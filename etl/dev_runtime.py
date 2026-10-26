"""One-command local API startup. Fixed namespaces; no legacy DB adoption."""
import argparse,hashlib,json,os,re,secrets,stat,sys,urllib.request
from datetime import datetime
from pathlib import Path
import psycopg
from psycopg import sql
from api_runtime import DATABASE,PGDATA,DB_IMAGE,UTC,RuntimeErrorCode,require,private_read

CONTROL=Path('/api-control'); DATA=Path('/api-data')
READER=Path('/reader-control'); WRITER=Path('/writer-control')
LABEL='local-development-v1'
UID=10001


def project_name(value):
    require(bool(re.fullmatch(r'recycleyoungs-dev(?:-check-[0-9a-f]{8})?',value)),'LOCAL_PROJECT_REJECTED')
    return value


def project():return project_name(os.environ.get('DEV_PROJECT','recycleyoungs-dev'))


def startup_state(root):
    if (root/'ready.json').is_file():return 'READY'
    require(not any((root/p).exists() for p in ('migration.started','init.started')),'INITIALIZATION_INTERRUPTED')
    return 'NEW'


def metadata(kind,name):
    with urllib.request.urlopen('http://inspect-proxy:8081/inspect/'+kind+'/'+name,timeout=10) as r:
        data=r.read(1000001)
    require(len(data)<=1000000,'METADATA_TOO_LARGE')
    return json.loads(data)


def schemas():
    folders=[Path('/workspace/backend/src/main/resources/db/migration'),Path('/api-migration'),Path('/api-schema')]
    return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for folder in folders for p in sorted(folder.glob('*.sql'))}


def read(path):
    if os.getuid()!=0:return private_read(path)
    require(not any(p.is_symlink() for p in [path,*path.parents]),'PRIVATE_SYMLINK_REJECTED')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd) as f:
        s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==UID and not s.st_mode&0o077,'PRIVATE_FILE_REQUIRED')
        value=f.read(100001)
    require(len(value)<=100000,'PRIVATE_FILE_TOO_LARGE');return value


def write(path,value):
    data=value if isinstance(value,bytes) else json.dumps(value,sort_keys=True).encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data)
    if os.getuid()==0:os.chown(path,UID,UID)


def volume_binding():
    p=project();result={}
    for role in ('db','control','data','reader','writer'):
        v=metadata('volume',p+'-'+role)
        require(v['Name']==p+'-'+role and v['Labels'].get('org.recycleyoungs.environment')==LABEL
            and v['Labels'].get('com.docker.compose.project')==p and not v.get('Options'),'LOCAL_VOLUME_REJECTED')
        result[role]=v['CreatedAt']
    return result


def validate_config(raw):
    from app.api_config import parse_keys
    require(len(raw)<=16384,'CONFIG_TOO_LARGE')
    keys=parse_keys(raw.decode('utf-8'))
    require(all(keys.values()),'API_KEYS_REQUIRED')


def preflight():
    require(os.getuid()==0,'PREFLIGHT_REQUIRES_ROOT')
    from dev_transition import require_clear
    require_clear(CONTROL);require_clear(WRITER)
    source=Path('/input/api.env')
    require(source.is_file() and not source.is_symlink() and not source.stat().st_mode&0o077,'API_ENV_0600_REQUIRED')
    raw=source.read_bytes();validate_config(raw)
    binding=volume_binding();state=startup_state(CONTROL)
    first=not (CONTROL/'binding.json').exists()
    if first:
        require(not any(CONTROL.iterdir()) and not any(Path('/db-check').iterdir())
                and not any(DATA.iterdir()),'EXISTING_DATA_WITHOUT_CONTROL_REJECTED')
        for folder in (CONTROL,DATA,DATA/'runs',DATA/'boundaries',READER,WRITER):
            folder.mkdir(mode=0o700,exist_ok=True);folder.chmod(0o700);os.chown(folder,UID,UID)
        write(CONTROL/'binding.json',dict(project=project(),volumes=binding,sql=schemas()))
        write(CONTROL/'owner',secrets.token_hex(12).encode())
        for name in ('owner','writer','reader'):write(CONTROL/(name+'-password'),secrets.token_urlsafe(32).encode())
        write(READER/'reader-password',read(CONTROL/'reader-password').encode())
        for name in ('reader','writer'):write(WRITER/(name+'-password'),read(CONTROL/(name+'-password')).encode())
        write(WRITER/'binding.json',read(CONTROL/'binding.json').encode())
    else:
        saved=json.loads(read(CONTROL/'binding.json'))
        require(saved==dict(project=project(),volumes=binding,sql=schemas()),'LOCAL_BINDING_CHANGED')
        for name in ('owner','writer','reader'):require(bool(read(CONTROL/(name+'-password'))),'PASSWORD_MISSING')
    if not (CONTROL/'api.env').exists():write(CONTROL/'api.env',raw)
    else:require(read(CONTROL/'api.env').encode()==raw,'API_KEY_CHANGED_MANUAL_UPDATE_REQUIRED')
    if not (WRITER/'api.env').exists():write(WRITER/'api.env',raw)
    print(json.dumps(dict(status='PREFLIGHT_OK',initial=state=='NEW')),flush=True)


def check_database(p,d,n,expected_image=DB_IMAGE):
    project_name(p)
    require(d['Id'] and re.fullmatch('[0-9a-f]{64}',d['Id']) and d['Name']=='/'+p+'-api-postgres-1'
        and d['Image']==expected_image and d['State']['Running'],'LOCAL_DB_IDENTITY_REJECTED')
    labels=d['Config']['Labels']
    require(labels.get('org.recycleyoungs.environment')==LABEL and labels.get('com.docker.compose.project')==p,'LOCAL_DB_OWNER_REJECTED')
    require(not d['HostConfig'].get('PortBindings') and set(d['NetworkSettings']['Networks'])=={p+'-data'}
        and 'api-postgres' in (d['NetworkSettings']['Networks'][p+'-data'].get('Aliases') or []),'LOCAL_DB_ROUTE_REJECTED')
    mounts=d['Mounts']
    require(len(mounts)==2 and any(m.get('Name')==p+'-db' and m['Type']=='volume' and m['Destination']=='/var/lib/postgresql/data' and m['RW'] for m in mounts)
        and any(m.get('Name')==p+'-control' and m['Type']=='volume' and m['Destination']=='/api-control' and not m['RW'] for m in mounts),'LOCAL_DB_MOUNTS_REJECTED')
    env=dict(v.split('=',1) for v in d['Config']['Env'])
    require(env.get('POSTGRES_DB')==DATABASE and env.get('POSTGRES_USER')=='ry_api_owner' and env.get('PGDATA')==PGDATA
        and env.get('POSTGRES_PASSWORD_FILE')=='/api-control/owner-password','LOCAL_DB_SETTINGS_REJECTED')
    require(n['Name']==p+'-data' and n['Internal'] is True and re.fullmatch('[0-9a-f]{64}',n['Id']),'LOCAL_NETWORK_REJECTED')
    return dict(container_id=d['Id'],network_id=n['Id'],volume=p+'-db')


def checked_context():
    from dev_transition import require_clear
    require_clear(CONTROL)
    p=project();binding=json.loads(private_read(CONTROL/'binding.json'))
    require(binding==dict(project=p,volumes=volume_binding(),sql=schemas()),'LOCAL_BINDING_CHANGED')
    image=metadata('image','postgis-pinned')
    require(image['RepoDigests']==['postgis/postgis@'+DB_IMAGE] and image['Os']=='linux' and image['Architecture']=='amd64','LOCAL_IMAGE_REJECTED')
    return check_database(p,metadata('container',p+'-api-postgres-1'),metadata('network',p+'-data'),image['Id'])


def identity():
    actual=checked_context();owner=private_read(CONTROL/'owner');ready=(CONTROL/'ready.json').exists()
    conn=psycopg.connect(host='api-postgres',port=5432,dbname=DATABASE,user='ry_api_owner',
        password=private_read(CONTROL/'owner-password'),autocommit=True,connect_timeout=5,
        options='-c lock_timeout=5s -c statement_timeout=600000 -c default_transaction_read_only='+('on' if ready else 'off'))
    with conn:
        row=conn.execute("""SELECT current_database(),current_user,session_user,(SELECT system_identifier::text FROM pg_control_system()),
            current_setting('data_directory'),current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout'),
            current_setting('transaction_read_only'),current_setting('recycleyoungs.api_owner',true)""").fetchone()
        require(row[:3]==(DATABASE,'ry_api_owner','ry_api_owner') and row[4:9]==(PGDATA,'5432','5s','10min','on' if ready else 'off')
            and row[3] not in ('7692329130053947430','7696461093743411240'),'LOCAL_CONNECTION_REJECTED')
        target=dict(runtime='local-dev',project=project(),owner=owner,dbname=DATABASE,host='api-postgres',port='5432',data=PGDATA,sid=row[3],**actual)
        path=CONTROL/'target.json'
        if path.exists():require(json.loads(private_read(path))==target and row[9]==owner,'LOCAL_TARGET_CHANGED')
        else:
            require(not ready and row[9] is None,'EXISTING_DATABASE_OWNER_REJECTED')
            conn.execute(sql.SQL('ALTER DATABASE {} SET recycleyoungs.api_owner={}').format(sql.Identifier(DATABASE),sql.Literal(owner)))
            write(path,target)
            write(READER/'target.json',target);write(WRITER/'target.json',target)
    if not (CONTROL/'flyway.conf').exists():
        from control import flyway_init_sql
        guard=flyway_init_sql(dict(db=DATABASE,user='ry_api_owner',sid=target['sid'],data=PGDATA,port=5432))
        guard+="; SELECT 1 / ((session_user=current_user AND current_setting('recycleyoungs.api_owner')='"+owner+"')::int)"
        conf=dict(url='jdbc:postgresql://api-postgres:5432/'+DATABASE,user='ry_api_owner',password=private_read(CONTROL/'owner-password'),
            locations='filesystem:/flyway/base,filesystem:/flyway/api',schemas='public',createSchemas='false',baselineOnMigrate='false',cleanDisabled='true',connectRetries='0',initSql=guard)
        write(CONTROL/'flyway.conf',('\n'.join('flyway.'+k+'='+v for k,v in conf.items())+'\n').encode())
    return dict(status='IDENTITY_OK',reused=ready)


def initial_periods(now,available,*,start_year=2021):
    # Fresh environments use the same historical scope as the validated contract2 path.
    end=now.year*4+(now.month-1)//3-1;start=start_year*4
    require(0<=end-start<40,'INITIAL_PERIOD_RANGE_REJECTED')
    periods=[];gap=False
    for number in range(start,end+1):
        q=str(number//4)+str(number%4+1)
        present=[available(source,q) for source in ('stores','sales')]
        require(all(present) or not any(present),'INITIAL_SOURCE_PAIR_MISMATCH')
        if all(present):
            require(not gap,'INITIAL_SOURCE_PERIOD_GAP')
            periods.append(q)
        else:gap=True
    require(bool(periods),'INITIAL_SOURCE_UNAVAILABLE');return periods


def initialize():
    checked_context()
    import api_worker
    if (CONTROL/'ready.json').exists():return api_worker.status()|dict(initialized=False)
    require(not (CONTROL/'init.started').exists(),'INITIALIZATION_INTERRUPTED')
    from control import check_flyway_json
    migration=json.loads(private_read(CONTROL/'migration-result.json'));check_flyway_json(migration,'migrate')
    from api_runtime import verify_fresh_migration
    write(CONTROL/'initialization-migration.json',verify_fresh_migration(migration,schemas()))
    write(CONTROL/'init.started',b'')
    from app.api_config import load_keys
    from app.api_http import HttpClient
    from app import seoul_api
    from app.api_initial_release import collect_initial_release
    keys=load_keys(CONTROL/'api.env');client=HttpClient()
    allow=os.environ.get('DEV_ALLOW_SEOUL_HTTP','true')=='true'
    def available(source,q):
        return bool(next(seoul_api.pages(client,source,q,keys['SEOUL_OPENAPI_KEY'],page_size=1,probe=True,allow_http=allow)).records)
    periods=initial_periods(datetime.now(UTC),available)
    release=collect_initial_release(DATA/'runs/initial',periods,keys,client=client,allow_seoul_http=allow)
    write(DATA/'transport.json',dict(allow_seoul_http=allow))
    paths=api_worker.context_artifact(DATA/'runs/initial/bundle')
    write(DATA/'seed-runs.json',paths)
    from boundary_data import prepare_boundaries
    prepare_boundaries(DATA/'boundaries')
    api_worker.bootstrap()
    value=api_worker.status();write(CONTROL/'ready.json',dict(release_id=release['release_id'],quarters=periods))
    return value|dict(initialized=True,quarters=periods)


def main():
    action=argparse.ArgumentParser(description=__doc__);action.add_argument('action',choices=['preflight','identity','initialize','status','refresh','reconcile','schedule']);a=action.parse_args()
    if a.action=='preflight':preflight();return
    if a.action=='identity':value=identity()
    elif a.action=='initialize':value=initialize()
    else:
        checked_context();import api_worker
        value={'status':api_worker.status,'refresh':lambda:api_worker.refresh(force=True),'reconcile':api_worker.reconcile,'schedule':api_worker.schedule}[a.action]()
    if value is not None:print(json.dumps(value),flush=True)


if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except Exception as e:
        code=str(e) if isinstance(e,RuntimeErrorCode) else 'LOCAL_STARTUP_FAILED'
        print(json.dumps(dict(status='FAILED',code=code,type=type(e).__name__)),file=sys.stderr);sys.exit(2)
