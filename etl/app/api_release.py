"""Immutable API release preparation; DB writers require an injected verified connection.

The CLI only prepares a private file. It never opens a DB connection or publishes.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

from .api_artifacts import create_file, encoded, EvidenceRecords
from .api_compare import file_sha
from .api_config import private_parent
from .api_http import unique_object
from .api_records import (CollectionError, COMMON, STORE_COUNTS, SALES, SEMAS,
                          normalize_store_stats, normalize_sales, normalize_store,
                          quarter, reference_month)

TEXT_POLICY = 'SOURCE_TEXT_OUTER_STRIP_ONLY'
TABLES = {'seoul-stores': 'api_store_stats_dong', 'seoul-sales': 'api_sales_dong',
          'semas-stores': 'api_stores'}


def digest(value):
    # Preserve the original canonical bytes (including the final newline) while
    # avoiding a second multi-GB JSON string. iterencode also supports RecordFile.
    h = hashlib.sha256()
    for part in canonical_chunks(value):
        h.update(part)
    h.update(b'\n')
    return h.hexdigest()


def canonical_chunks(value):
    """Canonical JSON bytes; hash-checked JSONL rows avoid per-field Python work."""
    scalar = lambda v:json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    if isinstance(value,dict):
        if not any(isinstance(v,(dict,list)) for v in value.values()):
            yield scalar(value); return
        yield b'{'
        for index,key in enumerate(sorted(value)):
            if index: yield b','
            yield scalar(key); yield b':'
            yield from canonical_chunks(value[key])
        yield b'}'
    elif isinstance(value,list):
        yield b'['
        items=value.canonical_json_items() if hasattr(value,'canonical_json_items') else (canonical_chunks(v) for v in value)
        for index,item in enumerate(items):
            if index: yield b','
            yield from item
        yield b']'
    else:
        yield scalar(value)


def canonical_record(source, row, period, industry=None):
    if source == 'semas-stores':
        raw = {k: row.get(v) for k, v in SEMAS.items()} | {
            'ctprvnCd': '11', 'lon': row.get('longitude'), 'lat': row.get('latitude')}
        normalized = normalize_store(raw, industry, source_reference_month=period)
    else:
        fields = COMMON | (STORE_COUNTS | {'OPBIZ_RT': 'opening_rate', 'CLSBIZ_RT': 'closing_rate'}
                           if source == 'seoul-stores' else SALES)
        raw = {k: row.get(v) for k, v in fields.items()}
        normalized = (normalize_store_stats if source == 'seoul-stores' else normalize_sales)(raw, period)
        if source == 'seoul-stores' and any(normalized[f] is not None and int(normalized[f]) > 2147483647
                                            for f in STORE_COUNTS.values()):
            raise CollectionError('STORE_COUNT_OUT_OF_RANGE')
    if normalized != row:
        raise CollectionError('NONCANONICAL_RELEASE_RECORD')
    return normalized


def load_run(path):
    path = Path(path)
    manifest = json.loads((path / 'manifest.json').read_text(), object_pairs_hook=unique_object)
    source, scope = manifest.get('source'), manifest.get('scope', {})
    if (source not in TABLES or manifest.get('status') != 'COLLECTED_UNPUBLISHED'
            or manifest.get('complete') is not True or manifest.get('published') is not False
            or manifest.get('mode') != 'collect' or manifest.get('normalizer_version') not in (1, 2)):
        raise CollectionError('INCOMPLETE_API_RUN')
    if source == 'semas-stores':
        if scope.get('region') != '11' or scope.get('industry') not in ('I21201', 'ALL_SOURCE_INDUSTRIES'):
            raise CollectionError('RELEASE_SCOPE_MISMATCH')
        periods=manifest.get('source_periods', [])
        if len(periods)!=1: raise CollectionError('RELEASE_PERIOD_MISMATCH')
        period=reference_month(periods[0])
    else:
        if scope.get('region')!='SEOUL' or scope.get('industry')!='ALL_SOURCE_INDUSTRIES':
            raise CollectionError('RELEASE_SCOPE_MISMATCH')
        period=quarter(scope.get('quarter'))
        if manifest.get('source_periods') != [period]: raise CollectionError('RELEASE_PERIOD_MISMATCH')
    pages=manifest.get('pages', [])
    if not pages or manifest.get('page_count')!=len(pages): raise CollectionError('RELEASE_PAGE_MISMATCH')
    for n, page in enumerate(pages, 1):
        if page.get('file')!=f'pages/{n:06d}.json': raise CollectionError('RELEASE_PAGE_MISMATCH')
        raw=path/page['file']
        if raw.is_symlink() or file_sha(raw)!=page.get('sha256'): raise CollectionError('RAW_SHA_MISMATCH')
    normalized=path/'normalized.jsonl'
    if normalized.is_symlink() or file_sha(normalized)!=manifest.get('normalized_sha256'):
        raise CollectionError('NORMALIZED_SHA_MISMATCH')
    records=[]; keys=set()
    with normalized.open() as stream:
        for line in stream:
            row=json.loads(line, object_pairs_hook=unique_object)
            canonical_record(source,row,period,'I21201' if scope.get('industry')=='I21201' else None)
            key=row['source_store_id'] if source=='semas-stores' else (row['quarter_code'],row['dong_code'],row['source_industry_code'])
            if key in keys: raise CollectionError('DUPLICATE_RELEASE_KEY')
            keys.add(key); records.append(row)
    if not records or any(type(manifest.get(k)) is not int or manifest[k]!=len(records)
                          for k in ('received_count','declared_count','unique_key_count')):
        raise CollectionError('RELEASE_COUNT_MISMATCH')
    if sum(p.get('received_count',-1) for p in pages)!=len(records): raise CollectionError('RELEASE_COUNT_MISMATCH')
    collection_manifest=manifest
    if 'replay_of' in scope:
        original=scope['replay_of']
        if not isinstance(original,str) or not re.fullmatch('[A-Za-z0-9_-]+',original):
            raise CollectionError('INVALID_REPLAY_PROVENANCE')
        collection_manifest=json.loads((path.parent/original/'manifest.json').read_text(),object_pairs_hook=unique_object)
        if (collection_manifest.get('status')!='COLLECTED_UNPUBLISHED' or collection_manifest.get('complete') is not True
                or collection_manifest.get('source')!=source or collection_manifest.get('pages')!=pages
                or collection_manifest.get('source_periods')!=manifest.get('source_periods')
                or 'replay_of' in collection_manifest.get('scope',{})):
            raise CollectionError('INVALID_REPLAY_PROVENANCE')
    finished=datetime.fromisoformat(collection_manifest['finished_at'])
    if finished.tzinfo is None: raise CollectionError('INVALID_COLLECTION_TIME')
    return dict(source=source, period=period, scope=scope, normalizer_version=manifest['normalizer_version'],
                normalized_sha256=manifest['normalized_sha256'], pages=pages,
                collected_at=finished.astimezone(timezone.utc).isoformat(), records=EvidenceRecords(records,path))


def prepare_release(paths):
    runs=sorted((load_run(p) for p in paths), key=lambda r:(r['source'],r['period']))
    scopes=[(r['source'],r['period']) for r in runs]
    if len(scopes)!=len(set(scopes)): raise CollectionError('DUPLICATE_RELEASE_SCOPE')
    stats={r['period'] for r in runs if r['source']=='seoul-stores'}
    sales={r['period'] for r in runs if r['source']=='seoul-sales'}
    stores=[r for r in runs if r['source']=='semas-stores']
    if not stats or stats!=sales or len(stores)!=1: raise CollectionError('INCOMPLETE_RELEASE_SOURCES')
    result=dict(contract_version=1, text_policy=TEXT_POLICY, quarters=sorted(stats),
                store_reference_month=stores[0]['period'], store_scope=stores[0]['scope']['industry'],
                collected_at=max(r['collected_at'] for r in runs), runs=runs)
    release=result | {'release_id':digest(result)}
    verify_release(release)
    return release


def verify_release(release):
    content={k:v for k,v in release.items() if k!='release_id'}
    if not re.fullmatch('[0-9a-f]{64}', release.get('release_id','')) or digest(content)!=release['release_id']:
        raise CollectionError('RELEASE_DIGEST_MISMATCH')
    if (release.get('contract_version')!=1 or release.get('text_policy')!=TEXT_POLICY
            or any(r.get('normalizer_version') not in (1,2) or 'quality' in r for r in release['runs'])
            or any(k in release for k in ('quality_policy','candidate_status'))):
        raise CollectionError('RELEASE_CONTRACT_MISMATCH')
    verify_record_layout(release)


def verify_record_layout(release):
    """Shared numeric/key/layout checks; not a release or DB authorization gate."""
    stats=set(); sales=set(); stores=[]; scopes=set()
    for run in release['runs']:
        source=run['source']; scope=run['scope']; period=run['period']
        if source not in TABLES or (source,period) in scopes or not run['records']:
            raise CollectionError('RELEASE_LAYOUT_MISMATCH')
        scopes.add((source,period))
        if source=='semas-stores':
            if scope.get('region')!='11' or scope.get('industry') not in ('I21201','ALL_SOURCE_INDUSTRIES'):
                raise CollectionError('RELEASE_LAYOUT_MISMATCH')
            reference_month(period); stores.append(run)
        else:
            quarter(period)
            if scope.get('quarter')!=period or scope.get('region')!='SEOUL' or scope.get('industry')!='ALL_SOURCE_INDUSTRIES':
                raise CollectionError('RELEASE_LAYOUT_MISMATCH')
            (stats if source=='seoul-stores' else sales).add(period)
        h=hashlib.sha256(); keys=set(); names={}
        for row in run['records']:
            canonical_record(source,row,period,'I21201' if scope['industry']=='I21201' else None)
            key=row['source_store_id'] if source=='semas-stores' else (row['quarter_code'],row['dong_code'],row['source_industry_code'])
            if key in keys: raise CollectionError('DUPLICATE_RELEASE_KEY')
            if source!='semas-stores':
                dong=(row['quarter_code'],row['dong_code'])
                if dong in names and names[dong]!=row['dong_name']:
                    raise CollectionError('CONFLICTING_DONG_NAME')
                names[dong]=row['dong_name']
            keys.add(key); h.update(encoded(row))
        if h.hexdigest()!=run['normalized_sha256']: raise CollectionError('NORMALIZED_SHA_MISMATCH')
    if (not stats or stats!=sales or release['quarters']!=sorted(stats) or len(stores)!=1
            or release['store_reference_month']!=stores[0]['period'] or release['store_scope']!=stores[0]['scope']['industry']
            or release['collected_at']!=max(r['collected_at'] for r in release['runs'])):
        raise CollectionError('RELEASE_LAYOUT_MISMATCH')


def connection_ready(conn):
    # Never accept an implicit pre-existing transaction or claim a savepoint committed the release.
    if conn.autocommit is not True or conn.info.transaction_status != 0:
        raise CollectionError('IDLE_AUTOCOMMIT_CONNECTION_REQUIRED')


def stage_release(conn, release, *, verify_identity):
    """Only an authorized adapter supplies conn + a same-connection identity verifier.

    No connect(), migration, legacy DELETE/TRUNCATE or current-pointer change occurs here.
    """
    verify_release(release)
    return _stage_verified_release(conn, release, verify_identity=verify_identity)


def _stage_verified_release(conn, release, *, verify_identity, metadata=None, before_seal=None):
    """Shared COPY transaction; callers must enforce their separate contract gate."""
    connection_ready(conn)
    from psycopg.types.json import Jsonb
    metadata=metadata if metadata is not None else {k:v for k,v in release.items() if k!='runs'} | {
        'runs':[{k:v for k,v in r.items() if k!='records'} | {'row_count':len(r['records'])} for r in release['runs']]}
    version=release['release_id']
    with conn.transaction():
        verify_identity(conn)
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout='5s'")
            cur.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(version,))
            cur.execute('SELECT status, metadata FROM api_releases WHERE release_id=%s',(version,))
            existing=cur.fetchone()
            if existing:
                if existing != ('READY',metadata): raise CollectionError('EXISTING_RELEASE_CONFLICT')
                return False
            cur.execute('INSERT INTO api_releases(release_id,metadata,status) VALUES (%s,%s,\'PREPARING\')',
                        (version,Jsonb(metadata)))
            for run in release['runs']:
                source=run['source']; table=TABLES[source]
                rows=run['records']
                fields=[k for k in rows[0] if k not in ('industry_code','source_reference_month')]
                columns=fields+['industry_id','release_id']
                # Column names are normalized by canonical_record, not supplied as SQL by users.
                cur.execute("SELECT im.source_code, i.id, i.code FROM industry_mappings im JOIN industries i ON i.id=im.industry_id WHERE im.source=%s",
                            ('SEMAS' if source=='semas-stores' else 'SEOUL',))
                mapping={code:(identifier,internal) for code,identifier,internal in cur.fetchall()}
                with cur.copy(f"COPY {table} ({','.join(columns)}) FROM STDIN") as copy:
                    for row in rows:
                        code=row['source_small_category_code'] if source=='semas-stores' else row['source_industry_code']
                        identifier,internal=mapping.get(code,(None,None))
                        if internal!=row['industry_code']: raise CollectionError('RELEASE_MAPPING_MISMATCH')
                        copy.write_row(tuple(row[k] for k in fields)+(identifier,version))
            for source,table in TABLES.items():
                expected=sum(len(r['records']) for r in release['runs'] if r['source']==source)
                cur.execute(f'SELECT count(*) FROM {table} WHERE release_id=%s',(version,))
                if cur.fetchone()!=(expected,): raise CollectionError('STAGED_COUNT_MISMATCH')
            if before_seal is not None:
                before_seal(cur, release)
            cur.execute("UPDATE api_releases SET status='READY' WHERE release_id=%s",(version,))
    return True


def publish_release(conn, version, *, expected_current, verify_identity):
    """Explicit compare-and-set publication; previous releases remain immutable and retained."""
    if not re.fullmatch('[0-9a-f]{64}',version or ''): raise CollectionError('INVALID_RELEASE_ID')
    connection_ready(conn)
    with conn.transaction():
        verify_identity(conn)
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout='5s'")
            cur.execute('SELECT release_id FROM api_current_release WHERE singleton=true FOR UPDATE')
            current=cur.fetchone()
            if current is None: raise CollectionError('PUBLICATION_POINTER_MISSING')
            cur.execute('SELECT status FROM api_releases WHERE release_id=%s',(version,))
            if cur.fetchone()!=('READY',): raise CollectionError('RELEASE_NOT_READY')
            if current[0]==version: return False
            if current[0]!=expected_current: raise CollectionError('CURRENT_RELEASE_CHANGED')
            if current[0] is not None:
                cur.execute("SELECT metadata->'quarters' @> (SELECT metadata->'quarters' FROM api_releases WHERE release_id=%s) FROM api_releases WHERE release_id=%s",
                            (current[0],version))
                if cur.fetchone()!=(True,): raise CollectionError('RELEASE_PERIOD_LOSS')
                cur.execute("SELECT (SELECT metadata->>'store_scope' FROM api_releases WHERE release_id=%s) <> 'ALL_SOURCE_INDUSTRIES' OR metadata->>'store_scope'='ALL_SOURCE_INDUSTRIES' FROM api_releases WHERE release_id=%s",
                            (current[0],version))
                if cur.fetchone()!=(True,): raise CollectionError('RELEASE_SCOPE_NARROWING')
            cur.execute('UPDATE api_current_release SET release_id=%s WHERE singleton=true',(version,))
    return True


def main(argv=None):
    parser=argparse.ArgumentParser(description='검증된 API run들을 private release 파일로 준비합니다. DB 접속 없음.')
    parser.add_argument('--run',action='append',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args(argv)
    try:
        output=private_parent(args.output)
        release=prepare_release(args.run)
        with create_file(output) as target: target.write(encoded(release))
        print(json.dumps(dict(release_id=release['release_id'],quarters=release['quarters'],
                              store_reference_month=release['store_reference_month'],published=False)))
        return 0
    except CollectionError as error: print('ERROR: '+str(error),file=sys.stderr)
    except Exception: print('ERROR: RELEASE_PREPARATION_FAILED',file=sys.stderr)
    return 2


if __name__=='__main__': sys.exit(main())
