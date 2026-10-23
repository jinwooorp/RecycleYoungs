"""Weekly contract2 succession preserves the exact seed and all old quarters."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from api_fixtures import FakeClient, stats, sales, store, seoul, semas
from test_api_context_release import history_fixture, context_fixture
from test_seoul_context import source_row
from app import api_context_release as context
from app.api_records import CollectionError
from app.seoul_context import SOURCES


class ContextRefreshTests(unittest.TestCase):
    def initial(self,root):
        candidate=history_fixture(root)
        return context.prepare_context_release(candidate,[context_fixture(root,s) for s in context.ACTIVE_SOURCES])

    def client(self, fail_source=False, workers_override=None):
        pages=[seoul([stats(STOR_CO='999')]),seoul([sales(THSMON_SELNG_AMT='12345')],service='VwsmAdstrdSelngW'),
               semas([store(stdrYm='202607')],size=100)]
        for source in context.ACTIVE_SOURCES:
            spec=SOURCES[source]; row=source_row(spec,STDR_YYQU_CD='20251')
            if source=='seoul-change':row.update(TRDAR_CHNGE_IX='LL',TRDAR_CHNGE_IX_NM='다이나믹')
            if source=='seoul-workers' and workers_override:row.update(workers_override)
            pages.append({'RESULT':{'CODE':'INFO-200'}} if fail_source and source=='seoul-workers'
                         else seoul([row],service=spec.service))
        return FakeClient(*pages)

    def test_refresh_replaces_latest_keeps_history_and_exact_baseline_archive(self):
        from app.api_context_refresh import collect_context_refresh
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); previous=self.initial(root)
            release=collect_context_refresh(root/'refresh',['20251'],dict(SEOUL_OPENAPI_KEY='synthetic',SEMAS_SERVICE_KEY='synthetic'),
                previous_release=previous,client=self.client())
            self.assertEqual(release['quarters'],['20244','20251'])
            self.assertEqual(release['baseline'],previous['baseline'])
            self.assertEqual(release['quality_policy'],previous['quality_policy'])
            self.assertEqual(release['refresh_parent'],previous['release_id'])
            self.assertEqual(release['store_reference_month'],'202607')
            self.assertEqual(next(r for r in release['runs'] if r['source']=='seoul-stores' and r['period']=='20251')['records'][0]['store_count'],'999')
            self.assertEqual(next(r for r in release['baseline_archive'] if r['source']=='seoul-stores' and r['period']=='20251')['records'][0]['store_count'],'10')
            self.assertTrue(context.read_release_bundle(root/'refresh/bundle'))

    def test_required_context_failure_never_reuses_previous_run_or_writes_bundle(self):
        from app.api_context_refresh import collect_context_refresh
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); previous=self.initial(root)
            with self.assertRaises(CollectionError):
                collect_context_refresh(root/'failed',['20251'],dict(SEOUL_OPENAPI_KEY='synthetic',SEMAS_SERVICE_KEY='synthetic'),
                    previous_release=previous,client=self.client(True))
            self.assertFalse((root/'failed/bundle').exists())

    def test_missing_period_or_dong_requires_review_even_for_complete_replacement(self):
        from app.api_context_refresh import require_context_coverage
        for removed in [('20244','11110515'), ('20251','11110530')]:
            before=[dict(quarter_code=q,dong_code=d) for q,d in
                    [('20244','11110515'),('20251','11110515'),('20251','11110530')]]
            after=[r for r in before if (r['quarter_code'],r['dong_code'])!=removed]
            with self.subTest(removed=removed),self.assertRaisesRegex(CollectionError,'CONTEXT_COVERAGE_REGRESSION_REQUIRES_REVIEW'):
                require_context_coverage(dict(records=before),dict(records=after))
        require_context_coverage(dict(records=before),dict(records=before+[dict(quarter_code='20252',dong_code='11110515')]))

    def test_collector_stops_complete_but_changed_period_or_dong_coverage(self):
        from app.api_context_refresh import collect_context_refresh
        for changed in [dict(STDR_YYQU_CD='20244'),dict(ADSTRD_CD='11110530')]:
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as d:
                root=Path(d);previous=self.initial(root)
                with self.assertRaisesRegex(CollectionError,'CONTEXT_COVERAGE_REGRESSION_REQUIRES_REVIEW'):
                    collect_context_refresh(root/'failed',['20251'],dict(SEOUL_OPENAPI_KEY='synthetic',SEMAS_SERVICE_KEY='synthetic'),
                        previous_release=previous,client=self.client(workers_override=changed))
                self.assertFalse((root/'failed/bundle').exists())
