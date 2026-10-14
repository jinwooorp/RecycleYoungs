"""Container-side real-input demo operations. Explicit stdin proof; no default DSN."""
import argparse
from collections import Counter
import contextlib
import csv
from decimal import Decimal
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import time
import traceback
import urllib.error
import urllib.request

from demo_safety import DemoError, PGDATA, PROTECTED_SID, require

INPUTS = {'administrative_store_stats': 'stats.csv', 'administrative_sales': 'sales.csv',
          'individual_stores': 'stores.csv'}
CANDIDATES = [('서울시청', 37.5665, 126.9780), ('홍대입구', 37.5563, 126.9238),
              ('성수', 37.5445, 127.0557)]


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def manifests(manifest_path=Path('/inputs/manifest.json')):
    manifest = json.loads(Path(manifest_path).read_text())
    return {d['dataset_id']: d for d in manifest['datasets'] if d['dataset_id'] in INPUTS}


def input_validation(inputs_root=Path('/inputs'), manifest_path=Path('/inputs/manifest.json')):
    reports = []
    for key, spec in manifests(manifest_path).items():
        path = Path(inputs_root) / INPUTS[key]
        require(path.is_file() and sha(path) == spec['sha256'] and path.stat().st_size == spec['bytes'],
                'CSV identity mismatch: ' + key)
        keys, quarters, dongs, classes = set(), Counter(), set(), Counter()
        count = badcoords = blankcoords = nonseoul = 0
        with path.open(encoding=spec['encoding'], newline='') as stream:
            reader = csv.DictReader(stream)
            require(reader.fieldnames == spec['headers'], 'CSV header identity mismatch: ' + key)
            for row in reader:
                count += 1
                require(None not in row and all(v is not None for v in row.values()), 'Invalid field count')
                identity = tuple(row[k] for k in spec['candidate_key'])
                require(identity not in keys, 'Duplicate source key')
                keys.add(identity)
                if key != 'individual_stores':
                    quarters[row['기준_년분기_코드']] += 1
                    dongs.add(row['행정동_코드'])
                else:
                    classes[row['상권업종소분류코드']] += 1
                    nonseoul += row['시도코드'] != '11'
                    x, y = row['경도'].strip(), row['위도'].strip()
                    blankcoords += not x or not y
                    if x and y:
                        try:
                            x, y = float(x), float(y)
                            badcoords += not (math.isfinite(x) and math.isfinite(y) and -180 <= x <= 180 and -90 <= y <= 90)
                        except ValueError:
                            badcoords += 1
        require(count == spec['row_count'] and dict(quarters) == spec['quarter_row_counts'], 'CSV row/period mismatch')
        require(not badcoords and not nonseoul, 'Source coordinate/region integrity mismatch')
        reports.append(dict(dataset=key, sha256=spec['sha256'], rows=count, duplicate_keys=0,
                            quarters=dict(quarters), admin_codes=len(dongs), cafe_rows=classes['I21201'],
                            invalid_coordinates=badcoords, blank_coordinates=blankcoords))
    return reports


def prepared(inputs_root=Path('/inputs')):
    from app.spatial_geometry import prepare_dataset
    from app.spatial_sources import SPECS
    return [prepare_dataset(SPECS[key], Path(inputs_root) / (key + '.zip'),
                            {'quality': Path(inputs_root) / (key + '-report.json'),
                             **({'repair': Path(inputs_root) / 'repair-report.json'} if key == 'commercial' else {})})
            for key in ('admin', 'commercial')]


def connect(config, read_only=False):
    import psycopg
    from psycopg.rows import dict_row
    target = config['target']
    owner = target['owner']
    require(target['host'] == 'ry-demo-db-' + owner and target['database'] == 'recycleyoungs_demo_' + owner
            and target['sid'] != PROTECTED_SID and target['pgdata'] == PGDATA, 'Worker routing rejected')
    user = 'ry_demo_reader' if read_only else 'ry_demo_owner'
    connection = psycopg.connect(host=target['host'], port=5432, dbname=target['database'], user=user,
                                  password=config['reader_password'] if read_only else config['password'],
                                  connect_timeout=5, autocommit=True, row_factory=dict_row,
                                  application_name='recycleyoungs_demo_worker')
    try:
        connection.execute("SET lock_timeout='5s'")
        connection.execute("SET statement_timeout='10min'")
        connection.execute('SET default_transaction_read_only=' + ('on' if read_only else 'off'))
        actual = connection.execute("""SELECT current_database() AS db,current_user AS actor,session_user,
            (SELECT system_identifier::text FROM pg_control_system()) AS sid,
            current_setting('data_directory') AS data,current_setting('port') AS port,
            current_setting('lock_timeout') AS lock,current_setting('statement_timeout') AS timeout,
            current_setting('transaction_read_only') AS readonly""").fetchone()
        require(actual == dict(db=target['database'], actor=user, session_user=user, sid=target['sid'],
                               data=PGDATA, port='5432', lock='5s', timeout='10min',
                               readonly='on' if read_only else 'off'), 'Actual worker connection identity mismatch')
        return connection
    except BaseException:
        connection.close()
        raise


def load(config):
    from app import etl_store_stats, etl_sales, etl_stores
    from app.spatial_load import publish
    inputs = input_validation()
    polygons = prepared()
    with connect(config) as connection:
        for table in ('stores', 'store_stats_dong', 'sales_dong', 'spatial_dataset_versions'):
            require(connection.execute('SELECT count(*) AS n FROM ' + table).fetchone()['n'] == 0,
                    'Initial demo tables must be empty')
        # Existing destructive jobs share one guarded transaction; an error rolls back all CSV jobs.
        with contextlib.redirect_stdout(io.StringIO()), connection.transaction():
            etl_store_stats.run(connection, Path('/inputs/stats.csv'))
            etl_sales.run_dong(connection, Path('/inputs/sales.csv'))
            etl_stores.run(connection, Path('/inputs/stores.csv'))
        result = [dict(dataset=d.spec.dataset_id, **publish(connection, d).__dict__) for d in polygons]
        for table in ('stores', 'store_stats_dong', 'sales_dong', 'admin_dong_boundaries', 'commercial_area_boundaries'):
            connection.execute('ANALYZE ' + table)
    return dict(csv=inputs, polygon=result, transaction='CSV atomic; Polygon one atomic publication per kind')


def normalize(value):
    if isinstance(value, Decimal):
        return format(value.normalize(), 'f') if value else '0'
    return value


def row_hash(values):
    return hashlib.sha256(json.dumps([normalize(v) for v in values], ensure_ascii=False,
                                    separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def multiset_digest(rows):
    values = sorted(row_hash(row) for row in rows)
    return len(values), hashlib.sha256('\n'.join(values).encode()).hexdigest()


def projections(connection, inputs_root=Path('/inputs'), manifest_path=Path('/inputs/manifest.json')):
    from app.etl_sales import SALES_AMOUNT_FIELDS, TRANSACTION_FIELDS
    from app.etl_stores import USECOLS, COLUMNS
    mapping = {(r['source'], r['source_code']): r['industry_id'] for r in
               connection.execute('SELECT source,source_code,industry_id FROM industry_mappings')}
    stats = [('기준_년분기_코드', 'quarter_code', 'int'), ('행정동_코드', 'dong_code', 'str'),
             ('행정동_코드_명', 'dong_name', 'str'), ('서비스_업종_코드', 'source_industry_code', 'str'),
             ('서비스_업종_코드_명', 'source_industry_name', 'str'), ('점포_수', 'store_count', 'int'),
             ('유사_업종_점포_수', 'similar_store_count', 'int'), ('개업_율', 'opening_rate', 'decimal'),
             ('개업_점포_수', 'opening_store_count', 'int'), ('폐업_률', 'closing_rate', 'decimal'),
             ('폐업_점포_수', 'closing_store_count', 'int'), ('프랜차이즈_점포_수', 'franchise_store_count', 'int')]
    sales = stats[:5] + [(a, b, 'int') for a, b in SALES_AMOUNT_FIELDS + TRANSACTION_FIELDS]
    stores = [(a, b, 'float' if a in ('경도', '위도') else 'str')
              for a, b in zip(USECOLS, [c for c in COLUMNS if c not in ('industry_id', 'location')])]
    result = []
    for key, table, fields in [('administrative_store_stats', 'store_stats_dong', stats),
                               ('administrative_sales', 'sales_dong', sales),
                               ('individual_stores', 'stores', stores)]:
        spec = manifests(manifest_path)[key]
        columns = [b for _, b, _ in fields] + ['industry_id']
        nulls, zeros = Counter(), Counter()

        def source_rows():
            with (Path(inputs_root) / INPUTS[key]).open(encoding=spec['encoding'], newline='') as stream:
                for row in csv.DictReader(stream):
                    values = []
                    for header, column, kind in fields:
                        text = row[header].strip()
                        value = None if not text else {'int': int, 'float': float, 'decimal': Decimal, 'str': str}[kind](text)
                        values.append(value)
                        nulls[column] += value is None
                        zeros[column] += value == 0
                    source, code = ('SEMAS', row['상권업종소분류코드']) if key == 'individual_stores' else ('SEOUL', row['서비스_업종_코드'])
                    yield values + [mapping.get((source, code.strip()))]

        expected = multiset_digest(source_rows())
        with connection.cursor(name='projection_' + table) as cursor:
            cursor.execute('SELECT ' + ','.join(columns) + ' FROM ' + table)
            actual = multiset_digest([row[c] for c in columns] for row in cursor)
        require(expected == actual and actual[0] == spec['row_count'], 'Full source/DB projection mismatch: ' + table)
        result.append(dict(table=table, rows=actual[0], columns=columns, projection_sha256=actual[1],
                           source_db_equal=True, source_nulls=dict(nulls), source_zeros=dict(zeros)))
    return result


def verify(config, read_only=False):
    input_validation()
    polygons = prepared()
    with connect(config, read_only) as connection, connection.transaction():
        connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        history = list(connection.execute('SELECT version,checksum,success FROM flyway_schema_history ORDER BY installed_rank'))
        require([r['version'] for r in history] == ['1', '2', '3'] and all(r['success'] for r in history), 'Flyway history mismatch')
        projection = projections(connection)
        spatial = []
        for dataset in polygons:
            table, code = ('admin_dong_boundaries', 'dong_code') if dataset.spec.key == 'admin' else ('commercial_area_boundaries', 'commercial_area_code')
            versions = list(connection.execute('SELECT id,source_file_sha256,feature_count,validation_status,reference_date_verified,historical_compatibility_status FROM spatial_dataset_versions WHERE boundary_kind=%s AND is_current AND load_status=\'READY\'', (dataset.spec.boundary_kind,)))
            require(len(versions) == 1 and versions[0]['source_file_sha256'] == dataset.spec.archive_sha256, 'Current source version mismatch')
            rows = list(connection.execute('SELECT ' + code + " AS code,source_feature_index,encode(sha256(ST_AsBinary(source_geometry,'NDR')),'hex') AS source,encode(sha256(ST_AsBinary(operational_geometry,'NDR')),'hex') AS operational,ST_SRID(source_geometry) AS source_srid,ST_SRID(operational_geometry) AS operational_srid,ST_IsValid(operational_geometry) AND NOT ST_IsEmpty(operational_geometry) AS valid,quality_status FROM " + table + ' WHERE dataset_version_id=%s ORDER BY source_feature_index', (versions[0]['id'],)))
            require(len(rows) == len(dataset.features), 'Spatial feature count mismatch')
            for row, feature in zip(rows, dataset.features):
                require((row['code'], row['source_feature_index'], row['source'], row['operational']) ==
                        (feature.code, feature.source_feature_index, feature.source_sha256, feature.operational_sha256)
                        and row['source_srid'] == row['operational_srid'] == 5181 and row['valid'], 'Full spatial projection mismatch')
            spatial.append(dict(dataset=dataset.spec.dataset_id, version=versions[0], features=len(rows),
                                quality=dict(Counter(r['quality_status'] for r in rows)), all_hashes_equal=True))
        stores = connection.execute("""SELECT count(*) AS total,count(DISTINCT source_store_id) AS unique_ids,
            count(*) FILTER (WHERE source_small_category_code='I21201') AS i21201,
            count(*) FILTER (WHERE industry_id=(SELECT id FROM industries WHERE code='CAFE')) AS cafe,
            count(*) FILTER (WHERE industry_id IS NULL) AS unclassified,
            count(*) FILTER (WHERE location IS NULL) AS null_points,
            count(*) FILTER (WHERE location IS NOT NULL AND (ST_SRID(location)<>4326 OR ST_IsEmpty(location)
              OR ST_X(location) IS DISTINCT FROM longitude OR ST_Y(location) IS DISTINCT FROM latitude)) AS bad_points,
            count(*) FILTER (WHERE (source_small_category_code='I21201') IS DISTINCT FROM
              (industry_id IS NOT DISTINCT FROM (SELECT id FROM industries WHERE code='CAFE'))) AS cafe_conflicts FROM stores""").fetchone()
        require(stores['total'] == stores['unique_ids'] == 554092 and stores['i21201'] == stores['cafe'] == 22739
                and stores['bad_points'] == stores['cafe_conflicts'] == stores['null_points'] == 0, 'Stores integrity mismatch')
        result = dict(history=history, projections=projection, spatial=spatial, stores=stores,
                      readonly_transaction=True, snapshot_status='UNVERIFIED', writer_credentials_exported=False)
        if read_only:
            from demo_checks import run_checks
            result['api_checks'] = run_checks(connection, config['target']['owner'])
        return result


def seal(config):
    from psycopg import sql
    with connect(config) as connection, connection.transaction():
        connection.execute(sql.SQL('CREATE ROLE ry_demo_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}').format(sql.Literal(config['reader_password'])))
        connection.execute(sql.SQL('REVOKE ALL ON DATABASE {} FROM PUBLIC').format(sql.Identifier(config['target']['database'])))
        connection.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO ry_demo_reader').format(sql.Identifier(config['target']['database'])))
        connection.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        connection.execute('GRANT USAGE ON SCHEMA public TO ry_demo_reader')
        connection.execute('GRANT SELECT ON ALL TABLES IN SCHEMA public TO ry_demo_reader')
        connection.execute('GRANT pg_read_all_settings TO ry_demo_reader')
        connection.execute('GRANT EXECUTE ON FUNCTION pg_control_system() TO ry_demo_reader')
        connection.execute('ALTER ROLE ry_demo_reader SET default_transaction_read_only=on')
        connection.execute('ALTER ROLE ry_demo_owner NOLOGIN')
    with connect(config, True) as connection:
        permissions = connection.execute("""SELECT count(*) AS writable_tables FROM pg_tables
            WHERE schemaname='public' AND (has_table_privilege(current_user,schemaname||'.'||tablename,'INSERT')
            OR has_table_privilege(current_user,schemaname||'.'||tablename,'UPDATE')
            OR has_table_privilege(current_user,schemaname||'.'||tablename,'DELETE')
            OR has_table_privilege(current_user,schemaname||'.'||tablename,'TRUNCATE'))""").fetchone()
        require(permissions['writable_tables'] == 0, 'Reader has write privileges')
        require(connection.execute("SELECT rolcanlogin FROM pg_roles WHERE rolname='ry_demo_owner'").fetchone()['rolcanlogin'] is False,
                'Writer login remains enabled')
    return dict(reader='ry_demo_reader', writable_tables=0, default_read_only=True, writer_login=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['validate', 'load', 'verify', 'seal', 'final'])
    stage = parser.parse_args().stage
    try:
        config = json.loads(sys.stdin.readline())
        if stage == 'validate':
            value = dict(csv=input_validation(), polygon=[dict(dataset=d.spec.dataset_id, features=len(d.features),
                         quality=dict(Counter(f.quality_status for f in d.features))) for d in prepared()])
        elif stage == 'load':
            value = load(config)
        elif stage in ('verify', 'final'):
            value = verify(config, stage == 'final')
        else:
            value = seal(config)
        print(json.dumps(dict(stage=stage, status='PASS', result=value), ensure_ascii=False, default=str))
    except Exception as failure:
        message = str(failure) if isinstance(failure, DemoError) else 'Operational error; ' + type(failure).__name__
        print(json.dumps(dict(stage=stage, status='STOP', reason=message,
                             sqlstate=getattr(failure, 'sqlstate', None),
                             locations=[dict(file=Path(f.filename).name, line=f.lineno, function=f.name)
                                        for f in traceback.extract_tb(failure.__traceback__)])))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
