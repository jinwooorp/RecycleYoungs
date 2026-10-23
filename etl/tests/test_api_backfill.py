"""Historical additions never replace existing quarters or recollect SEMAS."""
import importlib
from pathlib import Path
import tempfile
import unittest

from api_fixtures import FakeClient, stats, sales, store, seoul
from app.api_artifacts import write_run
from app.api_records import Page, normalize_store_stats, normalize_sales, normalize_store, CollectionError


class BackfillTests(unittest.TestCase):
    def baseline(self, root):
        paths=[]
        for source, row, normalized, scope in [
            ('seoul-stores', stats(), normalize_store_stats(stats(), '20251'), dict(quarter='20251',region='SEOUL',industry='ALL_SOURCE_INDUSTRIES')),
            ('seoul-sales', sales(), normalize_sales(sales(), '20251'), dict(quarter='20251',region='SEOUL',industry='ALL_SOURCE_INDUSTRIES')),
            ('semas-stores', store(), normalize_store(store(), 'I21201'), dict(region='11',industry='I21201'))]:
            path=root/source
            write_run(path,[Page(1,1,(normalized,),b'{}',('202606' if source=='semas-stores' else '20251',))],
                      source=source,scope=scope,mode='collect');paths.append(path)
        return paths

    def test_backfill_adds_only_missing_pairs_preserves_snapshot_and_records_baseline(self):
        m=importlib.import_module('app.api_backfill')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); paths=self.baseline(root)
            before={str(p): (p/'manifest.json').read_bytes() for p in paths}
            client=FakeClient(seoul([stats(STDR_YYQU_CD='20214')]),
                              seoul([sales(STDR_YYQU_CD='20214')],service='VwsmAdstrdSelngW'))
            result=m.collect_backfill(root/'added',['20214'],{'SEOUL_OPENAPI_KEY':'synthetic'},previous_runs=paths,client=client)
            self.assertEqual(result['quarters'],['20214','20251'])
            self.assertEqual(result['store_reference_month'],'202606')
            self.assertEqual(len(client.calls),2)
            self.assertTrue(all('seoul.go.kr' in url for url in client.calls))
            self.assertTrue((root/'added/release.json').exists())
            self.assertTrue((root/'added/backfill.json').exists())
            self.assertEqual(before,{str(p):(p/'manifest.json').read_bytes() for p in paths})

    def test_existing_scope_empty_and_excessive_input_fail_before_network(self):
        m=importlib.import_module('app.api_backfill')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);paths=self.baseline(root)
            for periods in [[],['20251'],['20214','20214'],['20215'],[f'{y}{q}' for y in range(2000,2011) for q in range(1,5)]]:
                client=FakeClient()
                with self.assertRaises(CollectionError):
                    m.collect_backfill(root/'invalid',periods,{'SEOUL_OPENAPI_KEY':'synthetic'},previous_runs=paths,client=client)
                self.assertEqual(client.calls,[]);self.assertFalse((root/'invalid').exists())

    def test_empty_half_pair_keeps_failed_run_and_never_creates_release(self):
        m=importlib.import_module('app.api_backfill')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);paths=self.baseline(root)
            with self.assertRaises(CollectionError):
                m.collect_backfill(root/'failed',['20214'],{'SEOUL_OPENAPI_KEY':'synthetic'},previous_runs=paths,
                    client=FakeClient(seoul([stats(STDR_YYQU_CD='20214')]),{'RESULT':{'CODE':'INFO-200'}}))
            self.assertFalse((root/'failed/release.json').exists())
            self.assertTrue((root/'failed/seoul-stores-20214/manifest.json').exists())

    def test_negative_source_count_stays_failed_without_coercion_or_partial_release(self):
        m=importlib.import_module('app.api_backfill')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);paths=self.baseline(root)
            with self.assertRaisesRegex(CollectionError,'INVALID_INTEGER'):
                m.collect_backfill(root/'failed',['20214'],{'SEOUL_OPENAPI_KEY':'synthetic'},previous_runs=paths,
                    client=FakeClient(seoul([stats(STDR_YYQU_CD='20214')]),
                        seoul([sales(STDR_YYQU_CD='20214',TMZON_06_11_SELNG_CO='-1')],service='VwsmAdstrdSelngW')))
            self.assertFalse((root/'failed/release.json').exists())
            self.assertEqual(len(list((root/'failed/seoul-sales-20214/pages').iterdir())),0)
