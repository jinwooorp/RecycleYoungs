"""Explicit additive V5 -> V6 reference transition, never ordinary startup.

Plans bind an already approved target, preserved SQL, private backup/restore
proofs and exact reference input. A plan is evidence, not authorization. The
operator must supply actual Docker/same-connection prechecks for every step.
The completed V4/V5 transition's plan validator is deliberately not reused.
"""
import json
from pathlib import Path
import re
import time
import os
import psycopg
from api_runtime import (private_read,validate_target,verify_connection,require,RuntimeErrorCode,REFERENCE_PENDING)
from dev_transition import (Journal,PENDING,fingerprint,exclusive_json,replace_binding,runtime_fingerprint,flyway_checksum)
from app.reference_release import (SOURCES,prepare_catalog,catalog_version,stage_catalog,publish_catalog,current_snapshots)
from app.api_config import private_parent

V6='/api-migration/V6__current_reference_catalogs.sql'
V5='/api-migration/V5__api_context_and_quality_contract.sql'


def validate_plan(p, *, now=None):
    fields={'format','run_id','target','previous_binding','proposed_sql','expected_current','expected_references',
            'catalog_id','source_sha256','backup_sha256','restore_sha256','baseline_sha256','expires_at'}
    require(isinstance(p,dict) and set(p)==fields and p['format']=='EXPLICIT_V5_V6_REFERENCE_V1','REFERENCE_TRANSITION_PLAN_FORMAT')
    validate_target(p['target'])
    require(bool(re.fullmatch('[0-9a-f]{24}',p['run_id'])),'REFERENCE_TRANSITION_RUN_ID')
    old=p['previous_binding']
    require(set(old)=={'project','volumes','sql'} and old['project']==p['target']['project']
            and set(old['volumes'])=={'db','data','control','reader','writer'} and all(isinstance(v,str) and v for v in old['volumes'].values()),'REFERENCE_TRANSITION_BINDING_CHANGED')
    require(len(old['sql'])==6 and V5 in old['sql'] and V6 not in old['sql'] and set(p['proposed_sql'])==set(old['sql'])|{V6}
            and all(p['proposed_sql'][k]==v for k,v in old['sql'].items()),'REFERENCE_TRANSITION_SQL_CHANGED')
    require(all(isinstance(v,str) and re.fullmatch('[0-9a-f]{64}',v) for v in p['proposed_sql'].values()),'REFERENCE_TRANSITION_SQL_CHANGED')
    for key in ['expected_current','catalog_id','source_sha256','backup_sha256','restore_sha256','baseline_sha256']:
        require(isinstance(p[key],str) and re.fullmatch('[0-9a-f]{64}',p[key]),'REFERENCE_TRANSITION_PROOF_REQUIRED')
    require(isinstance(p['expected_references'],dict),'REFERENCE_TRANSITION_REFERENCE_STATE')
    if p['expected_references']:catalog_version(p['expected_references'])
    current=time.time() if now is None else now
    require(type(p['expires_at']) in (int,float) and 0<p['expires_at']-current<=1800,'REFERENCE_TRANSITION_EXPIRED')
    return p


def verify_flyway(value,p):
    require(value.get('operation')=='migrate' and value.get('flywayVersion')=='12.4.0' and not value.get('error')
            and value.get('success') is not False and value.get('migrationsExecuted')==1 and len(value.get('migrations',[]))==1,
            'REFERENCE_TRANSITION_MIGRATION_RECEIPT')
    migration=value['migrations'][0]
    require(migration.get('version')=='6' and Path(migration.get('filepath','')).name==Path(V6).name
            and V6 in p['proposed_sql'],'REFERENCE_TRANSITION_MIGRATION_RECEIPT')


def verify_history(conn,p,count):
    files={}
    for name in p['proposed_sql']:
        match=re.fullmatch(r'V([1-6])__.+\.sql',Path(name).name)
        if match:
            require(int(match[1]) not in files,'REFERENCE_TRANSITION_SQL_CHANGED');files[int(match[1])]=Path(name)
    require(set(files)==set(range(1,7)),'REFERENCE_TRANSITION_SQL_CHANGED')
    rows=conn.execute('SELECT installed_rank,version,script,checksum,success FROM flyway_schema_history ORDER BY installed_rank').fetchall()
    require(len(rows)==count and all(tuple(row)==(n,str(n),files[n].name,flyway_checksum(files[n]),True)
        for n,row in enumerate(rows,1)),'REFERENCE_TRANSITION_HISTORY_CHANGED')


def catalog(p):
    root=Path('/api-data/reference-runs')/('transition-'+p['run_id'])
    private_parent(root)
    value=prepare_catalog({source:root/source for source in SOURCES})
    require(value['catalog_id']==p['catalog_id'],'REFERENCE_TRANSITION_INPUT_CHANGED')
    return value


def marker(p):return dict(kind=p['format'],run_id=p['run_id'],plan_sha256=fingerprint(p))


def require_pending(p,control,writer):
    require(json.loads(private_read(REFERENCE_PENDING))==marker(p),'REFERENCE_TRANSITION_PENDING_CHANGED')
    for root in [control,writer]:
        require(json.loads(private_read(Path(root)/PENDING))==marker(p),'REFERENCE_TRANSITION_PENDING_CHANGED')
        require(json.loads(private_read(Path(root)/'target.json'))==p['target'],'REFERENCE_TRANSITION_TARGET_CHANGED')


def open_connection(p,control,writer,actor, *, readonly=False):
    """The only explicit writer exception: both exact persistent markers match."""
    validate_plan(p);require_pending(p,control,writer)
    require(actor in ['ry_api_owner','api_writer'],'REFERENCE_TRANSITION_ACTOR')
    require(not any(v and k.startswith(('PG','DB_','FLYWAY_','SPRING_DATASOURCE')) for k,v in os.environ.items()),'AMBIENT_DB_SETTINGS_REJECTED')
    name='owner' if actor=='ry_api_owner' else 'writer'
    password=private_read(Path(control)/(name+'-password')).strip()
    conn=psycopg.connect(host=p['target']['host'],port=5432,dbname=p['target']['dbname'],user=actor,password=password,
        autocommit=True,connect_timeout=5,options='-c lock_timeout=5s -c statement_timeout=600000 -c default_transaction_read_only='+('on' if readonly else 'off'))
    try:verify_connection(conn,p['target'],actor,readonly)
    except BaseException:conn.close();raise
    return conn


def begin(p,root,control,writer, *, verify_preconditions):
    from dev_transition import require_clear
    validate_plan(p)
    require(callable(verify_preconditions),'REFERENCE_TRANSITION_PRECHECK_REQUIRED')
    require(not REFERENCE_PENDING.exists() and not REFERENCE_PENDING.is_symlink(),'REFERENCE_TRANSITION_REQUIRES_REVIEW')
    for folder in [control,writer]:
        require_clear(folder)
        require(json.loads(private_read(Path(folder)/'binding.json'))==p['previous_binding'],'REFERENCE_TRANSITION_BINDING_CHANGED')
        require(json.loads(private_read(Path(folder)/'target.json'))==p['target'],'REFERENCE_TRANSITION_TARGET_CHANGED')
    require(verify_preconditions(p,'begin')==dict(status='PASS',plan_sha256=fingerprint(p)),'REFERENCE_TRANSITION_PRECHECK_FAILED')
    validate_plan(p)
    journal=Journal.create(Path(root),p)
    exclusive_json(REFERENCE_PENDING,marker(p))
    for folder in [control,writer]:
        validate_plan(p)
        exclusive_json(Path(folder)/PENDING,marker(p))
    return journal


def execute_step(p,journal,step,operation, *, verify_preconditions):
    validate_plan(p)
    require(journal.plan==fingerprint(p) and callable(verify_preconditions),'REFERENCE_TRANSITION_PRECHECK_REQUIRED')
    journal.intent(step)
    try:
        require(verify_preconditions(p,step)==dict(status='PASS',plan_sha256=fingerprint(p)),'REFERENCE_TRANSITION_PRECHECK_FAILED')
        validate_plan(p)
        result=operation()
        require(isinstance(result,dict) and result.get('status')=='PASS','REFERENCE_TRANSITION_PROOF_REQUIRED')
        validate_plan(p)
        require(verify_preconditions(p,step+'-after')==dict(status='PASS',plan_sha256=fingerprint(p)),'REFERENCE_TRANSITION_PRECHECK_FAILED')
        validate_plan(p)
        journal.done(step,result);return result
    except BaseException:
        journal.stop(step,'REFERENCE_TRANSITION_REQUIRES_REVIEW');raise


def commit_bindings(p,control,writer, *, verify_publication):
    validate_plan(p);require_pending(p,control,writer)
    proof=verify_publication()
    require(proof==dict(status='PASS',release_id=p['expected_current'],catalog_id=p['catalog_id']),'REFERENCE_TRANSITION_PUBLICATION_UNVERIFIED')
    validate_plan(p)
    proposed=p['previous_binding']|dict(sql=p['proposed_sql'])
    for root in [control,writer]:
        validate_plan(p)
        replace_binding(Path(root)/'binding.json',p['previous_binding'],proposed,p['run_id'])
    receipt=dict(status='PASS',kind=p['format'],plan_sha256=fingerprint(p),source_sha256=p['source_sha256'],
        previous_binding_sha256=fingerprint(p['previous_binding']),proposed_binding_sha256=fingerprint(proposed),proof=proof)
    validate_plan(p)
    exclusive_json(Path(control)/('reference-transition-'+p['run_id']+'.json'),receipt)
    return receipt


def finish(p,journal,control,writer, *, verify_preconditions):
    validate_plan(p);require_pending(p,control,writer)
    disk=Journal.open(journal.root,p)
    require(disk.records[-1]['status']=='DONE' and disk.records[-1]['step']=='binding','REFERENCE_TRANSITION_INCOMPLETE')
    require(verify_preconditions(p,'finish')==dict(status='PASS',plan_sha256=fingerprint(p)),'REFERENCE_TRANSITION_PRECHECK_FAILED')
    receipt=json.loads(private_read(Path(control)/('reference-transition-'+p['run_id']+'.json')))
    proposed=p['previous_binding']|dict(sql=p['proposed_sql'])
    expected=dict(status='PASS',kind=p['format'],plan_sha256=fingerprint(p),source_sha256=p['source_sha256'],
        previous_binding_sha256=fingerprint(p['previous_binding']),proposed_binding_sha256=fingerprint(proposed),
        proof=dict(status='PASS',release_id=p['expected_current'],catalog_id=p['catalog_id']))
    require(receipt==expected,'REFERENCE_TRANSITION_RECEIPT_CHANGED')
    for root in [control,writer]:require(json.loads(private_read(Path(root)/'binding.json'))==proposed,'REFERENCE_TRANSITION_BINDING_CHANGED')
    validate_plan(p)
    for root in [control,writer]:
        validate_plan(p)
        (Path(root)/PENDING).unlink();fd=os.open(root,os.O_RDONLY);os.fsync(fd);os.close(fd)
    # Both control routes stay blocked by this one shared data-volume marker
    # until every binding, receipt and individual marker has been checked.
    validate_plan(p)
    require(json.loads(private_read(REFERENCE_PENDING))==marker(p),'REFERENCE_TRANSITION_PENDING_CHANGED')
    REFERENCE_PENDING.unlink();fd=os.open(REFERENCE_PENDING.parent,os.O_RDONLY);os.fsync(fd);os.close(fd)
    return receipt
