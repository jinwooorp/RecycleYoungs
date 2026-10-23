"""Final context contract is distinct from the unpublished history candidate."""
from copy import deepcopy
import hashlib
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock

from api_fixtures import FakeClient, sales, seoul, stats
import test_api_backfill as backfill_fixtures
import test_api_history_quality as quality_fixtures
from test_seoul_context import source_row
from app.api_artifacts import write_run, encoded
from app.api_records import CollectionError, Page, normalize_store_stats
from app.api_release import digest, verify_release
from app import api_history_quality as history
from app.seoul_context import SOURCES, normalize


def history_fixture(root):
    baseline = backfill_fixtures.BackfillTests().baseline(root)
    helper = quality_fixtures.HistoryQualityTests()
    policy = helper.policy(history, quarter_code='20244')
    history.collect_sales(root/'quality', '20244', 'synthetic', policy,
        client=FakeClient(seoul([helper.bad(STDR_YYQU_CD='20244'), sales(STDR_YYQU_CD='20244')],
                                service='VwsmAdstrdSelngW')))
    path = root/'historical-stores'
    row = normalize_store_stats(stats(STDR_YYQU_CD='20244'), '20244')
    write_run(path, [Page(1, 1, (row,), b'{}', ('20244',))], source='seoul-stores',
        scope=dict(quarter='20244', region='SEOUL', industry='ALL_SOURCE_INDUSTRIES'), mode='collect')
    return history.prepare_history_candidate([*baseline, path], [root/'quality'], policy,
        quarters=['20244', '20251'], baseline_paths=baseline)


def context_fixture(root, source):
    spec = SOURCES[source]
    raw = source_row(spec, STDR_YYQU_CD='20251')
    if source == 'seoul-change':
        raw.update(TRDAR_CHNGE_IX='LL', TRDAR_CHNGE_IX_NM='다이나믹')
    if source == 'seoul-population':
        raw.update(TOT_FLPOP_CO='9007199254740993.25', ML_FLPOP_CO=None)
    path = root/source
    write_run(path, [Page(1, 1, (normalize(source, raw),),
        json.dumps(seoul([raw], service=spec.service), ensure_ascii=False).encode(), ('20251',))],
        source=source, scope=dict(region='SEOUL', service=spec.service, dataset=spec.dataset,
            period_scope='ALL_SOURCE_PERIODS', observation_date=None,
            spatial_unit='ADMINISTRATIVE_DONG', annual_repeated_values=spec.annual), mode='collect')
    return path


class ContextReleaseTests(unittest.TestCase):
    def module(self):
        return importlib.import_module('app.api_context_release')

    def inputs(self, root):
        m = self.module()
        return history_fixture(root), [context_fixture(root, s) for s in m.ACTIVE_SOURCES]

    def test_final_digest_binds_history_exact_policy_five_runs_and_withheld_source(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            candidate, paths = self.inputs(Path(d))
            release = m.prepare_context_release(candidate, paths)
            m.verify_context_release(release)
            self.assertNotEqual(release['release_id'], candidate['release_id'])
            self.assertEqual(release['runs'], candidate['runs'])
            self.assertEqual(release['baseline'], candidate['baseline'])
            self.assertEqual(release['quality_policy'], candidate['quality_policy'])
            self.assertNotIn('candidate_status', release)
            self.assertEqual(len(release['context_sources']), 6)
            self.assertEqual(release['context_sources']['consumption']['state'], 'WITHHELD')
            self.assertIsNone(release['context_sources']['consumption']['run'])
            with self.assertRaises(CollectionError): verify_release(release)
            with self.assertRaises(CollectionError): m.verify_context_release(candidate)

    def test_missing_duplicate_withheld_and_apartment_inputs_fail_closed(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); candidate, paths = self.inputs(root)
            for bad in [paths[:-1], paths+[paths[0]], paths+[context_fixture(root, 'seoul-apartments')],
                        paths+[context_fixture(root, 'seoul-consumption')]]:
                with self.subTest(count=len(bad)), self.assertRaises(CollectionError):
                    m.prepare_context_release(candidate, bad)

    def test_resealed_policy_descriptor_records_and_quarantine_tamper_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            candidate, paths = self.inputs(Path(d))
            release = m.prepare_context_release(candidate, paths)
            for change in [lambda r:r['context_sources'].pop('workers'),
                           lambda r:r['context_sources']['consumption'].update(run=r['context_sources']['residents']['run']),
                           lambda r:r['context_policy']['sections']['residents']['fields'].append('APT_HSHLD_CO'),
                           lambda r:r['context_sources']['population']['run']['records'][0]['metrics'].update(TOT_FLPOP_CO='-1'),
                           lambda r:r['quality_policy'].update(quarantined_count=0),
                           lambda r:r.update(history_candidate_id='a'*64),
                           lambda r:r.update(candidate_status='PREPARED_UNPUBLISHED_REQUIRES_CONTRACT_2_INTEGRATION')]:
                altered = deepcopy(release); change(altered)
                altered['release_id'] = digest({k:v for k,v in altered.items() if k!='release_id'})
                with self.assertRaises(CollectionError): m.verify_context_release(altered)

    def test_loader_replays_raw_quality_and_normalized_instead_of_trusting_complete_flag(self):
        m = self.module()
        for file in ['pages/000001.json', 'normalized.jsonl', 'quality.json']:
            with self.subTest(file=file), tempfile.TemporaryDirectory() as d:
                path = context_fixture(Path(d), 'seoul-population')
                m.load_context_run(path)
                (path/file).write_bytes((path/file).read_bytes()+b'\n')
                with self.assertRaises(CollectionError): m.load_context_run(path)

    def test_projection_preserves_decimal_null_zero_and_hides_unapproved_fields(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            candidate, paths = self.inputs(Path(d)); release = m.prepare_context_release(candidate, paths)
            sections = m.project_sections(release, '11110515', '20251')
            self.assertEqual(sections['population']['metrics']['TOT_FLPOP_CO']['value'], '9007199254740993.25')
            self.assertEqual(sections['population']['metrics']['ML_FLPOP_CO']['valueState'], 'SOURCE_NULL')
            self.assertEqual(sections['population']['metrics']['FML_FLPOP_CO']['value'], '0')
            self.assertNotIn('APT_HSHLD_CO', sections['residents']['metrics'])
            self.assertNotIn('VIATR_FCLTY_CO', sections['facilities']['metrics'])
            self.assertEqual(sections['consumption']['state'], 'WITHHELD')
            self.assertIsNone(sections['consumption']['metrics'])
            self.assertIsNone(sections['consumption']['provenance']['runId'])
            for section in sections.values(): self.assertFalse(section['scoreReady'])
            self.assertEqual(m.project_sections(release, '11110530', '20251')['workers']['state'], 'NO_ROW')
            self.assertEqual(m.project_sections(release, '11110515', '20244')['workers']['state'], 'NO_PERIOD')

    def test_streaming_digest_is_byte_identical_and_record_file_detects_tamper(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'rows.jsonl'; rows = [{'a':'한글','b':None}, {'a':'0','b':['1',False]}]
            path.write_bytes(b''.join(encoded(r) for r in rows))
            records = m.RecordFile(path, len(rows), hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(digest({'rows':records}), digest({'rows':rows}))
            self.assertEqual(digest({'rows':records}),hashlib.sha256(encoded({'rows':rows})).hexdigest())
            self.assertEqual(records[0], rows[0]); self.assertEqual(len(records), 2)
            path.write_bytes(path.read_bytes()+encoded({'a':'unexpected'}))
            with self.assertRaises(CollectionError): list(records)

    def test_context_stage_rejects_history_only_and_checks_identity_before_any_sql(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            candidate, paths = self.inputs(Path(d))
            conn = MagicMock(); conn.autocommit = True; conn.info.transaction_status = 0
            with self.assertRaises(CollectionError):
                m.stage_context_release(conn, candidate, verify_identity=lambda c:None)
            conn.transaction.assert_not_called()
            release = m.prepare_context_release(candidate, paths)
            def reject(c):
                self.assertIs(c, conn)
                raise CollectionError('IDENTITY_REJECTED')
            with self.assertRaisesRegex(CollectionError, 'IDENTITY_REJECTED'):
                m.stage_context_release(conn, release, verify_identity=reject)
            conn.cursor.assert_not_called()

    def test_backend_policy_fixture_matches_exact_append_only_policy(self):
        m = self.module()
        path = Path(__file__).resolve().parents[2]/'backend/src/main/resources/contracts/admin-dong-context-policy-v1.json'
        self.assertEqual(json.loads(path.read_text()), dict(version=m.policy_version(),policy=m.policy_document()))
        frontend = Path(__file__).resolve().parents[2]/'frontend/src/data/context-policy-v1.json'
        self.assertEqual(json.loads(frontend.read_text()),json.loads(path.read_text()))

    def test_bundle_recomputes_full_digest_with_bounded_record_files_and_detects_forgery(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); candidate, paths = self.inputs(root)
            release = m.prepare_context_release(candidate, paths)
            m.write_release_bundle(root/'bundle', release)
            restored = m.read_release_bundle(root/'bundle')
            self.assertEqual(restored['release_id'],release['release_id'])
            self.assertIsInstance(restored['runs'][0]['records'],m.RecordFile)
            self.assertEqual(digest(restored),digest(release))
            plan = json.loads((root/'bundle/bundle.json').read_text())
            plan['release']['context_policy_version'] = 'a'*64
            (root/'bundle/bundle.json').write_text(json.dumps(plan))
            with self.assertRaises(CollectionError): m.read_release_bundle(root/'bundle')

    def test_even_rehashed_wrong_source_scope_is_rejected(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as d:
            candidate,paths=self.inputs(Path(d)); release=m.prepare_context_release(candidate,paths)
            run=release['context_sources']['population']['run']
            run['scope']['region']='BUSAN'
            run['run_id']=digest({k:v for k,v in run.items() if k not in ('records','run_id')})
            release['release_id']=digest({k:v for k,v in release.items() if k!='release_id'})
            with self.assertRaisesRegex(CollectionError,'CONTEXT_SCOPE_MISMATCH'):m.verify_context_release(release)

    def test_bundle_retains_and_verifies_raw_quality_and_quarantine_evidence(self):
        m=self.module()
        for kind,name in [('context_sources','run/pages/000001.json'),
                          ('context_sources','run/quality.json'),('quality','run/quarantine.jsonl')]:
            with self.subTest(kind=kind,name=name),tempfile.TemporaryDirectory() as d:
                root=Path(d);candidate,paths=self.inputs(root)
                release=m.prepare_context_release(candidate,paths)
                m.write_release_bundle(root/'bundle',release)
                doc=json.loads((root/'bundle/bundle.json').read_text())
                self.assertEqual(doc['schema_version'],2)
                if kind=='context_sources':
                    index=next(i for i,b in enumerate(doc['record_files']) if b['kind']=='context_sources')
                else:
                    index=next(i for i,b in enumerate(doc['record_files'])
                               if b['kind']=='runs' and 'quality' in doc['release']['runs'][b['selector']])
                target=root/'bundle/evidence'/f'{index:06d}'/name
                self.assertTrue(target.is_file())
                target.write_bytes(target.read_bytes()+b'\n')
                with self.assertRaises(CollectionError):m.read_release_bundle(root/'bundle')
                target.unlink()
                with self.assertRaises((CollectionError,FileNotFoundError)):m.read_release_bundle(root/'bundle')
