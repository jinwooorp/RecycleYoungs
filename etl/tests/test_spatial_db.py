"""Opt-in PostgreSQL tests; the caller must provide an isolated, migrated test DB."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.spatial_geometry import prepare_dataset
from spatial_fixtures import write_fixture
try:
    from app import spatial_load as loader
except ImportError:
    loader = None


class PublicationInterfaceTests(unittest.TestCase):
    def test_implicit_outer_transaction_is_rejected_before_queries(self):
        self.assertIsNotNone(loader, 'Polygon publication is not implemented')
        class WrongConnection:
            autocommit = False
        with self.assertRaisesRegex(ValueError, 'autocommit'):
            loader.publish(WrongConnection(), None)


DSN = os.environ.get('SPATIAL_TEST_DSN')


@unittest.skipUnless(DSN, 'isolated SPATIAL_TEST_DSN not provided')
class PublicationDbTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if loader is None:
            raise AssertionError('Polygon publication is not implemented')
        if not psycopg.conninfo.conninfo_to_dict(DSN).get('dbname', '').startswith('recycleyoungs_spatial_test_'):
            raise AssertionError('Refusing a non-isolated database name before connection')
        cls.conn = psycopg.connect(DSN, autocommit=True, row_factory=dict_row)
        if not cls.conn.info.dbname.startswith('recycleyoungs_spatial_test_'):
            cls.conn.close()
            raise AssertionError('Refusing a non-isolated database name')
        with cls.conn.cursor() as cur:
            cur.execute('SELECT version FROM public.flyway_schema_history WHERE success ORDER BY installed_rank')
            if [r['version'] for r in cur.fetchall()] != ['1', '2', '3']:
                raise AssertionError('test DB must have actual Flyway V1/V2/V3')
            for table in ['spatial_dataset_versions', 'admin_dong_boundaries', 'commercial_area_boundaries']:
                cur.execute(sql.SQL('SELECT count(*) AS n FROM public.{}').format(sql.Identifier(table)))
                if cur.fetchone()['n']:
                    raise AssertionError('test suite requires initially empty spatial tables')
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        with cls.conn.cursor() as cur:
            cur.execute("INSERT INTO stores(source_store_id,name,source_small_category_code,location) VALUES('preserve-store','original','G20405',ST_SetSRID(ST_MakePoint(127,37.55),4326))")
            cur.execute("INSERT INTO commercial_areas(commercial_area_code,name,location) VALUES('3110531','original',ST_SetSRID(ST_MakePoint(127,37.55),4326))")
            cur.execute("INSERT INTO store_stats_dong(quarter_code,dong_code,dong_name,source_industry_code,store_count) VALUES(20251,'11110515','original','CS100010',7)")
            cur.execute("INSERT INTO sales_dong(quarter_code,dong_code,dong_name,source_industry_code,sales_amount) VALUES(20251,'11110515','original','CS100010',9007199254740993)")
            cur.execute("INSERT INTO sales_commercial_area(quarter_code,commercial_area_code,source_industry_code,sales_amount) VALUES(20251,'3110531','CS100010',12345)")
        cls.original = cls.v1_snapshot()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()
        cls.conn.close()

    @classmethod
    def v1_snapshot(cls):
        result = {}
        with cls.conn.cursor() as cur:
            for table in ['stores', 'commercial_areas', 'store_stats_dong', 'sales_dong', 'sales_commercial_area', 'industry_mappings']:
                cur.execute(sql.SQL('SELECT to_jsonb(t) AS value FROM public.{} t ORDER BY id').format(sql.Identifier(table)))
                result[table] = [r['value'] for r in cur.fetchall()]
        return result

    def prepared(self, tag, commercial=False, codes=None):
        spec, archive, reports = write_fixture(self.root / tag, commercial=commercial, codes=codes)
        prepared = prepare_dataset(spec, archive, reports)
        # A fixed synthetic processing variant; never a production CLI override.
        profile = dict(prepared.profile, synthetic_case=tag)
        return replace(prepared, profile=profile)

    def version(self, version_id):
        with self.conn.cursor() as cur:
            cur.execute('SELECT * FROM public.spatial_dataset_versions WHERE id=%s', (version_id,))
            return cur.fetchone()

    def test_01_publication_retry_and_v1_preservation(self):
        prepared = self.prepared('retry')
        first = loader.publish(self.conn, prepared)
        version = self.version(first.version_id)
        self.assertEqual(version['load_status'], 'READY')
        self.assertTrue(version['is_current'])
        self.assertIsNotNone(version['loaded_at'])
        with self.conn.cursor() as cur:
            cur.execute('SELECT id,source_geometry_sha256,operational_geometry_sha256 FROM public.admin_dong_boundaries WHERE dataset_version_id=%s', (first.version_id,))
            before = cur.fetchall()
        second = loader.publish(self.conn, prepared)
        self.assertEqual(second.version_id, first.version_id)
        self.assertFalse(second.created)
        self.assertFalse(second.current_changed)
        self.assertEqual(self.version(first.version_id), version)
        with self.conn.cursor() as cur:
            cur.execute('SELECT id,source_geometry_sha256,operational_geometry_sha256 FROM public.admin_dong_boundaries WHERE dataset_version_id=%s', (first.version_id,))
            self.assertEqual(cur.fetchall(), before)
        self.assertEqual(self.v1_snapshot(), self.original)

    def test_02_commercial_attributes_and_hashes(self):
        prepared = self.prepared('commercial', commercial=True)
        result = loader.publish(self.conn, prepared)
        with self.conn.cursor() as cur:
            cur.execute('SELECT source_sigungu_code,source_dong_code,source_attribute_status,ST_SRID(operational_geometry) AS srid FROM public.commercial_area_boundaries WHERE dataset_version_id=%s', (result.version_id,))
            row = cur.fetchone()
        self.assertEqual((row['source_sigungu_code'], row['source_dong_code']), ('11110', '11410660'))
        self.assertEqual(row['source_attribute_status'], 'CONFLICT_OBSERVED')
        self.assertEqual(row['srid'], 5181)

    def test_03_existing_ready_row_and_provenance_mismatch_are_rejected(self):
        prepared = self.prepared('mismatch')
        result = loader.publish(self.conn, prepared)
        before = self.version(result.version_id)
        changed = replace(prepared, features=(replace(prepared.features[0], name='different'),))
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            loader.publish(self.conn, changed)
        original_url = prepared.spec.provenance['source_url']
        prepared.spec.provenance['source_url'] = 'https://example.invalid/changed'
        try:
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                loader.publish(self.conn, prepared)
        finally:
            prepared.spec.provenance['source_url'] = original_url
        self.assertEqual(self.version(result.version_id), before)

    def test_04_pending_incomplete_is_not_reused_or_deleted(self):
        prepared = self.prepared('pending')
        metadata = loader.dataset_metadata(self.conn, prepared)
        with self.conn.cursor() as cur:
            values = [Jsonb(v) if isinstance(v, dict) else v for v in metadata.values()]
            cur.execute(sql.SQL('INSERT INTO public.spatial_dataset_versions ({}) VALUES ({}) RETURNING id').format(
                sql.SQL(',').join(map(sql.Identifier, metadata)), sql.SQL(',').join(sql.Placeholder() for _ in metadata)), values)
            version_id = cur.fetchone()['id']
        before = self.version(version_id)
        with self.assertRaisesRegex(ValueError, 'PENDING'):
            loader.publish(self.conn, prepared)
        self.assertEqual(self.version(version_id), before)

    def test_05_partial_insert_failure_rolls_back_and_preserves_current(self):
        previous = loader.publish(self.conn, self.prepared('before-insert-failure'))
        candidate = self.prepared('insert-failure', codes=['00110515', '00110530'])
        with self.conn.cursor() as cur:
            cur.execute("""CREATE FUNCTION fixture_fail_second() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
              IF NEW.source_feature_index=1 THEN RAISE EXCEPTION 'fixture middle insert failure'; END IF;
              RETURN NEW; END $$;
              CREATE TRIGGER fixture_fail_second AFTER INSERT ON public.admin_dong_boundaries
              FOR EACH ROW EXECUTE FUNCTION fixture_fail_second();""")
        try:
            with self.assertRaisesRegex(psycopg.Error, 'fixture middle insert failure'):
                loader.publish(self.conn, candidate)
        finally:
            with self.conn.cursor() as cur:
                cur.execute('DROP TRIGGER fixture_fail_second ON public.admin_dong_boundaries; DROP FUNCTION fixture_fail_second()')
        self.assertTrue(self.version(previous.version_id)['is_current'])
        with self.conn.cursor() as cur:
            cur.execute('SELECT count(*) AS n FROM public.spatial_dataset_versions WHERE processing_profile_sha256=%s', (loader.dataset_metadata(self.conn, candidate)['processing_profile_sha256'],))
            self.assertEqual(cur.fetchone()['n'], 0)
        self.assertEqual(self.v1_snapshot(), self.original)

    def test_06_current_switch_failure_restores_previous_current(self):
        previous = loader.publish(self.conn, self.prepared('before-switch-failure'))
        candidate = self.prepared('switch-failure')
        with self.conn.cursor() as cur:
            cur.execute("""CREATE FUNCTION fixture_fail_current() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
              IF NEW.is_current AND NEW.processing_metadata->>'synthetic_case'='switch-failure'
              THEN RAISE EXCEPTION 'fixture current switch failure'; END IF;
              RETURN NEW; END $$;
              CREATE TRIGGER fixture_fail_current BEFORE UPDATE ON public.spatial_dataset_versions
              FOR EACH ROW EXECUTE FUNCTION fixture_fail_current();""")
        try:
            with self.assertRaisesRegex(psycopg.Error, 'fixture current switch failure'):
                loader.publish(self.conn, candidate)
        finally:
            with self.conn.cursor() as cur:
                cur.execute('DROP TRIGGER fixture_fail_current ON public.spatial_dataset_versions; DROP FUNCTION fixture_fail_current()')
        self.assertTrue(self.version(previous.version_id)['is_current'])

    def test_07_concurrent_same_profile_publication_is_serialized(self):
        prepared = self.prepared('concurrency')
        def work():
            with psycopg.connect(DSN, autocommit=True) as conn:
                return loader.publish(conn, prepared)
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: work(), range(2)))
        self.assertEqual(results[0].version_id, results[1].version_id)
        self.assertEqual(sum(r.created for r in results), 1)

    def test_08_current_uniqueness_and_boundary_immutability_guards(self):
        first = loader.publish(self.conn, self.prepared('guard-first'))
        second = loader.publish(self.conn, self.prepared('guard-second'))
        with self.assertRaises(psycopg.Error), self.conn.cursor() as cur:
            cur.execute('UPDATE public.spatial_dataset_versions SET is_current=true WHERE id=%s', (first.version_id,))
        for action in ["UPDATE public.admin_dong_boundaries SET dong_name='changed' WHERE dataset_version_id=%s",
                       'DELETE FROM public.admin_dong_boundaries WHERE dataset_version_id=%s']:
            with self.assertRaises(psycopg.Error), self.conn.cursor() as cur:
                cur.execute(action, (second.version_id,))
        self.assertEqual(self.v1_snapshot(), self.original)


if __name__ == '__main__':
    unittest.main()
