"""Refresh failures must never turn a partial source collection into a publication."""
import importlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock

from api_fixtures import FakeClient, seoul, semas, stats, sales, store
from app.api_records import CollectionError


class RefreshTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('app.api_refresh'), 'refresh orchestration is required')
        return importlib.import_module('app.api_refresh')

    def test_complete_collection_preserves_source_period_and_never_connects(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            client=FakeClient(seoul([stats()]), seoul([sales()], service='VwsmAdstrdSelngW'), semas([store()],size=100))
            result=m.collect_refresh(Path(tmp)/'refresh', ['20251'],
                dict(SEOUL_OPENAPI_KEY='seoul-key', SEMAS_SERVICE_KEY='semas-key'),
                client=client, allow_seoul_http=True)
            self.assertEqual(result['quarters'], ['20251'])
            self.assertEqual(result['store_reference_month'], '202606')
            self.assertEqual(len(result['runs']), 3)
            self.assertTrue((Path(tmp)/'refresh/release.json').is_file())
            self.assertEqual((Path(tmp)/'refresh/release.json').stat().st_mode & 0o777, 0o600)
            self.assertNotIn('seoul-key', json.dumps(result))

    def test_empty_sales_stops_before_store_snapshot_and_creates_no_release(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            client=FakeClient(seoul([stats()]), {'RESULT':{'CODE':'INFO-200'}})
            with self.assertRaises(CollectionError):
                m.collect_refresh(Path(tmp)/'refresh', ['20251'],
                    dict(SEOUL_OPENAPI_KEY='key',SEMAS_SERVICE_KEY='key'),client=client)
            self.assertFalse((Path(tmp)/'refresh/release.json').exists())
            self.assertEqual(len(client.calls),2)

    def test_invalid_or_excessive_periods_fail_before_network_or_output(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            for periods in [[],['20255'],['20251','20251'],[f'{year}{q}' for year in range(2000,2011) for q in range(1,5)]]:
                client=FakeClient()
                with self.assertRaises(CollectionError):
                    m.collect_refresh(Path(tmp)/'refresh',periods,dict(SEOUL_OPENAPI_KEY='key',SEMAS_SERVICE_KEY='key'),client=client)
                self.assertEqual(client.calls,[])
                self.assertFalse((Path(tmp)/'refresh').exists())

    def test_refresh_keeps_older_validated_quarters(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            keys=dict(SEOUL_OPENAPI_KEY='key',SEMAS_SERVICE_KEY='key')
            m.collect_refresh(root/'first',['20251'],keys,client=FakeClient(
                seoul([stats()]),seoul([sales()],service='VwsmAdstrdSelngW'),semas([store()],size=100)))
            previous=[root/'first'/name for name in ['seoul-stores-20251','seoul-sales-20251','semas-stores']]
            result=m.collect_refresh(root/'next',['20252'],keys,previous_runs=previous,client=FakeClient(
                seoul([stats(STDR_YYQU_CD='20252')]),
                seoul([sales(STDR_YYQU_CD='20252')],service='VwsmAdstrdSelngW'),semas([store()],size=100)))
            self.assertEqual(result['quarters'],['20251','20252'])
            self.assertEqual(len(result['runs']),5)

    def test_older_store_reference_month_never_produces_a_refresh_release(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); keys=dict(SEOUL_OPENAPI_KEY='key',SEMAS_SERVICE_KEY='key')
            m.collect_refresh(root/'first',['20251'],keys,client=FakeClient(
                seoul([stats()]),seoul([sales()],service='VwsmAdstrdSelngW'),semas([store()],size=100)))
            previous=[root/'first'/name for name in ['seoul-stores-20251','seoul-sales-20251','semas-stores']]
            with self.assertRaisesRegex(CollectionError,'REFRESH_STORE_PERIOD_REGRESSION'):
                m.collect_refresh(root/'older',['20251'],keys,previous_runs=previous,client=FakeClient(
                    seoul([stats()]),seoul([sales()],service='VwsmAdstrdSelngW'),semas([store(stdrYm='202605')],size=100)))
            self.assertFalse((root/'older/release.json').exists())

    def test_actual_current_month_overrides_stale_previous_run_list(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            release=m.collect_refresh(Path(tmp)/'candidate',['20251'],
                dict(SEOUL_OPENAPI_KEY='key',SEMAS_SERVICE_KEY='key'),client=FakeClient(
                    seoul([stats()]),seoul([sales()],service='VwsmAdstrdSelngW'),semas([store()],size=100)))
            conn=MagicMock(); conn.autocommit=True; conn.info.transaction_status=0
            conn.cursor.return_value.__enter__.return_value.fetchone.return_value=('a'*64,'202607')
            with self.assertRaisesRegex(CollectionError,'REFRESH_STORE_PERIOD_REGRESSION'):
                m.refresh_release(conn,release,expected_current='a'*64,verify_identity=lambda c:None)


if __name__=='__main__': unittest.main()
