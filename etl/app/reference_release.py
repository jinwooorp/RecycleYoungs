"""Immutable current-reference snapshots, separate from quarterly cafe releases."""
import hashlib
from pathlib import Path
import re
from datetime import datetime
from psycopg.types.json import Jsonb

from .api_records import CollectionError
from .seoul_reference import SOURCES, read_reference


def require(ok, code):
    if not ok: raise CollectionError(code)


def catalog_version(snapshots):
    require(set(snapshots) == set(SOURCES) and all(isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) for v in snapshots.values()),
            'REFERENCE_SOURCE_SET_REQUIRED')
    canonical = 'SEOUL_CURRENT_REFERENCE_V1\n' + '\n'.join(source + ':' + snapshots[source] for source in sorted(snapshots))
    return hashlib.sha256(canonical.encode()).hexdigest()


def prepare_catalog(paths):
    require(set(paths) == set(SOURCES), 'REFERENCE_SOURCE_SET_REQUIRED')
    sources = {}
    for source in sorted(paths):
        checked = read_reference(paths[source])
        require(checked['manifest']['source'] == source and checked['records'], 'REFERENCE_SOURCE_MISMATCH_OR_EMPTY')
        sources[source] = checked | dict(artifact_ref=str(Path(paths[source])))
    return dict(catalog_id=catalog_version({s: v['manifest']['snapshot_id'] for s, v in sources.items()}), sources=sources)


def verify_catalog(catalog):
    require(set(catalog) == {'catalog_id', 'sources'} and set(catalog['sources']) == set(SOURCES), 'REFERENCE_SOURCE_SET_REQUIRED')
    fresh = prepare_catalog({source: value['artifact_ref'] for source, value in catalog['sources'].items()})
    require(fresh == catalog, 'REFERENCE_PREPARED_CHANGED')
    return fresh


def require_expected_catalog(current, expected):
    require(current == expected, 'REFERENCE_PUBLICATION_CONFLICT')


def require_catalog_successor(previous, candidate):
    """Automatic refresh cannot silently retire records or publish older data.

    Legitimate provider deletions need a new reviewed policy/explicit transition;
    lowering a count is never treated as an ordinary complete refresh.
    """
    for source, old in previous['sources'].items():
        fresh=candidate['sources'][source]
        require({r['reference_id'] for r in old['records']} <= {r['reference_id'] for r in fresh['records']},
                'REFERENCE_RECORD_LOSS_REQUIRES_REVIEW')
        require(fresh['manifest']['received_count']>=old['manifest']['received_count'], 'REFERENCE_RAW_ROW_LOSS_REQUIRES_REVIEW')
        before=datetime.fromisoformat(old['manifest']['collected_at']);after=datetime.fromisoformat(fresh['manifest']['collected_at'])
        require(before.tzinfo is not None and after.tzinfo is not None and after>=before, 'REFERENCE_TIME_REGRESSION')


def current_snapshots(conn):
    return dict(conn.execute('SELECT source_id,snapshot_id FROM api_reference_current ORDER BY source_id').fetchall())


def verify_registered_records(actual, records):
    expected={r['reference_id']:(r['attributes'],r['attribute_states'],r['metrics'],r.get('source_row_count',1)) for r in records}
    # PostgreSQL's database collation can order punctuation differently from
    # Python. Keys and complete values are compared independently of locale.
    received={r[0]:tuple(r[1:]) for r in actual}
    require(len(actual)==len(received)==len(records)==len(expected) and received==expected,
            'REFERENCE_REGISTERED_RECORDS_CHANGED')


def verify_registered_snapshots(conn, *, verify_identity):
    require(callable(verify_identity),'REFERENCE_IDENTITY_REQUIRED');verify_identity(conn)
    if not enabled(conn):return []
    identities=[]
    for identity,source,descriptor,path,count,raw,status in conn.execute(
            'SELECT snapshot_id,source_id,descriptor,artifact_ref,record_count,raw_row_count,status FROM api_reference_snapshots ORDER BY snapshot_id').fetchall():
        route=Path(path)
        require(route.is_absolute() and route.is_relative_to('/api-data/reference-runs') and '..' not in route.parts
                and not any(p.is_symlink() for p in [route,*route.parents]),'REFERENCE_ARTIFACT_ROUTE_REJECTED')
        prepared=read_reference(route)
        require(prepared['manifest']==descriptor and descriptor['source']==source and descriptor['snapshot_id']==identity
                and status=='READY' and count==len(prepared['records']) and raw==descriptor['received_count'],
                'REFERENCE_REGISTERED_SNAPSHOT_CONFLICT')
        actual=conn.execute('SELECT record_id,attributes,attribute_states,metrics,source_row_count FROM api_reference_records WHERE snapshot_id=%s',(identity,)).fetchall()
        verify_registered_records(actual,prepared['records']);identities.append(identity)
    verify_identity(conn)
    return identities


def enabled(conn):
    return conn.execute("SELECT to_regclass('public.api_reference_current') IS NOT NULL").fetchone() == (True,)


def registered_catalog(conn):
    rows = conn.execute('SELECT c.source_id,c.snapshot_id,s.artifact_ref FROM api_reference_current c JOIN api_reference_snapshots s ON s.snapshot_id=c.snapshot_id ORDER BY c.source_id').fetchall()
    if not rows:
        return {}
    require({row[0] for row in rows} == set(SOURCES), 'REFERENCE_SOURCE_SET_REQUIRED')
    prepared = prepare_catalog({row[0]: row[2] for row in rows})
    actual = {row[0]: row[1] for row in rows}
    require(actual == {s: v['manifest']['snapshot_id'] for s, v in prepared['sources'].items()}, 'REFERENCE_REGISTERED_CATALOG_CHANGED')
    return actual


def collect_catalog(output, key, *, client=None, allow_http=False):
    from .seoul_reference import collect_reference
    from .api_config import private_parent
    output = private_parent(Path(output),create=True); output.mkdir(mode=0o700)
    paths = {}
    for source in sorted(SOURCES):
        paths[source] = output / source
        collect_reference(paths[source], source, key, client=client, allow_http=allow_http)
    return prepare_catalog(paths)


def grant_writer(conn):
    """Fresh migration can precede role creation; grant the same narrow rights."""
    conn.execute('GRANT INSERT ON api_reference_snapshots,api_reference_records,api_reference_current TO api_writer')
    conn.execute('GRANT UPDATE(status) ON api_reference_snapshots TO api_writer')
    conn.execute('GRANT UPDATE(snapshot_id) ON api_reference_current TO api_writer')


def stage_catalog(conn, catalog, *, verify_identity):
    require(callable(verify_identity), 'REFERENCE_IDENTITY_REQUIRED')
    catalog = verify_catalog(catalog)
    verify_identity(conn)
    for source, prepared in catalog['sources'].items():
        path = Path(prepared['artifact_ref'])
        require(path.is_absolute() and path.is_relative_to('/api-data/reference-runs') and '..' not in path.parts
                and not any(p.is_symlink() for p in [path, *path.parents]), 'REFERENCE_ARTIFACT_ROUTE_REJECTED')
        manifest = prepared['manifest']; rows = prepared['records']; identity = manifest['snapshot_id']
        with conn.transaction():
            verify_identity(conn)
            existing = conn.execute('SELECT descriptor,artifact_ref,status FROM api_reference_snapshots WHERE snapshot_id=%s', (identity,)).fetchone()
            if existing is not None:
                require(existing == (manifest, str(path), 'READY'), 'REFERENCE_REGISTERED_SNAPSHOT_CONFLICT')
                actual = conn.execute('SELECT record_id,attributes,attribute_states,metrics,source_row_count FROM api_reference_records WHERE snapshot_id=%s ORDER BY record_id', (identity,)).fetchall()
                verify_registered_records(actual,rows)
                continue
            conn.execute('INSERT INTO api_reference_snapshots(snapshot_id,source_id,descriptor,artifact_ref,record_count,raw_row_count,status) VALUES(%s,%s,%s,%s,%s,%s,\'PREPARING\')',
                         (identity, source, Jsonb(manifest), str(path), len(rows), manifest['received_count']))
            with conn.cursor() as cursor:
                with cursor.copy('COPY api_reference_records(snapshot_id,record_id,attributes,attribute_states,metrics,source_row_count) FROM STDIN') as copy:
                    for row in rows:
                        copy.write_row((identity, row['reference_id'], Jsonb(row['attributes']), Jsonb(row['attribute_states']),
                                        Jsonb(row['metrics']), row.get('source_row_count', 1)))
            verify_identity(conn)
            conn.execute("UPDATE api_reference_snapshots SET status='READY' WHERE snapshot_id=%s", (identity,))
    return catalog['catalog_id']


def publish_catalog(conn, catalog, *, expected, verify_identity):
    require(callable(verify_identity), 'REFERENCE_IDENTITY_REQUIRED')
    catalog = verify_catalog(catalog)
    with conn.transaction():
        verify_identity(conn)
        require(conn.execute('SELECT pg_try_advisory_xact_lock(20261024,63)').fetchone() == (True,), 'REFERENCE_PUBLICATION_BUSY')
        # The common worker advisory lock excludes other normal publications;
        # row locking and an exact-old comparison reject stale direct callers.
        actual = dict(conn.execute('SELECT source_id,snapshot_id FROM api_reference_current ORDER BY source_id FOR UPDATE').fetchall())
        require_expected_catalog(actual, expected)
        wanted = {source: value['manifest']['snapshot_id'] for source, value in catalog['sources'].items()}
        if actual == wanted:
            return False
        if actual:
            require(set(actual)==set(SOURCES), 'REFERENCE_SOURCE_SET_REQUIRED')
            paths={source:conn.execute('SELECT artifact_ref FROM api_reference_snapshots WHERE snapshot_id=%s AND source_id=%s AND status=\'READY\'',(identity,source)).fetchone()
                   for source,identity in actual.items()}
            require(all(row is not None for row in paths.values()), 'REFERENCE_SNAPSHOT_NOT_READY')
            previous=prepare_catalog({source:row[0] for source,row in paths.items()})
            require({s:v['manifest']['snapshot_id'] for s,v in previous['sources'].items()}==actual, 'REFERENCE_REGISTERED_CATALOG_CHANGED')
            require_catalog_successor(previous,catalog)
        for source, identity in wanted.items():
            row = conn.execute('SELECT source_id,descriptor,status FROM api_reference_snapshots WHERE snapshot_id=%s', (identity,)).fetchone()
            require(row == (source, catalog['sources'][source]['manifest'], 'READY'), 'REFERENCE_SNAPSHOT_NOT_READY')
        verify_identity(conn)
        for source, identity in wanted.items():
            conn.execute('INSERT INTO api_reference_current(source_id,snapshot_id) VALUES(%s,%s) ON CONFLICT(source_id) DO UPDATE SET snapshot_id=EXCLUDED.snapshot_id', (source, identity))
    return True
