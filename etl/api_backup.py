"""Snapshot-bound backup and independent tmpfs restore of the owned API DB only."""
from datetime import datetime
import hashlib,json,os,re,secrets,subprocess,sys,time
from pathlib import Path
from api_dev import ROOT,WORKER,run,write,proof,inspect,compose_command
from api_images import home_manifest
from api_runtime import PROJECT,DATABASE,PGDATA,DB_IMAGE,UTC,require,private_read

def verify_restore(t):
    d=inspect('container',t['container_id']);n=inspect('network',t['network_id'])
    require(d['Id']==t['container_id'] and d['Image']==t.get('image',DB_IMAGE) and d['Config']['Labels'].get('org.recycleyoungs.api-restore')==t['nonce']
        and n['Labels'].get('org.recycleyoungs.api-restore')==t['nonce'] and n['Internal'] is True,'RESTORE_OWNERSHIP_REJECTED')
    require(not d['Mounts'] and not d['HostConfig'].get('PortBindings') and set(d['HostConfig']['Tmpfs'])=={'/var/lib/postgresql/data','/docker-entrypoint-initdb.d'}
        and set(d['NetworkSettings']['Networks'])=={t['network']} and n['Id']==t['network_id'],'RESTORE_ISOLATION_REJECTED')

def backup(home):
    source=proof(home);folder=home/'backups'
    images=home_manifest(home,expected=source.get('image_manifest'))
    worker_image=images['images']['worker'] if images else WORKER
    database_image=images['images']['database'] if images else DB_IMAGE
    folder.mkdir(mode=0o700,exist_ok=True)
    require(not folder.is_symlink() and folder.stat().st_uid==os.getuid() and not folder.stat().st_mode&0o077,'PRIVATE_BACKUP_PARENT_REQUIRED')
    out=folder/('backup-'+datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4));out.mkdir(mode=0o700)
    command,environment=compose_command(home)
    args=[*command,'run','--rm','--no-deps','-T',
          '--entrypoint','python','api-bootstrap','/workspace/etl/api_snapshot.py','hold']
    holder=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env={**os.environ,**environment})
    try:
        header=json.loads(holder.stdout.readline());snapshot=header.get('snapshot','')
        require(bool(re.fullmatch('[0-9A-F]+-[0-9A-F]+-[0-9]+',snapshot)),'EXPORTED_SNAPSHOT_REQUIRED')
        proof(home)
        fd=os.open(out/'database.dump',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as dest:
            r=subprocess.run(['docker','exec',source['container_id'],'pg_dump','-h','127.0.0.1','-p','5432','-U','ry_api_owner','-d',DATABASE,
                              '-Fc','--snapshot='+snapshot],stdout=dest,stderr=subprocess.PIPE,timeout=900)
        require(r.returncode==0,'SNAPSHOT_DUMP_FAILED')
        baseline=json.loads(holder.stdout.readline());write(out/'source-snapshot.json',baseline)
        holder.stdin.write('release\n');holder.stdin.flush();holder.stdin.close()
        require(holder.wait(timeout=30)==0,'SOURCE_SNAPSHOT_FAILED')
    finally:
        if holder.poll() is None:holder.terminate();holder.wait(timeout=30)
    # Bootstrap an independent restore without mounting or reusing a source volume.
    nonce=secrets.token_hex(12);password=secrets.token_urlsafe(32)
    target=dict(nonce=nonce,image=database_image,host='ry-api-restore-'+nonce,network='ry-api-restore-net-'+nonce,
                dbname='recycleyoungs_api_restore_'+nonce)
    target['network_id']=run(['docker','network','create','--internal','--label','org.recycleyoungs.api-restore='+nonce,target['network']]).decode().strip()
    target['container_id']=run(['docker','run','-d','--pull=never','--platform','linux/amd64','--name',target['host'],'--network',target['network'],'--network-alias',target['host'],
        '--label','org.recycleyoungs.api-restore='+nonce,'--tmpfs','/var/lib/postgresql/data:rw,size=2g','--tmpfs','/docker-entrypoint-initdb.d:rw',
        '-e','POSTGRES_USER=ry_api_owner','-e','POSTGRES_DB='+target['dbname'],'-e','PGDATA='+PGDATA,'-e','POSTGRES_PASSWORD',database_image],env={'POSTGRES_PASSWORD':password}).decode().strip()
    write(out/'created-restore.json',target)
    for _ in range(90):
        r=subprocess.run(['docker','exec',target['container_id'],'pg_isready','-q','-h','127.0.0.1','-U','ry_api_owner','-d',target['dbname']],capture_output=True)
        if r.returncode==0:break
        time.sleep(1)
    else:raise ValueError('RESTORE_START_TIMEOUT')
    verify_restore(target)
    target['sid']=run(['docker','exec',target['container_id'],'psql','-X','-At','-U','ry_api_owner','-d',target['dbname'],'-c','SELECT system_identifier::text FROM pg_control_system()']).decode().strip()
    # Recreate known role properties with fresh authentication, never extract password hashes.
    role_passwords={name:secrets.token_urlsafe(32) for name in ('api_writer','api_reader')}
    sql="SET lock_timeout='5s'; SET statement_timeout='10min'; SELECT 1 / ((current_database()='"+target['dbname']+"' AND current_user='ry_api_owner' AND session_user=current_user AND (SELECT system_identifier::text FROM pg_control_system())='"+target['sid']+"' AND current_setting('data_directory')='"+PGDATA+"')::int);"
    for actor,value in role_passwords.items():
        sql+="CREATE ROLE "+actor+" LOGIN PASSWORD '"+value+"' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; GRANT pg_read_all_settings TO "+actor+";"
    sql+="ALTER ROLE api_reader SET default_transaction_read_only=on; ALTER DATABASE "+target['dbname']+" SET recycleyoungs.api_owner='"+source['owner']+"';"
    run(['docker','exec','-i',target['container_id'],'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','ry_api_owner','-d',target['dbname']],data=sql.encode())
    verify_restore(target)
    with (out/'database.dump').open('rb') as source_dump:
        r=subprocess.run(['docker','exec','-i',target['container_id'],'pg_restore','--exit-on-error','-h','127.0.0.1','-U','ry_api_owner','-d',target['dbname']],stdin=source_dump,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=900)
    require(r.returncode==0,'RESTORE_FAILED')
    config=dict(target=target,password=password,reader_password=role_passwords['api_reader'])
    write(out/'restore.private.json',config)
    code_mounts=[] if images else [
        '--mount',f'type=bind,src={ROOT}/etl/api_runtime.py,dst=/workspace/etl/api_runtime.py,readonly',
        '--mount',f'type=bind,src={ROOT}/etl/api_snapshot.py,dst=/workspace/etl/api_snapshot.py,readonly',
        '--mount',f'type=bind,src={ROOT}/etl/app,dst=/workspace/etl/app,readonly']
    measured=json.loads(run(['docker','run','--rm','--pull=never','-i',*(['--platform','linux/amd64'] if images else []),'--network',target['network'],
        *code_mounts,'--workdir','/workspace/etl','--entrypoint','python',worker_image,'api_snapshot.py','restore'],data=json.dumps(config).encode()))
    write(out/'restore-snapshot.json',measured)
    require(measured==baseline,'RESTORE_FULL_COMPARISON_FAILED')
    verify_restore(target);proof(home)
    report=dict(status='PASS',snapshot_bound=True,full_rows_geometry_ids_history_catalog_acl_sequences=True,
        tables=len(measured['tables']),rows=sum(v['rows'] for v in measured['tables'].values()),
        dump_sha256=hashlib.sha256((out/'database.dump').read_bytes()).hexdigest(),backup=str(out),restore_retained=True)
    write(out/'result.json',report);return report

if __name__=='__main__':
    os.umask(0o077)
    try:print(json.dumps(backup(Path(sys.argv[1]))))
    except Exception as e:print(json.dumps(dict(status='FAIL',type=type(e).__name__,code=str(e) if isinstance(e,ValueError) else 'BACKUP_VERIFICATION_FAILED')),file=sys.stderr);sys.exit(2)
