"""V5/V6 transition cannot reuse the completed V4/V5 plan or change old SQL."""
import copy
import importlib
import unittest
import tempfile
from unittest.mock import patch
from pathlib import Path
from test_dev_transition import proposal

def plan():
    old=proposal();binding=old['previous_binding']|dict(sql=old['proposed_sql'])
    return dict(format='EXPLICIT_V5_V6_REFERENCE_V1',run_id='d'*24,target=old['target'],previous_binding=binding,
        proposed_sql=binding['sql']|{'/api-migration/V6__current_reference_catalogs.sql':'6'*64},
        expected_current='e'*64,expected_references={},catalog_id='f'*64,source_sha256='b'*64,
        backup_sha256='c'*64,restore_sha256='d'*64,baseline_sha256='e'*64,expires_at=2000)

class ReferenceTransitionTests(unittest.TestCase):
    def module(self):
        try:return importlib.import_module('dev_reference_transition')
        except ModuleNotFoundError:self.fail('an explicit V5/V6 transition is required')
    def test_old_files_binding_target_and_evidence_are_immutable(self):
        m=self.module();p=plan();m.validate_plan(p,now=1000)
        for key in p['previous_binding']['sql']:
            changed=copy.deepcopy(p);changed['proposed_sql'][key]='9'*64
            with self.assertRaisesRegex(ValueError,'REFERENCE_TRANSITION_SQL_CHANGED'):m.validate_plan(changed,now=1000)
        for field,value in [('expires_at',999),('backup_sha256',''),('restore_sha256',''),('catalog_id','bad')]:
            with self.assertRaises(ValueError):m.validate_plan(p|{field:value},now=1000)
        with self.assertRaises(ValueError):m.validate_plan(proposal(),now=1000)

    def test_insecure_reference_parent_is_rejected_before_preparing_a_transition_catalog(self):
        m=self.module();p=plan()
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d).resolve();parent.chmod(0o755)
            with patch.object(m,'Path',return_value=parent),patch.object(m,'prepare_catalog',return_value=dict(catalog_id=p['catalog_id'])) as prepare:
                with self.assertRaisesRegex(ValueError,'PRIVATE_PARENT_0700_REQUIRED'):m.catalog(p)
                prepare.assert_not_called()
                parent.chmod(0o700)
                self.assertEqual(m.catalog(p)['catalog_id'],p['catalog_id'])
                prepare.assert_called_once()
    def test_only_one_new_v6_flyway_migration_can_be_recorded(self):
        m=self.module();p=plan();value=dict(operation='migrate',flywayVersion='12.4.0',migrationsExecuted=1,
            migrations=[dict(version='6',filepath='/flyway/api/V6__current_reference_catalogs.sql')])
        m.verify_flyway(value,p)
        for changed in [value|dict(migrationsExecuted=0),value|dict(migrations=[dict(version='5',filepath='old.sql')])]:
            with self.assertRaises(ValueError):m.verify_flyway(changed,p)

    def test_expiry_during_publication_proof_does_not_replace_any_binding(self):
        m=self.module();p=plan()
        with patch.object(m.time,'time',return_value=1000) as clock,patch.object(m,'require_pending'),patch.object(m,'replace_binding') as replace:
            def slow_proof():
                clock.return_value=2001
                return dict(status='PASS',release_id=p['expected_current'],catalog_id=p['catalog_id'])
            with self.assertRaisesRegex(ValueError,'REFERENCE_TRANSITION_EXPIRED'):
                m.commit_bindings(p,Path('/unused-control'),Path('/unused-writer'),verify_publication=slow_proof)
            replace.assert_not_called()

    def test_shared_guard_blocks_each_new_writer_route_before_database_open(self):
        import api_runtime as runtime
        with tempfile.TemporaryDirectory() as d:
            guard=Path(d).resolve()/'reference-transition-pending.json';guard.write_text('{}')
            with patch.object(runtime,'REFERENCE_PENDING',guard,create=True),patch.object(runtime.psycopg,'connect') as opened:
                for actor in ['api_writer','ry_api_owner']:
                    with self.assertRaisesRegex(ValueError,'REFERENCE_TRANSITION_REQUIRES_REVIEW'):
                        runtime.connect(guard.parent/actor,actor,False)
                opened.assert_not_called()

    def test_partial_finish_keeps_shared_guard_and_all_new_writers_blocked(self):
        m=self.module();p=plan()
        import api_runtime as runtime
        from dev_transition import Journal,PENDING,fingerprint,exclusive_json
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            control=root/'control';writer=root/'writer';control.mkdir(mode=0o700);writer.mkdir(mode=0o700)
            guard=root/'reference-transition-pending.json';exclusive_json(guard,m.marker(p))
            proposed=p['previous_binding']|dict(sql=p['proposed_sql'])
            for folder in [control,writer]:
                exclusive_json(folder/PENDING,m.marker(p));exclusive_json(folder/'target.json',p['target']);exclusive_json(folder/'binding.json',proposed)
            receipt=dict(status='PASS',kind=p['format'],plan_sha256=fingerprint(p),source_sha256=p['source_sha256'],
                previous_binding_sha256=fingerprint(p['previous_binding']),proposed_binding_sha256=fingerprint(proposed),
                proof=dict(status='PASS',release_id=p['expected_current'],catalog_id=p['catalog_id']))
            exclusive_json(control/('reference-transition-'+p['run_id']+'.json'),receipt)
            journal=Journal.create(root/'journal',p)
            for step in ['migration','grants','stage','publish','binding']:
                journal.intent(step);journal.done(step,dict(status='PASS'))
            original=Path.unlink
            def fail_second(path,*args,**kwargs):
                if path==writer/PENDING:raise OSError('injected second guard removal failure')
                return original(path,*args,**kwargs)
            with patch.object(m.time,'time',return_value=1000),patch.object(m,'REFERENCE_PENDING',guard),patch.object(runtime,'REFERENCE_PENDING',guard):
                with patch.object(Path,'unlink',fail_second):
                    with self.assertRaises(OSError):
                        m.finish(p,journal,control,writer,verify_preconditions=lambda *_:dict(status='PASS',plan_sha256=fingerprint(p)))
                self.assertFalse((control/PENDING).exists());self.assertTrue((writer/PENDING).exists());self.assertTrue(guard.exists())
                with patch.object(runtime.psycopg,'connect') as opened:
                    with self.assertRaisesRegex(ValueError,'REFERENCE_TRANSITION_REQUIRES_REVIEW'):runtime.connect(control,'api_writer',False)
                    opened.assert_not_called()

if __name__=='__main__':unittest.main()
