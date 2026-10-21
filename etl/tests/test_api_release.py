"""Synthetic release validation and transaction boundaries; never connect to a DB."""
import importlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock

from api_fixtures import stats, sales, store
from app.api_artifacts import encoded, write_run
from app.api_records import Page, normalize_store_stats, normalize_sales, normalize_store


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.runs = []
        for source, raw, normalize in [('seoul-stores', stats(), normalize_store_stats),
                                        ('seoul-sales', sales(), normalize_sales)]:
            path = self.root / source
            write_run(path, [Page(1, 1, (normalize(raw, '20251'),), b'{}', ('20251',))],
                      source=source, scope=dict(quarter='20251', region='SEOUL', industry='ALL_SOURCE_INDUSTRIES'), mode='collect')
            self.runs.append(path)
        path = self.root / 'semas'
        write_run(path, [Page(1, 1, (normalize_store(store(bizesNm='A,B'), 'I21201'),), b'{}', ('202606',))],
                  source='semas-stores', scope=dict(region='11', industry='I21201'), mode='collect')
        self.runs.append(path)

    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('app.api_release'), 'API release validation is required')
        return importlib.import_module('app.api_release')

    def test_complete_release_is_order_independent_and_keeps_source_text(self):
        m = self.module()
        release = m.prepare_release(self.runs)
        self.assertEqual(release, m.prepare_release(list(reversed(self.runs))))
        self.assertEqual(release['quarters'], ['20251'])
        self.assertEqual(release['store_reference_month'], '202606')
        self.assertEqual(release['store_scope'], 'I21201')
        self.assertEqual(len(release['release_id']), 64)
        semas = next(r for r in release['runs'] if r['source']=='semas-stores')
        self.assertEqual(semas['records'][0]['name'], 'A,B')

    def test_missing_pair_and_duplicate_scope_are_rejected(self):
        m = self.module()
        for runs in [self.runs[1:], self.runs + self.runs[:1], self.runs[:2]]:
            with self.subTest(runs=len(runs)), self.assertRaises(m.CollectionError):
                m.prepare_release(runs)

    def test_conflicting_dong_names_within_one_source_are_rejected(self):
        m=self.module(); path=self.root/'conflicting-stats'
        rows=(normalize_store_stats(stats(ADSTRD_CD_NM='이름A'),'20251'),
              normalize_store_stats(stats(ADSTRD_CD_NM='이름B',SVC_INDUTY_CD='CS100001'),'20251'))
        write_run(path,[Page(1,2,rows,b'{}',('20251',))],source='seoul-stores',
                  scope=dict(quarter='20251',region='SEOUL',industry='ALL_SOURCE_INDUSTRIES'),mode='collect')
        with self.assertRaisesRegex(m.CollectionError,'CONFLICTING_DONG_NAME'):
            m.prepare_release([path,*self.runs[1:]])

    def test_raw_or_normalized_tampering_and_incomplete_run_are_rejected(self):
        m = self.module()
        raw = self.runs[0] / 'pages/000001.json'
        raw.write_bytes(b'{"changed":true}')
        with self.assertRaisesRegex(m.CollectionError, 'RAW_SHA_MISMATCH'):
            m.prepare_release(self.runs)
        raw.write_bytes(b'{}')
        manifest = self.runs[0] / 'manifest.json'
        data=json.loads(manifest.read_text()); data['complete']=False
        manifest.write_bytes(encoded(data))
        with self.assertRaisesRegex(m.CollectionError, 'INCOMPLETE_API_RUN'):
            m.prepare_release(self.runs)

    def test_stage_requires_identity_on_same_connection_before_writes(self):
        m=self.module(); release=m.prepare_release(self.runs)
        conn=MagicMock(); conn.autocommit=True
        conn.info.transaction_status=0
        def reject(connection):
            self.assertIs(connection, conn)
            raise ValueError('identity mismatch')
        with self.assertRaises(ValueError):
            m.stage_release(conn, release, verify_identity=reject)
        conn.cursor.assert_not_called()

    def test_modified_prepared_release_is_rejected_before_db_access(self):
        m=self.module(); release=m.prepare_release(self.runs)
        release['runs'][0]['records'][0]['name']='injected'
        conn=MagicMock()
        with self.assertRaisesRegex(m.CollectionError, 'RELEASE_DIGEST_MISMATCH'):
            m.stage_release(conn, release, verify_identity=MagicMock())
        conn.transaction.assert_not_called()

    def test_rehashed_incomplete_layout_is_rejected_before_db_access(self):
        m=self.module(); release=m.prepare_release(self.runs)
        release['quarters']=['20262']
        release['release_id']=m.digest({k:v for k,v in release.items() if k!='release_id'})
        conn=MagicMock()
        with self.assertRaisesRegex(m.CollectionError, 'RELEASE_LAYOUT_MISMATCH'):
            m.stage_release(conn, release, verify_identity=MagicMock())
        conn.transaction.assert_not_called()

    def test_successful_stage_seals_rows_without_publishing(self):
        m=self.module(); release=m.prepare_release(self.runs)
        conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect=[None,(1,),(1,),(1,)]
        cur.fetchall.return_value=[('I21201',1,'CAFE'),('CS100010',1,'CAFE')]
        self.assertTrue(m.stage_release(conn, release, verify_identity=lambda c:None))
        self.assertEqual(cur.copy.call_count,3)
        sql=[c.args[0] for c in cur.execute.call_args_list]
        self.assertTrue(any("SET status='READY'" in s for s in sql))
        self.assertFalse(any('UPDATE api_current_release' in s for s in sql))

    def test_publication_writes_only_after_ready_and_expected_version_checks(self):
        m=self.module(); conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect=[(None,),('READY',)]
        self.assertTrue(m.publish_release(conn,'a'*64,expected_current=None,verify_identity=lambda c:None))
        cur.execute.assert_called_with('UPDATE api_current_release SET release_id=%s WHERE singleton=true',('a'*64,))

    def test_publication_retry_after_lost_response_is_a_noop(self):
        m=self.module(); conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect=[('a'*64,),('READY',)]
        self.assertFalse(m.publish_release(conn,'a'*64,expected_current='b'*64,verify_identity=lambda c:None))
        self.assertFalse(any('UPDATE api_current_release' in c.args[0] for c in cur.execute.call_args_list))

    def test_copy_failure_exits_transaction_and_never_publishes(self):
        m=self.module(); release=m.prepare_release(self.runs)
        conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value=None
        cur.fetchall.return_value=[('I21201',1,'CAFE'),('CS100010',1,'CAFE')]
        cur.copy.return_value.__enter__.return_value.write_row.side_effect=RuntimeError('injected copy failure')
        with self.assertRaises(RuntimeError):
            m.stage_release(conn, release, verify_identity=lambda c:None)
        self.assertIs(conn.transaction.return_value.__exit__.call_args.args[0], RuntimeError)
        self.assertFalse(any('UPDATE api_current_release' in c.args[0] for c in cur.execute.call_args_list))

    def test_publication_uses_expected_current_version_and_ready_release(self):
        m=self.module(); conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect=[('old',), ('READY',)]
        with self.assertRaisesRegex(m.CollectionError, 'CURRENT_RELEASE_CHANGED'):
            m.publish_release(conn,'a'*64,expected_current=None,verify_identity=lambda c:None)
        self.assertFalse(any('UPDATE api_current_release' in c.args[0] for c in cur.execute.call_args_list))

    def test_publication_cannot_hide_previously_published_quarters(self):
        m=self.module(); conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect=[('b'*64,),('READY',),(False,)]
        with self.assertRaisesRegex(m.CollectionError,'RELEASE_PERIOD_LOSS'):
            m.publish_release(conn,'a'*64,expected_current='b'*64,verify_identity=lambda c:None)

    def test_publication_cannot_drop_non_cafe_api_snapshot_by_narrowing_scope(self):
        m=self.module(); conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
        cur=conn.cursor.return_value.__enter__.return_value
        cur.fetchone.side_effect=[('b'*64,),('READY',),(True,),(False,)]
        with self.assertRaisesRegex(m.CollectionError,'RELEASE_SCOPE_NARROWING'):
            m.publish_release(conn,'a'*64,expected_current='b'*64,verify_identity=lambda c:None)


if __name__ == '__main__': unittest.main()
