"""Transition safety decisions without Docker, credentials or a database."""
import copy
import importlib
import tempfile
import unittest
from pathlib import Path


def proposal():
    old = {'/api-migration/V4__api_release_publication.sql': '4'*64,
           '/api-schema/schema.sql': 'a'*64,
           **{f'/workspace/backend/src/main/resources/db/migration/V{n}__base.sql': str(n)*64
              for n in range(1, 4)}}
    target = dict(runtime='local-dev', project='recycleyoungs-dev', owner='a'*24,
                  dbname='recycleyoungs_api_dev', host='api-postgres', port='5432',
                  data='/var/lib/postgresql/data/api', sid='123456', volume='recycleyoungs-dev-db',
                  container_id='b'*64, network_id='c'*64)
    binding = dict(project='recycleyoungs-dev', volumes={n: 'created' for n in
                   ('db', 'control', 'data', 'reader', 'writer')}, sql=old)
    return dict(format=1, run_id='d'*24, target=target, previous_binding=binding,
                proposed_sql={**old, '/api-migration/V5__api_context_and_quality_contract.sql': '5'*64},
                expected_current='e'*64, candidate='f'*64,
                bundle='/api-data/transitions/'+'d'*24+'/bundle',
                bundle_sha256='a'*64, source_sha256='b'*64,
                backup_sha256='c'*64, rehearsal_sha256='d'*64,
                expires_at=2000)


def checked(p, step):
    m=importlib.import_module('dev_transition')
    return dict(status='PASS',plan_sha256=m.fingerprint(p),target_sha256=m.fingerprint(p['target']),
                source_sha256=p['source_sha256'],sql_sha256=m.fingerprint(p['proposed_sql']),
                input_sha256=p['bundle_sha256'],previous_binding_sha256=m.fingerprint(p['previous_binding']),
                current=p['candidate'] if step in ('binding','finish') else p['expected_current'],job_status='IDLE')


class TransitionTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        self.clock=patch('dev_transition.time.time',return_value=1000)
        self.clock_mock=self.clock.start();self.addCleanup(self.clock.stop)

    def module(self):
        return importlib.import_module('dev_transition')

    def test_only_v5_addition_can_change_binding(self):
        m = self.module(); p = proposal()
        m.validate_plan(p, now=1000)
        for key in p['previous_binding']['sql']:
            bad = copy.deepcopy(p); bad['proposed_sql'][key] = '9'*64
            with self.assertRaisesRegex(ValueError, 'TRANSITION_SQL_CHANGED'):
                m.validate_plan(bad, now=1000)
        for change in [lambda q: q['proposed_sql'].pop('/api-schema/schema.sql'),
                       lambda q: q['proposed_sql'].update({'/api-migration/V6__extra.sql': '6'*64})]:
            bad = copy.deepcopy(p); change(bad)
            with self.assertRaises(ValueError): m.validate_plan(bad, now=1000)

    def test_target_expiry_bundle_and_evidence_are_bound(self):
        m = self.module()
        for field, value in [('expires_at', 999), ('expires_at', 3000),
                             ('candidate', 'same'), ('backup_sha256', ''),
                             ('bundle', '/api-data/../outside'), ('run_id', 'bad')]:
            bad = proposal(); bad[field] = value
            with self.assertRaises(ValueError): m.validate_plan(bad, now=1000)
        bad = proposal(); bad['target']['project'] = 'foreign'
        with self.assertRaises(ValueError): m.validate_plan(bad, now=1000)
        bad = proposal(); bad['previous_binding']['volumes']['db'] = ''
        with self.assertRaises(ValueError): m.validate_plan(bad, now=1000)

    def test_observed_target_binding_sql_and_public_pointer_must_match(self):
        m = self.module(); p = proposal()
        args = dict(target=p['target'], binding=p['previous_binding'],
                    sql_hashes=p['proposed_sql'], current=p['expected_current'], status='IDLE')
        m.validate_observation(p, **args)
        for key, value in [('target', {**p['target'], 'sid': '987'}),
                           ('binding', {**p['previous_binding'], 'volumes': {}}),
                           ('sql_hashes', {}), ('current', '0'*64),
                           ('status', 'RUNNING'), ('status', 'FAILED')]:
            with self.assertRaises(ValueError): m.validate_observation(p, **{**args, key: value})

    def test_journal_is_exclusive_hash_chained_and_stops_on_interrupted_intent(self):
        m = self.module(); p = proposal()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            j = m.Journal.create(root, p)
            with self.assertRaises(ValueError): m.Journal.create(root, p)
            j.intent('migration')
            recovered = m.Journal.open(root, p)
            with self.assertRaisesRegex(ValueError, 'TRANSITION_INTERRUPTED'):
                recovered.intent('migration')
            with self.assertRaisesRegex(ValueError, 'TRANSITION_INTERRUPTED'):
                recovered.intent('stage')
            bad = copy.deepcopy(p); bad['candidate'] = '0'*64
            with self.assertRaises(ValueError): m.Journal.open(root, bad)

    def test_failed_publication_blocks_binding_and_no_automatic_retry(self):
        m = self.module(); p = proposal()
        with tempfile.TemporaryDirectory() as d:
            j = m.Journal.create(Path(d).resolve(), p)
            for step in ['migration', 'grants', 'stage']:
                j.intent(step); j.done(step, {'status': 'PASS'})
            j.intent('publish'); j.stop('publish', 'CURRENT_RELEASE_CHANGED')
            for step in ['publish', 'binding']:
                with self.assertRaisesRegex(ValueError, 'TRANSITION_STOPPED'): j.intent(step)

    def test_missing_and_tampered_records_and_out_of_order_steps_are_rejected(self):
        m = self.module(); p = proposal()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); j = m.Journal.create(root, p)
            with self.assertRaisesRegex(ValueError, 'TRANSITION_STEP_ORDER'): j.intent('publish')
            j.intent('migration'); j.done('migration', {'status': 'PASS'})
            records = sorted(root.glob('*.json'))
            records[1].write_text('{}')
            with self.assertRaisesRegex(ValueError, 'TRANSITION_JOURNAL'): m.Journal.open(root, p)

    def test_flyway_checksum_matches_existing_v4_receipt(self):
        m = self.module()
        path = Path(__file__).resolve().parents[2]/'backend/src/main/resources/db/api-migration/V4__api_release_publication.sql'
        self.assertEqual(m.flyway_checksum(path), 688940435)

    def test_pending_transition_blocks_ordinary_context_before_metadata_access(self):
        from unittest.mock import patch
        import dev_runtime
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); (root/m.PENDING).write_text('{}')
            with patch.object(dev_runtime, 'CONTROL', root), patch.object(dev_runtime, 'metadata') as external:
                with self.assertRaisesRegex(ValueError, 'TRANSITION_REQUIRES_REVIEW'):
                    dev_runtime.checked_context()
                external.assert_not_called()

    def test_begin_journal_can_be_reopened_without_untracked_control_files(self):
        m = self.module(); p = proposal()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            j = m.Journal.create(root, p)
            self.assertEqual(m.Journal.open(root,p).records,j.records)

    def test_full_snapshot_covers_default_acl_membership_options_and_sequence_dependencies(self):
        import api_snapshot
        self.assertIn('default_acl', api_snapshot.CATALOG)
        self.assertIn('inherit_option', api_snapshot.CATALOG['memberships'])
        self.assertIn('set_option', api_snapshot.CATALOG['memberships'])
        self.assertIn('sequence_dependencies', api_snapshot.CATALOG)
        self.assertIn('effective_acl', api_snapshot.CATALOG)

    def test_execution_failure_records_stop_and_never_runs_later_callback(self):
        m = self.module(); p = proposal(); called = []
        with tempfile.TemporaryDirectory() as d:
            j = m.Journal.create(Path(d).resolve(), p)
            def fail():
                called.append('migration'); raise ValueError('bad')
            with self.assertRaises(ValueError): m.execute_step(j,'migration',fail,verify_preconditions=checked)
            self.assertEqual(j.records[-1]['status'],'STOP')
            with self.assertRaises(ValueError): m.execute_step(j,'migration',lambda: called.append('retry'),verify_preconditions=checked)
            self.assertEqual(called,['migration'])

    def test_incomplete_or_wrong_history_cannot_be_used_as_migration_success(self):
        m = self.module(); from unittest.mock import patch
        p = proposal()
        files = {int(Path(name).name[1]):Path(name).name for name in p['proposed_sql'] if Path(name).name.startswith('V')}
        history = [[n,str(n),files[n],n,True] for n in range(1,6)]
        with patch.object(m,'flyway_checksum',side_effect=lambda path:int(path.name[1])):
            m.verify_history(history,p['proposed_sql'],5)
            for bad in [history[:-1], [[1,'1',files[1],999,True],*history[1:]],
                        [*history[:-1],[5,'5',files[5],5,False]]]:
                with self.assertRaises(ValueError):m.verify_history(bad,p['proposed_sql'],5)

    def test_publication_receipt_requires_candidate_registry_and_pointer(self):
        m = self.module(); p = proposal()
        m.validate_publication(p,current=p['candidate'],registered=p['candidate'],status='READY')
        for args in [dict(current=p['expected_current'],registered=p['candidate'],status='READY'),
                     dict(current=p['candidate'],registered='0'*64,status='READY'),
                     dict(current=p['candidate'],registered=p['candidate'],status='STAGED')]:
            with self.assertRaises(ValueError): m.validate_publication(p,**args)

    def test_truncated_tail_is_detected_by_persisted_head(self):
        m = self.module(); p = proposal()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();j=m.Journal.create(root,p)
            j.intent('migration');j.done('migration',{'status':'PASS'})
            sorted(root.glob('*.json'))[-1].unlink()
            with self.assertRaisesRegex(ValueError,'TRANSITION_JOURNAL'):m.Journal.open(root,p)

    def test_binding_failure_leaves_both_startup_guards_in_place(self):
        m=self.module();p=proposal()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();control=root/'control';writer=root/'writer'
            control.mkdir(mode=0o700);writer.mkdir(mode=0o700)
            marker={'run_id':p['run_id'],'plan_sha256':m.fingerprint(p)}
            for folder in [control,writer]:
                m.exclusive_json(folder/'binding.json',p['previous_binding'])
                m.exclusive_json(folder/m.PENDING,marker)
            def rejected():raise ValueError('reader not ready')
            with self.assertRaises(ValueError):
                m.commit_bindings(p,control,writer,verify_publication=rejected)
            for folder in [control,writer]:
                self.assertTrue((folder/m.PENDING).exists())
                self.assertEqual(__import__('json').loads((folder/'binding.json').read_text()),p['previous_binding'])

    def test_binding_commit_preserves_old_proof_and_requires_explicit_finish(self):
        m=self.module();p=proposal()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();control=root/'control';writer=root/'writer'
            control.mkdir(mode=0o700);writer.mkdir(mode=0o700)
            marker={'run_id':p['run_id'],'plan_sha256':m.fingerprint(p)}
            for folder in [control,writer]:
                m.exclusive_json(folder/'binding.json',p['previous_binding']);m.exclusive_json(folder/m.PENDING,marker)
            receipt=m.commit_bindings(p,control,writer,verify_publication=lambda:{'status':'PASS','release_id':p['candidate']})
            self.assertEqual(receipt['status'],'PASS')
            for folder in [control,writer]:
                self.assertTrue((folder/m.PENDING).exists())
                self.assertEqual(__import__('json').loads((folder/'binding.json').read_text())['sql'],p['proposed_sql'])
                self.assertEqual(__import__('json').loads((folder/('binding-before-'+p['run_id']+'.json')).read_text()),p['previous_binding'])

    def test_common_write_connection_refuses_pending_transition_before_credentials(self):
        import api_runtime
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();(root/'transition-pending.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'TRANSITION_REQUIRES_REVIEW'):
                api_runtime.connect(root,'api_writer',False)

    def test_binding_second_volume_failure_keeps_writes_blocked(self):
        m=self.module();p=proposal();from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();control=root/'control';writer=root/'writer'
            control.mkdir(mode=0o700);writer.mkdir(mode=0o700)
            marker={'run_id':p['run_id'],'plan_sha256':m.fingerprint(p)}
            for folder in [control,writer]:
                m.exclusive_json(folder/'binding.json',p['previous_binding']);m.exclusive_json(folder/m.PENDING,marker)
            replace=m.os.replace
            def crash(src,dst):
                if dst==writer/'binding.json':raise OSError('injected crash')
                replace(src,dst)
            with patch.object(m.os,'replace',side_effect=crash):
                with self.assertRaises(OSError):
                    m.commit_bindings(p,control,writer,verify_publication=lambda:{'status':'PASS','release_id':p['candidate']})
            for folder in [control,writer]:
                with self.assertRaisesRegex(ValueError,'TRANSITION_REQUIRES_REVIEW'):m.require_clear(folder)

    def test_finish_requires_durable_binding_receipt_before_unblocking(self):
        m=self.module();p=proposal()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();control=root/'control';writer=root/'writer'
            control.mkdir(mode=0o700);writer.mkdir(mode=0o700)
            marker={'run_id':p['run_id'],'plan_sha256':m.fingerprint(p)}
            for folder in [control,writer]:
                m.exclusive_json(folder/'binding.json',p['previous_binding']);m.exclusive_json(folder/m.PENDING,marker)
            j=m.Journal.create(root/'journal',p)
            with self.assertRaisesRegex(ValueError,'TRANSITION_NOT_COMPLETE'):m.finish(p,j,control,writer,verify_preconditions=checked)
            for step in ['migration','grants','stage','publish']:m.execute_step(j,step,lambda:{'status':'PASS'},verify_preconditions=checked)
            m.execute_step(j,'binding',lambda:m.commit_bindings(p,control,writer,verify_publication=lambda:{'status':'PASS','release_id':p['candidate']}),verify_preconditions=checked)
            self.assertEqual(m.finish(p,j,control,writer,verify_preconditions=checked)['status'],'PASS')
            for folder in [control,writer]:m.require_clear(folder)

    def test_expired_plan_never_runs_a_mutation_and_persists_stop(self):
        m=self.module();p=proposal();p['expires_at']=999;calls=[]
        with tempfile.TemporaryDirectory() as d:
            j=m.Journal.create(Path(d).resolve(),p)
            with self.assertRaisesRegex(ValueError,'TRANSITION_APPROVAL_EXPIRED'):
                m.execute_step(j,'migration',lambda:calls.append('mutation') or {'status':'PASS'})
            self.assertEqual(calls,[])
            self.assertEqual(m.Journal.open(j.root,p).records[-1]['status'],'STOP')

    def test_already_published_candidate_is_not_a_new_transition_cas_success(self):
        from unittest.mock import MagicMock,patch
        m=self.module();p=proposal();conn=MagicMock()
        conn.execute.return_value.fetchone.return_value=(p['candidate'],'READY')
        with patch('app.api_release.publish_release',return_value=False):
            with self.assertRaisesRegex(ValueError,'TRANSITION_CAS_NOT_PERFORMED'):
                m.publish_candidate(conn,p,verify_identity=lambda c:None,registered=lambda c:p['candidate'])

    def test_changed_source_sql_input_target_or_pointer_proof_stops_before_mutation(self):
        m=self.module();p=proposal()
        for field in ['plan_sha256','target_sha256','source_sha256','sql_sha256','input_sha256',
                      'previous_binding_sha256','current','job_status']:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as d:
                j=m.Journal.create(Path(d).resolve(),p);calls=[]
                def altered(plan,step):return checked(plan,step)|{field:'changed'}
                with self.assertRaisesRegex(ValueError,'TRANSITION_PRECONDITIONS_CHANGED'):
                    m.execute_step(j,'migration',lambda:calls.append('write'),verify_preconditions=altered)
                self.assertEqual(calls,[]);self.assertEqual(m.Journal.open(j.root,p).records[-1]['status'],'STOP')

    def test_publication_proof_expiring_plan_blocks_both_binding_writes(self):
        import json
        m=self.module();p=proposal()
        with tempfile.TemporaryDirectory() as d:
            control=Path(d).resolve()/'control';writer=control.parent/'writer'
            control.mkdir(mode=0o700);writer.mkdir(mode=0o700)
            marker={'run_id':p['run_id'],'plan_sha256':m.fingerprint(p)}
            for folder in [control,writer]:
                m.exclusive_json(folder/'binding.json',p['previous_binding'])
                m.exclusive_json(folder/m.PENDING,marker)
            def slow_proof():
                self.clock_mock.return_value=2001
                return {'status':'PASS','release_id':p['candidate']}
            with self.assertRaisesRegex(ValueError,'TRANSITION_APPROVAL_EXPIRED'):
                m.commit_bindings(p,control,writer,verify_publication=slow_proof)
            for folder in [control,writer]:
                self.assertEqual(json.loads((folder/'binding.json').read_text()),p['previous_binding'])
                self.assertTrue((folder/m.PENDING).exists())
                self.assertFalse((folder/('binding-before-'+p['run_id']+'.json')).exists())

    def test_plan_expiring_during_preconditions_still_blocks_the_mutation(self):
        m=self.module();p=proposal();calls=[]
        with tempfile.TemporaryDirectory() as d:
            j=m.Journal.create(Path(d).resolve(),p)
            def slow(plan,step):
                proof=checked(plan,step);self.clock_mock.return_value=2001;return proof
            with self.assertRaisesRegex(ValueError,'TRANSITION_APPROVAL_EXPIRED'):
                m.execute_step(j,'migration',lambda:calls.append('write'),verify_preconditions=slow)
            self.assertEqual(calls,[])


if __name__ == '__main__': unittest.main()
