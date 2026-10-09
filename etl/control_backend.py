"""Trusted Docker measurements for isolated control; no development branch."""
import contextlib,hashlib,importlib,io,json,os,re,subprocess,sys
from pathlib import Path
from control import ControlError,check_target,file_sha,digest,flyway_init_sql,reject_environment,verify_hashes,check_flyway_json
BACKUP_SHA='970cb9016b67b95b9e1c3bb291f762a229129f2a3884551e16053aca26f2089d'
SQL_SHA={'V1__initial_schema.sql':'e610887d646e6f6efe1967e3862b0a3f76f91c4f4ab78573caf3e3f6d2895c01','V2__spatial_schema.sql':'eaf805c50ba32cd7a2d4875ff0aea31cea719d5522ea33cf833cab98580e00e3','V3__semas_cafe_mapping_and_store_backfill.sql':'d1065d224b841c0adbb09bc368f2f63c63c63d81a268d08e8affee9884dd52cc'}
IMAGES={'db':'sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5',
 'flyway':'sha256:5be18367a9b3979a9f37234c371b80da457a448fb9577bd94d4bf24d923fafac',
 'etl':'sha256:b3bc55d2aeadd8ca3ef25e8c6be50a9f1651420983ded52cf20f98b3cee75536'}

def code_hashes(repo):
 root=Path(repo)/'etl'
 paths=[root/name for name in ('control.py','control_backend.py','control_worker.py','tests/integration_support.py')]
 paths+=list((root/'app').rglob('*.py'))
 return {str(p.relative_to(root)):file_sha(p) for p in sorted(paths)}

class DockerBackend:
 kind='ISOLATED_MEASURED'
 def __init__(self,path):
  path=Path(path)
  if path.is_symlink() or path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077:raise ControlError('private configuration required')
  self.cfg=json.loads(path.read_text());self.cfg_path=path;self.cfg_sha=file_sha(path)
  self.repo=Path(self.cfg['repo']);self.target=self.cfg['target'];self.out=Path(self.cfg['work'])
  if path.resolve().is_relative_to(self.repo.resolve()) or self.out.resolve().is_relative_to(self.repo.resolve()):raise ControlError('private paths inside repository')
  if self.cfg['images']!=IMAGES:raise ControlError('unapproved image')
  if self.target['db_image']!=IMAGES['db']:raise ControlError('actual database image not approved')
  if self.out.is_symlink() or not self.out.is_dir() or self.out.stat().st_uid!=os.getuid() or self.out.stat().st_mode&0o077 or any(self.out.iterdir()):raise ControlError('fresh private work directory required')
  if any(p.is_symlink() for p in self.out.parents):raise ControlError('symlink work ancestor forbidden')
  self.secret=os.environ.get('CONTROL_DB_PASSWORD')
  if not self.secret:raise ControlError('ephemeral isolated secret required')
  reject_environment(os.environ)
  self.logs=[];self.artifacts={};self.command_number=0
  self._target()
 def _sanitize(self,text):
  text=text.replace(self.secret,'[SECRET_REDACTED]')
  return re.sub(r'jdbc:postgresql://\S+','[JDBC_REDACTED]',text)
 def _run(self,args,name,data=None,env=None):
  r=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
   env={**os.environ,**(env or {})},timeout=600)
  log=self._sanitize(r.stdout.decode(errors='replace')+'\n'+r.stderr.decode(errors='replace'))
  self.command_number+=1
  p=self.out/(str(self.command_number)+'-'+name+'.private.log')
  fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  with os.fdopen(fd,'w') as f:f.write(log)
  self.logs.append({'operation':name,'exit_code':r.returncode,'log_sha256':file_sha(p)})
  if r.returncode:raise ControlError(name+' failed; redacted private log retained')
  return r
 def _target(self):
  d=json.loads(self._run(['docker','inspect',self.target['container_id']],'target-inspect').stdout)[0]
  n=json.loads(self._run(['docker','network','inspect',self.target['network_id']],'network-inspect').stdout)[0]
  check_target(self.target,d,n)
  return d,n
 def _check_artifacts(self):
  for name,sha in self.artifacts.items():
   p=self.out/name
   if p.stat().st_uid!=os.getuid() or p.stat().st_mode&0o077 or file_sha(p)!=sha:raise ControlError('validator evidence altered')
 def _seal_artifacts(self,label):
  for name in (label+'.json','snap-'+label+'.json'):
   if name in self.artifacts:raise ControlError('validator evidence reuse forbidden')
   p=self.out/name
   if p.stat().st_uid!=os.getuid() or p.stat().st_mode&0o077:raise ControlError('private validator evidence required')
   self.artifacts[name]=file_sha(p)
 def fingerprint(self):
  reject_environment(os.environ);self._check_artifacts();self._target()
  if file_sha(self.cfg_path)!=self.cfg_sha:raise ControlError('private configuration changed')
  if self._run(['git','-C',str(self.repo),'branch','--show-current'],'git-branch').stdout.decode().strip()!='main':raise ControlError('branch changed')
  head=self._run(['git','-C',str(self.repo),'rev-parse','HEAD'],'git-head').stdout.decode().strip()
  if head!=self.cfg['expected_head']:raise ControlError('Git changed')
  sql={f.name:file_sha(f) for f in (self.repo/'backend/src/main/resources/db/migration').glob('*.sql')}
  verify_hashes(SQL_SHA,sql);verify_hashes(SQL_SHA,self.cfg['sql_sha'])
  if file_sha(self.cfg['backup'])!=BACKUP_SHA or Path(self.cfg['backup']).stat().st_size!=11690636:raise ControlError('backup identity differs')
  if file_sha(self.cfg['reference'])!=self.cfg['reference_sha']:raise ControlError('restore reference evidence altered')
  for name in ('audit_source','catalog_source'):
   if file_sha(self.cfg[name])!=self.cfg[name+'_sha']:raise ControlError('validator artifact changed')
  for image in IMAGES.values():
   if json.loads(self._run(['docker','image','inspect',image],'image-inspect').stdout)[0]['Id']!=image:raise ControlError('image identity differs')
  sys.path.insert(0,str(self.repo/'etl'))
  from app.spatial_sources import SPECS
  from zipfile import ZipFile
  root=Path(self.cfg['spatial_root'])
  archives={'admin':root/'서울시 상권분석서비스(영역-행정동).zip','commercial':root/'stage4-research-20261007/official-commercial-area.zip'}
  inputs={}
  for kind,spec in SPECS.items():
   if file_sha(archives[kind])!=spec.archive_sha256:raise ControlError('Polygon ZIP differs')
   with ZipFile(archives[kind]) as z:
    members={}
    for name in z.namelist():
     decoded=name if z.getinfo(name).flag_bits&0x800 else name.encode('cp437').decode('cp949')
     if decoded in members:raise ControlError('duplicate ZIP member')
     members[decoded]=hashlib.sha256(z.read(name)).hexdigest()
    if members!=spec.member_hashes:raise ControlError('ZIP members differ')
   reports={}
   for role,relative in spec.report_artifacts.items():
    value=file_sha(self.repo/relative)
    if value!=spec.report_hashes[role]:raise ControlError('report differs')
    reports[role]=value
   inputs[kind]={'zip':spec.archive_sha256,'members':members,'reports':reports,'profile':self.cfg['profiles'][kind]}
  code=code_hashes(self.repo)
  return digest({'head':head,'target':self.target,'images':IMAGES,'sql':sql,'backup':BACKUP_SHA,
   'reference':self.cfg['reference_sha'],'validators':[self.cfg['audit_source_sha'],self.cfg['catalog_source_sha']],'inputs':inputs,'code':code})
 def _worker(self,operation,label=None,kind=None):
  self._check_artifacts();self._target()
  args=['docker','run','--rm','--pull=never','--network',self.target['network'],'--entrypoint','python',
   '-e','CONTROL_DB_PASSWORD','-e','PYTHONDONTWRITEBYTECODE=1',
   '--mount',f'type=bind,src={self.repo}/etl,dst=/workspace/etl,readonly',
   '--mount',f'type=bind,src={self.cfg_path},dst=/run/config.json,readonly',
   '--mount',f'type=bind,src={self.cfg["reference"]},dst=/run/reference.json,readonly',
   '--mount',f'type=bind,src={self.cfg["audit_source"]},dst=/run/audit_source.py,readonly',
   '--mount',f'type=bind,src={self.cfg["catalog_source"]},dst=/run/catalog_source.py,readonly',
   '--mount',f'type=bind,src={self.cfg["spatial_root"]},dst=/source/spatial,readonly',
   '--mount',f'type=bind,src={self.out},dst=/out','--workdir','/workspace/etl',IMAGES['etl'],
   'control_worker.py',operation]
  if label:args+=['--label',label]
  if kind:args+=['--kind',kind]
  r=self._run(args,'worker-'+operation+'-'+str(label or kind),env={'CONTROL_DB_PASSWORD':self.secret})
  result=json.loads(r.stdout.decode().splitlines()[-1])
  self._check_artifacts()
  if operation=='verify':self._seal_artifacts(label)
  return result
 def identity(self):return self._worker('identity')['identity']
 def _flyway(self,target,action='migrate'):
  e={'db':self.target['dbname'],'user':self.target['user'],'sid':self.target['sid'],'data':self.target['data'],'port':5432}
  args=['docker','run','--rm','--pull=never','--network',self.target['network'],
   '--mount',f'type=bind,src={self.repo}/backend/src/main/resources/db/migration,dst=/flyway/sql,readonly',
   '-e','FLYWAY_PASSWORD',IMAGES['flyway'],f'-url=jdbc:postgresql://{self.target["host"]}:5432/{self.target["dbname"]}',
   '-user='+self.target['user'],'-schemas=public','-defaultSchema=public','-createSchemas=false',
   '-baselineOnMigrate=false','-cleanDisabled=true','-group=false','-outOfOrder=false','-connectRetries=0',
   '-executeInTransaction=true','-mixed=false','-initSql='+flyway_init_sql(e),'-outputType=json']
  if target:args+=['-target='+str(target)]
  args+=[action]
  r=self._run(args,'flyway-'+action+'-'+str(target),env={'FLYWAY_PASSWORD':self.secret})
  value=json.loads(r.stdout)
  check_flyway_json(value,action)
  return value
 def execute(self,stage):
  self.logs=[]
  if stage=='PRECHECK':result=self._worker('runtime')
  elif stage=='BACKUP_RESTORE_VERIFIED':
   self._worker('empty')
   for role in self.cfg['restore_roles']:
    if not re.fullmatch('[A-Za-z_][A-Za-z_0-9]*',role):raise ControlError('unsafe owner role')
    self._run(['docker','exec','-i','-e','PGPASSWORD',self.target['container_id'],'psql','-X','-q','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','5432','-U',self.target['user'],'-d',self.target['dbname']],
     'restore-role',data=('CREATE ROLE "'+role+'" NOLOGIN;\n').encode(),env={'PGPASSWORD':self.secret})
   self._target()
   with Path(self.cfg['backup']).open('rb') as source:
    r=subprocess.run(['docker','exec','-i','-e','PGPASSWORD',self.target['container_id'],'pg_restore','--exit-on-error','-h','127.0.0.1','-p','5432','-U',self.target['user'],'-d',self.target['dbname']],
     stdin=source,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'PGPASSWORD':self.secret},timeout=600)
   restore_log=self._sanitize(r.stdout.decode()+'\n'+r.stderr.decode())
   self.logs.append({'operation':'pg_restore','exit_code':r.returncode,'log':restore_log})
   if r.returncode:raise ControlError('restore failed')
   result=self._worker('verify',label='restore')
  elif stage=='V2_APPLIED':
   result={'flyway':self._flyway(2),'history':self._worker('history',label='v2')}
  elif stage=='V2_VERIFIED':
   result={'validate':self._flyway(2,'validate'),'preservation':self._worker('verify',label='v2')}
  elif stage=='V3_APPLIED':
   result={'flyway':self._flyway(3),'history':self._worker('history',label='v3')}
  elif stage=='V3_VERIFIED':
   result={'validate':self._flyway(None,'validate'),'preservation':self._worker('verify',label='v3')}
  elif stage in ('ADMIN_POLYGON_APPLIED','COMMERCIAL_POLYGON_APPLIED'):
   result=self._worker('polygon',kind='admin' if stage.startswith('ADMIN') else 'commercial')
  elif stage in ('ADMIN_POLYGON_VERIFIED','COMMERCIAL_POLYGON_VERIFIED'):
   result=self._worker('verify',label='admin' if stage.startswith('ADMIN') else 'commercial')
  elif stage=='FINAL_VERIFIED':result=self._worker('final')
  else:raise ControlError('stage not implemented')
  return {'exit_code':0,'validated':True,'result':result,'validator_artifacts':dict(self.artifacts),'log':json.dumps({'commands':self.logs,'validated_result':result},sort_keys=True,default=str)}
