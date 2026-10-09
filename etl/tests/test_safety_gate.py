"""Pure local fail-closed guard tests; no Docker, DB, backup or credentials."""
import copy,hashlib,json,os,tempfile,unittest
from pathlib import Path
try:
 import safety_gate as gate
except ImportError:
 gate=None

def context():
 return {'git_head':'a'*40,'container_id':'b'*64,'dbname':'fixture_db','user':'fixture_user','host':'fixture_host','port':'5432',
  'network':'fixture_net','network_id':'c'*64,'volume':'fixture_volume','pgdata':'/fixture/data','image_id':'sha256:'+'d'*64,
  'backup_sha256':'e'*64,'sql_sha256':{'V1':'1'*64,'V2':'2'*64,'V3':'3'*64},'role_acl_sha256':'f'*64,'input_manifest_sha256':'4'*64}

def proof(c):
 return {k:c[k] for k in ('container_id','network','network_id','volume','pgdata','image_id')}|{'aliases':[c['host']]}

def facts(c):
 return {'database':c['dbname'],'user':c['user'],'session_user':c['user'],'system_identifier':'12345',
  'read_only':'on','default_read_only':'on','isolation':'repeatable read','lock_timeout':'5s','statement_timeout':'10min'}

class Cursor:
 def __init__(self,c):self.c=c
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def execute(self,q):self.c.queries.append(q)
 def fetchone(self):
  if self.c.error:raise RuntimeError('fixture identity lookup failure')
  return {'identity':self.c.facts}

class Connection:
 autocommit=True
 class Info:transaction_status=0
 info=Info()
 def __init__(self,f):self.facts=f;self.closed=False;self.queries=[];self.error=False
 def cursor(self):return Cursor(self)
 def close(self):self.closed=True

class SafetyTests(unittest.TestCase):
 def setUp(self):
  self.assertIsNotNone(gate,'8-C2B-2 safety guard implementation missing')
  self.c=context();self.c['system_identifier']='12345'
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.root.chmod(0o700)
 def tearDown(self):
  if hasattr(self,'temp'):self.temp.cleanup()
 def session(self):return gate.GateSession(self.root,self.c,now=1000,ttl=1800)
 def accept(self,s,stage='preflight',status='PASS',now=1001,current=None):
  log=self.root/(stage+'.log');log.write_text('fixture measured command exit=0\n');log.chmod(0o600)
  e=s.evidence(stage,status,log,now)
  s.accept(stage,e,current or self.c,now)
 def open(self,conn,environment=None,p=None,params=None):
  values={'host':self.c['host'],'port':'5432','dbname':self.c['dbname'],'user':self.c['user'],'password':'fixture-only'}
  return gate.open_checked(lambda supplied:conn,params or values,self.c,p or proof(self.c),environment or {})

 def test_identical_returned_connection_is_checked(self):
  conn=Connection(facts(self.c));self.assertIs(self.open(conn),conn)
  self.assertEqual(len(conn.queries),1);self.assertIn('system_identifier',conn.queries[0]);self.assertFalse(conn.closed)
 def test_container_id_image_volume_network_rejected_before_connect(self):
  for key in ('container_id','image_id','volume','pgdata','network','network_id'):
   with self.subTest(key=key):
    p=proof(self.c);p[key]='wrong';called=[]
    with self.assertRaises(gate.GuardError):gate.open_checked(lambda x:called.append(x),{'host':self.c['host'],'port':'5432','dbname':self.c['dbname'],'user':self.c['user'],'password':'fixture'},self.c,p,{})
    self.assertEqual(called,[])
 def test_dsn_missing_extra_multihost_rejected(self):
  base={'host':self.c['host'],'port':'5432','dbname':self.c['dbname'],'user':self.c['user'],'password':'fixture'}
  for changed in (base|{'service':'bad'},base|{'host':'one,two'},{k:v for k,v in base.items() if k!='user'}):
   with self.assertRaises(gate.GuardError):self.open(Connection(facts(self.c)),params=changed)
 def test_wrong_database_user_sid_readonly_timeout_close(self):
  for key in ('database','user','session_user','system_identifier','read_only','default_read_only','isolation','lock_timeout','statement_timeout'):
   with self.subTest(key=key):
    f=facts(self.c);f[key]='wrong';conn=Connection(f)
    with self.assertRaises(gate.GuardError):self.open(conn)
    self.assertTrue(conn.closed)
 def test_identity_query_failure_closes_connection(self):
  conn=Connection(facts(self.c));conn.error=True
  with self.assertRaises(gate.GuardError):self.open(conn)
  self.assertTrue(conn.closed)
 def test_connector_failure_is_sanitized(self):
  def broken(parameters):raise RuntimeError('password=must-not-escape')
  values={'host':self.c['host'],'port':'5432','dbname':self.c['dbname'],'user':self.c['user'],'password':'fixture'}
  with self.assertRaises(gate.GuardError) as caught:gate.open_checked(broken,values,self.c,proof(self.c),{})
  self.assertNotIn('password=',str(caught.exception))
 def test_outer_transaction_and_non_autocommit_rejected(self):
  conn=Connection(facts(self.c));conn.autocommit=False
  with self.assertRaises(gate.GuardError):self.open(conn)
  self.assertTrue(conn.closed)
 def test_ambient_libpq_and_flyway_override(self):
  for key in ('PGHOSTADDR','PGSERVICE','PGOPTIONS','PGSERVICEFILE','PGSYSCONFDIR','FLYWAY_URL','FLYWAY_CONFIG_FILES','FLYWAY_GROUP'):
   with self.subTest(key=key),self.assertRaises(gate.GuardError):self.open(Connection(facts(self.c)),environment={key:'unexpected'})
 def test_missing_previous_gate_and_wrong_stage_order(self):
  s=self.session()
  for stage in ('v2_migrate','commercial_polygon','final_verify'):
   with self.assertRaises(gate.GuardError):self.accept(s,stage)
 def test_previous_fail_stops_every_later_stage(self):
  s=self.session()
  with self.assertRaises(gate.GuardError):self.accept(s,status='FAIL')
  with self.assertRaises(gate.GuardError):self.accept(s,status='PASS')
 def test_context_sql_backup_acl_identity_changes_invalidate(self):
  for key in ('git_head','container_id','system_identifier','backup_sha256','role_acl_sha256','input_manifest_sha256','image_id','sql_sha256'):
   with self.subTest(key=key):
    r=self.root/key;r.mkdir(mode=0o700);s=gate.GateSession(r,self.c,now=1000)
    c=copy.deepcopy(self.c)
    if key=='sql_sha256':c[key]['V1']='9'*64
    elif key=='git_head':c[key]='9'*40
    elif key=='system_identifier':c[key]='99999'
    elif key=='image_id':c[key]='sha256:'+'9'*64
    else:c[key]='9'*64
    log=r/'run.log';log.write_text('measured');log.chmod(0o600)
    with self.assertRaises(gate.GuardError):s.accept('preflight',s.evidence('preflight','PASS',log,1001),c,1001)
 def test_log_evidence_tamper_detected(self):
  s=self.session();self.accept(s)
  (self.root/'preflight.log').write_text('tampered')
  with self.assertRaises(gate.GuardError):self.accept(s,'backup_restore')
 def test_persisted_state_tamper_detected(self):
  s=self.session();self.accept(s)
  (self.root/'state.json').write_text('{}\n')
  with self.assertRaises(gate.GuardError):self.accept(s,'backup_restore')
 def test_stale_future_and_other_run_pass_rejected(self):
  for stamp in (900,3000,1002):
   with self.subTest(stamp=stamp):
    r=self.root/str(stamp);r.mkdir(mode=0o700);s=gate.GateSession(r,self.c,now=1000,ttl=10)
    log=r/'log';log.write_text('measured');log.chmod(0o600)
    e=s.evidence('preflight','PASS',log,stamp)
    if stamp==1002:e['run_id']='other'
    with self.assertRaises(gate.GuardError):s.accept('preflight',e,self.c,1011 if stamp==3000 else 1001)
 def test_success_text_not_accepted_as_evidence(self):
  with self.assertRaises(gate.GuardError):self.session().accept('preflight','PASS',self.c,1001)
 def test_old_pass_files_do_not_authorize_new_run(self):
  s=self.session();self.accept(s)
  with self.assertRaises(gate.GuardError):self.session()
 def test_symlink_and_insecure_evidence_rejected(self):
  s=self.session();target=self.root/'outside';target.write_text('fixture');target.chmod(0o600)
  link=self.root/'link';link.symlink_to(target)
  with self.assertRaises(gate.GuardError):s.evidence('preflight','PASS',link,1001)
  target.chmod(0o644)
  with self.assertRaises(gate.GuardError):s.evidence('preflight','PASS',target,1001)
 def test_migration_failure_and_polygon_failure_stop_next(self):
  for failure in ('v2_migrate','admin_polygon'):
   with self.subTest(stage=failure):
    r=self.root/failure;r.mkdir(mode=0o700);s=gate.GateSession(r,self.c,now=1000)
    for stage in gate.STAGES:
     log=r/(stage+'.log');log.write_text('measured');log.chmod(0o600)
     if stage==failure:
      with self.assertRaises(gate.GuardError):s.accept(stage,s.evidence(stage,'FAIL',log,1001),self.c,1001)
      with self.assertRaises(gate.GuardError):s.accept(gate.STAGES[gate.STAGES.index(stage)+1],s.evidence(gate.STAGES[gate.STAGES.index(stage)+1],'PASS',log,1001),self.c,1001)
      break
     s.accept(stage,s.evidence(stage,'PASS',log,1001),self.c,1001)
 def test_full_simulated_order_never_enables_development_writes(self):
  s=self.session()
  for stage in gate.STAGES:
   self.accept(s,stage)
   with self.assertRaises(gate.GuardError):gate.require_development_write(stage)
  self.assertTrue(s.complete)

if __name__=='__main__':unittest.main()
