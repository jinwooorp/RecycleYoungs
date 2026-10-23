"""Full contract-2 test job, only on the controller-created isolated target."""
from copy import deepcopy
import psycopg
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from psycopg.types.json import Jsonb
from api_isolation import connect_target, verify_connection
from app.api_artifacts import encoded, create_file
from app.api_context_release import (read_release_bundle, stage_context_release,
    compare_staged_statistics, release_metadata, project_sections)
from app.api_records import CollectionError
from app.api_release import digest, stage_release, publish_release, verify_release
from integration_api import (CHECKS, check, roles, polygons, expect_rejected, fixture)


def baseline(release):
    entries={(r['source'],r['period']):r for r in release['runs']}
    runs=[entries[(r['source'],r['period'])] for r in release['baseline']['runs']]
    value={k:release[k] for k in ('text_policy','store_reference_month','store_scope')}
    value.update(contract_version=1,runs=runs,
        quarters=sorted({r['period'] for r in runs if r['source']=='seoul-stores'}),
        collected_at=max(r['collected_at'] for r in runs))
    value['release_id']=digest(value)
    check('baseline is the audited immutable seed',value['release_id']==release['baseline']['release_id'])
    verify_release(value)
    return value


def capture_legacy(conn,target):
    # No production data is present here: these are the new target's own fixtures.
    with conn.transaction():
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        verify_connection(conn,target,read_only=True)
        boundaries={}
        for table in ('admin_dong_boundaries','commercial_area_boundaries'):
            # Whole attributes and both EWKB forms, including their SRID, are
            # compared in a verified RO snapshot. Values never enter stdout.
            boundaries[table]=conn.execute('SELECT (to_jsonb(t)-\'source_geometry\'-\'operational_geometry\')::text,'
                'encode(ST_AsEWKB(source_geometry),\'hex\'),encode(ST_AsEWKB(operational_geometry),\'hex\') '
                'FROM '+table+' t ORDER BY id').fetchall()
        return dict(stores=conn.execute('SELECT to_jsonb(t)::text FROM stores t ORDER BY source_store_id').fetchall(),
            boundaries=boundaries,
            sequences=conn.execute("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename NOT LIKE 'api_%' ORDER BY sequencename").fetchall())


def grant_context(admin):
    with admin.transaction():
        admin.execute('GRANT SELECT ON api_context_runs,api_context_rows,api_release_context_sources,published_context_rows TO api_writer,api_reader')
        admin.execute('GRANT INSERT ON api_context_runs,api_context_rows,api_release_context_sources TO api_writer')
        # Row locking during seal needs this narrow privilege; mutation still
        # fails through the immutable run trigger, including for the DB owner.
        admin.execute('GRANT UPDATE(run_id) ON api_context_runs TO api_writer')


def coverage_guard_probe(admin,target,release):
    """Exercise the actual publication guard on rollback-only source fixtures.

    A temporary pointer calls only the new guard, so this focuses on its key
    comparison without duplicating a million café rows or altering publication.
    """
    original=release['context_sources']['workers']['run']
    for mode in ('period','dong'):
        with admin.transaction(force_rollback=True):
            verify_connection(admin,target)
            candidate_id=digest(dict(test='context-coverage-'+mode,parent=release['release_id']))
            metadata=release_metadata(release)|dict(release_id=candidate_id)
            admin.execute("INSERT INTO api_releases(release_id,metadata,status) VALUES(%s,%s,'PREPARING')",(candidate_id,Jsonb(metadata)))
            run_id=digest(dict(test=mode,run=original['run_id']))
            desc={k:v for k,v in original.items() if k!='records'}|dict(run_id=run_id)
            admin.execute('INSERT INTO api_context_runs(run_id,source_id,descriptor) VALUES(%s,%s,%s)',(run_id,'seoul-workers',Jsonb(desc)))
            first=next(iter(original['records']))
            condition='quarter_code<>%s' if mode=='period' else 'NOT (quarter_code=%s AND dong_code=%s)'
            params=(run_id,original['run_id'],first['quarter_code'])+(() if mode=='period' else (first['dong_code'],))
            admin.execute('INSERT INTO api_context_rows SELECT %s,quarter_code,dong_code,dong_name,metrics,attributes '
                'FROM api_context_rows WHERE run_id=%s AND '+condition,params)
            admin.execute("INSERT INTO api_release_context_sources SELECT %s,source_id,state,CASE WHEN source_id='seoul-workers' THEN %s ELSE run_id END,policy_version "
                'FROM api_release_context_sources WHERE release_id=%s',(candidate_id,run_id,release['release_id']))
            admin.execute('CREATE TEMP TABLE context_guard_probe(release_id TEXT) ON COMMIT DROP')
            admin.execute('CREATE TRIGGER context_coverage_probe BEFORE UPDATE ON context_guard_probe FOR EACH ROW EXECUTE FUNCTION guard_api_context_publication()')
            admin.execute('INSERT INTO context_guard_probe VALUES(%s)',(release['release_id'],))
            try:
                with admin.transaction():admin.execute('UPDATE context_guard_probe SET release_id=%s',(candidate_id,))
            except psycopg.errors.RaiseException as error:
                check('SQL publication guard rejects lost context '+mode,'Context coverage regression requires review' in str(error))
            else:raise AssertionError('context coverage regression accepted')
        with admin.transaction():
            admin.execute('SET TRANSACTION READ ONLY');verify_connection(admin,target,read_only=True)
            check('coverage probe retained publication '+mode,admin.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()==(release['release_id'],))


def main():
    config=json.load(sys.stdin); target=config['target']; phase=config['phase']
    # All input hashing and record/policy validation precede opening a connection.
    release=read_release_bundle('/context-input')
    check('full release ID matches host preflight',release['release_id']==config['release_id'])
    base=baseline(release)
    with connect_target(target,config['password']) as admin:
        if phase=='seed-v4' or config['scenario']=='fresh':
            roles(admin,config); polygons(admin)
        legacy=capture_legacy(admin,target)
        if phase=='seed-v4':
            with connect_target(target,config['writer_password'],actor='api_writer') as writer:
                identity=lambda c:verify_connection(c,target,actor='api_writer')
                check('V4 baseline staged',stage_release(writer,base,verify_identity=identity))
                check('V4 baseline published',publish_release(writer,base['release_id'],expected_current=None,verify_identity=identity))
                with writer.transaction(),writer.cursor() as cur:
                    verify_connection(writer,target,actor='api_writer'); compare_staged_statistics(cur,base)
            result=dict(status='PASS',phase=phase,release_id=base['release_id'],checks=CHECKS,
                rows=sum(len(r['records']) for r in base['runs']),current_bindings_preserved=True)
            print(json.dumps(result));return
        grant_context(admin)
        with connect_target(target,config['writer_password'],actor='api_writer') as writer:
            identity=lambda c:verify_connection(c,target,actor='api_writer')
            if config['scenario']=='fresh':
                check('V5 keeps contract1 writer',stage_release(writer,base,verify_identity=identity))
                check('baseline publish',publish_release(writer,base['release_id'],expected_current=None,verify_identity=identity))
            else:
                check('V4 pointer retained across additive upgrade',writer.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()==(base['release_id'],))
                check('V4 existing release still READY',writer.execute('SELECT status FROM api_releases WHERE release_id=%s',(base['release_id'],)).fetchone()==('READY',))
            check('complete contract2 stage with all typed fields',stage_context_release(writer,release,verify_identity=identity))
            check('same staged release is a no-op',not stage_context_release(writer,release,verify_identity=identity))
            check('stage did not publish',writer.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()==(base['release_id'],))
            try: publish_release(writer,release['release_id'],expected_current='a'*64,verify_identity=identity)
            except CollectionError as error: check('wrong CAS rejected',str(error)=='CURRENT_RELEASE_CHANGED')
            else: raise AssertionError('CAS was accepted')
            check('CAS failure retained old publication',writer.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()==(base['release_id'],))
            check('contract2 publish',publish_release(writer,release['release_id'],expected_current=base['release_id'],verify_identity=identity))
            check('READY rerun publication is inert',not publish_release(writer,release['release_id'],expected_current=base['release_id'],verify_identity=identity))
            expect_rejected(writer,'UPDATE api_current_release SET release_id=%s WHERE singleton',(base['release_id'],))
            check('contract1 downshift rejected',writer.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()==(release['release_id'],))
            run=release['context_sources']['population']['run']['run_id']
            expect_rejected(writer,'UPDATE api_context_rows SET dong_name=dong_name WHERE run_id=%s',(run,))
            expect_rejected(writer,'DELETE FROM api_context_rows WHERE run_id=%s',(run,))
            expect_rejected(writer,'TRUNCATE api_context_rows')
            expect_rejected(writer,'UPDATE api_context_runs SET run_id=run_id WHERE run_id=%s',(run,))
            check('sealed context rows and runs are immutable',True)
            expect_rejected(writer,"INSERT INTO api_context_rows SELECT run_id,'20263',dong_code,dong_name,metrics,attributes FROM api_context_rows WHERE run_id=%s LIMIT 1",(run,))
            check('append to sealed run rejected',True)
            check('withheld consumer has no stored rows',writer.execute("SELECT count(*) FROM api_context_runs WHERE source_id IN ('seoul-consumption','seoul-apartments')").fetchone()==(0,))
            check('all normal rows retained',writer.execute('SELECT (SELECT count(*) FROM api_store_stats_dong WHERE release_id=%s)+(SELECT count(*) FROM api_sales_dong WHERE release_id=%s)+(SELECT count(*) FROM api_stores WHERE release_id=%s)',(release['release_id'],)*3).fetchone()==(sum(len(r['records']) for r in release['runs']),))
            check('context row total',writer.execute('SELECT count(*) FROM published_context_rows').fetchone()==(sum(e['run']['row_count'] for e in release['context_sources'].values() if e['run']),))
            for q in ('20211','20212','20214','20221','20244','20251','20262'):
                check('quarter present '+q,q in release['quarters'])
            for case in release['quality_policy']['approval']['cases']:
                check('approved raw exclusion bound and absent',writer.execute('SELECT count(*) FROM api_sales_dong WHERE release_id=%s AND quarter_code=%s AND dong_code=%s AND source_industry_code=%s',
                    (release['release_id'],int(case['quarter_code']),case['dong_code'],case['source_industry_code'])).fetchone()==(0,))
            for mutate in [lambda r:r['context_sources'].pop('workers'),
                           lambda r:r['quality_policy'].update(quarantined_count=0)]:
                # Only metadata is copied; all million source records remain streamed.
                changed={**release,'context_sources':dict(release['context_sources']),
                    'quality_policy':dict(release['quality_policy'])};mutate(changed)
                try:stage_context_release(writer,changed,verify_identity=identity)
                except CollectionError:check('invalid preparation rejected before stage',True)
                else:raise AssertionError('invalid candidate staged')
            broken=fixture('partial-seal')
            metadata={k:v for k,v in broken.items() if k!='runs'}|dict(runs=[{k:v for k,v in r.items() if k!='records'}|dict(row_count=len(r['records'])) for r in broken['runs']])
            writer.execute("INSERT INTO api_releases(release_id,metadata,status) VALUES (%s,%s,'PREPARING')",
                (broken['release_id'],Jsonb(metadata)))
            expect_rejected(writer,"UPDATE api_releases SET status='READY' WHERE release_id=%s",(broken['release_id'],))
            check('incomplete release cannot seal',True)
        with connect_target(target,config['reader_password'],actor='api_reader',read_only=True) as reader:
            with reader.transaction():
                reader.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                verify_connection(reader,target,actor='api_reader',read_only=True)
                check('reader snapshot identity',reader.execute("SELECT current_setting('transaction_isolation'),current_setting('transaction_read_only')").fetchone()==('repeatable read','on'))
                check('reader context accessible',reader.execute('SELECT count(*) FROM published_context_rows').fetchone()[0]>0)
            expect_rejected(reader,'DELETE FROM api_context_rows')
            check('reader cannot write',True)
        coverage_guard_probe(admin,target,release)
        check('new isolated legacy fixtures geometry and sequences preserved',capture_legacy(admin,target)==legacy)
        with admin.transaction():
            admin.execute('SET TRANSACTION READ ONLY');verify_connection(admin,target,read_only=True)
            history=admin.execute('SELECT version,checksum,success FROM flyway_schema_history ORDER BY installed_rank').fetchall()
            check('all five migrations validated',len(history)==5 and all(r[2] for r in history))
    # A small public response fixture contains projected reference fields only.
    # It supports the independent HTTP audit without exposing private raw rows.
    sections=project_sections(release,'11110515','20262')
    with create_file(Path('/out/context-projection.private.json')) as target_file:
        target_file.write(encoded(dict(release_id=release['release_id'],sections=sections)))
    print(json.dumps(dict(status='PASS',phase=phase,checks=CHECKS,release_id=release['release_id'],
        quarters=release['quarters'],typed_rows=sum(len(r['records']) for r in release['runs']),
        context_rows=sum(e['run']['row_count'] for e in release['context_sources'].values() if e['run']),
        exact_exclusions=release['quality_policy']['quarantined_count'],current_dev_modified=False)),flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps(dict(status='FAIL',type=type(error).__name__,phase='CONTEXT_INTEGRATION',
            sqlstate=getattr(error,'sqlstate',None),check=str(error) if isinstance(error,(AssertionError,CollectionError)) else None)),file=sys.stderr)
        sys.exit(2)
