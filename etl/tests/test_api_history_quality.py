"""Explicit, exact quarantine is separate from strict v1 publication."""
import importlib
import hashlib
import io
import json
from copy import deepcopy
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from api_fixtures import FakeClient, sales, seoul
import test_api_backfill as backfill_fixtures
from app.api_records import CollectionError, normalize_sales
from app.api_release import digest, load_run, verify_release


class HistoryQualityTests(unittest.TestCase):
    def policy(self, m, **changes):
        case = dict(quarter_code='20251', dong_code='11110515', source_industry_code='CS300001',
                    fields={'TMZON_06_11_SELNG_CO':'-1'}) | changes
        return {'schema_version':1, 'policy_id':m.POLICY, 'cases':[case]}

    def bad(self, **changes):
        return sales(SVC_INDUTY_CD='CS300001', TMZON_06_11_SELNG_CO='-1.0') | changes

    def collect(self, m, root, policy=None, rows=None):
        policy = self.policy(m) if policy is None else policy
        rows = [self.bad(), sales(ADSTRD_CD='11110530',THSMON_SELNG_CO='9007199254740993')] if rows is None else rows
        return m.collect_sales(root/'quality', '20251', 'synthetic', policy,
            client=FakeClient(seoul(rows,service='VwsmAdstrdSelngW')))

    def test_exact_approved_unmapped_row_is_retained_raw_and_quarantined_without_coercion(self):
        m=importlib.import_module('app.api_history_quality')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); manifest=self.collect(m,root)
            self.assertFalse(manifest['complete']);self.assertTrue(manifest['raw_complete'])
            self.assertEqual(manifest['received_count'],2);self.assertEqual(manifest['normalized_count'],1)
            self.assertEqual(manifest['quarantined_count'],1)
            run=m.load_quality_run(root/'quality',self.policy(m))
            self.assertEqual(run['records'][0]['transaction_count'],'9007199254740993')
            self.assertEqual(run['quality']['cases'][0]['fields'],{'TMZON_06_11_SELNG_CO':'-1'})
            self.assertIn('-1.0',(root/'quality/pages/000001.json').read_text())
            with self.assertRaises(CollectionError):load_run(root/'quality')
            with self.assertRaises(CollectionError):normalize_sales(self.bad(),'20251')

    def test_supported_industry_new_case_changed_value_and_missing_case_remain_blocked(self):
        m=importlib.import_module('app.api_history_quality')
        cases=[(self.policy(m,source_industry_code='CS100010'),[self.bad(SVC_INDUTY_CD='CS100010')]),
            (self.policy(m),[self.bad(ADSTRD_CD='11110530')]),
            (self.policy(m),[self.bad(TMZON_06_11_SELNG_CO='-2')]),
            (self.policy(m),[self.bad(TMZON_06_11_SELNG_CO='0')]),
            (self.policy(m),[self.bad(THSMON_SELNG_AMT='bad')]),
            (self.policy(m),[self.bad(TMZON_06_11_SELNG_CO='-1.5')]),
            (self.policy(m),[self.bad(),self.bad()])]
        for policy,rows in cases:
            with self.subTest(rows=rows),tempfile.TemporaryDirectory() as d:
                with self.assertRaises(CollectionError):self.collect(m,Path(d),policy,rows)

    def test_replay_rejects_tampered_raw_normalized_quarantine_and_policy(self):
        m=importlib.import_module('app.api_history_quality')
        for file in ['pages/000001.json','normalized.jsonl','quarantine.jsonl','manifest.json']:
            with self.subTest(file=file),tempfile.TemporaryDirectory() as d:
                root=Path(d);self.collect(m,root)
                p=root/'quality'/file;p.write_bytes(p.read_bytes()+b'\n')
                # A whitespace-only manifest change is semantically harmless; change its count instead.
                if file=='manifest.json':
                    data=json.loads(p.read_text());data['quarantined_count']=0;p.write_text(json.dumps(data))
                with self.assertRaises(CollectionError):m.load_quality_run(root/'quality',self.policy(m))
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.collect(m,root)
            with self.assertRaises(CollectionError):m.load_quality_run(root/'quality',self.policy(m,dong_code='11110530'))

    def test_multipage_collection_and_source_total_or_period_drift(self):
        m=importlib.import_module('app.api_history_quality')
        second=sales(ADSTRD_CD='11110530')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            client=FakeClient(seoul([self.bad()],total=2,service='VwsmAdstrdSelngW'),seoul([second],total=2,service='VwsmAdstrdSelngW'))
            m.collect_sales(root/'quality','20251','synthetic',self.policy(m),client=client,page_size=1)
            self.assertEqual(len(client.calls),2)
            self.assertEqual(len(m.load_quality_run(root/'quality',self.policy(m))['records']),1)
            empty=json.dumps(seoul([],total=2,service='VwsmAdstrdSelngW')).encode()
            (root/'quality/pages/000003.json').write_bytes(empty)
            path=root/'quality/manifest.json';manifest=json.loads(path.read_text())
            manifest['page_count']=3;manifest['pages'].append(dict(file='pages/000003.json',sha256=hashlib.sha256(empty).hexdigest(),received_count=0))
            path.write_text(json.dumps(manifest))
            with self.assertRaises(CollectionError):m.load_quality_run(root/'quality',self.policy(m))
        for payload in [seoul([second],total=3,service='VwsmAdstrdSelngW'),
                        seoul([],total=2,service='VwsmAdstrdSelngW'),
                        seoul([second|{'STDR_YYQU_CD':'20252'}],total=2,service='VwsmAdstrdSelngW')]:
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(CollectionError):
                    m.collect_sales(Path(d)/'quality','20251','synthetic',self.policy(m),page_size=1,
                        client=FakeClient(seoul([self.bad()],total=2,service='VwsmAdstrdSelngW'),payload))

    def test_candidate_v2_preserves_baseline_and_v1_writer_still_rejects_it(self):
        m=importlib.import_module('app.api_history_quality')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); baseline=backfill_fixtures.BackfillTests().baseline(root)
            # A separate historical quarter has one supported row and one exact excluded source row.
            policy=self.policy(m,quarter_code='20244')
            client=FakeClient(seoul([self.bad(STDR_YYQU_CD='20244'),sales(STDR_YYQU_CD='20244')],service='VwsmAdstrdSelngW'))
            m.collect_sales(root/'quality','20244','synthetic',policy,client=client)
            from app.api_artifacts import write_run
            from app.api_records import Page, normalize_store_stats
            from api_fixtures import stats
            historical=root/'history-stores';row=normalize_store_stats(stats(STDR_YYQU_CD='20244'),'20244')
            write_run(historical,[Page(1,1,(row,),b'{}',('20244',))],source='seoul-stores',
                scope=dict(quarter='20244',region='SEOUL',industry='ALL_SOURCE_INDUSTRIES'),mode='collect')
            before=[(p/'manifest.json').read_bytes() for p in baseline]
            candidate=m.prepare_history_candidate([*baseline,historical],[root/'quality'],policy,
                quarters=['20244','20251'],baseline_paths=baseline)
            self.assertEqual(candidate['contract_version'],2)
            self.assertEqual(candidate['quality_policy']['quarantined_count'],1)
            self.assertEqual(candidate['store_reference_month'],'202606')
            m.verify_history_candidate(candidate)
            self.assertEqual(before,[(p/'manifest.json').read_bytes() for p in baseline])
            for mutate in [lambda c:c['quality_policy'].update(quarantined_count=0),
                           lambda c:c.update(text_policy='UNAPPROVED_TEXT_CORRECTION'),
                           lambda c:c['baseline'].update(release_id='a'*64),
                           lambda c:next(r for r in c['runs'] if 'quality' in r)['quality'].update(raw_count=1),
                           lambda c:next(r for r in c['runs'] if 'quality' in r)['quality']['cases'][0].update(row_index=999)]:
                changed=deepcopy(candidate);mutate(changed)
                changed['release_id']=digest({k:v for k,v in changed.items() if k!='release_id'})
                with self.assertRaises(CollectionError):m.verify_history_candidate(changed)
            with self.assertRaisesRegex(CollectionError,'RELEASE_CONTRACT_MISMATCH'):verify_release(candidate)
            downgraded=deepcopy(candidate);downgraded['contract_version']=1
            downgraded['release_id']=digest({k:v for k,v in downgraded.items() if k!='release_id'})
            with self.assertRaisesRegex(CollectionError,'RELEASE_CONTRACT_MISMATCH'):verify_release(downgraded)
            with self.assertRaises(CollectionError):m.prepare_history_candidate([*baseline,historical],[root/'quality'],policy,
                quarters=['20251'],baseline_paths=baseline)
            from app.api_artifacts import create_file, encoded
            inputs=dict(runs=[str(p) for p in [*baseline,historical]],quality_runs=[str(root/'quality')],
                        baseline_runs=[str(p) for p in baseline],quarters=['20244','20251'])
            for name,body in [('policy.json',policy),('inputs.json',inputs)]:
                with create_file(root/name) as target:target.write(encoded(body))
            with redirect_stdout(io.StringIO()):
                exit_code=m.main(['prepare','--policy-file',str(root/'policy.json'),
                    '--input-plan',str(root/'inputs.json'),'--output',str(root/'prepared')])
            self.assertEqual(exit_code,0)
            result=json.loads((root/'prepared/preparation.json').read_text())
            self.assertTrue(result['readback_verified'])
            self.assertEqual(result['release_id'],candidate['release_id'])
            # A write that returns successfully with altered bytes must not
            # produce a successful preparation receipt.
            writer=m.write_candidate
            def corrupt(path,value):
                writer(path,value)
                data=json.loads(path.read_text());data['quality_policy']['quarantined_count']=0
                path.write_text(json.dumps(data))
            with patch.object(m,'write_candidate',side_effect=corrupt),redirect_stdout(io.StringIO()),redirect_stderr(io.StringIO()):
                self.assertEqual(m.main(['prepare','--policy-file',str(root/'policy.json'),
                    '--input-plan',str(root/'inputs.json'),'--output',str(root/'corrupted')]),2)
            self.assertFalse((root/'corrupted/preparation.json').exists())
