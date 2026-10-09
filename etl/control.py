"""Isolated execution control. Default inspection is inert; no development mode."""
import argparse,hashlib,hmac,json,os,re,secrets,time,subprocess
from pathlib import Path

class ControlError(RuntimeError):pass
STAGES=('PRECHECK','BACKUP_RESTORE_VERIFIED','V2_APPLIED','V2_VERIFIED','V3_APPLIED','V3_VERIFIED',
 'ADMIN_POLYGON_APPLIED','ADMIN_POLYGON_VERIFIED','COMMERCIAL_POLYGON_APPLIED','COMMERCIAL_POLYGON_VERIFIED','FINAL_VERIFIED')
PROTECTED_ID='983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951'
PROTECTED_SID='7692329130053947430'
def encode(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(value):return hashlib.sha256(encode(value)).hexdigest()
def file_sha(path):
 path=Path(path)
 if path.is_symlink() or not path.is_file():raise ControlError('unsafe artifact')
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def reject_environment(environment):
 bad={'PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR'}
 if any(v and (k in bad or k.startswith('FLYWAY_')) for k,v in environment.items()):raise ControlError('ambient configuration rejected')

def verify_hashes(expected,actual):
 if expected!=actual:raise ControlError('artifact identity mismatch')

def check_flyway_json(value,action):
 if value.get('flywayVersion')!='12.4.0' or value.get('operation')!=action or value.get('errorDetails') is not None:raise ControlError('Flyway JSON rejected')
 if action=='validate' and (value.get('validationSuccessful') is not True or value.get('invalidMigrations')!=[]):raise ControlError('Flyway validation rejected')

def check_target(t,d,n):
 if t['container_id']==PROTECTED_ID or t['sid']==PROTECTED_SID:raise ControlError('development target forbidden')
 if not re.fullmatch('ry-8c1-db-[a-z0-9]+',t['host']) or not re.fullmatch('ry-8c1-net-[a-z0-9]+',t['network']):raise ControlError('isolated names required')
 if not re.fullmatch('recycleyoungs_integration_test_[a-z0-9_]+',t['dbname']) or t['user']!='integration_test' or t['port']!='5432':raise ControlError('isolated actor/database required')
 if d['Id']!=t['container_id'] or d['Name']!='/'+t['host'] or d['Image']!=t['db_image'] or not d['State']['Running']:raise ControlError('container identity differs')
 if d['Mounts'] or d['HostConfig']['PortBindings'] or not {'/var/lib/postgresql/data','/docker-entrypoint-initdb.d'}<=set(d['HostConfig']['Tmpfs']):raise ControlError('volume/port/tmpfs policy rejected')
 endpoint=d['NetworkSettings']['Networks'].get(t['network'],{})
 names=set(endpoint.get('Aliases') or ())|set(endpoint.get('DNSNames') or ())
 if set(d['NetworkSettings']['Networks'])!={t['network']} or t['host'] not in names:raise ControlError('network/alias differs')
 if n['Id']!=t['network_id'] or n['Name']!=t['network'] or n['Internal'] is not True:raise ControlError('network identity differs')
 if d['Config']['Labels'].get('recycleyoungs.control')!=t['label'] or n['Labels'].get('recycleyoungs.control')!=t['label']:raise ControlError('resource ownership differs')
 env=dict(x.split('=',1) for x in d['Config']['Env'] if '=' in x)
 reject_environment(env)
 if env.get('PGDATA')!=t['data']:raise ControlError('PGDATA metadata differs')

def flyway_init_sql(e):
 def literal(s):
  if not re.fullmatch('[A-Za-z0-9_/.-]+',str(s)):raise ControlError('unsafe identity literal')
  return "'"+str(s)+"'"
 predicates=["current_database()="+literal(e['db']),"current_user="+literal(e['user']),
  "(SELECT system_identifier::text FROM pg_control_system())="+literal(e['sid']),
  "current_setting('data_directory')="+literal(e['data']),"current_setting('port')="+literal(e['port']),
  "current_setting('lock_timeout')='5s'","current_setting('statement_timeout')='10min'"]
 return "SET lock_timeout='5s'; SET statement_timeout='10min'; SELECT 1 / (("+ ' AND '.join(predicates)+")::int)"

CONNECTION_SQL="""SELECT current_database() AS db,current_user AS user,session_user,
 (SELECT system_identifier::text FROM pg_control_system()) AS sid,
 current_setting('data_directory') AS data,current_setting('port')::int AS port,
 current_setting('lock_timeout') AS lock,current_setting('statement_timeout') AS statement,
 current_setting('transaction_read_only') AS readonly"""
def guard_connection(conn,expected):
 try:
  if conn.autocommit is not True or conn.info.transaction_status!=0:raise ControlError('idle autocommit required')
  with conn.cursor() as cur:cur.execute(CONNECTION_SQL);actual=cur.fetchone()
  wanted=expected|{'session_user':expected['user'],'lock':'5s','statement':'10min','readonly':'off'}
  if actual!=wanted:raise ControlError('publication connection differs')
  return conn
 except BaseException:
  try:conn.close()
  except BaseException:pass
  raise ControlError('publication connection rejected') from None

class Controller:
 """Dispatch and collect measurements itself; does not accept external PASS."""
 def __init__(self,backend,root,clock=time.time,ttl=1800):
  self.backend=backend;self.root=Path(root);self.clock=clock;self.ttl=ttl
  if self.root.is_symlink() or not self.root.is_dir() or self.root.stat().st_uid!=os.getuid() or self.root.stat().st_mode&0o077:raise ControlError('private evidence directory required')
  if self.root.resolve().is_relative_to(Path(__file__).resolve().parents[1]):raise ControlError('evidence inside repository forbidden')
  if (self.root/'state.json').exists() or (self.root/'STOP.json').exists():raise ControlError('stale state cannot resume')
  self.start=clock();self.last=self.start;self.nonce=secrets.token_hex(16);self.key=secrets.token_bytes(32)
  self.fingerprint=backend.fingerprint();self.records=[];self.stopped=False
  self._save()
 @property
 def complete(self):
  now=self.clock()
  return not self.stopped and len(self.records)==len(STAGES) and self.last<=now<=self.start+self.ttl
 def authorize_development(self):raise ControlError('development execution not implemented')
 def _write(self,name,data):
  p=self.root/name
  if p.is_symlink():raise ControlError('symlink evidence forbidden')
  temp=self.root/(name+'.'+secrets.token_hex(8)+'.tmp')
  fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(temp,p)
 def _state(self):return {'kind':self.backend.kind,'nonce':self.nonce,'fingerprint':self.fingerprint,'records':self.records}
 def _save(self):self._write('state.json',encode(self._state())+b'\n')
 def _integrity(self):
  p=self.root/'state.json'
  if p.is_symlink() or p.stat().st_mode&0o077 or json.loads(p.read_text())!=self._state():raise ControlError('state altered')
  for record in self.records:
   raw={k:v for k,v in record.items() if k!='seal'}
   if not hmac.compare_digest(record['seal'],hmac.new(self.key,encode(raw),'sha256').hexdigest()):raise ControlError('evidence forged')
   if file_sha(self.root/record['log'])!=record['log_sha256']:raise ControlError('log changed')
 def run_stage(self,stage):
  try:
   if self.stopped:raise ControlError('terminal STOP')
   now=self.clock()
   if not self.start<=now<=self.start+self.ttl or now<self.last:raise ControlError('stale evidence')
   self._integrity()
   if self.backend.fingerprint()!=self.fingerprint:raise ControlError('input/Git/target changed')
   if len(self.records)>=len(STAGES) or stage!=STAGES[len(self.records)]:raise ControlError('previous real gate missing')
   before=self.backend.identity()
   measured=self.backend.execute(stage)
   after=self.backend.identity()
   if before!=after or measured.get('exit_code')!=0 or measured.get('validated') is not True:raise ControlError('execution/validator/identity failure')
   if self.backend.fingerprint()!=self.fingerprint:raise ControlError('input changed during stage')
   finished=self.clock()
   if not now<=finished<=self.start+self.ttl:raise ControlError('stage evidence expired')
   text=measured.pop('log')
   if not isinstance(text,str):raise ControlError('measured log absent')
   self._write(stage+'.log',text.encode())
   record={'stage':stage,'nonce':self.nonce,'before':before,'after':after,'measured':measured,'time':finished,'started_at':now,
    'fingerprint':self.fingerprint,'previous':self.records[-1]['seal'] if self.records else self.fingerprint,
    'log':stage+'.log','log_sha256':file_sha(self.root/(stage+'.log'))}
   record['seal']=hmac.new(self.key,encode(record),'sha256').hexdigest()
   self.records.append(record);self.last=finished;self._save()
  except BaseException as error:
   detail=str(error) if isinstance(error,ControlError) else 'operational failure; private details withheld'
   self.stopped=True;self._write('STOP.json',encode({'stage':stage,'nonce':self.nonce,'automatic_resume':False,'reason':detail})+b'\n')
   raise ControlError('STOP: no following stage permitted') from None
 def run_all(self):
  for stage in STAGES:self.run_stage(stage)

def main(argv=None):
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--isolated-run',action='store_true')
 p.add_argument('--private-config',type=Path);p.add_argument('--private-evidence',type=Path);a=p.parse_args(argv)
 if not a.isolated_run:
  repo=Path(__file__).resolve().parents[1]
  branch=subprocess.check_output(['git','-C',str(repo),'branch','--show-current'],text=True).strip()
  if branch!='main':raise ControlError('unexpected branch')
  head=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
  print(json.dumps({'mode':'inspect/dry-run','branch':branch,'head':head,'database_contact':False,'development_execution':False,'stages':STAGES}));return 0
 if not a.private_config or not a.private_evidence:p.error('explicit private isolated configuration required')
 from control_backend import DockerBackend
 Controller(DockerBackend(a.private_config),a.private_evidence).run_all()
 print('ISOLATED MEASURED RUN PASS; development execution remains unavailable');return 0
if __name__=='__main__':raise SystemExit(main())
