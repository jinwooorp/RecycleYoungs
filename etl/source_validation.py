"""Pure preservation comparison; no connections, file reads, writes or execution.

validate_preservation consumes two JSON-like evidence bundles:
  snapshot: existing physical/raw digest, columns, sequence state and history
  audit: ids/nulls/points, full catalog/ACL, sequence definitions, full history
  outcome: CONFIRMED or UNKNOWN (missing outcome is insufficient evidence)
  v3_rows: required for V3; industries {id,code}, full four-column mappings,
           stores {id,source_store_id,source_small_category_code,industry_id}

audit.projections.v3 must be control.digest(v3_rows) from the same collection.
Projected rows are complete (not samples); raw stores digest covers every
column except industry_id, including IDs, NULL and POINT NDR/SRID. Digest
formats for physical/points must be identical before and after. audit.ids is
SHA-256 of ascending integer IDs, each canonical JSON value prefixed by its
8-byte unsigned big-endian byte length (rows is the number of IDs).

Catalog tables contain columns (including type/nullability/default/identity/
collation), constraints, indexes, triggers, owner and rls. Constraints/indexes/
triggers are ordered lists of complete nonempty SQL definition strings.
ACL includes database,
schema, default_acl, roles and objects (table:/sequence:/function: keys).
Schema has name/owner; extensions have version/owner; functions have
definition/owner. Database/schema ACL have owner/acl (SQL NULL ACL is valid).
Roles have login/superuser/createdb/createrole/inherit/replication/bypassrls,
connection_limit, valid_until and memberships. Memberships include role,
grantor and admin/inherit/set options; default ACL rows include owner/schema/
object_type/acl. Empty lists attest no entries, unlike missing/unknown data.
Sequence definitions include owner and owned_by as well as all numeric bounds.
Full history includes installed_by/on/execution_time, unlike old snapshots.
This protected-source profile requires V1 BASELINE with NULL checksum and
the default Flyway 12.4.0 script/description marker. The description is
recorded in deaed745:docs/development-db-8c2a-preflight.md; Flyway's
Database baseline statement uses that description as the script too.
These are independent profile requirements, never inferred from matching
before/after rows. Custom/unverified markers are rejected. Observed actor,
timestamp and duration are preserved, not fixed to a historical snapshot.

V2 requires an independently reviewed v2_additions reference (columns,
catalog_tables/catalog_functions, sequence_definitions, acl_objects). Only
the exact V2 object names can be added; reference values never come from after.
V2/V3 also require the expected migration_actor. The caller must establish
reference provenance and collection completeness; this module cannot attest
that supplied hashes/metadata came from a real DB, authorize a run, or prove
rollback. Existing legacy snapshots alone are intentionally insufficient.
"""
from copy import deepcopy
from dataclasses import dataclass, field
import hashlib
import math
import re

if __package__:
    from .control import digest, encode
else:
    from control import digest, encode

V1_TABLES = ('industries', 'industry_mappings', 'commercial_areas', 'store_stats_dong',
             'sales_dong', 'sales_commercial_area', 'stores')
SPATIAL_TABLES = ('spatial_dataset_versions', 'admin_dong_boundaries', 'commercial_area_boundaries')
V2_FUNCTIONS = ('guard_spatial_boundary_write', 'guard_spatial_dataset_version')
HISTORY_FIELDS = {'installed_rank', 'version', 'description', 'type', 'script', 'checksum',
                  'installed_by', 'installed_on', 'execution_time', 'success'}
SNAPSHOT_HISTORY_FIELDS = HISTORY_FIELDS - {'installed_by', 'installed_on', 'execution_time'}
SEQUENCE_FIELDS = {'data_type', 'start_value', 'min_value', 'max_value', 'increment_by',
                   'cache_size', 'cycle', 'owner', 'owned_by'}
EMPTY = {'rows': 0, 'sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}
V1_BASELINE = {'version': '1', 'type': 'BASELINE', 'checksum': None,
               'script': '<< Flyway Baseline >>', 'description': '<< Flyway Baseline >>'}
SQL = {'V2': ('2', 'V2__spatial_schema.sql', 'spatial schema', 237765795),
       'V3': ('3', 'V3__semas_cafe_mapping_and_store_backfill.sql',
              'semas cafe mapping and store backfill', 617267104)}


@dataclass(frozen=True)
class ValidationResult:
    status: str
    issues: tuple[str, ...] = ()
    verified_checks: tuple[str, ...] = ()
    available_evidence: tuple[str, ...] = ()
    expected_changes: dict = field(default_factory=dict)

    @property
    def passed(self):
        return self.status == 'PASS'

    def __bool__(self):
        return self.passed


class _Rejected(Exception):
    def __init__(self, status, path):
        self.status, self.path = status, path


def _stop(path, status='UNEXPECTED_CHANGE'):
    raise _Rejected(status, path)


def _need(value, keys, path):
    if not isinstance(value, dict) or not set(keys) <= value.keys():
        _stop(path, 'INSUFFICIENT_EVIDENCE')


def _integer(value, path, minimum=None):
    if type(value) is not int or (minimum is not None and value < minimum):
        _stop(path, 'INDETERMINATE')


def _same(a, b, path):
    # Canonical bytes also distinguish False from 0 and NULL from empty values.
    if encode(a) != encode(b):
        _stop(path)


def _json_tree(value):
    if isinstance(value, dict):
        if any(not isinstance(k, str) for k in value):
            _stop('non-string evidence key', 'INDETERMINATE')
        for v in value.values():
            _json_tree(v)
    elif isinstance(value, list):
        for v in value:
            _json_tree(v)
    elif value is not None and type(value) not in (str, int, bool, float):
        _stop('non-JSON evidence', 'INDETERMINATE')
    elif isinstance(value, float) and not math.isfinite(value):
        _stop('non-finite evidence', 'INDETERMINATE')


def _digest_record(value, path, count):
    _need(value, ('rows', 'sha256'), path)
    _integer(value['rows'], path + '.rows', 0)
    if value['rows'] != count or not isinstance(value['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', value['sha256']):
        _stop(path, 'INDETERMINATE')
    if count == 0 and value['sha256'] != EMPTY['sha256']:
        _stop(path, 'INDETERMINATE')


def _column_names(cols, path, full=False):
    if not isinstance(cols, list) or not cols:
        _stop(path, 'INSUFFICIENT_EVIDENCE')
    required = {'column_name', 'data_type', 'udt_name'}
    if full:
        required |= {'type', 'nullable', 'default', 'identity', 'collation'}
    for col in cols:
        _need(col, required, path)
        if not all(isinstance(col[k], str) and col[k] for k in ('column_name', 'data_type', 'udt_name')):
            _stop(path, 'INDETERMINATE')
        if full:
            if type(col['nullable']) is not bool or not isinstance(col['type'], str) or not col['type']:
                _stop(path, 'INDETERMINATE')
            if col['identity'] not in ('', 'a', 'd') or any(col[k] is not None and not isinstance(col[k], str) for k in ('default', 'collation')):
                _stop(path, 'INDETERMINATE')
    names = [c['column_name'] for c in cols]
    if len(names) != len(set(names)):
        _stop(path, 'INDETERMINATE')
    return names


def _table_definition(value, path):
    _need(value, ('columns', 'constraints', 'indexes', 'triggers', 'owner', 'rls'), path)
    _column_names(value['columns'], path + '.columns', True)
    if not all(isinstance(value[k], list) for k in ('constraints', 'indexes', 'triggers')) or not isinstance(value['owner'], str) or not value['owner'] or type(value['rls']) is not bool:
        _stop(path, 'INDETERMINATE')
    if any(not isinstance(item, str) or not item.strip()
           for key in ('constraints', 'indexes', 'triggers') for item in value[key]):
        _stop(path + '.object definitions', 'INSUFFICIENT_EVIDENCE')


def _history(value, path):
    if not isinstance(value, list) or not value:
        _stop(path, 'INSUFFICIENT_EVIDENCE')
    versions = []
    for index, row in enumerate(value, 1):
        _need(row, HISTORY_FIELDS, path)
        _integer(row['installed_rank'], path, 1)
        _integer(row['execution_time'], path, 0)
        if row['installed_rank'] != index or row['success'] is not True:
            _stop(path)
        if not all(isinstance(row[k], str) and row[k] for k in
                   ('version', 'description', 'type', 'script', 'installed_by', 'installed_on')):
            _stop(path, 'INDETERMINATE')
        if row['checksum'] is not None:
            _integer(row['checksum'], path)
        if row['version'] == '1':
            _same({key: row[key] for key in V1_BASELINE}, V1_BASELINE, path + '.V1 baseline profile')
        if row['type'] == 'BASELINE' and (row['version'] != '1' or row['checksum'] is not None):
            _stop(path + '.baseline')
        if row['type'] not in ('BASELINE', 'SQL') or (row['type'] == 'SQL' and row['checksum'] is None):
            _stop(path + '.migration type/checksum')
        if row['version'] in ('2', '3'):
            version, script, description, checksum = SQL['V' + row['version']]
            _same([row[k] for k in ('version', 'script', 'description', 'checksum', 'type')],
                  [version, script, description, checksum, 'SQL'], path + '.migration profile')
        versions.append(row['version'])
    if versions not in (['1'], ['1', '2'], ['1', '2', '3']):
        _stop(path + '.versions')


def _sequence_definition(value, path):
    _need(value, SEQUENCE_FIELDS, path)
    for key in ('start_value', 'min_value', 'max_value', 'increment_by', 'cache_size'):
        _integer(value[key], path + '.' + key)
    if value['min_value'] > value['start_value'] or value['start_value'] > value['max_value'] or value['increment_by'] == 0 or value['cache_size'] < 1 or type(value['cycle']) is not bool:
        _stop(path, 'INDETERMINATE')
    if not all(isinstance(value[k], str) and value[k] for k in ('data_type', 'owner', 'owned_by')):
        _stop(path, 'INDETERMINATE')
    if value['data_type'] not in ('smallint', 'integer', 'bigint'):
        _stop(path + '.data_type', 'INDETERMINATE')


def _named_metadata(value, fields, path):
    _need(value, fields, path)
    if any(not isinstance(value[k], str) or not value[k] for k in fields):
        _stop(path, 'INSUFFICIENT_EVIDENCE')


def _acl_value(value, path):
    # SQL NULL relacl means default ACL, not a missing owner/object definition.
    if value is not None and (not isinstance(value, list) or any(not isinstance(v, str) for v in value)):
        _stop(path, 'INDETERMINATE')


def _acl_metadata(acl, path):
    for key in ('database', 'schema'):
        _need(acl[key], ('owner', 'acl'), path + '.' + key)
        _named_metadata(acl[key], ('owner',), path + '.' + key)
        _acl_value(acl[key]['acl'], path + '.' + key)
    if not isinstance(acl['default_acl'], list):
        _stop(path + '.default_acl', 'INSUFFICIENT_EVIDENCE')
    for row in acl['default_acl']:
        _need(row, ('owner', 'schema', 'object_type', 'acl'), path + '.default_acl')
        _named_metadata(row, ('owner', 'object_type'), path + '.default_acl')
        if row['schema'] is not None and not isinstance(row['schema'], str):
            _stop(path + '.default_acl.schema', 'INDETERMINATE')
        _acl_value(row['acl'], path + '.default_acl')
    if not isinstance(acl['roles'], dict) or not acl['roles']:
        _stop(path + '.roles', 'INSUFFICIENT_EVIDENCE')
    flags = ('login', 'superuser', 'createdb', 'createrole', 'inherit', 'replication', 'bypassrls')
    for role in acl['roles'].values():
        _need(role, flags + ('connection_limit', 'valid_until', 'memberships'), path + '.roles')
        if any(type(role[k]) is not bool for k in flags):
            _stop(path + '.role flags', 'INDETERMINATE')
        _integer(role['connection_limit'], path + '.role connection limit', -1)
        if role['valid_until'] is not None and not isinstance(role['valid_until'], str):
            _stop(path + '.role expiry', 'INDETERMINATE')
        if not isinstance(role['memberships'], list):
            _stop(path + '.memberships', 'INSUFFICIENT_EVIDENCE')
        for membership in role['memberships']:
            _named_metadata(membership, ('role', 'grantor'), path + '.membership')
            _need(membership, ('admin_option', 'inherit_option', 'set_option'), path + '.membership')
            if any(type(membership[k]) is not bool for k in ('admin_option', 'inherit_option', 'set_option')):
                _stop(path + '.membership options', 'INDETERMINATE')
    for acl_value in acl['objects'].values():
        _acl_value(acl_value, path + '.objects')


def _evidence(value, label):
    _need(value, ('snapshot', 'audit', 'outcome'), label)
    if value['outcome'] != 'CONFIRMED':
        _stop(label + '.outcome', 'INDETERMINATE')
    s, a = value['snapshot'], value['audit']
    _need(s, ('physical', 'raw', 'columns', 'sequences', 'history'), label + '.snapshot')
    _need(a, ('ids', 'nulls', 'points', 'catalog', 'acl', 'sequence_definitions', 'history_rows'), label + '.audit')
    _need(s['physical'], V1_TABLES, label + '.physical')
    tables = set(s['physical'])
    if not tables <= set(V1_TABLES + SPATIAL_TABLES):
        _stop(label + '.physical.tables')
    for block in (s['columns'], a['ids'], a['nulls']):
        if not isinstance(block, dict) or set(block) != tables:
            _stop(label + '.table evidence', 'INSUFFICIENT_EVIDENCE')
    _need(a['catalog'], ('tables', 'functions', 'extensions', 'schema'), label + '.catalog')
    _need(a['catalog']['tables'], tables | {'flyway_schema_history'}, label + '.catalog.tables')
    _need(a['catalog']['extensions'], ('postgis',), label + '.catalog.extensions')
    if not isinstance(a['catalog']['functions'], dict):
        _stop(label + '.catalog.functions', 'INSUFFICIENT_EVIDENCE')
    _named_metadata(a['catalog']['schema'], ('name', 'owner'), label + '.catalog.schema')
    for extension in a['catalog']['extensions'].values():
        _named_metadata(extension, ('version', 'owner'), label + '.catalog.extension')
    for function in a['catalog']['functions'].values():
        _named_metadata(function, ('definition', 'owner'), label + '.catalog.function')
    for name, definition in a['catalog']['tables'].items():
        _table_definition(definition, label + '.catalog.' + name)
    for table in tables:
        p = s['physical'][table]
        _need(p, ('rows', 'sha256'), label + '.physical.' + table)
        _integer(p['rows'], label + '.rows', 0)
        _digest_record(p, label + '.physical.' + table, p['rows'])
        _digest_record(a['ids'][table], label + '.ids.' + table, p['rows'])
        names = _column_names(s['columns'][table], label + '.columns.' + table)
        catalog_cols = a['catalog']['tables'][table]['columns']
        _same(names, [c['column_name'] for c in catalog_cols], label + '.column names')
        for col, full in zip(s['columns'][table], catalog_cols):
            for key, observed in col.items():
                if key not in full:
                    _stop(label + '.column details', 'INSUFFICIENT_EVIDENCE')
                _same(observed, full[key], label + '.column details')
        _need(a['nulls'][table], names, label + '.nulls.' + table)
        if set(a['nulls'][table]) != set(names):
            _stop(label + '.null field set')
        for count in a['nulls'][table].values():
            _integer(count, label + '.null count', 0)
            if count > p['rows']:
                _stop(label + '.null count', 'INDETERMINATE')
    _need(s['raw'], ('stores',), label + '.raw')
    _digest_record(s['raw']['stores'], label + '.raw.stores', s['physical']['stores']['rows'])
    _need(a['points'], ('stores', 'commercial_areas'), label + '.points')
    for table in ('stores', 'commercial_areas'):
        _digest_record(a['points'][table], label + '.points.' + table, s['physical'][table]['rows'])
    _need(s['sequences'], (t + '_id_seq' for t in tables), label + '.sequences')
    if not isinstance(a['sequence_definitions'], dict) or set(s['sequences']) != set(a['sequence_definitions']):
        _stop(label + '.sequence definitions', 'INSUFFICIENT_EVIDENCE')
    for name, state in s['sequences'].items():
        _need(state, ('last_value', 'is_called'), label + '.sequence state')
        _integer(state['last_value'], label + '.last_value')
        if type(state['is_called']) is not bool:
            _stop(label + '.is_called', 'INDETERMINATE')
        _sequence_definition(a['sequence_definitions'][name], label + '.sequence.' + name)
        definition = a['sequence_definitions'][name]
        if not definition['min_value'] <= state['last_value'] <= definition['max_value']:
            _stop(label + '.sequence bounds', 'INDETERMINATE')
    _need(a['acl'], ('database', 'schema', 'default_acl', 'roles', 'objects'), label + '.acl')
    objects = {'table:' + t for t in a['catalog']['tables']} | {'sequence:' + q for q in s['sequences']} | {'function:' + f for f in a['catalog']['functions']}
    _need(a['acl']['objects'], objects, label + '.object ACL')
    _acl_metadata(a['acl'], label + '.acl')
    _history(a['history_rows'], label + '.history')
    if len(a['history_rows']) >= 2:
        _need(s['physical'], SPATIAL_TABLES, label + '.V2 table evidence')
        _need(a['catalog']['functions'], V2_FUNCTIONS, label + '.V2 function evidence')
    if not isinstance(s['history'], list) or len(s['history']) != len(a['history_rows']):
        _stop(label + '.snapshot history', 'INSUFFICIENT_EVIDENCE')
    for partial, full in zip(s['history'], a['history_rows']):
        if not isinstance(partial, dict) or set(partial) not in (SNAPSHOT_HISTORY_FIELDS, HISTORY_FIELDS):
            _stop(label + '.snapshot history fields', 'INSUFFICIENT_EVIDENCE')
        _same(partial, {k: full[k] for k in partial}, label + '.history evidence consistency')


def _append_history(expected, after, stage, actor):
    if not isinstance(actor, str) or not actor:
        _stop('migration_actor', 'INSUFFICIENT_EVIDENCE')
    if actor not in expected['audit']['acl']['roles']:
        _stop('migration_actor role evidence', 'INSUFFICIENT_EVIDENCE')
    before_rows, rows = expected['audit']['history_rows'], after['audit']['history_rows']
    version, script, description, checksum = SQL[stage]
    if [r['version'] for r in before_rows] != (['1'] if stage == 'V2' else ['1', '2']):
        _stop('migration pre-history')
    if len(rows) != len(before_rows) + 1:
        _stop('history append count')
    _same(before_rows, rows[:-1], 'history existing full rows')
    row = rows[-1]
    wanted = {'version': version, 'script': script, 'description': description,
              'checksum': checksum, 'type': 'SQL', 'success': True,
              'installed_rank': len(before_rows) + 1, 'installed_by': actor}
    _same({k: row[k] for k in wanted}, wanted, 'history new migration row')
    expected['audit']['history_rows'] = deepcopy(rows)
    expected['snapshot']['history'] = deepcopy(after['snapshot']['history'])


def _v2_expected(expected, delta):
    _need(delta, ('columns', 'catalog_tables', 'catalog_functions', 'sequence_definitions', 'acl_objects'), 'v2_additions')
    sequences = {t + '_id_seq' for t in SPATIAL_TABLES}
    acl_names = {'table:' + t for t in SPATIAL_TABLES} | {'sequence:' + q for q in sequences} | {'function:' + f for f in V2_FUNCTIONS}
    for key, names in [('columns', set(SPATIAL_TABLES)), ('catalog_tables', set(SPATIAL_TABLES)),
                       ('catalog_functions', set(V2_FUNCTIONS)), ('sequence_definitions', sequences), ('acl_objects', acl_names)]:
        if not isinstance(delta[key], dict) or set(delta[key]) != names:
            _stop('v2_additions.' + key)
    s, a = expected['snapshot'], expected['audit']
    if any(t in s['physical'] or t in a['catalog']['tables'] for t in SPATIAL_TABLES) or any(f in a['catalog']['functions'] for f in V2_FUNCTIONS):
        _stop('V2 objects already present')
    for t in SPATIAL_TABLES:
        names = _column_names(delta['columns'][t], 'V2 columns')
        _table_definition(delta['catalog_tables'][t], 'V2 table')
        s['physical'][t] = deepcopy(EMPTY)
        s['columns'][t] = deepcopy(delta['columns'][t])
        a['ids'][t] = deepcopy(EMPTY)
        a['nulls'][t] = {c: 0 for c in names}
    for q, definition in delta['sequence_definitions'].items():
        if q in s['sequences']:
            _stop('V2 sequence collision')
        _sequence_definition(definition, 'V2 sequence')
        s['sequences'][q] = {'last_value': definition['start_value'], 'is_called': False}
    a['catalog']['tables'].update(deepcopy(delta['catalog_tables']))
    a['catalog']['functions'].update(deepcopy(delta['catalog_functions']))
    a['sequence_definitions'].update(deepcopy(delta['sequence_definitions']))
    a['acl']['objects'].update(deepcopy(delta['acl_objects']))


def _v3_rows(evidence, label):
    _need(evidence, ('v3_rows',), label + '.v3_rows')
    data = evidence['v3_rows']
    _need(data, ('industries', 'mappings', 'stores'), label + '.v3_rows')
    _need(evidence['audit'], ('projections',), label + '.projections')
    _need(evidence['audit']['projections'], ('v3',), label + '.projections')
    if evidence['audit']['projections']['v3'] != digest(data):
        _stop(label + '.projection digest', 'INDETERMINATE')
    fields = {'industries': {'id', 'code'}, 'mappings': {'id', 'source', 'source_code', 'industry_id'},
              'stores': {'id', 'source_store_id', 'source_small_category_code', 'industry_id'}}
    mapping_columns = {c['column_name'] for c in evidence['snapshot']['columns']['industry_mappings']}
    if mapping_columns != fields['mappings']:
        _stop(label + '.full mapping column coverage', 'INSUFFICIENT_EVIDENCE')
    for key, keys in fields.items():
        table = 'industry_mappings' if key == 'mappings' else key
        if not keys <= {c['column_name'] for c in evidence['snapshot']['columns'][table]}:
            _stop(label + '.projected column coverage', 'INSUFFICIENT_EVIDENCE')
        rows = data[key]
        if not isinstance(rows, list):
            _stop(label + '.' + key, 'INSUFFICIENT_EVIDENCE')
        if len(rows) != evidence['snapshot']['physical']['industry_mappings' if key == 'mappings' else key]['rows']:
            _stop(label + '.projection count', 'INDETERMINATE')
        seen = set()
        for row in rows:
            _need(row, keys, label + '.' + key)
            if set(row) != keys:
                _stop(label + '.projection fields', 'INDETERMINATE')
            _integer(row['id'], label + '.id', 1)
            if row['id'] in seen:
                _stop(label + '.duplicate ID', 'INDETERMINATE')
            seen.add(row['id'])
        sha = hashlib.sha256()
        for identifier in sorted(seen):
            raw = encode(identifier)
            sha.update(len(raw).to_bytes(8, 'big'))
            sha.update(raw)
        if encode({'rows': len(seen), 'sha256': sha.hexdigest()}) != encode(evidence['audit']['ids'][table]):
            _stop(label + '.projection ID digest', 'INDETERMINATE')
        for field_name in keys:
            if sum(r[field_name] is None for r in rows) != evidence['audit']['nulls'][table][field_name]:
                _stop(label + '.projection NULL counts', 'INDETERMINATE')
    ids = {r['id'] for r in data['industries']}
    codes = [r['code'] for r in data['industries']]
    sources = [(r['source'], r['source_code']) for r in data['mappings']]
    store_ids = [r['source_store_id'] for r in data['stores']]
    if any(not isinstance(c, str) or not c for c in codes + store_ids) or len(set(codes)) != len(codes) or len(set(sources)) != len(sources) or len(set(store_ids)) != len(store_ids):
        _stop(label + '.projection keys', 'INDETERMINATE')
    if any(not isinstance(v, str) or not v for pair in sources for v in pair) or any(r['source_small_category_code'] is not None and not isinstance(r['source_small_category_code'], str) for r in data['stores']):
        _stop(label + '.projection code types', 'INDETERMINATE')
    for row in data['mappings'] + data['stores']:
        if row['industry_id'] is not None:
            _integer(row['industry_id'], label + '.industry_id', 1)
            if row['industry_id'] not in ids:
                _stop(label + '.industry FK')
        elif 'source' in row:
            _stop(label + '.mapping NULL')
    return data


def _v3_expected(expected, after):
    before_rows, observed = _v3_rows(expected, 'before'), _v3_rows(after, 'after')
    cafes = [r['id'] for r in before_rows['industries'] if r['code'] == 'CAFE']
    if len(cafes) != 1:
        _stop('CAFE industry absent or ambiguous')
    cafe = cafes[0]
    existing = [r for r in before_rows['mappings'] if (r['source'], r['source_code']) == ('SEMAS', 'I21201')]
    if existing and existing[0]['industry_id'] != cafe:
        _stop('SEMAS mapping conflict')
    if any(r['source_small_category_code'] == 'I21201' and r['industry_id'] not in (None, cafe) for r in before_rows['stores']):
        _stop('non-CAFE store conflict')
    add = int(not existing)
    if add:
        name = 'industry_mappings_id_seq'
        state, definition = expected['snapshot']['sequences'][name], expected['audit']['sequence_definitions'][name]
        if definition['cache_size'] != 1 or definition['cycle']:
            _stop('mapping nextval not deterministic from supplied state', 'INDETERMINATE')
        next_id = state['last_value'] + definition['increment_by'] if state['is_called'] else state['last_value']
        if not definition['min_value'] <= next_id <= definition['max_value'] or next_id <= 0:
            _stop('mapping nextval outside bounds', 'INDETERMINATE')
        if any(r['id'] == next_id for r in before_rows['mappings']):
            _stop('mapping nextval collision')
        before_rows['mappings'].append({'id': next_id, 'source': 'SEMAS', 'source_code': 'I21201', 'industry_id': cafe})
        expected['snapshot']['sequences'][name] = {'last_value': next_id, 'is_called': True}
    backfilled = 0
    for row in before_rows['stores']:
        if row['source_small_category_code'] == 'I21201' and row['industry_id'] is None:
            row['industry_id'] = cafe
            backfilled += 1
    for key in before_rows:
        _same(sorted(before_rows[key], key=lambda r: r['id']), sorted(observed[key], key=lambda r: r['id']), 'V3 row projection.' + key)
    expected['audit']['projections']['v3'] = digest(before_rows)
    # The supplemental row projection plus raw stores hash exactly decomposes
    # permitted industry_id changes; no preimage of a SHA is reconstructed.
    if backfilled:
        expected['audit']['nulls']['stores']['industry_id'] -= backfilled
    for table, change in [('industry_mappings', add), ('stores', backfilled)]:
        if change:
            before_physical = expected['snapshot']['physical'][table]
            after_physical = after['snapshot']['physical'][table]
            if before_physical['sha256'] == after_physical['sha256'] or after_physical['rows'] != before_physical['rows'] + (add if table == 'industry_mappings' else 0):
                _stop('V3 physical/projection inconsistency', 'INDETERMINATE')
            expected['snapshot']['physical'][table] = deepcopy(after_physical)
            if table == 'industry_mappings':
                expected['audit']['ids'][table] = deepcopy(after['audit']['ids'][table])
    return {'mapping_added': add, 'backfill_rows': backfilled}


def validate_preservation(before, after, stage='V1', *, v2_additions=None, migration_actor=None):
    """Return one of PASS/UNEXPECTED_CHANGE/INSUFFICIENT_EVIDENCE/INDETERMINATE.

    PASS is limited to consistency/preservation of supplied evidence. It is
    never permission to connect, migrate, repair, setval or publish.
    Caller data are not changed; issue strings contain paths, never row values.
    """
    available, changes, checks = (), {}, ()
    try:
        if stage not in ('V1', 'V2', 'V3'):
            _stop('unsupported stage', 'INDETERMINATE')
        _json_tree(before); _json_tree(after)
        if isinstance(before, dict) and isinstance(before.get('snapshot'), dict):
            available = tuple(sorted(set(before['snapshot']) & {'physical', 'raw', 'columns', 'sequences', 'history'}))
        _evidence(before, 'before'); _evidence(after, 'after')
        expected = deepcopy(before)
        if stage == 'V2':
            _v2_expected(expected, v2_additions)
        elif stage == 'V3':
            changes = _v3_expected(expected, after)
        if stage != 'V1':
            _append_history(expected, after, stage, migration_actor)
        for key in ('physical', 'raw', 'columns', 'sequences', 'history'):
            _same(expected['snapshot'][key], after['snapshot'][key], 'snapshot.' + key)
        for key in ('ids', 'nulls', 'points', 'catalog', 'acl', 'sequence_definitions', 'history_rows'):
            _same(expected['audit'][key], after['audit'][key], 'audit.' + key)
        checks = ('rows/IDs/original values', 'NULL', 'POINT WKB/SRID', 'mapping/classification',
                  'sequence state/definition', 'full history', 'columns/catalog/ACL')
        return ValidationResult('PASS', verified_checks=checks, available_evidence=available, expected_changes=changes)
    except _Rejected as error:
        return ValidationResult(error.status, (error.path,), available_evidence=available, expected_changes=changes)
    except (TypeError, ValueError, KeyError, IndexError, OverflowError, RecursionError):
        return ValidationResult('INDETERMINATE', ('malformed or inconsistent evidence',), available_evidence=available)
