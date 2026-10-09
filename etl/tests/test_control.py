"""New controller integration-contract tests; existing safety_gate tests remain intact."""
import copy,json,tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
try:
 from control import Controller,ControlError,STAGES,guard_connection,flyway_init_sql,check_target,reject_environment,verify_hashes,check_flyway_json
except ImportError:
 Controller=None

class Backend:
 kind='FAKE_TEST'
 def __init__(self):
  self.calls=[];self.fault=None;self.change=None
 def fingerprint(self):return 'a'*64 if self.change is None else self.change
 def identity(self):return {'db':'fixture','user':'integration_test','sid':'123','data':'/var/lib/postgresql/data','port':5432}
 def execute(self,stage):
  self.calls.append(stage)
  if self.fault==stage:return {'exit_code':1,'validated':False,'log':'failed'}
  return {'exit_code':0,'validated':True,'log':'measured '+stage}

class ControllerTests(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(Controller,'actual execution controller missing')
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.root.chmod(0o700);self.b=Backend()
 def tearDown(self):
  if hasattr(self,'tmp'):self.tmp.cleanup()
 def controller(self):return Controller(self.b,self.root,clock=lambda:1000)
 def test_order_dispatches_executor_and_validator(self):
  c=self.controller();c.run_all()
  self.assertEqual(self.b.calls,list(STAGES));self.assertTrue(c.complete)
  self.assertEqual(json.loads((self.root/'state.json').read_text())['kind'],'FAKE_TEST')
 def test_missing_or_wrong_stage_never_dispatches(self):
  c=self.controller()
  with self.assertRaises(ControlError):c.run_stage('V3_APPLIED')
  self.assertEqual(self.b.calls,[])
 def test_failure_stops_later_command_for_each_boundary(self):
  for failed in ('V2_APPLIED','V3_VERIFIED','ADMIN_POLYGON_APPLIED'):
   with self.subTest(stage=failed):
    r=self.root/failed;r.mkdir(mode=0o700);b=Backend();b.fault=failed;c=Controller(b,r,clock=lambda:1000)
    with self.assertRaises(ControlError):c.run_all()
    self.assertEqual(b.calls[-1],failed)
    with self.assertRaises(ControlError):c.run_stage(STAGES[len(b.calls)])
 def test_exit_zero_without_validator_pass_stops(self):
  self.b.execute=lambda s:{'exit_code':0,'validated':False,'log':'PASS'}
  with self.assertRaises(ControlError):self.controller().run_stage(STAGES[0])
 def test_input_change_invalidates_previous_gate(self):
  c=self.controller();c.run_stage(STAGES[0]);self.b.change='b'*64
  with self.assertRaises(ControlError):c.run_stage(STAGES[1])
  self.assertEqual(self.b.calls,[STAGES[0]])
 def test_identity_changed_after_command_is_stop(self):
  c=self.controller();original=self.b.execute
  def action(s):
   result=original(s);self.b.identity=lambda:{'sid':'changed'};return result
  self.b.execute=action
  with self.assertRaises(ControlError):c.run_stage(STAGES[0])
 def test_forged_log_and_state_are_rejected(self):
  for target in ('PRECHECK.log','state.json'):
   with self.subTest(target=target):
    root=self.root/target.replace('.','_');root.mkdir(mode=0o700);b=Backend();c=Controller(b,root,clock=lambda:1000);c.run_stage(STAGES[0])
    (root/target).write_text('forged PASS')
    with self.assertRaises(ControlError):c.run_stage(STAGES[1])
    self.assertEqual(b.calls,[STAGES[0]])
 def test_old_state_cannot_resume(self):
  c=self.controller();c.run_stage(STAGES[0])
  with self.assertRaises(ControlError):self.controller()
 def test_stale_pass_and_clock_backwards_stop(self):
  c=self.controller();c.run_stage(STAGES[0]);c.clock=lambda:5000
  with self.assertRaises(ControlError):c.run_stage(STAGES[1])
 def test_final_stage_expiring_during_execution_is_not_pass(self):
  now=[1000];c=Controller(self.b,self.root,clock=lambda:now[0]);original=self.b.execute
  def action(stage):
   result=original(stage)
   if stage==STAGES[-1]:now[0]=5000
   return result
  self.b.execute=action
  with self.assertRaises(ControlError):c.run_all()
  self.assertFalse(c.complete);self.assertEqual(len(c.records),len(STAGES)-1)
 def test_completed_run_does_not_claim_fresh_pass_after_expiry(self):
  now=[1000];c=Controller(self.b,self.root,clock=lambda:now[0]);c.run_all()
  now[0]=5000;self.assertFalse(c.complete)
 def test_fake_backend_never_produces_production_authorization(self):
  c=self.controller();c.run_all()
  with self.assertRaises(ControlError):c.authorize_development()
 def test_flyway_own_connection_guard_contains_all_fields(self):
  sql=flyway_init_sql({'db':'fixture','user':'integration_test','sid':'123','data':'/var/lib/postgresql/data','port':5432})
  for x in ('current_database','current_user','system_identifier','data_directory','lock_timeout','statement_timeout','1 /'):self.assertIn(x,sql)

class ArtifactTests(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(Controller,'controller missing')
 def test_actual_database_image_must_be_pinned_before_inspect(self):
  from unittest.mock import patch
  from control_backend import DockerBackend,IMAGES
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'config.json'
   p.write_text(json.dumps({'repo':str(root/'repo'),'work':str(root/'work'),'images':IMAGES,'target':{'db_image':'sha256:'+'0'*64}}));p.chmod(0o600)
   with patch.dict('os.environ',{'CONTROL_DB_PASSWORD':'fixture'},clear=True),patch.object(DockerBackend,'_target') as inspect:
    with self.assertRaises(ControlError):DockerBackend(p)
    inspect.assert_not_called()
 def test_shared_stale_or_symlink_work_directory_is_rejected(self):
  from unittest.mock import patch
  from control_backend import DockerBackend,IMAGES
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);work=root/'work';work.mkdir(mode=0o700);p=root/'config.json'
   p.write_text(json.dumps({'repo':str(root/'repo'),'work':str(work),'images':IMAGES,'target':{'db_image':IMAGES['db']}}));p.chmod(0o600)
   with patch.dict('os.environ',{'CONTROL_DB_PASSWORD':'fixture'},clear=True),patch.object(DockerBackend,'_target'):
    work.chmod(0o755)
    with self.assertRaises(ControlError):DockerBackend(p)
    work.chmod(0o700);(work/'old.json').write_text('stale')
    with self.assertRaises(ControlError):DockerBackend(p)
    (work/'old.json').unlink();work.rmdir();work.symlink_to(root,target_is_directory=True)
    with self.assertRaises(ControlError):DockerBackend(p)
 def test_measured_validator_artifact_tamper_is_rejected(self):
  from control_backend import DockerBackend
  with tempfile.TemporaryDirectory() as tmp:
   b=DockerBackend.__new__(DockerBackend);b.out=Path(tmp);b.artifacts={}
   p=b.out/'restore.json';p.write_text('{}');p.chmod(0o600)
   snap=b.out/'snap-restore.json';snap.write_text('{}');snap.chmod(0o600)
   b._seal_artifacts('restore');p.write_text('{"forged":"PASS"}')
   with self.assertRaises(ControlError):b._check_artifacts()
 def test_subprocess_logs_redact_secret_and_jdbc_url(self):
  from control_backend import DockerBackend
  b=DockerBackend.__new__(DockerBackend);b.secret='fixture-private-secret'
  raw='password='+b.secret+' jdbc:postgresql://isolated:5432/private_db?password='+b.secret
  clean=b._sanitize(raw)
  self.assertNotIn(b.secret,clean);self.assertNotIn('jdbc:postgresql://',clean);self.assertNotIn('private_db',clean)
 def test_validator_and_transitive_app_changes_change_fingerprint(self):
  from control_backend import code_hashes
  with tempfile.TemporaryDirectory() as tmp:
   repo=Path(tmp)/'repo';etl=repo/'etl';(etl/'app').mkdir(parents=True);(etl/'tests').mkdir()
   for name in ('control.py','control_backend.py','control_worker.py','app/__init__.py','app/utils.py','tests/integration_support.py'):(etl/name).write_text('fixture\n')
   self.assertEqual(set(code_hashes(repo)),{'control.py','control_backend.py','control_worker.py','app/__init__.py','app/utils.py','tests/integration_support.py'})
   before=code_hashes(repo)
   for name in ('tests/integration_support.py','app/utils.py'):
    with self.subTest(file=name):
     (etl/name).write_text('changed\n');self.assertNotEqual(code_hashes(repo),before);(etl/name).write_text('fixture\n')
 def test_changed_sql_backup_or_image_hash_rejected(self):
  for artifact in ('sql','backup','image'):
   with self.subTest(artifact=artifact),self.assertRaises(ControlError):verify_hashes({artifact:'a'*64},{artifact:'b'*64})
 def test_ambient_libpq_flyway_rejected(self):
  for key in ('PGHOSTADDR','PGSERVICE','PGOPTIONS','FLYWAY_URL','FLYWAY_GROUP','FLYWAY_INIT_SQL'):
   with self.subTest(key=key),self.assertRaises(ControlError):reject_environment({key:'polluted'})
 def test_exit_zero_validate_json_failure_is_rejected(self):
  base={'flywayVersion':'12.4.0','operation':'validate','validationSuccessful':True,'invalidMigrations':[],'errorDetails':None}
  check_flyway_json(base,'validate')
  for key,value in [('flywayVersion','12.5'),('operation','migrate'),('validationSuccessful',False),('invalidMigrations',[{}]),('errorDetails',{'errorCode':'bad'})]:
   with self.subTest(key=key),self.assertRaises(ControlError):check_flyway_json(base|{key:value},'validate')
 def test_wrong_resource_or_development_target_rejected(self):
  t={'container_id':'a'*64,'sid':'123','host':'ry-8c1-db-fixture','network':'ry-8c1-net-fixture','network_id':'b'*64,'dbname':'recycleyoungs_integration_test_fixture','user':'integration_test','port':'5432','db_image':'sha256:'+'c'*64,'data':'/var/lib/postgresql/data','label':'fixture'}
  d={'Id':t['container_id'],'Name':'/'+t['host'],'Image':t['db_image'],'State':{'Running':True},'Mounts':[],'HostConfig':{'PortBindings':{},'Tmpfs':{'/var/lib/postgresql/data':'rw','/docker-entrypoint-initdb.d':'rw'}},'NetworkSettings':{'Networks':{t['network']:{'Aliases':[t['host']]}}},'Config':{'Labels':{'recycleyoungs.control':'fixture'},'Env':['PGDATA=/var/lib/postgresql/data']}}
  n={'Id':t['network_id'],'Name':t['network'],'Internal':True,'Labels':{'recycleyoungs.control':'fixture'}}
  check_target(t,d,n)
  for key,value in [('Id','wrong'),('Mounts',[{'Name':'recycleyoungs_postgres_data'}]),('Image','unapproved')]:
   with self.subTest(key=key),self.assertRaises(ControlError):check_target(t,d|{key:value},n)
  with self.assertRaises(ControlError):check_target(t,d,n|{'Internal':False})
  with self.assertRaises(ControlError):check_target(t|{'sid':'7692329130053947430'},d,n)
  for key in ('PGHOST','PGHOSTADDR','PGSERVICE','PGOPTIONS'):
   with self.subTest(key=key),self.assertRaises(ControlError):check_target(t,d|{'Config':d['Config']|{'Env':d['Config']['Env']+[key+'=polluted']}},n)

class Connection:
 autocommit=True
 class Info:transaction_status=0
 info=Info()
 def __init__(self,facts):self.facts=facts;self.closed=False
 def cursor(self):return self
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def execute(self,q):self.query=q
 def fetchone(self):return self.facts
 def close(self):self.closed=True

class PublicationGuardTests(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(Controller,'controller missing')
  self.expected={'db':'fixture','user':'integration_test','sid':'123','data':'/var/lib/postgresql/data','port':5432}
 def facts(self):return self.expected|{'session_user':'integration_test','lock':'5s','statement':'10min','readonly':'off'}
 def test_same_publication_connection_returned(self):
  conn=Connection(self.facts());self.assertIs(guard_connection(conn,self.expected),conn)
 def test_identity_pgdata_timeout_mismatch_closes_connection(self):
  for key in self.facts():
   f=self.facts();f[key]='wrong';conn=Connection(f)
   with self.assertRaises(ControlError):guard_connection(conn,self.expected)
   self.assertTrue(conn.closed)

class CliFactoryTests(unittest.TestCase):
 def setUp(self):self.assertIsNotNone(Controller,'controller missing')
 def test_factory_extension_exists_and_default_unchanged(self):
  import inspect
  from app.spatial_main import main
  self.assertIn('connection_factory',inspect.signature(main).parameters)
  self.assertIsNone(inspect.signature(main).parameters['connection_factory'].default)

 def test_actual_main_uses_factory_exact_connection_and_closes(self):
  from types import SimpleNamespace
  from unittest.mock import patch
  from app import spatial_main
  from app.spatial_load import PublicationResult
  prepared=SimpleNamespace(spec=SimpleNamespace(dataset_id='OA-22160'),features=[SimpleNamespace(quality_status='VALID_SOURCE')],profile={})
  conn=Connection({'fixture':True})
  with patch('app.spatial_geometry.prepare_dataset',return_value=prepared),patch('app.spatial_geometry.profile_sha256',return_value='fixture'),patch('app.spatial_load.publish',return_value=PublicationResult(1,True,True,'fixture')) as publish:
   self.assertEqual(spatial_main.main(['--only','admin','--load','--dsn','fixture','--admin-zip','fixture','--admin-report','fixture'],connection_factory=lambda d:conn),0)
   publish.assert_called_once_with(conn,prepared)
   self.assertTrue(conn.closed)
 def test_factory_identity_failure_never_reaches_publication(self):
  from types import SimpleNamespace
  from unittest.mock import patch
  from app import spatial_main
  prepared=SimpleNamespace(spec=SimpleNamespace(dataset_id='OA-22160'),features=[SimpleNamespace(quality_status='VALID_SOURCE')],profile={})
  conn=Connection({'sid':'wrong'})
  with patch('app.spatial_geometry.prepare_dataset',return_value=prepared),patch('app.spatial_geometry.profile_sha256',return_value='fixture'),patch('app.spatial_load.publish') as publish:
   rc=spatial_main.main(['--only','admin','--load','--dsn','fixture','--admin-zip','fixture','--admin-report','fixture'],connection_factory=lambda d:guard_connection(conn,{'db':'fixture','user':'integration_test','sid':'123','data':'/var/lib/postgresql/data','port':5432}))
   self.assertEqual(rc,1);publish.assert_not_called();self.assertTrue(conn.closed)
if __name__=='__main__':unittest.main()
