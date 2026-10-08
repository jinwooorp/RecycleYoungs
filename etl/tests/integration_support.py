"""8-C1 test-only isolation checks and streaming snapshots; never a production loader."""
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import etl_stores
from app.loaders import copy_rows
from app.utils import clean_text, clean_float

if not __debug__:
    raise RuntimeError('integration verification refuses Python optimization (-O)')

V1_TABLES = ('industries','industry_mappings','commercial_areas','store_stats_dong',
             'sales_dong','sales_commercial_area','stores')
KEYS = {'industries':'code', 'industry_mappings':'source,source_code',
        'commercial_areas':'commercial_area_code', 'stores':'source_store_id',
        'store_stats_dong':'quarter_code,dong_code,source_industry_code',
        'sales_dong':'quarter_code,dong_code,source_industry_code',
        'sales_commercial_area':'quarter_code,commercial_area_code,source_industry_code',
        'spatial_dataset_versions':'dataset_id,source_file_sha256,processing_profile_sha256',
        'admin_dong_boundaries':'v.dataset_id,v.processing_profile_sha256,t.source_feature_index',
        'commercial_area_boundaries':'v.dataset_id,v.processing_profile_sha256,t.source_feature_index'}


def connect_isolated(dsn, proof):
    """Reject unsafe connection parameters BEFORE connect; proof comes from Docker inspection."""
    # libpq can fill unspecified hostaddr/service/options from the process environment.
    # Reject them before any connection, rather than relying on a post-connect identity check.
    unsafe_env = [name for name in ('PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR','PGOPTIONS')
                  if os.environ.get(name)]
    if unsafe_env:
        raise ValueError('ambient libpq overrides forbidden: ' + ','.join(unsafe_env))
    p = psycopg.conninfo.conninfo_to_dict(dsn)
    if set(p) != {'host','port','dbname','user','password'}:
        raise ValueError('explicit test-only host/port/dbname/user/password required; no service/hostaddr override')
    if not (re.fullmatch(r'ry-8c1-db-[a-z0-9]+', p['host']) and p['host'] == proof.get('host')
            and p['port'] == proof.get('port') == '5432'
            and p['user'] == proof.get('user') == 'integration_test'
            and re.fullmatch(r'recycleyoungs_(integration|spatial|stores)_test_[a-z0-9_]+', p['dbname'])
            and re.fullmatch(r'[0-9a-f]{64}', proof.get('container_id',''))
            and proof.get('internal') is True and not proof.get('port_bindings')
            and proof.get('mounts') == []
            and {'/var/lib/postgresql/data','/docker-entrypoint-initdb.d'} <= set(proof.get('tmpfs',{}))
            and re.fullmatch(r'ry-8c1-net-[a-z0-9]+', proof.get('network',''))
            and re.fullmatch(r'[0-9]+', proof.get('system_identifier',''))):
        raise ValueError('refusing target without verified internal-network/tmpfs/no-volume isolation proof')
    conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row, connect_timeout=5)
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT system_identifier::text AS id FROM pg_control_system()')
            if cur.fetchone()['id'] != proof['system_identifier']:
                raise ValueError('connected server identity differs from inspected isolated container')
    except BaseException:
        conn.close()
        raise
    return conn


def digest_records(records):
    h = hashlib.sha256()
    count = 0
    for record in records:
        value = record.encode('utf-8')
        h.update(len(value).to_bytes(8,'big'))
        h.update(value)
        count += 1
    return {'rows':count,'sha256':h.hexdigest()}


def assert_v1_fixture_state(versions, count):
    if versions != ['1'] or count != 0:
        raise ValueError('test-only V1 fixture requires actual V1-only history and empty stores')


def load_v1_stores(conn, path):
    """Reproduce the pre-V3 NULL policy only in a checked, empty isolated V1 database."""
    if not (re.fullmatch(r'ry-8c1-db-[a-z0-9]+',conn.info.host)
            and conn.info.dbname.startswith('recycleyoungs_integration_test_')
            and conn.info.user=='integration_test' and conn.info.port==5432):
        raise ValueError('V1 fixture requires a confirmed isolated connection')
    with conn.transaction(), conn.cursor() as cur:
        cur.execute('SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank')
        versions = [r['version'] for r in cur.fetchall()]
        cur.execute('SELECT count(*) AS n FROM stores')
        assert_v1_fixture_state(versions, cur.fetchone()['n'])
        cur.execute("SELECT count(*) AS n FROM industry_mappings WHERE source='SEMAS'")
        if cur.fetchone()['n']:
            raise ValueError('V1 fixture must not contain SEMAS mappings')
        # Empty database only: no TRUNCATE, no production stores.run, no mapping override.
        with Path(path).open(encoding='utf-8-sig', newline='') as source:
            reader = csv.DictReader(source, strict=True)
            batch = []
            total = 0
            for r in reader:
                values = [clean_text(r[c]) for c in etl_stores.USECOLS[:-2]]
                values.insert(11, None)
                lon, lat = clean_float(r['경도']), clean_float(r['위도'])
                if lon is not None and not -180 <= lon <= 180 or lat is not None and not -90 <= lat <= 90:
                    raise ValueError('V1 fixture coordinate out of range')
                point = f'SRID=4326;POINT({lon} {lat})' if lon is not None and lat is not None else None
                batch.append((*values,lon,lat,point))
                if len(batch) == 50000:
                    total += copy_rows(conn,'stores',etl_stores.COLUMNS,batch)
                    batch.clear()
            total += copy_rows(conn,'stores',etl_stores.COLUMNS,batch)
        print(f'[test-only V1 stores] {total} rows, industry_id=NULL')


def table_query(table, mode):
    """Include all actual columns; masks exclude only explicitly documented surrogate/lifecycle fields."""
    if table not in KEYS:
        raise ValueError('table outside integration snapshot allowlist')
    expression = 'to_jsonb(t)'
    join = ''
    order = 't.id' if mode in ('physical','raw') else KEYS[table]
    if mode == 'raw' and table == 'stores':
        expression += "-'industry_id'"
    elif mode == 'logical':
        expression += "-'id'"
        if table == 'industry_mappings' or table in ('stores','store_stats_dong','sales_dong','sales_commercial_area'):
            expression += "-'industry_id'"
            join = ' LEFT JOIN industries i ON i.id=t.industry_id'
            expression += " || jsonb_build_object('industry_code',i.code)"
        if table == 'spatial_dataset_versions':
            expression = "to_jsonb(t)-'id'-'loaded_at'"
        if table.endswith('_boundaries'):
            expression = "to_jsonb(t)-'id'-'dataset_version_id'"
            join = ' JOIN spatial_dataset_versions v ON v.id=t.dataset_version_id'
            expression += " || jsonb_build_object('dataset_id',v.dataset_id,'processing_profile_sha256',v.processing_profile_sha256)"
    elif mode not in ('physical','raw'):
        raise ValueError('invalid snapshot mode')
    if table in ('stores','commercial_areas'):
        expression = f"(({expression})-'location') || jsonb_build_object('location_ndr',encode(ST_AsBinary(t.location,'NDR'),'hex'),'location_srid',ST_SRID(t.location))"
    if table.endswith('_boundaries'):
        expression = f"(({expression})-'source_geometry'-'operational_geometry') || jsonb_build_object('source_ndr',encode(ST_AsBinary(t.source_geometry,'NDR'),'hex'),'operational_ndr',encode(ST_AsBinary(t.operational_geometry,'NDR'),'hex'),'source_srid',ST_SRID(t.source_geometry),'operational_srid',ST_SRID(t.operational_geometry))"
    return f'SELECT ({expression})::text AS value FROM public.{table} t{join} ORDER BY {order}'


def stream_query(conn, query):
    with conn.cursor(name='integration_snapshot') as cur:
        cur.itersize = 5000
        cur.execute(query)
        return digest_records(r['value'] for r in cur)


def snapshot(conn, spatial=False):
    result = {'physical':{},'raw':{},'logical':{},'sequences':{},'history':[], 'columns':{}}
    tables = list(V1_TABLES)
    if spatial:
        tables += ['spatial_dataset_versions','admin_dong_boundaries','commercial_area_boundaries']
    with conn.transaction(), conn.cursor() as cur:
        cur.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        for table in tables:
            for mode in ('physical','logical'):
                result[mode][table] = stream_query(conn, table_query(table,mode))
            if table == 'stores':
                result['raw'][table] = stream_query(conn,table_query(table,'raw'))
            cur.execute("SELECT column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position",(table,))
            result['columns'][table] = cur.fetchall()
        cur.execute("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")
        for row in cur.fetchall():
            name = row['sequencename']
            cur.execute(sql.SQL('SELECT last_value,is_called FROM public.{}').format(sql.Identifier(name)))
            result['sequences'][name] = cur.fetchone()
        cur.execute('SELECT installed_rank,version,description,type,script,checksum,success FROM flyway_schema_history ORDER BY installed_rank')
        result['history'] = cur.fetchall()
        result['classification'] = stream_query(conn,"SELECT jsonb_build_array(s.id,s.source_store_id,i.code)::text AS value FROM stores s LEFT JOIN industries i ON i.id=s.industry_id ORDER BY s.source_store_id")
        result['expected_v3_classification'] = stream_query(conn,"SELECT jsonb_build_array(s.id,s.source_store_id,CASE WHEN s.source_small_category_code='I21201' AND s.industry_id IS NULL THEN 'CAFE' ELSE i.code END)::text AS value FROM stores s LEFT JOIN industries i ON i.id=s.industry_id ORDER BY s.source_store_id")
        result['target_ids'] = stream_query(conn,"SELECT jsonb_build_array(id,source_store_id)::text AS value FROM stores WHERE source_small_category_code='I21201' ORDER BY source_store_id")
        cur.execute("SELECT source,source_code,m.id,i.code AS industry_code FROM industry_mappings m JOIN industries i ON i.id=m.industry_id ORDER BY source,source_code")
        result['mappings'] = cur.fetchall()
        cur.execute("SELECT count(*) AS total,count(*) FILTER(WHERE source_small_category_code='I21201') AS targets,count(*) FILTER(WHERE source_small_category_code='I21201' AND s.industry_id IS NULL) AS target_null,count(*) FILTER(WHERE source_small_category_code='I21201' AND i.code IS DISTINCT FROM 'CAFE') AS target_not_cafe,count(*) FILTER(WHERE source_small_category_code IS DISTINCT FROM 'I21201' AND s.industry_id IS NOT NULL) AS other_mapped FROM stores s LEFT JOIN industries i ON i.id=s.industry_id")
        result['stores_summary'] = cur.fetchone()
    return result


def compare_preserved(before, after, migrated=False):
    for table in V1_TABLES:
        if table == 'industry_mappings' and migrated:
            if after['mappings'] != sorted(before['mappings'] + [r for r in after['mappings'] if r['source']=='SEMAS' and r['source_code']=='I21201'], key=lambda r:(r['source'],r['source_code'])):
                raise AssertionError('mapping change outside SEMAS/I21201')
        elif table == 'stores' and migrated:
            assert before['raw']['stores'] == after['raw']['stores'], 'stores original columns/ids/POINT changed'
            assert before['expected_v3_classification'] == after['classification'], 'unexpected industry_id changes'
            assert before['target_ids'] == after['target_ids'], 'target ID/source_id set changed'
        else:
            assert before['physical'][table] == after['physical'][table], f'{table} rows/values/IDs changed'
    for name,value in before['sequences'].items():
        if name not in {f'{table}_id_seq' for table in V1_TABLES}:
            continue
        if migrated and name == 'industry_mappings_id_seq':
            continue
        assert after['sequences'][name] == value, f'{name} changed'
    assert after['history'][:len(before['history'])] == before['history'], 'existing Flyway history/checksum changed'


def compare_logical(a,b):
    assert a['logical'] == b['logical'], 'Fresh/Populated logical row hashes differ'
    assert a['columns'] == b['columns'], 'Fresh/Populated column schema differs'
