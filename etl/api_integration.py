"""Explicit controller for a NEW disposable API DB; never touches team Compose resources."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

from api_isolation import verify_docker
from control import flyway_init_sql, check_flyway_json
from demo_safety import DB_IMAGE, reject_environment
from app.api_config import private_parent
from app.api_artifacts import create_file, encoded

ROOT=Path(__file__).resolve().parents[1]
ETL_IMAGE='sha256:9d57711a7d8a613845eb4c78b57331a7f612087ab965c0b0a85d1569a5cec5c4'
JAVA_IMAGE='sha256:5be18367a9b3979a9f37234c371b80da457a448fb9577bd94d4bf24d923fafac'


def command(args,*,data=None,env=None,timeout=600):
    result=subprocess.run(args,input=data,capture_output=True,env={**os.environ,**(env or {})},timeout=timeout)
    if result.returncode:
        try:
            failure=json.loads(result.stderr.decode().splitlines()[-1])
            if failure.get('status')=='FAIL':
                print(json.dumps({key:failure.get(key) for key in ('status','phase','type','sqlstate','check')}),file=sys.stderr,flush=True)
        except (ValueError,IndexError,AttributeError): pass
        # Container logs can include SQL/source values. Never copy stderr into public output.
        raise RuntimeError('COMMAND_FAILED:'+args[0]+':'+str(result.returncode))
    return result.stdout


def inspect_target(target):
    container=json.loads(command(['docker','inspect',target['container_id']]))[0]
    network=json.loads(command(['docker','network','inspect',target['network_id']]))[0]
    verify_docker(target,container,network)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input-root',required=True,type=Path)
    p.add_argument('--work',required=True,type=Path)
    args=p.parse_args(argv)
    reject_environment(os.environ)
    work=private_parent(args.work)
    if work.exists(): raise ValueError('FRESH_WORK_REQUIRED')
    inputs=args.input_root.resolve()
    private_parent(inputs/'manifest-check')
    if inputs.is_symlink() or not inputs.is_dir(): raise ValueError('PRIVATE_INPUT_REQUIRED')
    for image in [DB_IMAGE,ETL_IMAGE,JAVA_IMAGE]:
        if json.loads(command(['docker','image','inspect',image]))[0]['Id']!=image:
            raise ValueError('PINNED_IMAGE_REQUIRED')
    work.mkdir(mode=0o700)
    owner=secrets.token_hex(12); password=secrets.token_urlsafe(32)
    target=dict(label=owner,host='ry-8c1-db-'+owner,network='ry-8c1-net-'+owner,
        dbname='recycleyoungs_integration_test_'+owner,user='integration_test',port='5432',
        data='/var/lib/postgresql/data/pgdata',db_image=DB_IMAGE)
    target['network_id']=command(['docker','network','create','--internal','--label','recycleyoungs.control='+owner,target['network']]).decode().strip()
    target['container_id']=command(['docker','run','-d','--pull=never','--name',target['host'],
        '--label','recycleyoungs.control='+owner,'--network',target['network'],'--network-alias',target['host'],
        '--tmpfs','/var/lib/postgresql/data:rw,size=2g','--tmpfs','/docker-entrypoint-initdb.d:rw',
        '-e','POSTGRES_DB='+target['dbname'],'-e','POSTGRES_USER=integration_test','-e','POSTGRES_PASSWORD',
        '-e','PGDATA='+target['data'],DB_IMAGE],env={'POSTGRES_PASSWORD':password}).decode().strip()
    with create_file(work/'created-resources.json') as f: f.write(encoded(target))
    # Readiness probes are bounded; failed migration/load/publication operations are never retried.
    for _ in range(60):
        # initdb's temporary server accepts Unix sockets before the final TCP server starts.
        r=subprocess.run(['docker','exec',target['container_id'],'pg_isready','-q','-h','127.0.0.1','-U',target['user'],'-d',target['dbname']],capture_output=True)
        if r.returncode==0: break
        time.sleep(1)
    else: raise RuntimeError('NEW_DB_READINESS_TIMEOUT')
    target['sid']=command(['docker','exec',target['container_id'],'psql','-X','-At','-U',target['user'],'-d',target['dbname'],
        '-c','SELECT system_identifier::text FROM pg_control_system()']).decode().strip()
    inspect_target(target)
    with create_file(work/'target.json') as f: f.write(encoded(target))
    print(json.dumps(dict(phase='NEW_ISOLATED_TARGET',status='PASS',owner=owner,host_ports=False,tmpfs=True)),flush=True)
    init=flyway_init_sql(dict(db=target['dbname'],user=target['user'],sid=target['sid'],data=target['data'],port=5432))
    init+="; SELECT 1 / ((session_user=current_user AND current_setting('transaction_read_only')='off')::int)"
    result=json.loads(command(['docker','run','--rm','--pull=never','--network',target['network'],
        '--mount',f'type=bind,src={ROOT}/backend/src/main/resources/db/migration,dst=/flyway/base,readonly',
        '--mount',f'type=bind,src={ROOT}/backend/src/main/resources/db/api-migration,dst=/flyway/api,readonly',
        '-e','FLYWAY_PASSWORD',JAVA_IMAGE,'-url=jdbc:postgresql://'+target['host']+':5432/'+target['dbname'],
        '-user='+target['user'],'-locations=filesystem:/flyway/base,filesystem:/flyway/api','-schemas=public',
        '-defaultSchema=public','-createSchemas=false','-baselineOnMigrate=false','-cleanDisabled=true',
        '-connectRetries=0','-group=false','-outOfOrder=false','-executeInTransaction=true','-mixed=false',
        '-initSql='+init,'-outputType=json','migrate'],env={'FLYWAY_PASSWORD':password}))
    check_flyway_json(result,'migrate')
    if result['migrationsExecuted']!=4: raise RuntimeError('FRESH_V1_V4_REQUIRED')
    with create_file(work/'migration.json') as f: f.write(encoded(result))
    print(json.dumps(dict(phase='V1_V4_MIGRATION',status='PASS',count=4)),flush=True)
    inspect_target(target)
    config=dict(target=target,password=password,writer_password=secrets.token_urlsafe(32),reader_password=secrets.token_urlsafe(32))
    # Secrets are passed over stdin; they are neither Docker CLI arguments nor output artifacts.
    mounts=[]
    for name in ['etl/app','etl/tests','etl/api_isolation.py','etl/control.py','etl/demo_safety.py',
                 'etl/team_public_data.py','etl/team_data.py','etl/demo_worker.py','data/manifest.json',
                 'data/public-data-v2.json','backend/src/main/resources/db/migration']:
        mounts+=['--mount',f'type=bind,src={ROOT}/{name},dst=/workspace/{name},readonly']
    output=command(['docker','run','--rm','--pull=never','-i','--network',target['network'],*mounts,
        '--mount',f'type=bind,src={inputs},dst=/inputs,readonly',
        '--mount',f'type=bind,src={work},dst=/out','--workdir','/workspace/etl',
        '--entrypoint','python',ETL_IMAGE,'tests/integration_api.py'],data=encoded(config))
    measured=json.loads(output)
    with create_file(work/'result.json') as f: f.write(encoded(measured))
    # Save the new isolated reader credential privately for the separately started service only.
    with create_file(work/'service.private.json') as f:
        f.write(encoded(dict(target=target,password=config['reader_password'])))
    inspect_target(target)
    print(json.dumps(measured),flush=True)
    print(json.dumps(dict(status='RETAINED',resources=target['host'],work=str(work),cleanup='NOT_REQUESTED')),flush=True)
    return 0


if __name__=='__main__':
    try: sys.exit(main())
    except Exception as error:
        print(json.dumps(dict(status='FAIL',type=type(error).__name__,code=str(error) if isinstance(error,ValueError) else 'ISOLATED_OPERATION_FAILED',automatic_retry=False)),file=sys.stderr)
        sys.exit(2)
