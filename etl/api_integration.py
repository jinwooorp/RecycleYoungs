"""Explicit controller for a NEW disposable API DB; never touches team Compose resources."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
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


def context_resource_budget(memory, counts, context_rows, disk_free):
    """Conservative full-data budget, including the retained V4 baseline and WAL.

    No sampling, tmpfs enlargement, Docker settings or existing resource changes.
    COPY/reconciliation retain at most one run in Python at a time.
    """
    if (type(memory) is not int or memory < 6*1024**3
            or set(counts) != {'seoul-stores','seoul-sales','semas-stores'}
            or any(type(v) is not int or v<=0 for v in counts.values())
            or type(context_rows) is not int or not 0<context_rows<=100000):
        raise ValueError('CONTEXT_RESOURCE_BUDGET_REJECTED')
    typed = counts['seoul-stores']*240+counts['seoul-sales']*720+counts['semas-stores']*1800+context_rows*2400
    # Includes B-tree/GiST overhead in the per-row bounds, retained baseline,
    # bounded checkpoint WAL and schema/geometry slack.
    peak = typed + 300*1024**2 + 384*1024**2
    if peak > int(1.8*1024**3) or disk_free < 4*1024**3:
        raise ValueError('CONTEXT_RESOURCE_BUDGET_REJECTED')
    return dict(database_peak_bytes=peak,tmpfs_bytes=2*1024**3,
                worker_peak_budget_bytes=1024**3,docker_memory_bytes=memory)


def validate_context_migration(value, scenario):
    check_flyway_json(value,'migrate')
    expected = ['1','2','3','4','5'] if scenario=='fresh' else ['5'] if scenario=='upgrade' else None
    if expected is None or value.get('migrationsExecuted')!=len(expected) or [m.get('version') for m in value.get('migrations',[])]!=expected:
        raise ValueError('CONTEXT_MIGRATION_TRANSITION_REJECTED')


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
    p.add_argument('--context-bundle',type=Path)
    p.add_argument('--scenario',choices=('fresh','upgrade'))
    args=p.parse_args(argv)
    reject_environment(os.environ)
    if bool(args.context_bundle) != bool(args.scenario): raise ValueError('EXPLICIT_CONTEXT_SCENARIO_REQUIRED')
    work=private_parent(args.work)
    if work.exists(): raise ValueError('FRESH_WORK_REQUIRED')
    inputs=args.input_root.resolve()
    private_parent(inputs/'manifest-check')
    if inputs.is_symlink() or not inputs.is_dir(): raise ValueError('PRIVATE_INPUT_REQUIRED')
    # Boundary preparation runs separately on the host. The isolated DB job has
    # an internal network and never downloads a retired Release or an original.
    from boundary_data import boundary_specs
    from app.spatial_geometry import prepare_dataset
    for kind,spec in boundary_specs().items():
        folder=inputs/'boundaries'
        prepare_dataset(spec,folder/(kind+'.zip'),{role:folder/name for role,name in spec.report_artifacts.items()})
    for image in [DB_IMAGE,ETL_IMAGE,JAVA_IMAGE]:
        if json.loads(command(['docker','image','inspect',image]))[0]['Id']!=image:
            raise ValueError('PINNED_IMAGE_REQUIRED')
    budget = None
    if args.context_bundle:
        from app.api_context_release import read_release_bundle
        release = read_release_bundle(args.context_bundle)
        counts = {s:sum(len(r['records']) for r in release['runs'] if r['source']==s)
                  for s in ('seoul-stores','seoul-sales','semas-stores')}
        memory = int(command(['docker','info','--format','{{json .MemTotal}}']))
        budget = context_resource_budget(memory,counts,
            sum(e['run']['row_count'] for e in release['context_sources'].values() if e['run']),shutil.disk_usage(work.parent).free)
        # Bind source code, original SQL and the exact audited full release before
        # creating resources. No current dev target/binding/READY is inspected.
        from api_images import source_fingerprint
        budget.update(source_sha256=source_fingerprint(),release_id=release['release_id'],scenario=args.scenario,
            sql={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
                 for folder in ('migration','api-migration')
                 for p in sorted((ROOT/'backend/src/main/resources/db'/folder).glob('*.sql'))})
        del release
    work.mkdir(mode=0o700)
    if budget:
        with create_file(work/'preflight.json') as f: f.write(encoded(budget))
        print(json.dumps(dict(phase='CONTEXT_RESOURCE_PREFLIGHT',status='PASS',**budget)),flush=True)
    owner=secrets.token_hex(12); password=secrets.token_urlsafe(32)
    target=dict(label=owner,host='ry-8c1-db-'+owner,network='ry-8c1-net-'+owner,
        dbname='recycleyoungs_integration_test_'+owner,user='integration_test',port='5432',
        data='/var/lib/postgresql/data/pgdata',db_image=DB_IMAGE)
    target['network_id']=command(['docker','network','create','--internal','--label','recycleyoungs.control='+owner,target['network']]).decode().strip()
    target['container_id']=command(['docker','run','-d','--pull=never','--name',target['host'],
        '--label','recycleyoungs.control='+owner,'--network',target['network'],'--network-alias',target['host'],
        '--tmpfs','/var/lib/postgresql/data:rw,size=2g','--tmpfs','/docker-entrypoint-initdb.d:rw',
        '-e','POSTGRES_DB='+target['dbname'],'-e','POSTGRES_USER=integration_test','-e','POSTGRES_PASSWORD',
        '-e','PGDATA='+target['data'],DB_IMAGE,
        *(['-c','max_wal_size=256MB','-c','min_wal_size=80MB','-c','checkpoint_timeout=30s'] if budget else [])],env={'POSTGRES_PASSWORD':password}).decode().strip()
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
        '-initSql='+init,'-target='+('5' if args.scenario=='fresh' else '4'),'-outputType=json','migrate'],env={'FLYWAY_PASSWORD':password}))
    check_flyway_json(result,'migrate')
    if args.scenario=='fresh': validate_context_migration(result,'fresh')
    elif result['migrationsExecuted']!=4: raise RuntimeError('FRESH_V1_V4_REQUIRED')
    with create_file(work/'migration.json') as f: f.write(encoded(result))
    print(json.dumps(dict(phase='INITIAL_MIGRATION',status='PASS',count=result['migrationsExecuted'])),flush=True)
    inspect_target(target)
    config=dict(target=target,password=password,writer_password=secrets.token_urlsafe(32),reader_password=secrets.token_urlsafe(32))
    if budget:
        config.update(scenario=args.scenario,release_id=budget['release_id'])
    # Secrets are passed over stdin; they are neither Docker CLI arguments nor output artifacts.
    mounts=[]
    for name in ['etl/app','etl/tests','etl/api_isolation.py','etl/control.py','etl/demo_safety.py',
                 'etl/boundary_data.py','etl/demo_worker.py','data/manifest.json',
                 'data/boundaries/public-reports.json','backend/src/main/resources/db/migration']:
        mounts+=['--mount',f'type=bind,src={ROOT}/{name},dst=/workspace/{name},readonly']
    if budget:
        mounts+=['--mount',f'type=bind,src={args.context_bundle.resolve()},dst=/context-input,readonly']
        def context_job(phase):
            inspect_target(target)
            return json.loads(command(['docker','run','--rm','--pull=never','-i','--network',target['network'],*mounts,
                '--mount',f'type=bind,src={inputs},dst=/inputs,readonly',
                '--mount',f'type=bind,src={work},dst=/out','--workdir','/workspace/etl',
                '--entrypoint','python',ETL_IMAGE,'tests/integration_context.py'],
                data=encoded(config|dict(phase=phase)),timeout=1800))
        if args.scenario=='upgrade':
            seed = context_job('seed-v4')
            with create_file(work/'v4-seed.json') as f: f.write(encoded(seed))
            inspect_target(target)
            transition=json.loads(command(['docker','run','--rm','--pull=never','--network',target['network'],
                '--mount',f'type=bind,src={ROOT}/backend/src/main/resources/db/migration,dst=/flyway/base,readonly',
                '--mount',f'type=bind,src={ROOT}/backend/src/main/resources/db/api-migration,dst=/flyway/api,readonly',
                '-e','FLYWAY_PASSWORD',JAVA_IMAGE,'-url=jdbc:postgresql://'+target['host']+':5432/'+target['dbname'],
                '-user='+target['user'],'-locations=filesystem:/flyway/base,filesystem:/flyway/api','-schemas=public',
                '-defaultSchema=public','-createSchemas=false','-baselineOnMigrate=false','-cleanDisabled=true',
                '-connectRetries=0','-group=false','-outOfOrder=false','-executeInTransaction=true','-mixed=false',
                '-initSql='+init,'-target=5','-outputType=json','migrate'],env={'FLYWAY_PASSWORD':password}))
            validate_context_migration(transition,'upgrade')
            with create_file(work/'v4-to-v5-transition.json') as f:
                f.write(encoded(dict(target=target,source_sha256=budget['source_sha256'],sql=budget['sql'],
                    previous=seed,migration=transition,old_bindings_overwritten=False)))
        measured=context_job('full')
        with create_file(work/'result.json') as f: f.write(encoded(measured))
        with create_file(work/'service.private.json') as f:
            f.write(encoded(dict(target=target,password=config['reader_password'])))
        inspect_target(target)
        print(json.dumps(measured),flush=True)
        return 0
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
