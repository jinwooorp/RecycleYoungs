"""Persistent team DB lifecycle. No legacy DSN, destructive refresh or automatic adoption."""
import argparse
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import sys
from team_data import DataError, ROOT, canonical, require
from team_dataset import (binding, cache_path, check_files, contract_sha, expected_history, parse_json,
                          prepare, validate_binding, validate_spatial, version)
from team_guard import DATABASE, PGDATA, prove_database

CONTROL = Path('/control')
TABLES = ('industries', 'industry_mappings', 'commercial_areas', 'store_stats_dong', 'sales_dong',
          'sales_commercial_area', 'stores', 'spatial_dataset_versions', 'admin_dong_boundaries',
          'commercial_area_boundaries', 'flyway_schema_history')
DATA_TABLES = ('commercial_areas', 'store_stats_dong', 'sales_dong', 'sales_commercial_area', 'stores',
               'spatial_dataset_versions', 'admin_dong_boundaries', 'commercial_area_boundaries')


def validate_identity(actual, expected):
    require(actual == expected and actual['db'] == DATABASE and actual['port'] == '5432'
            and actual['actor'] in {'ry_team_owner', 'ry_team_reader'} and actual['pgdata'] == PGDATA
            and actual['sid'].isdecimal() and actual['sid'] != '7692329130053947430'
            and len(actual['owner']) == 32, 'Actual team DB connection identity rejected')


def decide_load(state, empty, version, digest):
    if state is None:
        require(empty, 'Unowned populated DB; refusing ETL adoption')
        return 'LOAD'
    require(state['version'] == version and state['contract'] == digest,
            'Dataset/ETL version mismatch; preserve volume and review an explicit update plan')
    if state['status'] == 'READY': return 'VERIFY'
    require(state['status'] in {'FAILED', 'LOADING'}, 'Unknown initialization state')
    if state['stage'] == 'CSV':
        require(empty, 'Incomplete CSV checkpoint with existing data; review required')
        return 'LOAD'
    require(state['stage'] in {'CSV_DONE', 'POLYGONS', 'VERIFY'}, 'Unknown failed stage')
    return 'RESUME'


def migration_state(state, version, digest, owner):
    require(state is not None and state['owner'] == owner and state['version'] == version
            and state['contract'] == digest and state['status'] in {'READY', 'LOADING', 'FAILED'},
            'Dataset/ETL/owner mismatch BEFORE Flyway; preserve volume and review')


def ownership():
    value = parse_json((CONTROL / 'ownership.json').read_bytes())
    actual = prove_database()
    require(value['resources'] == actual['resources'], 'Ownership ledger/resources mismatch')
    validate_binding(value)
    return value, actual


def load_identity():
    return None if not (CONTROL / 'identity.json').exists() else parse_json((CONTROL / 'identity.json').read_bytes())


def connect(bootstrap=False):
    import psycopg
    from psycopg.rows import dict_row
    owner, metadata = ownership()
    previous = load_identity()
    if previous:
        validate_binding(previous)
        prove_database(previous)
    c = psycopg.connect(host='postgres', hostaddr=metadata['ip'], port=5432, dbname=DATABASE,
                         user='ry_team_owner', password=(CONTROL / 'password').read_text(),
                         autocommit=True, connect_timeout=5, row_factory=dict_row,
                         application_name='recycleyoungs_team_init', options='-c default_transaction_read_only=on -c statement_timeout=600000 -c lock_timeout=5000')
    try:
        actual = c.execute("""SELECT current_database() AS db,current_user AS actor,
            (SELECT system_identifier::text FROM pg_control_system()) AS sid,
            current_setting('data_directory') AS pgdata,current_setting('port') AS port,
            current_setting('recycleyoungs.owner',true) AS owner""").fetchone()
        expected = dict(db=DATABASE, actor='ry_team_owner', sid=previous['sid'] if previous else actual['sid'],
                        pgdata=PGDATA, port='5432', owner=owner['owner'])
        if bootstrap and previous is None and actual['owner'] is None:
            # Recover a fresh initdb interrupted before the ownership marker. Prove every core
            # field and the absence of all user objects before the first authorized DDL.
            validate_identity(dict(actual, owner=owner['owner']), expected)
            require(not c.execute("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')").fetchone(),
                    'Missing owner marker on a populated DB; refusing adoption')
            require(not c.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name NOT IN ('public','information_schema') AND schema_name NOT LIKE 'pg_%'").fetchone(),
                    'Missing owner marker with unknown schema')
            from psycopg import sql
            c.execute('SET default_transaction_read_only=off')
            c.execute(sql.SQL('ALTER DATABASE recycleyoungs_team_dev SET recycleyoungs.owner = {}').format(sql.Literal(owner['owner'])))
            c.execute("SELECT set_config('recycleyoungs.owner',%s,false)", (owner['owner'],))
            actual['owner'] = owner['owner']
        validate_identity(actual, expected)
        require(c.execute('SELECT session_user AS u').fetchone()['u'] == 'ry_team_owner', 'Session user mismatch')
        state_exists = c.execute("SELECT to_regclass('team_dev.state') IS NOT NULL AS ok").fetchone()['ok']
        if not state_exists:
            require(not c.execute("SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name='team_dev') AS ok").fetchone()['ok'],
                    'Incomplete/unknown team_dev schema without state; preserve DB and review')
        if state_exists:
            state = read_state(c)
            migration_state(state, version(), contract_sha(), owner['owner'])
            if bootstrap:
                history(c)
                decide_load(state, empty(c), version(), contract_sha())
                if state['status'] == 'READY':
                    require(fingerprint(c) == state['verification']['fingerprint'], 'READY/actual DB mismatch BEFORE Flyway')
                    validate_spatial(list(c.execute('SELECT * FROM public.spatial_dataset_versions')))
        # Dataset/owner mismatch is rejected while the actual connection is still READ ONLY.
        c.execute("SET default_transaction_read_only=off")
        if bootstrap:
            if not state_exists:
                tables = {r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")}
                for table in tables & set(DATA_TABLES):
                    require(c.execute('SELECT count(*) AS n FROM public.' + table).fetchone()['n'] == 0,
                            'Nonempty DB without team ownership state; migration refused')
                require(tables <= set(TABLES) | {'spatial_ref_sys'}, 'Unknown public schema; migration refused')
            metadata.update(sid=actual['sid'], owner=owner['owner'], dataset=binding())
            (CONTROL / 'identity.json').write_text(canonical(metadata))
            (CONTROL / 'sid').write_text(actual['sid'])
            (CONTROL / 'owner').write_text(owner['owner'])
            (CONTROL / 'dataset-version').write_text(version())
            (CONTROL / 'dataset-contract').write_text(contract_sha())
        return c
    except BaseException:
        c.close(); raise


def history(c):
    expected = expected_history()
    actual = list(c.execute('SELECT version,checksum,success FROM public.flyway_schema_history ORDER BY installed_rank'))
    require(actual == expected and len(actual) == 3, 'Flyway V1/V2/V3/checksum mismatch')
    return actual


def fingerprint_sql():
    parts = ["SELECT '" + t + "' AS name, jsonb_build_object('rows',count(*),'sha',"
             "md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),''))) AS value FROM public." + t + ' t'
             for t in TABLES]
    parts.append("SELECT 'sequences', coalesce(jsonb_object_agg(sequencename,last_value),'{}'::jsonb) FROM pg_sequences WHERE schemaname='public'")
    return 'SELECT jsonb_object_agg(name,value) FROM (' + ' UNION ALL '.join(parts) + ') fingerprints'


def fingerprint(c):
    return c.execute(fingerprint_sql()).fetchone()['jsonb_object_agg']


def setup(c):
    c.execute('CREATE SCHEMA IF NOT EXISTS team_dev')
    c.execute('''CREATE TABLE IF NOT EXISTS team_dev.state (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        version text NOT NULL,contract text NOT NULL,owner text NOT NULL,
        status text NOT NULL CHECK(status IN ('LOADING','FAILED','READY')),
        stage text NOT NULL,verification jsonb,updated_at timestamptz NOT NULL DEFAULT now())''')
    c.execute('CREATE OR REPLACE FUNCTION team_dev.fingerprint() RETURNS jsonb LANGUAGE sql STABLE AS $fn$ ' + fingerprint_sql() + ' $fn$')


def read_state(c):
    return c.execute('SELECT version,contract,owner,status,stage,verification FROM team_dev.state WHERE singleton').fetchone()


def assert_ready(c):
    state = read_state(c)
    require(state and state['status'] == 'READY' and state['version'] == version() and state['contract'] == contract_sha(),
            'DB_NOT_READY: inspect etl-init logs; rerun compose after resolving failure')
    history(c)
    validate_spatial(list(c.execute('SELECT * FROM public.spatial_dataset_versions')))
    require(fingerprint(c) == state['verification']['fingerprint'], 'READY/actual DB fingerprint mismatch')
    return state


def checkpoint(c, status, stage, verification=None):
    from psycopg.types.json import Jsonb
    updated = c.execute('''INSERT INTO team_dev.state(singleton,version,contract,owner,status,stage,verification)
        VALUES(true,%s,%s,%s,%s,%s,%s) ON CONFLICT(singleton) DO UPDATE SET
        status=excluded.status,stage=excluded.stage,verification=coalesce(excluded.verification,team_dev.state.verification),updated_at=now()
        WHERE team_dev.state.version=excluded.version AND team_dev.state.contract=excluded.contract
          AND team_dev.state.owner=excluded.owner RETURNING singleton''',
        (version(), contract_sha(), (CONTROL / 'owner').read_text(), status, stage,
         Jsonb(verification) if verification is not None else None)).fetchone()
    # A conflicting identity is never updated, including by the failure checkpoint.
    require(updated is not None, 'Checkpoint dataset identity mismatch; no state adoption')


def empty(c):
    return all(c.execute('SELECT count(*) AS n FROM ' + t).fetchone()['n'] == 0 for t in DATA_TABLES)


def load_csv(c, fail_after=None):
    from app import etl_store_stats, etl_sales, etl_stores
    with c.transaction(), redirect_stdout(io.StringIO()):
        for name, fn in [('stats', etl_store_stats.run), ('sales', etl_sales.run_dong), ('stores', etl_stores.run)]:
            fn(c, cache_path() / (name + '.csv'))
            if fail_after == name: raise DataError('Injected CSV rollback fixture')
        checkpoint(c, 'LOADING', 'CSV_DONE')


def verify(c, polygons):
    from demo_worker import projections
    from app.spatial_load import _verify_features, dataset_metadata, LAYOUTS
    with c.transaction():
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        migrations = history(c)
        csv = projections(c, cache_path(), ROOT / 'data/manifest.json')
        validate_spatial(list(c.execute('SELECT * FROM public.spatial_dataset_versions')))
        spatial = []
        for d in polygons:
            versions = list(c.execute('SELECT * FROM spatial_dataset_versions WHERE boundary_kind=%s', (d.spec.boundary_kind,)))
            require(len(versions) == 1 and versions[0]['load_status'] == 'READY' and versions[0]['is_current'],
                    'Spatial version/current readiness mismatch')
            v = versions[0]
            require(all(v[k] == value for k, value in dataset_metadata(c, d).items()), 'Spatial provenance/profile mismatch')
            with c.cursor() as cur: _verify_features(cur, v['id'], d)
            spatial.append(dict(dataset=d.spec.dataset_id, version_id=v['id'], rows=len(d.features),
                                source_sha256=d.spec.archive_sha256, processing_profile_sha256=v['processing_profile_sha256'],
                                historical_compatibility=v['historical_compatibility_status']))
        stores = c.execute('''SELECT count(*) AS total,count(DISTINCT source_store_id) AS unique_ids,
            count(*) FILTER (WHERE source_small_category_code='I21201') AS source_cafe,
            count(*) FILTER (WHERE industry_id=(SELECT id FROM industries WHERE code='CAFE')) AS cafe,
            count(*) FILTER (WHERE location IS NULL OR ST_SRID(location)<>4326 OR ST_IsEmpty(location)
              OR ST_X(location) IS DISTINCT FROM longitude OR ST_Y(location) IS DISTINCT FROM latitude) AS bad_points,
            count(*) FILTER (WHERE (source_small_category_code='I21201') IS DISTINCT FROM
              (industry_id IS NOT DISTINCT FROM (SELECT id FROM industries WHERE code='CAFE'))) AS conflicts FROM stores''').fetchone()
        require(stores['total'] == stores['unique_ids'] and stores['source_cafe'] == stores['cafe']
                and stores['bad_points'] == stores['conflicts'] == 0, 'Stores/CAFE/POINT mismatch')
        return dict(migrations=migrations, csv=csv, spatial=spatial, stores=stores, fingerprint=fingerprint(c))


def reader(c):
    from psycopg import sql
    if not c.execute("SELECT 1 FROM pg_roles WHERE rolname='ry_team_reader'").fetchone():
        c.execute(sql.SQL('CREATE ROLE ry_team_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}').format(
            sql.Literal((CONTROL / 'reader-password').read_text())))
    c.execute('ALTER ROLE ry_team_reader SET default_transaction_read_only=on')
    c.execute('GRANT pg_monitor TO ry_team_reader')
    c.execute('GRANT EXECUTE ON FUNCTION pg_control_system() TO ry_team_reader')
    c.execute('GRANT CONNECT ON DATABASE recycleyoungs_team_dev TO ry_team_reader')
    c.execute('GRANT USAGE ON SCHEMA public,team_dev TO ry_team_reader')
    c.execute('GRANT SELECT ON ALL TABLES IN SCHEMA public,team_dev TO ry_team_reader')
    c.execute('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ry_team_reader')
    c.execute('GRANT EXECUTE ON FUNCTION team_dev.fingerprint() TO ry_team_reader')


def initialize():
    check_files(cache_path())
    _, polygons = prepare(cache_path())
    with connect() as c:
        require(c.execute('SELECT pg_try_advisory_lock(726014,1) AS ok').fetchone()['ok'], 'Another initializer is running')
        history(c)
        with c.transaction():
            has_state = c.execute("SELECT to_regclass('team_dev.state') IS NOT NULL AS ok").fetchone()['ok']
            state = read_state(c) if has_state else None
            action = decide_load(state, empty(c), version(), contract_sha())
            if state is None:
                # Schema creation and the first durable checkpoint are one atomic step.
                setup(c)
                checkpoint(c, 'LOADING', 'CSV')
        if action == 'VERIFY':
            result = verify(c, polygons)
            require(result == state['verification'], 'READY marker and actual DB disagree; preserve data and review')
            return dict(status='READY', action='PRESERVED', version=version(), verification=result)
        stage = 'CSV' if action == 'LOAD' else state['stage']
        try:
            checkpoint(c, 'LOADING', stage)
            if action == 'LOAD': load_csv(c)
            else:
                from demo_worker import projections
                with c.transaction():
                    c.execute('SET TRANSACTION READ ONLY')
                    projections(c, cache_path(), ROOT / 'data/manifest.json')
            stage = 'POLYGONS'; checkpoint(c, 'LOADING', stage)
            from app.spatial_load import publish
            for d in polygons:
                # Rechecks actual Docker AND SQL identity on every publication connection.
                with connect() as publication: publish(publication, d)
            stage = 'VERIFY'; checkpoint(c, 'LOADING', stage)
            for table in DATA_TABLES: c.execute('ANALYZE ' + table)
            result = verify(c, polygons)
            with c.transaction():
                reader(c)
                checkpoint(c, 'READY', 'VERIFIED', result)
            return dict(status='READY', action='INITIALIZED' if action == 'LOAD' else 'RESUMED', version=version(), verification=result)
        except BaseException:
            checkpoint(c, 'FAILED', 'CSV' if stage == 'CSV' else stage)
            raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['identity', 'initialize', 'status'])
    args = parser.parse_args()
    try:
        if args.action == 'identity':
            with connect(bootstrap=True): pass
            result = dict(status='PASS', stage='DB_IDENTITY')
        elif args.action == 'initialize': result = initialize()
        else:
            with connect() as c, c.transaction():
                c.execute('SET TRANSACTION READ ONLY')
                state = assert_ready(c)
                result = dict(status='READY', version=version(), verification=state['verification'])
        print(canonical(result))
    except Exception as exc:
        print(canonical(dict(status='FAIL', reason=str(exc) if isinstance(exc, DataError) else type(exc).__name__)))
        raise SystemExit(1)


if __name__ == '__main__': main()
