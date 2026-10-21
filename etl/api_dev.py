"""Host controller for the separately owned persistent API Compose environment."""
import argparse,hashlib,json,os,re,secrets,shutil,subprocess,sys,time,zipfile
from pathlib import Path
from api_runtime import PROJECT,DATABASE,PGDATA,DB_IMAGE,RuntimeErrorCode,require,private_read,validate_target
from app.api_artifacts import create_file,encoded
from app.api_config import private_parent,load_keys
from app.api_release import prepare_release
from control import flyway_init_sql,check_flyway_json

ROOT=Path(__file__).resolve().parents[1]
DEFAULT_HOME=Path.home()/'.config/recycleyoungs/api-dev'
FLYWAY='sha256:5be18367a9b3979a9f37234c371b80da457a448fb9577bd94d4bf24d923fafac'
WORKER='sha256:9d57711a7d8a613845eb4c78b57331a7f612087ab965c0b0a85d1569a5cec5c4'

def run(args,*,data=None,env=None,timeout=900):
    r=subprocess.run(args,input=data,capture_output=True,env={**os.environ,**(env or {})},timeout=timeout)
    if r.returncode:
        try:
            value=json.loads(r.stderr.decode().splitlines()[-1])
            if value.get('status')=='FAIL':print(json.dumps({k:value.get(k) for k in ('status','code','type','sqlstate')}),file=sys.stderr)
        except (ValueError,IndexError,AttributeError):pass
        raise RuntimeErrorCode('COMMAND_FAILED_'+args[0].replace('/','_'))
    return r.stdout

def write(path,value):
    with create_file(path) as f:f.write(encoded(value) if not isinstance(value,bytes) else value)

def compose(home,*args,**kwargs):
    require(not any(os.getenv(k) for k in ('COMPOSE_FILE','COMPOSE_PROJECT_NAME','COMPOSE_PROFILES')),'COMPOSE_OVERRIDES_REJECTED')
    return run(['docker','compose','--env-file',str(home/'compose.env'),'-f',str(ROOT/'docker-compose.api.yml'),*args],**kwargs)

def inspect(kind,name):return json.loads(run(['docker',kind,'inspect',name]))[0]

def proof(home):
    t=json.loads(private_read(home/'target.json'));validate_target(t)
    require(run(['docker','info','--format','{{.ID}}']).decode().strip()==t['daemon'],'DAEMON_CHANGED')
    d=inspect('container',t['container_id']);n=inspect('network',t['network_id']);v=inspect('volume',t['volume'])
    require(d['Name']=='/'+PROJECT+'-api-postgres-1' and d['State']['Running'] and d['Image']==DB_IMAGE,'DB_RESOURCE_CHANGED')
    require(d['Config']['Labels'].get('org.recycleyoungs.api-owner')==t['owner'] and n['Labels'].get('org.recycleyoungs.api-owner')==t['owner']
        and v['Labels'].get('org.recycleyoungs.api-owner')==t['owner'] and v['CreatedAt']==t['volume_created'],'API_OWNERSHIP_CHANGED')
    require(not d['HostConfig'].get('PortBindings') and set(d['NetworkSettings']['Networks'])=={PROJECT+'-data'}
        and n['Internal'] is True and n['Name']==PROJECT+'-data','API_NETWORK_REJECTED')
    mounts=d['Mounts'];require(len(mounts)==1 and mounts[0]['Type']=='volume' and mounts[0]['Name']==t['volume']
        and mounts[0]['Destination']=='/var/lib/postgresql/data' and mounts[0]['RW'],'API_VOLUME_REJECTED')
    env=dict(x.split('=',1) for x in d['Config']['Env'] if '=' in x)
    require(env.get('POSTGRES_DB')==DATABASE and env.get('POSTGRES_USER')=='ry_api_owner' and env.get('PGDATA')==PGDATA,'API_ROUTE_CHANGED')
    files={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ('db/migration','db/api-migration','db/api-runtime')
           for p in (ROOT/'backend/src/main/resources'/folder).glob('*.sql')}
    require(files==t['sql'],'API_SCHEMA_FILES_CHANGED')
    return t

def init(home,args):
    private_parent(home);require(not home.exists(),'NEW_API_HOME_REQUIRED')
    for kind,names in [('container',[PROJECT+'-'+s+'-1' for s in ('api-postgres','api-backend','api-scheduler')]),
                       ('network',[PROJECT+'-data',PROJECT+'-access']),('volume',[PROJECT+'-db'])]:
        for name in names:
            r=subprocess.run(['docker',kind,'inspect',name],capture_output=True)
            require(r.returncode!=0,'API_RESOURCE_COLLISION')
    for image in (DB_IMAGE,WORKER,FLYWAY):require(inspect('image',image)['Id']==image,'LOCAL_PINNED_IMAGES_REQUIRED')
    home.mkdir(mode=0o700);data=home/'data';data.mkdir(mode=0o700)
    for folder in ('seed','runs','boundaries','backups'): (data/folder).mkdir(mode=0o700)
    write(data/'transport.json',dict(allow_seoul_http=args.allow_seoul_http))
    owner=secrets.token_hex(12);passwords={name:secrets.token_urlsafe(32) for name in ('owner','writer','reader')}
    for name,password in passwords.items():write(home/(name+'-password'),password.encode())
    key=Path(args.key_file).absolute();require(key.is_file() and not key.is_symlink(),'API_KEY_FILE_REQUIRED')
    settings=dict(API_HOME=str(home),API_CODE_ROOT=str(ROOT),API_KEY_FILE=str(key),API_OWNER=owner,
                  API_DB_PASSWORD=passwords['owner'],API_UID=str(os.getuid()),API_GID=str(os.getgid()))
    require(all(re.fullmatch('[A-Za-z0-9_./:+-]+',v) for v in settings.values()),'UNSUPPORTED_ENV_PATH')
    write(home/'compose.env',('\n'.join(k+'='+v for k,v in settings.items())+'\n').encode())
    if args.seed_root:
        seed=Path(args.seed_root)
        require(seed.is_absolute() and not seed.is_symlink(),'PRIVATE_SEED_REQUIRED')
        names=[s+'-'+q for q in ('20251','20252','20253','20254','20261','20262') for s in ('seoul-stores','seoul-sales')]
        names+=['semas-stores-seoul-cafe-v2']
        expected=prepare_release([seed/name for name in names])['release_id']
        for name in [*names,'semas-stores-seoul-cafe']:
            source=seed/name
            require(not any(p.is_symlink() for p in [source,*source.rglob('*')]),'SEED_SYMLINK_REJECTED')
            shutil.copytree(source,data/'seed'/name)
        require(prepare_release([data/'seed'/name for name in names])['release_id']==expected,'SEED_COPY_CHANGED')
        paths=['/api-data/seed/'+name for name in names]
    else:
        from app.api_refresh import collect_refresh
        require(bool(args.quarter),'INITIAL_QUARTERS_REQUIRED')
        collect_refresh(data/'runs'/'initial',args.quarter,load_keys(key),allow_seoul_http=args.allow_seoul_http)
        paths=['/api-data/runs/initial/'+s+'-'+q for q in sorted(args.quarter) for s in ('seoul-stores','seoul-sales')]
        paths+=['/api-data/runs/initial/semas-stores']
    write(data/'seed-runs.json',paths)
    from team_public_data import verify_package
    archive=Path(args.boundary_archive) if args.boundary_archive else data/'public-baseline.zip'
    if not args.boundary_archive:
        from team_data import download
        release=json.loads((ROOT/'data/release.json').read_text());download(release['url'],archive,release['sha256']);archive.chmod(0o600)
    verify_package(archive,'6b11901f46d1a207c5b36353483e209f00a10fb401edcc5fd036a3025238ff0b')
    with zipfile.ZipFile(archive) as z:
        for name in ('admin.zip','commercial.zip','admin-report.json','commercial-report.json','repair-report.json'):
            write(data/'boundaries'/name,z.read(name))
    compose(home,'up','-d','--no-recreate','api-postgres')
    cid=compose(home,'ps','-q','api-postgres').decode().strip();d=inspect('container',cid)
    for _ in range(90):
        r=subprocess.run(['docker','exec',cid,'pg_isready','-q','-h','127.0.0.1','-U','ry_api_owner','-d',DATABASE],capture_output=True)
        if r.returncode==0:break
        time.sleep(1)
    else:raise RuntimeErrorCode('API_DB_START_TIMEOUT')
    sid=run(['docker','exec',cid,'psql','-X','-At','-U','ry_api_owner','-d',DATABASE,'-c','SELECT system_identifier::text FROM pg_control_system()']).decode().strip()
    n=inspect('network',PROJECT+'-data');v=inspect('volume',PROJECT+'-db')
    t=dict(owner=owner,dbname=DATABASE,host='api-postgres',port='5432',data=PGDATA,sid=sid,container_id=d['Id'],network_id=n['Id'],
        volume=PROJECT+'-db',volume_created=v['CreatedAt'],daemon=run(['docker','info','--format','{{.ID}}']).decode().strip(),
        sql={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for folder in ('db/migration','db/api-migration','db/api-runtime') for p in (ROOT/'backend/src/main/resources'/folder).glob('*.sql')})
    write(home/'target.json',t);proof(home)
    init_sql=flyway_init_sql(dict(db=DATABASE,user='ry_api_owner',sid=sid,data=PGDATA,port=5432))
    init_sql+="; SELECT 1 / ((session_user=current_user AND current_setting('transaction_read_only')='off')::int)"
    run(['docker','exec',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','ry_api_owner','-d',DATABASE,'-c',init_sql+"; ALTER DATABASE "+DATABASE+" SET recycleyoungs.api_owner='"+owner+"'"])
    result=json.loads(run(['docker','run','--rm','--pull=never','--network',PROJECT+'-data',
        '--mount',f'type=bind,src={ROOT}/backend/src/main/resources/db/migration,dst=/flyway/base,readonly',
        '--mount',f'type=bind,src={ROOT}/backend/src/main/resources/db/api-migration,dst=/flyway/api,readonly',
        '-e','FLYWAY_PASSWORD',FLYWAY,'-url=jdbc:postgresql://api-postgres:5432/'+DATABASE,'-user=ry_api_owner',
        '-locations=filesystem:/flyway/base,filesystem:/flyway/api','-schemas=public','-createSchemas=false','-baselineOnMigrate=false',
        '-cleanDisabled=true','-connectRetries=0','-initSql='+init_sql,'-outputType=json','migrate'],env={'FLYWAY_PASSWORD':passwords['owner']}))
    check_flyway_json(result,'migrate');require(result['migrationsExecuted']==4,'FOUR_NEW_MIGRATIONS_REQUIRED')
    print(compose(home,'run','--rm','--no-deps','api-bootstrap','bootstrap').decode().strip())
    return dict(status='INITIALIZED',home=str(home),db_host_port=False)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--home',type=Path,default=DEFAULT_HOME)
    sub=p.add_subparsers(dest='action',required=True)
    a=sub.add_parser('init');a.add_argument('--seed-root',type=Path);a.add_argument('--boundary-archive',type=Path)
    a.add_argument('--key-file',type=Path,default=ROOT/'etl/api.env');a.add_argument('--quarter',action='append')
    a.add_argument('--allow-seoul-http',action='store_true',help='서울 HTTP 사용을 명시적으로 허용; 키는 암호화되지 않은 URL로 전송됩니다')
    for name in ('up','status','refresh','reconcile','restart-check'):sub.add_parser(name)
    args=p.parse_args();home=args.home
    require(home.is_absolute() and not any(p.is_symlink() for p in [home,*home.parents]),'PRIVATE_HOME_REQUIRED')
    if args.action=='init':value=init(home,args)
    else:
        t=proof(home)
        if args.action=='up':
            require((ROOT/'backend/build/libs/backend-0.0.1-SNAPSHOT.jar').is_file(),'BUILD_BACKEND_JAR_FIRST')
            compose(home,'up','-d','--no-recreate','api-backend','api-scheduler');value=dict(status='STARTED',http='http://127.0.0.1:18090')
        elif args.action=='restart-check':
            # Only explicitly named, already verified resources in this newly approved API environment.
            compose(home,'restart','api-postgres');proof(home)
            for _ in range(60):
                r=subprocess.run(['docker','exec',t['container_id'],'pg_isready','-q','-h','127.0.0.1','-U','ry_api_owner','-d',DATABASE],capture_output=True)
                if r.returncode==0:break
                time.sleep(1)
            else:raise RuntimeErrorCode('RESTART_TIMEOUT')
            value=json.loads(compose(home,'run','--rm','--no-deps','api-scheduler','status'))
        else:value=json.loads(compose(home,'run','--rm','--no-deps','api-scheduler',args.action))
    print(json.dumps(value))

if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except Exception as e:
        print(json.dumps(dict(status='FAIL',code=str(e) if isinstance(e,RuntimeErrorCode) else 'API_CONTROL_FAILED',type=type(e).__name__)),file=sys.stderr);sys.exit(2)
