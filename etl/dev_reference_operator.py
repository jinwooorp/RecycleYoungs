"""Container-side operator for a separately approved, exact V5/V6 target.

There is no discovery/default target or automatic retry. The host controller
must check Docker identities and run the pinned Flyway image between the two
explicit migration actions. Ordinary startup and scheduled refresh never call
this module. Credentials and operational evidence remain in private volumes.
"""
import json,os,sys,time
from pathlib import Path
import api_runtime as runtime
import dev_runtime as dev
import dev_reference_transition as transition
from dev_transition import Journal,PENDING,fingerprint,exclusive_json,runtime_fingerprint
from api_snapshot import snapshot,CATALOG,row_digest,normalize_constraint
from control import flyway_init_sql
from app.reference_release import (current_snapshots,stage_catalog,publish_catalog,grant_writer,verify_registered_snapshots,catalog_version)

CONTROL=Path('/api-control');WRITER=Path('/writer-control')
NEW_TABLES={'api_reference_snapshots','api_reference_records','api_reference_current'}
NEW_INDEXES={'api_reference_snapshots_pkey','api_reference_snapshots_snapshot_id_source_id_key','api_reference_records_pkey','api_reference_current_pkey'}
NEW_FUNCTIONS={'guard_api_reference_snapshots()','guard_api_reference_records()','guard_api_reference_current()'}


def root_for(run):
    import re
    runtime.require(isinstance(run,str) and re.fullmatch('[0-9a-f]{24}',run),'REFERENCE_TRANSITION_RUN_ID')
    return CONTROL/'reference-transitions'/run


def baseline(p):
    from app.api_history_quality import private_json
    value=private_json(root_for(p['run_id'])/'baseline.json')
    runtime.require(fingerprint(value)==p['baseline_sha256'],'REFERENCE_TRANSITION_BASELINE_CHANGED')
    return value


def new_catalog_row(kind,row):
    if kind=='functions':return row[1].removeprefix('public.') in NEW_FUNCTIONS
    if kind=='types':return row[1] in NEW_TABLES|{'_'+n for n in NEW_TABLES}
    if kind=='effective_acl':return row[2] in NEW_TABLES
    if kind=='columns':return row[1] in NEW_TABLES|NEW_INDEXES
    if kind in ['relations','constraints','indexes','triggers','policies','views']:return row[1] in NEW_TABLES
    return False


def old_history_rows(conn):
    return [row[0] for row in conn.execute('SELECT to_jsonb(h)::text FROM flyway_schema_history h WHERE installed_rank<=5 ORDER BY installed_rank').fetchall()]


def verify_old_history(expected,rows):
    runtime.require(row_digest(rows)==expected,'REFERENCE_TRANSITION_LEGACY_HISTORY_CHANGED')


def flyway_configuration(properties):
    # Flyway's legacy config reader preserves backslash-space in initSql; SQL
    # spaces must stay literal. All values are fixed target strings or a safe
    # generated password, never shell syntax or multiline configuration.
    import re
    runtime.require(all(re.fullmatch(r'flyway\.[A-Za-z]+',key) and isinstance(value,str)
        and not any(c in value for c in ['\n','\r','\\','\x00']) for key,value in properties.items()),
        'REFERENCE_TRANSITION_CONFIGURATION_REJECTED')
    return '\n'.join(key+'='+value for key,value in properties.items())+'\n'


def preserved(conn,p,count):
    old=baseline(p);actual=snapshot(conn)
    verify_old_history(old['history_rows'],old_history_rows(conn))
    old_tables=old['tables']
    runtime.require(all(actual['tables'].get(k)==v for k,v in old_tables.items() if k!='public.flyway_schema_history'),
                    'REFERENCE_TRANSITION_LEGACY_ROWS_CHANGED')
    expected=set(old_tables)|({'public.'+t for t in NEW_TABLES} if count==6 else set())
    runtime.require(set(actual['tables'])==expected and actual['sequence_state']==old['sequence_state'],
                    'REFERENCE_TRANSITION_LEGACY_LAYOUT_CHANGED')
    for kind,query in CATALOG.items():
        rows=[row for row in conn.execute(query).fetchall() if not new_catalog_row(kind,row)]
        if kind=='constraints':rows=[(*r[:3],normalize_constraint(r[3])) for r in rows]
        measured=row_digest(json.dumps(row,default=str,separators=(',',':')) for row in rows)
        runtime.require(measured==old['catalog'][kind],'REFERENCE_TRANSITION_LEGACY_CATALOG_CHANGED')
    return actual


def external_identity(p):
    runtime.require(dev.project()==p['target']['project'],'REFERENCE_TRANSITION_PROJECT_CHANGED')
    image=dev.metadata('image','postgis-pinned')
    actual=dev.check_database(dev.project(),dev.metadata('container',dev.project()+'-api-postgres-1'),
        dev.metadata('network',dev.project()+'-data'),image['Id'])
    runtime.require(all(p['target'][k]==v for k,v in actual.items()),'REFERENCE_TRANSITION_TARGET_CHANGED')
    runtime.require(dev.volume_binding()==p['previous_binding']['volumes'] and dev.schemas()==p['proposed_sql']
        and runtime_fingerprint()==p['source_sha256'],'REFERENCE_TRANSITION_SOURCE_CHANGED')
    for folder in [CONTROL,WRITER]:
        runtime.require(json.loads(runtime.private_read(folder/'target.json'))==p['target'],'REFERENCE_TRANSITION_TARGET_CHANGED')


def precheck(p,phase):
    transition.validate_plan(p);external_identity(p)
    count=5 if phase in ['begin','migration'] else 6
    changed_binding=phase in ['binding-after','finish']
    expected_binding=p['previous_binding']|dict(sql=p['proposed_sql']) if changed_binding else p['previous_binding']
    for folder in [CONTROL,WRITER]:
        runtime.require(json.loads(runtime.private_read(folder/'binding.json'))==expected_binding,'REFERENCE_TRANSITION_BINDING_CHANGED')
    if phase!='begin':transition.require_pending(p,CONTROL,WRITER)
    catalog=transition.catalog(p)
    wanted={s:v['manifest']['snapshot_id'] for s,v in catalog['sources'].items()}
    expected_refs=wanted if phase in ['publish-after','binding','binding-after','finish'] else p['expected_references']
    with runtime.connect(CONTROL,'ry_api_owner',True)[0] as conn:
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            runtime.verify_connection(conn,p['target'],'ry_api_owner',True)
            runtime.require(conn.execute('SELECT pg_try_advisory_lock(20261021,51)').fetchone()==(True,),'REFERENCE_TRANSITION_WRITER_BUSY')
            runtime.require(conn.execute("SELECT count(*) FROM pg_stat_activity WHERE usename IN ('ry_api_owner','api_writer') AND backend_type='client backend' AND pid<>pg_backend_pid()").fetchone()==(0,),'REFERENCE_TRANSITION_WRITER_ACTIVE')
            runtime.require(conn.execute('SELECT count(*) FROM pg_prepared_xacts').fetchone()==(0,)
                and conn.execute('SELECT count(*) FROM pg_subscription').fetchone()==(0,),'REFERENCE_TRANSITION_EXTERNAL_WRITER')
            state=conn.execute('SELECT status,release_id FROM api_runtime.state CROSS JOIN api_current_release WHERE api_runtime.state.singleton AND api_current_release.singleton').fetchone()
            runtime.require(state[0] in ['IDLE','SUCCEEDED'] and state[1]==p['expected_current'],'REFERENCE_TRANSITION_PUBLICATION_CHANGED')
            transition.verify_history(conn,p,count)
            exists=conn.execute("SELECT to_regclass('public.api_reference_current') IS NOT NULL").fetchone()==(True,)
            runtime.require(exists==(count==6),'REFERENCE_TRANSITION_SCHEMA_CHANGED')
            actual_refs=current_snapshots(conn) if exists else {}
            runtime.require(actual_refs==expected_refs,'REFERENCE_TRANSITION_PUBLICATION_CHANGED')
            preserved(conn,p,count)
            if phase in ['stage-after','publish','publish-after','binding','binding-after','finish']:
                checked=verify_registered_snapshots(conn,verify_identity=lambda c:runtime.verify_connection(c,p['target'],'ry_api_owner',True))
                runtime.require(set(wanted.values())<=set(checked),'REFERENCE_TRANSITION_INPUT_UNREGISTERED')
    return dict(status='PASS',plan_sha256=fingerprint(p))


def prepare(c):
    run=c['run_id'];root=root_for(run)
    runtime.require(json.loads(runtime.private_read(CONTROL/'target.json'))==c['expected_target'],'REFERENCE_TRANSITION_TARGET_CHANGED')
    previous=json.loads(runtime.private_read(CONTROL/'binding.json'))
    with runtime.connect(CONTROL,'ry_api_owner',True)[0] as conn:
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            old=snapshot(conn)
            old['history_rows']=row_digest(old_history_rows(conn))
            current=conn.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()[0]
    proposed=dev.schemas()
    temporary=dict(run_id=run)
    value=transition.catalog(temporary|dict(catalog_id=c['catalog_id']))
    p=dict(format='EXPLICIT_V5_V6_REFERENCE_V1',run_id=run,target=c['expected_target'],previous_binding=previous,
        proposed_sql=proposed,expected_current=current,expected_references={},catalog_id=value['catalog_id'],
        source_sha256=runtime_fingerprint(),backup_sha256=c['backup_sha256'],restore_sha256=c['restore_sha256'],
        baseline_sha256=fingerprint(old),expires_at=time.time()+1800)
    transition.validate_plan(p)
    runtime.require(not any(path.is_symlink() for path in [root,*root.parents]),'REFERENCE_TRANSITION_PRIVATE_PATH')
    root.parent.mkdir(mode=0o700,exist_ok=True)
    parent=root.parent.stat()
    runtime.require(parent.st_uid==os.getuid() and not parent.st_mode&0o077,'REFERENCE_TRANSITION_PRIVATE_PATH')
    root.mkdir(mode=0o700)
    exclusive_json(root/'baseline.json',old);exclusive_json(root/'plan.json',p)
    precheck(p,'begin')
    password=runtime.private_read(CONTROL/'owner-password').strip()
    import re
    runtime.require(re.fullmatch('[A-Za-z0-9_-]{16,128}',password),'REFERENCE_TRANSITION_CREDENTIAL_FORMAT')
    init=flyway_init_sql(dict(db=p['target']['dbname'],user='ry_api_owner',sid=p['target']['sid'],data=p['target']['data'],port=5432))
    init+="; SELECT 1 / ((session_user=current_user AND current_setting('transaction_read_only')='off' AND current_setting('recycleyoungs.api_owner',true)='"+p['target']['owner']+"')::int)"
    properties={'flyway.url':'jdbc:postgresql://api-postgres:5432/'+p['target']['dbname'],'flyway.user':'ry_api_owner',
        'flyway.password':password,'flyway.locations':'filesystem:/flyway/base,filesystem:/flyway/api','flyway.schemas':'public',
        'flyway.defaultSchema':'public','flyway.createSchemas':'false','flyway.baselineOnMigrate':'false','flyway.cleanDisabled':'true',
        'flyway.connectRetries':'0','flyway.group':'false','flyway.outOfOrder':'false','flyway.executeInTransaction':'true',
        'flyway.mixed':'false','flyway.target':'6','flyway.initSql':init}
    content=flyway_configuration(properties)
    dev.write(root/'flyway.conf',content.encode())
    return dict(status='PREPARED_UNPUBLISHED',plan=p)


def publication(p):
    with runtime.connect(CONTROL,'ry_api_owner',True)[0] as conn:
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            runtime.verify_connection(conn,p['target'],'ry_api_owner',True)
            runtime.require(conn.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()==(p['expected_current'],),
                'REFERENCE_TRANSITION_PUBLICATION_CHANGED')
            runtime.require(catalog_version(current_snapshots(conn))==p['catalog_id'],'REFERENCE_TRANSITION_PUBLICATION_CHANGED')
    return dict(status='PASS',release_id=p['expected_current'],catalog_id=p['catalog_id'])


def run(c):
    action=c['action']
    if action=='prepare':return prepare(c)
    p=json.loads(runtime.private_read(root_for(c['run_id'])/'plan.json'));transition.validate_plan(p)
    root=root_for(p['run_id']);journal_root=root/'journal'
    if action=='begin':
        transition.begin(p,journal_root,CONTROL,WRITER,verify_preconditions=precheck)
        return dict(status='PASS',plan_sha256=fingerprint(p))
    journal=Journal.open(journal_root,p)
    if action=='migration-start':
        journal.intent('migration')
        try:precheck(p,'migration');transition.validate_plan(p)
        except BaseException:journal.stop('migration','REFERENCE_TRANSITION_REQUIRES_REVIEW');raise
        return dict(status='PASS',plan_sha256=fingerprint(p))
    if action=='migration-result':
        runtime.require(journal.records[-1]['status']=='INTENT' and journal.records[-1]['step']=='migration','REFERENCE_TRANSITION_INTERRUPTED')
        try:
            transition.verify_flyway(c['receipt'],p);precheck(p,'migration-after');transition.validate_plan(p)
            exclusive_json(root/'migration.json',c['receipt']);journal.done('migration',dict(status='PASS',version=6))
        except BaseException:journal.stop('migration','REFERENCE_TRANSITION_REQUIRES_REVIEW');raise
        return dict(status='PASS',version=6)
    if action=='finish':return transition.finish(p,journal,CONTROL,WRITER,verify_preconditions=precheck)
    def operation():
        if action=='binding':return transition.commit_bindings(p,CONTROL,WRITER,verify_publication=lambda:publication(p))
        actor='ry_api_owner' if action=='grants' else 'api_writer'
        with transition.open_connection(p,CONTROL,WRITER,actor) as conn:
            verified=lambda x:runtime.verify_connection(x,p['target'],actor)
            if action=='grants':
                with conn.transaction():
                    verified(conn);conn.execute('GRANT SELECT ON api_reference_snapshots,api_reference_records,api_reference_current TO api_reader,api_writer');grant_writer(conn)
                return dict(status='PASS',kind='V6_NARROW_GRANTS')
            value=transition.catalog(p)
            if action=='stage':stage_catalog(conn,value,verify_identity=verified)
            elif action=='publish':publish_catalog(conn,value,expected=p['expected_references'],verify_identity=verified)
            else:raise ValueError('REFERENCE_TRANSITION_ACTION_REJECTED')
            return dict(status='PASS',catalog_id=p['catalog_id'])
    runtime.require(action in ['grants','stage','publish','binding'],'REFERENCE_TRANSITION_ACTION_REJECTED')
    return transition.execute_step(p,journal,action,operation,verify_preconditions=precheck)


if __name__=='__main__':
    try:print(json.dumps(run(json.load(sys.stdin))))
    except Exception as error:
        code=str(error) if isinstance(error,(runtime.RuntimeErrorCode,)) else 'REFERENCE_TRANSITION_OPERATION_FAILED'
        print(json.dumps(dict(status='STOP',code=code,type=type(error).__name__,automatic_retry=False)));sys.exit(2)
