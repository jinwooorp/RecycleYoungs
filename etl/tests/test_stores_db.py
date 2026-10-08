"""Opt-in full-loader checks against an explicitly isolated V1/V2/V3 test database."""

from contextlib import redirect_stdout
from io import StringIO
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import etl_stores, main
from store_fixtures import store_rows, write_store_csv


DSN = os.environ.get('STORES_TEST_DSN')


@unittest.skipUnless(DSN, 'isolated STORES_TEST_DSN not provided')
class StoreDbTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not psycopg.conninfo.conninfo_to_dict(DSN).get('dbname', '').startswith('recycleyoungs_stores_test_'):
            raise AssertionError('Refusing non-isolated DB before connection')
        cls.conn = psycopg.connect(DSN, autocommit=True, row_factory=dict_row)
        with cls.conn.cursor() as cur:
            cur.execute('SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank')
            if [r['version'] for r in cur.fetchall()] != ['1', '2', '3']:
                raise AssertionError('requires actual Flyway V1/V2/V3')
            cur.execute("SELECT id FROM industries WHERE code='CAFE'")
            cls.cafe_id = cur.fetchone()['id']
            cur.execute("SELECT id FROM industries WHERE code='PUB'")
            cls.pub_id = cur.fetchone()['id']

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = write_store_csv(self.root / etl_stores.FILE)

    def load(self, chunk_size=1):
        with self.conn.transaction(), redirect_stdout(StringIO()), patch.object(etl_stores, 'STORE_CHUNK_SIZE', chunk_size):
            etl_stores.run(self.conn, self.path)

    def snapshot(self, include_ids=True):
        with self.conn.cursor() as cur:
            cur.execute("SELECT to_jsonb(s) AS value,i.code AS industry_code,encode(ST_AsBinary(s.location,'NDR'),'hex') AS wkb,ST_SRID(s.location) AS srid FROM stores s LEFT JOIN industries i ON i.id=s.industry_id ORDER BY s.source_store_id")
            result = cur.fetchall()
        if not include_ids:
            for r in result:
                r['value'].pop('id')
        return result

    def test_mapping_fk_attributes_points_and_logical_replay(self):
        self.load()
        rows = self.snapshot()
        self.assertEqual([r['industry_code'] for r in rows], ['CAFE', None, None, None])
        first = rows[0]['value']
        self.assertEqual(first['industry_id'], self.cafe_id)
        self.assertEqual(first['source_store_id'], '0001')
        self.assertEqual(first['name'], store_rows()[0]['상호명'])
        self.assertEqual(first['branch_name'], 'NA')
        self.assertEqual(first['source_small_category_code'], 'I21201')
        self.assertEqual(first['source_standard_industry_code'], 'I56229')
        self.assertEqual(first['source_medium_category_name'], '비알코올')
        self.assertEqual(first['sigungu_code'], '01110')
        self.assertEqual(first['dong_code'], '00110515')
        self.assertEqual(first['road_address'], store_rows()[0]['도로명주소'])
        self.assertEqual(rows[0]['wkb'], struct.pack('<BIdd', 1, 1, 127.0, 37.5).hex())
        self.assertEqual(rows[0]['srid'], 4326)
        self.assertIsNone(rows[2]['value']['source_small_category_code'])
        self.assertIsNone(rows[2]['wkb'])
        self.assertEqual(rows[3]['value']['longitude'], 127.2)
        self.assertIsNone(rows[3]['value']['latitude'])
        self.assertIsNone(rows[3]['wkb'])
        before = self.snapshot(include_ids=False)
        self.load(chunk_size=2)
        self.assertEqual(self.snapshot(include_ids=False), before)

    def test_all_invalid_mapping_states_reject_before_truncate_and_roll_back(self):
        self.load()
        before = self.snapshot()
        with self.conn.cursor() as cur:
            cur.execute("""CREATE FUNCTION stores_fixture_deny_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN RAISE EXCEPTION 'bad mapping must fail before TRUNCATE'; END $$;
              CREATE TRIGGER stores_fixture_deny_truncate BEFORE TRUNCATE ON stores
              FOR EACH STATEMENT EXECUTE FUNCTION stores_fixture_deny_truncate();""")
        try:
            for case in ['missing CAFE', 'missing mapping', 'wrong mapping']:
                with self.subTest(case=case), self.assertRaisesRegex(ValueError, 'CAFE|SEMAS'):
                    with self.conn.transaction():
                        with self.conn.cursor() as cur:
                            if case == 'missing CAFE':
                                cur.execute('UPDATE stores SET industry_id=NULL WHERE industry_id=%s', (self.cafe_id,))
                                cur.execute('DELETE FROM industry_mappings WHERE industry_id=%s', (self.cafe_id,))
                                cur.execute('DELETE FROM industries WHERE id=%s', (self.cafe_id,))
                            elif case == 'missing mapping':
                                cur.execute("DELETE FROM industry_mappings WHERE source='SEMAS' AND source_code='I21201'")
                            else:
                                cur.execute("UPDATE industry_mappings SET industry_id=%s WHERE source='SEMAS' AND source_code='I21201'", (self.pub_id,))
                        with redirect_stdout(StringIO()):
                            etl_stores.run(self.conn, self.path)
                self.assertEqual(self.snapshot(), before)
        finally:
            with self.conn.cursor() as cur:
                cur.execute('DROP TRIGGER stores_fixture_deny_truncate ON stores; DROP FUNCTION stores_fixture_deny_truncate()')

    def test_mid_chunk_copy_failure_restores_all_prior_rows(self):
        self.load()
        before = self.snapshot()
        with self.conn.cursor() as cur:
            cur.execute("""CREATE FUNCTION stores_fixture_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN IF NEW.source_store_id='0002' THEN RAISE EXCEPTION 'forced COPY chunk failure'; END IF;
              RETURN NEW; END $$;
              CREATE TRIGGER stores_fixture_fail_second AFTER INSERT ON stores
              FOR EACH ROW EXECUTE FUNCTION stores_fixture_fail_second();""")
        try:
            with self.assertRaisesRegex(psycopg.Error, 'forced COPY chunk failure'):
                self.load(chunk_size=1)
        finally:
            with self.conn.cursor() as cur:
                cur.execute('DROP TRIGGER stores_fixture_fail_second ON stores; DROP FUNCTION stores_fixture_fail_second()')
        self.assertEqual(self.snapshot(), before)

    def test_coordinate_failure_and_main_caller_transaction(self):
        self.load()
        before = self.snapshot()
        rows = store_rows()
        rows[1]['경도'] = '181'
        write_store_csv(self.path, rows)
        with self.assertRaisesRegex(ValueError, '경도 범위'):
            self.load(chunk_size=1)
        self.assertEqual(self.snapshot(), before)
        write_store_csv(self.path)
        def fresh_connection():
            return psycopg.connect(DSN, autocommit=True)
        with patch.object(main, 'get_connection', side_effect=fresh_connection), redirect_stdout(StringIO()):
            self.assertEqual(main.main(['--data-dir', str(self.root), '--only', 'stores']), 0)
        self.assertEqual([r['industry_code'] for r in self.snapshot()], ['CAFE', None, None, None])


if __name__ == '__main__':
    unittest.main()
