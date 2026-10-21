"""Persistent API worker: explicit bootstrap, refresh, reconciliation and scheduled execution."""
import argparse,hashlib,json,os,secrets,sys,time
from datetime import datetime
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from api_runtime import (UTC,RuntimeErrorCode,connect,private_read,verify_connection,require,
                         next_due,probe_quarters,require_automatic_ready,job_deadline)
from app.api_config import load_keys
from app.api_release import prepare_release,stage_release,publish_release,load_run
from app.api_refresh import collect_refresh,refresh_release
from app.api_http import HttpClient
from app import seoul_api

CONTROL=Path('/api-control');DATA=Path('/api-data')

def read_state(conn,t,actor='api_writer'):
    with conn.transaction():
        conn.execute('SET TRANSACTION READ ONLY')
        verify_connection(conn,t,actor,True)
        row=conn.execute("SELECT s.status,s.next_due,s.candidate_release,s.last_error,c.release_id,r.metadata,a.runs FROM api_runtime.state s CROSS JOIN api_current_release c LEFT JOIN api_releases r ON r.release_id=c.release_id LEFT JOIN api_runtime.artifacts a ON a.release_id=c.release_id WHERE s.singleton AND c.singleton").fetchone()
    require(row is not None,'API_NOT_READY')
    return row

def locked(conn):
    require(conn.execute('SELECT pg_try_advisory_lock(20261021,51)').fetchone()==(True,),'JOB_ALREADY_RUNNING')

def register(conn,t,release,paths):
    # Bind immutable paths to the exact validated release before exposing its pointer.
    require(prepare_release(paths)['release_id']==release['release_id'],'ARTIFACT_RELEASE_MISMATCH')
    with conn.transaction():
        verify_connection(conn,t,'api_writer')
        conn.execute('INSERT INTO api_runtime.artifacts(release_id,runs) VALUES (%s,%s) ON CONFLICT DO NOTHING',
                     (release['release_id'],Jsonb([str(p) for p in paths])))
        require(conn.execute('SELECT runs FROM api_runtime.artifacts WHERE release_id=%s',(release['release_id'],)).fetchone()==([str(p) for p in paths],),'ARTIFACT_REGISTRY_CONFLICT')

def artifact_paths(paths):
    require(isinstance(paths,list) and 3<=len(paths)<=81,'ARTIFACT_REGISTRY_INVALID')
    result=[]
    for item in paths:
        p=Path(item)
        require(p.is_absolute() and '..' not in p.parts and p.is_relative_to(DATA) and not any(x.is_symlink() for x in [p,*p.parents]),'ARTIFACT_PATH_REJECTED')
        result.append(p)
    return result

def bootstrap():
    with connect(CONTROL,'ry_api_owner',False)[0] as conn:
        target=json.loads(private_read(CONTROL/'target.json'))
        with conn.transaction():
            verify_connection(conn,target,'ry_api_owner')
            conn.execute(Path('/api-schema/schema.sql').read_text())
            for actor,secret in [('api_writer','writer-password'),('api_reader','reader-password')]:
                conn.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION').format(sql.Identifier(actor),sql.Literal(private_read(CONTROL/secret).strip())))
                conn.execute(sql.SQL('GRANT pg_read_all_settings TO {}').format(sql.Identifier(actor)))
                conn.execute(sql.SQL('GRANT EXECUTE ON FUNCTION pg_control_system() TO {}').format(sql.Identifier(actor)))
                conn.execute(sql.SQL('GRANT USAGE ON SCHEMA public,api_runtime TO {}').format(sql.Identifier(actor)))
                conn.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public,api_runtime TO {}').format(sql.Identifier(actor)))
            conn.execute('ALTER ROLE api_reader SET default_transaction_read_only=on')
            conn.execute('GRANT INSERT ON api_releases,api_store_stats_dong,api_sales_dong,api_stores,api_runtime.artifacts TO api_writer')
            conn.execute('GRANT UPDATE(status) ON api_releases TO api_writer')
            conn.execute('GRANT UPDATE(release_id) ON api_current_release TO api_writer')
            conn.execute('GRANT UPDATE ON api_runtime.state TO api_writer')
            conn.execute('GRANT USAGE,SELECT ON SEQUENCE api_store_stats_dong_id_seq,api_sales_dong_id_seq,api_stores_id_seq TO api_writer')
            conn.execute('INSERT INTO api_runtime.state(singleton,status,next_due) VALUES(true,\'IDLE\',%s)',(next_due(datetime.now(UTC)),))
        from team_public_data import public_specs
        from app.spatial_geometry import prepare_dataset
        from app.spatial_load import publish
        for kind,spec in public_specs().items():
            folder=DATA/'boundaries'
            prepared=prepare_dataset(spec,folder/(kind+'.zip'),{role:folder/name for role,name in spec.report_artifacts.items()})
            verify_connection(conn,target,'ry_api_owner');publish(conn,prepared)
    paths=artifact_paths(json.loads(private_read(DATA/'seed-runs.json')))
    release=prepare_release(paths)
    with connect(CONTROL,'api_writer',False)[0] as writer:
        stage_release(writer,release,verify_identity=lambda c:verify_connection(c,target,'api_writer'))
        register(writer,target,release,paths)
        publish_release(writer,release['release_id'],expected_current=None,verify_identity=lambda c:verify_connection(c,target,'api_writer'))
    return dict(status='READY',release_id=release['release_id'],rows=sum(len(r['records']) for r in release['runs']))

def choose_periods(metadata,client,keys,now,allow_http):
    latest=metadata['quarters'][-1];periods=[latest]
    for candidate in probe_quarters(latest,now):
        availability=[]
        for source in ('stores','sales'):
            page=next(seoul_api.pages(client,source,candidate,keys['SEOUL_OPENAPI_KEY'],page_size=1,probe=True,allow_http=allow_http))
            availability.append(bool(page.records))
        if not all(availability):break  # Never jump a gap or turn an upstream error into absence.
        periods.append(candidate)
    return periods

def update_state(conn,t,status,*,candidate=None,error=None,due=None):
    with conn.transaction():
        verify_connection(conn,t,'api_writer')
        conn.execute('UPDATE api_runtime.state SET status=%s,candidate_release=%s,last_error=%s,next_due=COALESCE(%s,next_due),updated_at=now() WHERE singleton',
                     (status,candidate,error,due))

@job_deadline(45*60)
def refresh(*,force=False):
    conn,t=connect(CONTROL,'api_writer',False)
    with conn:
        locked(conn);state=read_state(conn,t)
        require_automatic_ready(state[0])
        now=datetime.now(UTC)
        if not force and now<state[1]:return dict(status='NOT_DUE',next_due=state[1].isoformat())
        require(state[4] is not None and state[6] is not None,'CURRENT_ARTIFACTS_MISSING')
        previous=artifact_paths(state[6]);require(prepare_release(previous)['release_id']==state[4],'CURRENT_ARTIFACTS_CHANGED')
        update_state(conn,t,'RUNNING')
        try:
            keys=load_keys(CONTROL/'api.env');client=HttpClient()
            transport=json.loads(private_read(DATA/'transport.json'))
            require(type(transport.get('allow_seoul_http')) is bool,'TRANSPORT_POLICY_REQUIRED')
            allow_http=transport['allow_seoul_http']
            periods=choose_periods(state[5],client,keys,now,allow_http)
            output=DATA/'runs'/('run-'+now.strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4))
            release=collect_refresh(output,periods,keys,previous_runs=previous,client=client,allow_seoul_http=allow_http)
            retained=[p for p in previous if (r:=load_run(p))['source']!='semas-stores' and r['period'] not in periods]
            paths=[*retained,*[output/(s+'-'+q) for q in periods for s in ('seoul-stores','seoul-sales')],output/'semas-stores']
            stage_release(conn,release,verify_identity=lambda c:verify_connection(c,t,'api_writer'))
            register(conn,t,release,paths)
            update_state(conn,t,'RUNNING',candidate=release['release_id'])
            result=refresh_release(conn,release,expected_current=state[4],verify_identity=lambda c:verify_connection(c,t,'api_writer'))
            update_state(conn,t,'SUCCEEDED',candidate=release['release_id'],due=next_due(datetime.now(UTC)))
            return result|dict(status='SUCCEEDED',quarters=release['quarters'])
        except BaseException as error:
            code=str(error) if isinstance(error,(RuntimeErrorCode,)) else 'REFRESH_FAILED'
            # If marking failed is itself uncertain, RUNNING survives and prevents auto retry.
            update_state(conn,t,'FAILED',error=code)
            raise RuntimeErrorCode(code) from None

def reconcile():
    conn,t=connect(CONTROL,'api_writer',False)
    with conn:
        locked(conn);state=read_state(conn,t)
        paths=artifact_paths(state[6]);require(prepare_release(paths)['release_id']==state[4],'CURRENT_ARTIFACTS_CHANGED')
        update_state(conn,t,'SUCCEEDED' if state[2]==state[4] else 'IDLE',candidate=state[4],due=next_due(datetime.now(UTC)))
        return dict(status='RECONCILED',release_id=state[4])

def status():
    conn,t=connect(CONTROL,'api_reader',True)
    with conn:
        state=read_state(conn,t,'api_reader')
        return dict(status=state[0],next_due=state[1].isoformat(),release_id=state[4],last_error=state[3],readonly=True)

def schedule():
    previous=None
    while True:
        try:
            value=status();signature=(value['status'],value['release_id'],value['next_due'])
            if signature!=previous:print(json.dumps(value),flush=True);previous=signature
            if value['status'] in ('IDLE','SUCCEEDED') and datetime.now(UTC)>=datetime.fromisoformat(value['next_due']):
                print(json.dumps(refresh()),flush=True)
        except Exception:
            if previous!='ERROR':print(json.dumps(dict(status='SCHEDULER_BLOCKED',automatic_retry=False)),flush=True)
            previous='ERROR'
        time.sleep(30)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['bootstrap','status','refresh','reconcile','schedule']);a=p.parse_args()
    result={'bootstrap':bootstrap,'status':status,'refresh':lambda:refresh(force=True),'reconcile':reconcile,'schedule':schedule}[a.action]()
    if result is not None:print(json.dumps(result),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps(dict(status='FAIL',code=str(e) if isinstance(e,RuntimeErrorCode) else 'API_OPERATION_FAILED',type=type(e).__name__)),file=sys.stderr);sys.exit(2)
