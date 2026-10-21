"""Opt-in actual API release checks; invoked only by the new-resource controller."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg import sql
from api_isolation import connect_target, verify_connection
from app.api_artifacts import encoded
from app.api_records import normalize_store_stats, normalize_sales, normalize_store, CollectionError
from app.api_release import prepare_release, stage_release, publish_release, digest, TABLES
from app.api_refresh import refresh_release
from api_fixtures import stats, sales, store

CHECKS=[]


def check(name,condition):
    if not condition: raise AssertionError(name)
    CHECKS.append(name)


def fixture(label,periods=('20251',),month='202606'):
    runs=[]
    for period in periods:
        for source,record in [('seoul-stores',normalize_store_stats(stats(STDR_YYQU_CD=period,STOR_CO='0',SIMILR_INDUTY_STOR_CO=None),period)),
                              ('seoul-sales',normalize_sales(sales(STDR_YYQU_CD=period,THSMON_SELNG_AMT='9007199254740993'),period))]:
            records=[record]
            runs.append(dict(source=source,period=period,scope=dict(quarter=period,region='SEOUL',industry='ALL_SOURCE_INDUSTRIES'),
                normalizer_version=2,normalized_sha256=hashlib.sha256(encoded(record)).hexdigest(),
                pages=[dict(file='pages/000001.json',sha256=hashlib.sha256(b'{}').hexdigest(),received_count=1)],
                collected_at='2026-10-21T00:00:00+00:00',records=records))
    record=normalize_store(store(bizesNm=label,stdrYm=month),'I21201')
    runs.append(dict(source='semas-stores',period=month,scope=dict(region='11',industry='I21201'),
        normalizer_version=2,normalized_sha256=hashlib.sha256(encoded(record)).hexdigest(),
        pages=[dict(file='pages/000001.json',sha256=hashlib.sha256(b'{}').hexdigest(),received_count=1)],
        collected_at='2026-10-21T00:00:00+00:00',records=[record]))
    value=dict(contract_version=1,text_policy='SOURCE_TEXT_OUTER_STRIP_ONLY',quarters=list(periods),
        store_reference_month=month,store_scope='I21201',collected_at='2026-10-21T00:00:00+00:00',runs=runs)
    return value|dict(release_id=digest(value))


def roles(conn,config):
    with conn.transaction(),conn.cursor() as cur:
        for actor,key in [('api_writer','writer_password'),('api_reader','reader_password')]:
            cur.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION').format(
                sql.Identifier(actor),sql.Literal(config[key])))
            cur.execute(sql.SQL('GRANT pg_read_all_settings TO {}').format(sql.Identifier(actor)))
            cur.execute(sql.SQL('GRANT EXECUTE ON FUNCTION pg_control_system() TO {}').format(sql.Identifier(actor)))
            cur.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(config['target']['dbname']),sql.Identifier(actor)))
            cur.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(actor)))
            cur.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(actor)))
        cur.execute('ALTER ROLE api_reader SET default_transaction_read_only=on')
        cur.execute('GRANT INSERT ON api_releases,api_store_stats_dong,api_sales_dong,api_stores TO api_writer')
        cur.execute('GRANT UPDATE(status) ON api_releases TO api_writer')
        cur.execute('GRANT UPDATE(release_id) ON api_current_release TO api_writer')
        cur.execute('GRANT USAGE,SELECT ON SEQUENCE api_store_stats_dong_id_seq,api_sales_dong_id_seq,api_stores_id_seq TO api_writer')
        cur.execute("INSERT INTO stores(source_store_id,name,sigungu_code,source_small_category_code) VALUES ('legacy-seoul-cafe','fixture','11110','I21201'),('legacy-seoul-other','fixture','11110','I20101'),('legacy-other-region','fixture','26110','I21201')")


def expect_rejected(conn,statement,params=None):
    try:
        with conn.transaction(): conn.execute(statement,params)
    except psycopg.Error: return
    raise AssertionError('expected DB rejection')


def compare_rows(conn,release):
    verified=0
    for run in release['runs']:
        fields=[k for k in run['records'][0] if k not in ('industry_code','source_reference_month','location')]
        table=TABLES[run['source']]
        expressions=','.join(fields)+(',ST_X(location),ST_Y(location)' if run['source']=='semas-stores' else '')
        params=[release['release_id']]
        where='release_id=%s'
        if run['source']!='semas-stores': where+=' AND quarter_code=%s'; params.append(int(run['period']))
        with conn.cursor() as cur:
            cur.execute('SELECT '+expressions+' FROM '+table+' WHERE '+where,params)
            columns=[d.type_code for d in cur.description]
            actual=cur.fetchall()
        def key(row):
            return row[fields.index('source_store_id')] if run['source']=='semas-stores' else (str(row[fields.index('quarter_code')]),row[fields.index('dong_code')],row[fields.index('source_industry_code')])
        expected=[]
        for record in run['records']:
            values=[]
            for field,oid in zip(fields,columns):
                value=record[field]
                values.append(None if value is None else int(value) if oid in (20,21,23) else Decimal(value) if oid==1700 else float(value) if oid==701 else value)
            if run['source']=='semas-stores':
                values.extend([float(record['longitude']) if record['location'] else None,float(record['latitude']) if record['location'] else None])
            expected.append(tuple(values))
        check('typed values and geometry '+run['source']+' '+run['period'],sorted(actual,key=key)==sorted(expected,key=key))
        verified+=len(actual)
    return verified


def polygons(conn):
    from team_public_data import verify_package,public_specs
    from app.spatial_geometry import prepare_dataset
    from app.spatial_load import publish
    path=Path('/inputs/baseline/public-baseline.zip')
    verify_package(path,'6b11901f46d1a207c5b36353483e209f00a10fb401edcc5fd036a3025238ff0b')
    folder=Path('/tmp/api-boundaries'); folder.mkdir(mode=0o700)
    names=['admin.zip','commercial.zip','admin-report.json','commercial-report.json','repair-report.json']
    with zipfile.ZipFile(path) as archive:
        for name in names:
            fd=os.open(folder/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as f: f.write(archive.read(name))
    for key,spec in public_specs().items():
        prepared=prepare_dataset(spec,folder/(key+'.zip'),{role:folder/name for role,name in spec.report_artifacts.items()})
        publish(conn,prepared)
    check('real approved boundary counts',conn.execute('SELECT (SELECT count(*) FROM admin_dong_boundaries),(SELECT count(*) FROM commercial_area_boundaries)').fetchone()==(425,1650))


def main():
    config=json.load(sys.stdin); target=config['target']
    with connect_target(target,config['password']) as admin:
        roles(admin,config)
        polygons(admin)
        initial_sequences=admin.execute("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename NOT LIKE 'api_%' ORDER BY sequencename").fetchall()
        with connect_target(target,config['writer_password'],actor='api_writer') as conn:
            identity=lambda c:verify_connection(c,target,actor='api_writer')
            seed=fixture('synthetic,precision')
            check('first refresh stage and publish',refresh_release(conn,seed,expected_current=None,verify_identity=identity)['published'])
            check('NULL and actual zero remain distinct',conn.execute('SELECT store_count,similar_store_count FROM published_store_stats_dong').fetchone()==(0,None))
            check('BIGINT precision survives COPY',conn.execute('SELECT sales_amount FROM published_sales_dong').fetchone()==(9007199254740993,))
            check('identical READY stage is no-op',stage_release(conn,seed,verify_identity=identity) is False)
            check('lost response publish retry is no-op',publish_release(conn,seed['release_id'],expected_current=None,verify_identity=identity) is False)
            # This deliberately fails AFTER other source tables have copied rows.
            with admin.transaction():
                admin.execute("CREATE FUNCTION reject_api_test_copy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='COPY-FAILURE' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$")
                admin.execute('CREATE TRIGGER reject_api_test_copy BEFORE INSERT ON api_stores FOR EACH ROW EXECUTE FUNCTION reject_api_test_copy()')
            failure=fixture('COPY-FAILURE')
            try: stage_release(conn,failure,verify_identity=identity)
            except psycopg.Error: pass
            else: raise AssertionError('copy injection did not fail')
            check('failed COPY rolls back release and prior source rows',conn.execute('SELECT count(*) FROM api_releases WHERE release_id=%s',(failure['release_id'],)).fetchone()==(0,)
                and all(conn.execute('SELECT count(*) FROM '+table+' WHERE release_id=%s',(failure['release_id'],)).fetchone()==(0,) for table in TABLES.values()))
            check('COPY failure keeps current',conn.execute('SELECT release_id FROM api_current_release').fetchone()==(seed['release_id'],))
            inputs=Path('/inputs')
            paths=[inputs/(source+'-'+period) for period in ['20251','20252','20253','20254','20261','20262'] for source in ['seoul-stores','seoul-sales']]
            paths.append(inputs/'semas-stores-seoul-cafe-v2')
            release=prepare_release(paths)
            check('real release stage and publish',refresh_release(conn,release,expected_current=seed['release_id'],verify_identity=identity)['published'])
            verified=compare_rows(conn,release)
            check('CAFE scope preserves other legacy scopes',conn.execute("SELECT source_store_id FROM published_stores WHERE source_store_id LIKE 'legacy-%' ORDER BY 1").fetchall()==[('legacy-other-region',),('legacy-seoul-other',)])
            for table in TABLES.values():
                expect_rejected(admin,'UPDATE '+table+' SET release_id=release_id WHERE release_id=%s',(release['release_id'],))
                expect_rejected(admin,'DELETE FROM '+table+' WHERE release_id=%s',(release['release_id'],))
                expect_rejected(admin,'TRUNCATE '+table)
            check('sealed rows reject UPDATE DELETE TRUNCATE',True)
            bad=fixture('incomplete')
            try: publish_release(conn,bad['release_id'],expected_current=release['release_id'],verify_identity=identity)
            except CollectionError as e: check('unready publish rejected',str(e)=='RELEASE_NOT_READY')
            else: raise AssertionError('unready accepted')
            try: publish_release(conn,seed['release_id'],expected_current=release['release_id'],verify_identity=identity)
            except CollectionError as e: check('period loss rejected',str(e)=='RELEASE_PERIOD_LOSS')
            else: raise AssertionError('period loss accepted')
            july=fixture('synthetic-july',release['quarters'],month='202607')
            check('newer store month refresh succeeds',refresh_release(conn,july,expected_current=release['release_id'],verify_identity=identity)['published'])
            try: refresh_release(conn,release,expected_current=july['release_id'],verify_identity=identity)
            except CollectionError as e: check('actual current blocks stale baseline month',str(e)=='REFRESH_STORE_PERIOD_REGRESSION')
            else: raise AssertionError('older month refresh accepted')
            check('explicit recovery remains separate from automatic refresh',publish_release(conn,release['release_id'],expected_current=july['release_id'],verify_identity=identity))
            candidates=[fixture('concurrent-A',release['quarters']),fixture('concurrent-B',release['quarters'])]
            for candidate in candidates: stage_release(conn,candidate,verify_identity=identity)
            def concurrent(candidate):
                with connect_target(target,config['writer_password'],actor='api_writer') as other:
                    try: return publish_release(other,candidate['release_id'],expected_current=release['release_id'],verify_identity=identity)
                    except CollectionError as e: return str(e)
            with ThreadPoolExecutor(max_workers=2) as pool: outcomes=list(pool.map(concurrent,candidates))
            check('concurrent refresh has one winner',outcomes.count(True)==1 and outcomes.count('CURRENT_RELEASE_CHANGED')==1)
            current=conn.execute('SELECT release_id FROM api_current_release').fetchone()[0]
            check('recovery republishes retained full release',publish_release(conn,release['release_id'],expected_current=current,verify_identity=identity))
        with connect_target(target,config['reader_password'],actor='api_reader',read_only=True) as reader:
            with reader.transaction():
                reader.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                check('reader identity and readonly',reader.execute("SELECT current_user,current_setting('transaction_read_only'),current_setting('transaction_isolation')").fetchone()==('api_reader','on','repeatable read'))
                check('reader lacks all data writes',not reader.execute("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE'))").fetchone()[0])
            expect_rejected(reader,"UPDATE api_current_release SET release_id='"+'a'*64+"'")
        check('legacy sequences unchanged',initial_sequences==admin.execute("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename NOT LIKE 'api_%' ORDER BY sequencename").fetchall())
        check('legacy tables unchanged',admin.execute('SELECT (SELECT count(*) FROM store_stats_dong),(SELECT count(*) FROM sales_dong),(SELECT count(*) FROM stores)').fetchone()==(0,0,3))
        return dict(status='PASS',checks=CHECKS,verified_rows=verified,release_id=release['release_id'],quarters=release['quarters'],
                    store_reference_month=release['store_reference_month'],reader='READ_ONLY',legacy='SYNTHETIC_PRESERVATION_ONLY')


if __name__=='__main__':
    try: print(json.dumps(main()))
    except Exception as error:
        # No SQL/parameters/raw values/credentials in operational output.
        print(json.dumps(dict(status='FAIL',phase=CHECKS[-1] if CHECKS else 'bootstrap',type=type(error).__name__,
            sqlstate=getattr(error,'sqlstate',None),check=str(error) if isinstance(error,AssertionError) else None)),file=sys.stderr)
        sys.exit(2)
