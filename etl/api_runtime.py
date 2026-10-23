"""Owned persistent API runtime. Separate from team-dev and disposable integration adapters."""
from datetime import datetime,timedelta,timezone
import json,os,re,stat
import signal
from contextlib import contextmanager
from pathlib import Path
import psycopg
from app.api_records import quarter

PROJECT='recycleyoungs-api-dev'
DATABASE='recycleyoungs_api_dev'
PGDATA='/var/lib/postgresql/data/api'
DB_IMAGE='sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5'
UTC=timezone.utc
KST=timezone(timedelta(hours=9))

class RuntimeErrorCode(ValueError):pass

def require(ok,code):
    if not ok:raise RuntimeErrorCode(code)

def verify_fresh_migration(result,sql_hashes):
    """Fresh-target proof only; never replaces an existing binding."""
    from control import check_flyway_json
    check_flyway_json(result,'migrate')
    files={}
    for name,sha in sql_hashes.items():
        match=re.fullmatch(r'V([1-9][0-9]*)__.+\.sql',Path(name).name)
        if match:
            version=int(match[1])
            require(version not in files and re.fullmatch('[0-9a-f]{64}',sha),'MIGRATION_SOURCE_BINDING_REJECTED')
            files[version]=Path(name).name
    require(len(files) in (4,5) and sorted(files)==list(range(1,len(files)+1)),'MIGRATION_SOURCE_BINDING_REJECTED')
    migrated=result.get('migrations',[])
    require(result.get('migrationsExecuted')==len(files) and len(migrated)==len(files)
        and [m.get('version') for m in migrated]==[str(v) for v in sorted(files)]
        and all(Path(m.get('filepath','')).name==files[v] for v,m in zip(sorted(files),migrated)),
        'FRESH_MIGRATION_RECEIPT_REJECTED')
    return dict(kind='FRESH_INITIALIZATION',versions=sorted(files),sql_sha256=sql_hashes)

def private_read(path):
    path=Path(path)
    require(not any(p.is_symlink() for p in [path,*path.parents]),'PRIVATE_SYMLINK_REJECTED')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd) as source:
        info=os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode&0o077,'PRIVATE_FILE_REQUIRED')
        result=source.read(100001)
    require(len(result)<=100000,'PRIVATE_FILE_TOO_LARGE')
    return result

def validate_target(t):
    local=t.get('runtime')=='local-dev'
    valid_local=local and bool(re.fullmatch(r'recycleyoungs-dev(?:-check-[0-9a-f]{8})?',t.get('project','')))
    volume=t.get('project','')+'-db' if local else PROJECT+'-db'
    require(bool(re.fullmatch('[0-9a-f]{24}',t.get('owner',''))) and t.get('dbname')==DATABASE
        and t.get('host')=='api-postgres' and t.get('port')=='5432' and t.get('data')==PGDATA
        and (valid_local if local else t.get('runtime') is None) and t.get('volume')==volume and bool(re.fullmatch('[0-9]+',t.get('sid','')))
        and t.get('sid') not in ('7692329130053947430','7696461093743411240')
        and all(re.fullmatch('[0-9a-f]{64}',t.get(k,'')) for k in ('container_id','network_id')),'API_TARGET_REJECTED')

def verify_connection(conn,t,actor,readonly=False):
    validate_target(t)
    with conn.cursor() as cur:
        cur.execute("""SELECT current_database(),current_user,session_user,
          (SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),
          current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout'),
          current_setting('transaction_read_only'),current_setting('recycleyoungs.api_owner',true)""")
        value=cur.fetchone()
    require(value==(DATABASE,actor,actor,t['sid'],PGDATA,'5432','5s','10min','on' if readonly else 'off',t['owner']),
            'API_CONNECTION_IDENTITY_REJECTED')

def connect(control,actor='api_reader',readonly=True):
    require(actor in ('ry_api_owner','api_writer','api_reader') and (actor!='api_reader' or readonly),'API_ACTOR_REJECTED')
    require(not any(v and (k.startswith(('PG','DB_','FLYWAY_','SPRING_DATASOURCE'))) for k,v in os.environ.items()),'AMBIENT_DB_SETTINGS_REJECTED')
    control=Path(control);t=json.loads(private_read(control/'target.json'));validate_target(t)
    name={'ry_api_owner':'owner','api_writer':'writer','api_reader':'reader'}[actor]
    password=private_read(control/(name+'-password')).strip()
    conn=psycopg.connect(host=t['host'],port=5432,dbname=DATABASE,user=actor,password=password,
        autocommit=True,connect_timeout=5,options='-c lock_timeout=5s -c statement_timeout=600000 -c default_transaction_read_only='+('on' if readonly else 'off'))
    try:verify_connection(conn,t,actor,readonly)
    except BaseException:conn.close();raise RuntimeErrorCode('API_CONNECTION_IDENTITY_REJECTED') from None
    return conn,t

def next_due(now):
    require(now.tzinfo is not None,'AWARE_TIME_REQUIRED')
    local=now.astimezone(KST)
    due=local.replace(hour=4,minute=30,second=0,microsecond=0)+timedelta(days=(0-local.weekday())%7)
    if due<=local:due+=timedelta(days=7)
    return due.astimezone(UTC)

def probe_quarters(last,now):
    quarter(last);local=now.astimezone(KST)
    first=int(last[:4])*4+int(last[-1])-1
    completed=local.year*4+(local.month-1)//3-1
    require(completed-first<=4,'PERIOD_GAP_TOO_LARGE')
    return [str(i//4)+str(i%4+1) for i in range(first+1,completed+1)]

def require_automatic_ready(status):
    require(status in ('IDLE','SUCCEEDED'),'JOB_REQUIRES_RECONCILIATION')

@contextmanager
def job_deadline(seconds):
    require(signal.getitimer(signal.ITIMER_REAL)==(0.0,0.0),'EXISTING_JOB_TIMER_REJECTED')
    previous=signal.getsignal(signal.SIGALRM)
    def expired(signum,frame):raise RuntimeErrorCode('JOB_DEADLINE_EXCEEDED')
    signal.signal(signal.SIGALRM,expired);signal.setitimer(signal.ITIMER_REAL,seconds)
    try:yield
    finally:
        signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,previous)
