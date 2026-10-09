"""Test-only fail-closed connection and gate contracts. No database execution runner.

Evidence is SIMULATED_ONLY: hashes detect corruption, not human authorization.
This module intentionally has no development write enabling API.
"""
import hashlib,json,os,re,secrets,time
from pathlib import Path

class GuardError(RuntimeError):pass

STAGES=('preflight','backup_restore','v2_migrate','v2_verify','v3_migrate','v3_verify',
        'admin_polygon','admin_verify','commercial_polygon','commercial_verify','final_verify')
IDENTITY_SQL="""SELECT jsonb_build_object('database',current_database(),'user',current_user,'session_user',session_user,
 'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
 'read_only',current_setting('transaction_read_only'),'default_read_only',current_setting('default_transaction_read_only'),
 'isolation',current_setting('transaction_isolation'),'lock_timeout',current_setting('lock_timeout'),
 'statement_timeout',current_setting('statement_timeout')) AS identity"""

def digest(value):
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def validate_context(c):
 keys={'git_head','container_id','dbname','user','host','port','network','network_id','volume','pgdata',
       'image_id','backup_sha256','sql_sha256','role_acl_sha256','input_manifest_sha256','system_identifier'}
 if not isinstance(c,dict) or set(c)!=keys:raise GuardError('incomplete or extra context fields')
 for key,size in [('git_head',40),('container_id',64),('network_id',64),('backup_sha256',64),('role_acl_sha256',64),('input_manifest_sha256',64)]:
  if not isinstance(c[key],str) or not re.fullmatch('[0-9a-f]{'+str(size)+'}',c[key]):raise GuardError('invalid context digest')
 if not re.fullmatch('sha256:[0-9a-f]{64}',c['image_id']) or not str(c['system_identifier']).isdecimal():raise GuardError('invalid image/server identity')
 if c['port']!='5432' or not c['pgdata'].startswith('/') or not all(c[k] for k in ('host','dbname','user','volume','network')):raise GuardError('invalid endpoint')
 if set(c['sql_sha256'])!={'V1','V2','V3'} or not all(re.fullmatch('[0-9a-f]{64}',s) for s in c['sql_sha256'].values()):raise GuardError('invalid SQL manifest')

def open_checked(connect,parameters,expected,proof,environment):
 validate_context(expected)
 unsafe={'PGHOST','PGPORT','PGDATABASE','PGUSER','PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR','PGOPTIONS'}
 if any(v and (k in unsafe or k.startswith('FLYWAY_')) for k,v in environment.items()):raise GuardError('ambient override rejected')
 if set(parameters)!={'host','port','dbname','user','password'} or not parameters['password']:raise GuardError('explicit connection parameters required')
 for key in ('host','port','dbname','user'):
  if parameters[key]!=expected[key]:raise GuardError('connection route differs')
 for key in ('container_id','network','network_id','volume','pgdata','image_id'):
  if proof.get(key)!=expected[key]:raise GuardError('endpoint proof differs')
 if expected['host'] not in proof.get('aliases',[]):raise GuardError('approved alias missing')
 try:conn=connect(parameters)
 except BaseException:raise GuardError('connection opening failed; details withheld') from None
 try:
  if conn.autocommit is not True or conn.info.transaction_status!=0:raise GuardError('idle autocommit connection required')
  with conn.cursor() as cur:
   cur.execute(IDENTITY_SQL);row=cur.fetchone()
  actual=row.get('identity') if isinstance(row,dict) else row[0]
  required={'database':expected['dbname'],'user':expected['user'],'session_user':expected['user'],
   'system_identifier':expected['system_identifier'],'read_only':'on','default_read_only':'on',
   'isolation':'repeatable read','lock_timeout':'5s','statement_timeout':'10min'}
  if not isinstance(actual,dict) or any(actual.get(k)!=v for k,v in required.items()):raise GuardError('actual connection identity/session mismatch')
  return conn
 except BaseException:
  try:conn.close()
  except BaseException:pass
  raise GuardError('connection verification failed; close requested') from None

def require_development_write(stage):
 raise GuardError('development mutations disabled for every stage')

class GateSession:
 """One fresh in-memory session; persisted PASS never resumes/authorizes a run."""
 def __init__(self,root,context,now=None,ttl=1800):
  validate_context(context)
  if not 0<ttl<=1800:raise GuardError('invalid evidence lifetime')
  root=Path(root)
  if root.is_symlink() or not root.is_dir():raise GuardError('private directory required')
  self.root=root.resolve()
  repo=Path(__file__).resolve().parents[2]
  if self.root.is_relative_to(repo) or self.root.stat().st_uid!=os.getuid() or self.root.stat().st_mode&0o077:raise GuardError('evidence must be private and outside project')
  if (self.root/'state.json').exists() or (self.root/'STOP.json').exists():raise GuardError('old state requires manual review; cannot reuse')
  self.context=digest(context);self.start=time.time() if now is None else now;self.last=self.start
  self.ttl=ttl;self.run_id=secrets.token_hex(16);self.records=[];self.stopped=False
  self._persist()

 @property
 def complete(self):return not self.stopped and len(self.records)==len(STAGES)

 def _write(self,name,value):
  path=self.root/name
  if path.is_symlink():raise GuardError('symlink output forbidden')
  temp=self.root/(name+'.'+secrets.token_hex(8)+'.tmp')
  fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  try:
   with os.fdopen(fd,'w') as f:
    json.dump(value,f,sort_keys=True,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
   os.replace(temp,path)
  finally:
   if temp.exists():temp.unlink()

 def _state(self):
  return {'run_id':self.run_id,'context':self.context,'start':self.start,'ttl':self.ttl,'records':self.records}

 def _persist(self):self._write('state.json',self._state())

 def _log(self,path):
  path=Path(path)
  if path.is_symlink() or path.parent.resolve()!=self.root or not path.is_file():raise GuardError('invalid evidence path')
  st=path.stat()
  if st.st_uid!=os.getuid() or st.st_mode&0o077:raise GuardError('evidence access too broad')
  with path.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()

 def evidence(self,stage,status,log,created):
  return {'kind':'SIMULATED_ONLY','run_id':self.run_id,'context':self.context,'stage':stage,'status':status,
   'created':created,'log':Path(log).name,'log_sha256':self._log(log)}

 def _verify_chain(self):
  path=self.root/'state.json'
  if path.is_symlink() or path.stat().st_mode&0o077 or path.stat().st_uid!=os.getuid():raise GuardError('state access invalid')
  try:stored=json.loads(path.read_text())
  except (ValueError,OSError):raise GuardError('state corrupt') from None
  if stored!=self._state():raise GuardError('state altered')
  previous=self.context
  for record in self.records:
   raw={k:v for k,v in record.items() if k!='record_sha256'}
   if record['previous']!=previous or digest(raw)!=record['record_sha256']:raise GuardError('hash chain broken')
   if self._log(self.root/record['evidence']['log'])!=record['evidence']['log_sha256']:raise GuardError('log altered')
   previous=record['record_sha256']

 def accept(self,stage,evidence,current_context,now):
  try:
   if self.stopped or (self.root/'STOP.json').exists():raise GuardError('terminal STOP')
   validate_context(current_context)
   if digest(current_context)!=self.context:raise GuardError('context changed; all gates invalid')
   if not self.start<=now<=self.start+self.ttl or now<self.last:raise GuardError('stale/backward execution time')
   self._verify_chain()
   if len(self.records)>=len(STAGES) or stage!=STAGES[len(self.records)]:raise GuardError('missing previous gate or invalid order')
   if not isinstance(evidence,dict) or set(evidence)!={'kind','run_id','context','stage','status','created','log','log_sha256'}:raise GuardError('structured evidence required')
   if evidence['kind']!='SIMULATED_ONLY' or evidence['run_id']!=self.run_id or evidence['context']!=self.context or evidence['stage']!=stage:raise GuardError('foreign evidence')
   if not self.start<=evidence['created']<=now:raise GuardError('stale/future evidence')
   if self._log(self.root/evidence['log'])!=evidence['log_sha256']:raise GuardError('evidence changed')
   if evidence['status']!='PASS':raise GuardError('stage did not pass')
   record={'evidence':evidence.copy(),'previous':self.records[-1]['record_sha256'] if self.records else self.context}
   record['record_sha256']=digest(record);self.records.append(record);self.last=now;self._persist()
  except BaseException:
   self.stopped=True
   self._write('STOP.json',{'run_id':self.run_id,'context':self.context,'stage':stage,'state':'STOP','automatic_resume':False})
   raise GuardError('gate rejected; manual review/new run required') from None

if __name__=='__main__':
 print('TEST-ONLY: no connection, no database execution; development writes disabled.')
