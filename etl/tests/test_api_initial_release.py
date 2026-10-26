"""Fresh contract2 startup uses public synthetic sources, never Docker or DB."""
from pathlib import Path
import importlib,json,tempfile,unittest
from api_fixtures import FakeClient,seoul,semas,stats,sales,store
from test_seoul_context import source_row
from app.api_records import CollectionError
from app.api_context_release import ACTIVE_SOURCES,read_release_bundle
from app.seoul_context import SOURCES

PERIODS=[str(y)+str(q) for y in range(2021,2027) for q in range(1,5) if (y,q)<=(2026,2)]
CASES={'20222':('11470610','CS300043'),'20243':('11440655','CS200024')}

class InitialReleaseTests(unittest.TestCase):
    def module(self):return importlib.import_module('app.api_initial_release')
    def client(self,*,bad_count='-1.0',missing_context=False,periods=PERIODS):
        responses=[]
        for q in periods:
            responses.append(seoul([stats(STDR_YYQU_CD=q)]))
            rows=[sales(STDR_YYQU_CD=q)]
            if q in CASES:
                dong,industry=CASES[q]
                rows.append(sales(STDR_YYQU_CD=q,ADSTRD_CD=dong,SVC_INDUTY_CD=industry,TMZON_06_11_SELNG_CO=bad_count))
            responses.append(seoul(rows,service='VwsmAdstrdSelngW'))
        responses.append(semas([store()],size=100))
        for source in ACTIVE_SOURCES:
            spec=SOURCES[source];raw=source_row(spec,STDR_YYQU_CD='20251')
            if source=='seoul-change':raw.update(TRDAR_CHNGE_IX='LL',TRDAR_CHNGE_IX_NM='다이나믹')
            responses.append(seoul([] if missing_context and source=='seoul-workers' else [raw],service=spec.service))
        return FakeClient(*responses)
    def collect(self,output,**kwargs):
        return self.module().collect_initial_release(output,PERIODS,{'SEOUL_OPENAPI_KEY':'synthetic','SEMAS_SERVICE_KEY':'synthetic'},client=self.client(**kwargs),allow_seoul_http=True)
    def test_fresh_bundle_has_twenty_two_quarters_five_contexts_and_exact_two_held_rows(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);release=self.collect(root/'initial');saved=read_release_bundle(root/'initial/bundle')
            self.assertEqual(release['release_id'],saved['release_id']);self.assertEqual(saved['quarters'],PERIODS)
            self.assertEqual(saved['contract_version'],2);self.assertEqual(len(saved['runs']),45)
            self.assertEqual(saved['quality_policy']['quarantined_count'],2)
            self.assertEqual({x['quarter_code'] for x in saved['quality_policy']['approval']['cases']},{'20222','20243'})
            self.assertEqual({k for k,e in saved['context_sources'].items() if e['run']}, {'population','residents','workers','facilities','change'})
            self.assertEqual(saved['context_sources']['consumption'],dict(state='WITHHELD',run=None))
            self.assertFalse(any(x['score_ready'] for x in saved['context_policy']['sections'].values()))
            self.assertEqual(len(saved['baseline']['runs']),13)
            self.assertEqual({r['period'] for r in saved['baseline']['runs'] if r['source']=='seoul-stores'},set(PERIODS[-6:]))
            held_manifests=[]
            for path in (root/'initial/bundle/evidence').glob('*/run/manifest.json'):
                held=json.loads(path.read_text())
                if held.get('policy_id'):
                    self.assertFalse(held['complete']);self.assertTrue(held['raw_complete']);self.assertEqual(held['quarantined_count'],1)
                    held_manifests.append(held['scope']['quarter'])
            self.assertEqual(set(held_manifests),set(CASES))
            self.assertEqual([p.name for p in (root/'initial').iterdir()],['bundle'])
            # A bundle is not a metadata-only assertion: raw changes fail replay.
            raw=next((root/'initial/bundle/evidence').glob('*/run/pages/*.json'));raw.write_bytes(raw.read_bytes()+b' ')
            with self.assertRaises(CollectionError):read_release_bundle(root/'initial/bundle')
    def test_next_refresh_reuses_initial_bundle_after_collection_copies_are_removed(self):
        from app.api_context_refresh import collect_context_refresh
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);previous=self.collect(root/'initial')
            fresh=collect_context_refresh(root/'refresh',['20262'],
                {'SEOUL_OPENAPI_KEY':'synthetic','SEMAS_SERVICE_KEY':'synthetic'},
                previous_release=previous,client=self.client(periods=['20262']),allow_seoul_http=True)
            saved=read_release_bundle(root/'refresh/bundle')
            self.assertEqual(saved['release_id'],fresh['release_id'])
            self.assertEqual(saved['quarters'],PERIODS)
            self.assertEqual(saved['quality_policy']['quarantined_count'],2)
            self.assertEqual(saved['baseline'],previous['baseline'])
            self.assertEqual(saved['refresh_parent'],previous['release_id'])
            self.assertEqual(len(saved['baseline_archive']),13)
            self.assertEqual([p.name for p in (root/'initial').iterdir()],['bundle'])

    def test_unknown_quality_issue_does_not_publish_or_retry_a_partial_collection(self):
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/'initial'
            with self.assertRaisesRegex(CollectionError,'UNAPPROVED_SALES_QUALITY_ISSUE'):self.collect(output,bad_count='-2')
            self.assertFalse((output/'bundle/bundle.json').exists())
            with self.assertRaisesRegex(CollectionError,'OUTPUT_ALREADY_EXISTS'):self.collect(output)
    def test_missing_required_context_and_incomplete_history_do_not_silently_fall_back(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/'initial'
            with self.assertRaises(CollectionError):self.collect(output,missing_context=True)
            self.assertFalse((output/'bundle/bundle.json').exists())
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)/'initial'
            with self.assertRaises(CollectionError):m.collect_initial_release(output,PERIODS[1:],{'SEOUL_OPENAPI_KEY':'synthetic','SEMAS_SERVICE_KEY':'synthetic'},client=self.client())
            self.assertFalse(output.exists())

if __name__=='__main__':unittest.main()
