"""Reference publications are complete, versioned, replayable and never scores."""
import copy
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app import seoul_reference as reference


class ReferenceReleaseTests(unittest.TestCase):
    def module(self):
        try: return importlib.import_module('app.reference_release')
        except ModuleNotFoundError: self.fail('versioned reference publication is missing')

    def exports(self, root):
        root.chmod(0o700)
        parking = {key: '' for key in reference.PARKING_FIELDS}
        parking.update(PKLT_CD='P1', PKLT_NM='시험주차장', ADDR='종로구 시험로', TPKCT='20')
        rows = {
            'seoul-public-parking': parking,
            'seoul-bus-stops': dict(NODE_ID='100000001', STOPS_NO='00101', STOPS_NM='시험정류장', STOPS_TYPE='일반', XCRD='127', YCRD='37.5'),
            'seoul-metro-leases': dict(SHPS_NO='1', STN_NM='시험역', STN_CD='001', TPBIZ='판매', AREA='25.5', MM_RTFE='2000000', CTRT_STRT_DD='', CTRT_END_DD=''),
        }
        outputs = {}
        for source, row in rows.items():
            service = reference.SOURCES[source]['service']
            class Client:
                def get_json(self, url, *, secret):
                    body = {service: dict(RESULT=dict(CODE='INFO-000'), list_total_count=1, row=[row])}
                    return body, json.dumps(body).encode()
            output = root / source
            reference.collect_reference(output, source, 'test', client=Client(), allow_http=True)
            outputs[source] = output
        return outputs

    def test_prepared_catalog_is_order_independent_and_keeps_reference_policy(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            paths = self.exports(Path(d).resolve()); a = m.prepare_catalog(paths)
            b = m.prepare_catalog(dict(reversed(list(paths.items()))))
            self.assertEqual(a['catalog_id'], b['catalog_id'])
            self.assertTrue(all(not value['manifest']['policy']['scoreReady'] for value in a['sources'].values()))
            m.verify_catalog(a)

    def test_missing_source_and_mutated_prepared_values_are_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            paths = self.exports(Path(d).resolve())
            with self.assertRaisesRegex(ValueError, 'REFERENCE_SOURCE_SET_REQUIRED'):
                m.prepare_catalog({'seoul-bus-stops': paths['seoul-bus-stops']})
            catalog = m.prepare_catalog(paths)
            changed = copy.deepcopy(catalog)
            changed['sources']['seoul-public-parking']['records'][0]['metrics']['TPKCT']['value'] = '999'
            with self.assertRaisesRegex(ValueError, 'REFERENCE_PREPARED_CHANGED'):
                m.verify_catalog(changed)

    def test_stale_expected_catalog_is_not_a_new_publication(self):
        m = self.module(); current = {'seoul-bus-stops': 'a' * 64}
        m.require_expected_catalog(current, current)
        with self.assertRaisesRegex(ValueError, 'REFERENCE_PUBLICATION_CONFLICT'):
            m.require_expected_catalog(current, {'seoul-bus-stops': 'b' * 64})

    def test_automatic_publication_rejects_missing_keys_raw_rows_and_past_snapshots(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'require_catalog_successor',None)))
        with tempfile.TemporaryDirectory() as d:
            catalog=m.prepare_catalog(self.exports(Path(d).resolve()))
            m.require_catalog_successor(catalog,catalog)
            old=copy.deepcopy(catalog)
            old['sources']['seoul-bus-stops']['records'].append(dict(reference_id='removed'))
            with self.assertRaisesRegex(ValueError,'REFERENCE_RECORD_LOSS_REQUIRES_REVIEW'):
                m.require_catalog_successor(old,catalog)
            old=copy.deepcopy(catalog);old['sources']['seoul-public-parking']['manifest']['received_count']+=1
            with self.assertRaisesRegex(ValueError,'REFERENCE_RAW_ROW_LOSS_REQUIRES_REVIEW'):
                m.require_catalog_successor(old,catalog)
            old=copy.deepcopy(catalog);old['sources']['seoul-bus-stops']['manifest']['collected_at']='2099-01-01T00:00:00Z'
            with self.assertRaisesRegex(ValueError,'REFERENCE_TIME_REGRESSION'):
                m.require_catalog_successor(old,catalog)

    def test_failed_source_cannot_produce_a_partial_refresh_catalog(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'collect_catalog', None)))
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); root.chmod(0o700); output = root / 'reference-runs' / 'fresh'
            def broken(path, source, key, **options):
                path.mkdir(mode=0o700)
                if source == 'seoul-metro-leases': raise ValueError('SOURCE_FAILED')
            with patch.object(reference, 'collect_reference', side_effect=broken):
                with self.assertRaisesRegex(ValueError, 'SOURCE_FAILED'):
                    m.collect_catalog(output, 'test', client=object(), allow_http=True)
            self.assertTrue(output.exists(), 'failure evidence must survive')
            with self.assertRaises(FileExistsError):
                m.collect_catalog(output, 'test', client=object(), allow_http=True)

    def test_identity_is_required_before_any_staging_connection(self):
        m = self.module()
        with self.assertRaisesRegex(ValueError, 'REFERENCE_IDENTITY_REQUIRED'):
            m.stage_catalog(object(), {}, verify_identity=None)

    def test_registered_record_validation_is_independent_of_database_locale(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'verify_registered_records',None)))
        records=[dict(reference_id='10-1',attributes={},attribute_states={},metrics={}),
                 dict(reference_id='101',attributes={},attribute_states={},metrics={})]
        actual=[('101',{},{},{},1),('10-1',{},{},{},1)]
        m.verify_registered_records(actual,records)
        with self.assertRaisesRegex(ValueError,'REFERENCE_REGISTERED_RECORDS_CHANGED'):
            m.verify_registered_records([actual[0],actual[0]],records)

    def test_reference_policy_contract_is_shared_without_changing_context_v1(self):
        root = Path(__file__).resolve().parents[2]
        backend = root / 'backend/src/main/resources/contracts/current-reference-policy-v1.json'
        frontend = root / 'frontend/src/contracts/current-reference-policy-v1.json'
        self.assertTrue(backend.is_file(), 'current source policy contract is required')
        self.assertEqual(backend.read_bytes(), frontend.read_bytes())
        value = json.loads(backend.read_text())
        self.assertEqual(value, dict(model='SEOUL_CURRENT_REFERENCE_V1', sources={s: dict(
            policy=reference.policy(s), version=reference.digest(reference.policy(s))) for s in sorted(reference.SOURCES)}))

    def test_new_reference_schema_requires_explicit_fresh_v6_receipt(self):
        from api_runtime import verify_fresh_migration
        files = {f'/sql/V{i}__schema.sql': 'a' * 64 for i in range(1, 7)}
        response = dict(flywayVersion='12.4.0', operation='migrate', success=True, migrationsExecuted=6,
                        migrations=[dict(version=str(i), filepath=f'/sql/V{i}__schema.sql') for i in range(1, 7)])
        self.assertEqual(verify_fresh_migration(response, files)['versions'], [1, 2, 3, 4, 5, 6])


if __name__ == '__main__': unittest.main()
