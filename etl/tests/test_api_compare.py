import csv
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from api_fixtures import FakeClient, sales, seoul, semas, stats, store
from app.api_artifacts import write_run
from app import seoul_api, semas_api


class CompareTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('app.api_compare'), 'Repeatable DB-free parity check is required')
        return importlib.import_module('app.api_compare')

    def csv_file(self, root, source, rows):
        m = self.module()
        mapping = m.csv_fields(source)
        path = root / (source + '.csv')
        with path.open('w', encoding='utf-8-sig' if source == 'semas-stores' else 'cp949', newline='') as target:
            writer = csv.DictWriter(target, fieldnames=list(mapping.values()))
            writer.writeheader()
            for row in rows:
                writer.writerow({mapping[key]: row.get(key, '') for key in mapping})
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def run_dir(self, root, source, rows, **scope):
        run = root / 'run'
        if source == 'semas-stores':
            pages = semas_api.pages(FakeClient(semas(rows, size=100)), 'key', industry='I21201')
            scope = dict(region='11', industry='I21201') | scope
        else:
            scope = dict(quarter='20251', region='SEOUL', industry='ALL_SOURCE_INDUSTRIES') | scope
            service = 'VwsmAdstrdStorW' if source == 'seoul-stores' else 'VwsmAdstrdSelngW'
            pages = seoul_api.pages(FakeClient(seoul(rows, service=service)), source.removeprefix('seoul-'), scope['quarter'], 'key')
        write_run(run, pages, source=source, scope=scope, mode='collect')
        return run

    def test_full_stats_match_excludes_other_quarters(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'seoul-stores', [stats()])
            csv_path, digest = self.csv_file(root, 'seoul-stores', [stats(OPBIZ_RT='1.2500'), stats(STDR_YYQU_CD='20252')])
            result = m.compare_run(run, csv_path, digest)
            self.assertEqual(result['status'], 'MATCH')
            self.assertEqual(result['baseline_scope_count'], 1)
            self.assertEqual(result['baseline_total_count'], 2)

    def test_sales_mapping_and_big_integer_exact_match(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture = sales(THSMON_SELNG_AMT='9007199254740993', TMZON_06_11_SELNG_CO='2')
            run = self.run_dir(root, 'seoul-sales', [fixture])
            path, digest = self.csv_file(root, 'seoul-sales', [fixture])
            self.assertEqual(m.compare_run(run, path, digest)['status'], 'MATCH')

    def test_null_zero_and_changed_integer_are_distinct(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'seoul-stores', [stats(STOR_CO=None, CLSBIZ_STOR_CO='1')])
            path, digest = self.csv_file(root, 'seoul-stores', [stats(STOR_CO='0', CLSBIZ_STOR_CO='0')])
            result = m.compare_run(run, path, digest)
            self.assertEqual(result['status'], 'DIFFERENT')
            self.assertEqual(result['changed_rows'], 1)
            self.assertEqual(result['field_differences']['store_count']['value_to_null'], 1)
            self.assertEqual(result['field_differences']['closing_store_count']['zero_to_nonzero'], 1)

    def test_missing_extra_keys_are_reported_without_values(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'seoul-stores', [stats(ADSTRD_CD='11110530')])
            path, digest = self.csv_file(root, 'seoul-stores', [stats()])
            result = m.compare_run(run, path, digest)
            self.assertEqual(result['api_only_keys'], 1)
            self.assertEqual(result['baseline_only_keys'], 1)
            self.assertNotIn('합성동', json.dumps(result, ensure_ascii=False))

    def test_semas_cafe_scope_preserves_identifiers_and_decimal_coordinates(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'semas-stores', [store()])
            path, digest = self.csv_file(root, 'semas-stores', [store(lon='126.97000'), store(bizesId='other', indsSclsCd='I21202')])
            result = m.compare_run(run, path, digest, baseline_reference_month='202606')
            self.assertEqual(result['status'], 'MATCH')
            self.assertEqual(result['baseline_scope_count'], 1)
            self.assertIn('location', result['excluded_derived_fields'])

    def test_unverified_csv_and_changed_normalized_output_are_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'seoul-stores', [stats()])
            path, digest = self.csv_file(root, 'seoul-stores', [stats()])
            with self.assertRaises(m.CollectionError): m.compare_run(run, path, '0' * 64)
            (run / 'normalized.jsonl').write_text('{}\n')
            with self.assertRaises(m.CollectionError): m.compare_run(run, path, digest)

    def test_duplicate_baseline_is_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'seoul-stores', [stats()])
            path, digest = self.csv_file(root, 'seoul-stores', [stats(), stats()])
            with self.assertRaises(m.CollectionError): m.compare_run(run, path, digest)

    def test_probe_manifest_is_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'seoul-stores', [stats()])
            path, digest = self.csv_file(root, 'seoul-stores', [stats()])
            manifest = json.loads((run / 'manifest.json').read_text())
            manifest['status'] = 'PROBE_ONLY'
            (run / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(m.CollectionError, 'INCOMPLETE_API_RUN'):
                m.compare_run(run, path, digest)

    def test_punctuation_is_a_difference_not_an_automatic_correction(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = self.run_dir(root, 'semas-stores', [store(bizesNm='A,B')])
            path, digest = self.csv_file(root, 'semas-stores', [store(bizesNm='A;B')])
            result = m.compare_run(run, path, digest, baseline_reference_month='202606')
            self.assertEqual(result['status'], 'DIFFERENT')
            self.assertEqual(result['field_differences']['name']['other'], 1)


if __name__ == '__main__':
    unittest.main()
