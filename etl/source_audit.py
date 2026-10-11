"""Pure evidence serialization and UNVERIFIED provenance contract; no collector.

validate_contract(payload, envelope, expected, now=...) compares JSON-like claims.
Payload keeps the source_validation snapshot/audit/outcome structure unchanged.
The envelope contains schema_version=1, kind=UNVERIFIED_CLAIMS, run/collection IDs,
stage and its 1-based sequence, validation_stage=V1/V2/V3, artifacts, claims,
consistency, per-component bindings, payload_digest, previous_evidence_digest,
scope and collection_outcome. `expected` supplies the same run/stage/artifacts/
previous fields, a target claim and a connection/transaction/snapshot window.
Expected values are also unverified inputs, not authenticated user approval.
`stage` is a collection label, not a proven completed migration. validation_stage
is the comparator purpose: e.g. a V3-before payload can have history through V2.
No after-history progression is inferred from labels; a future collector/runner
must bind before/after observation points and measured execution results.
PRECHECK has no predecessor digest; subsequent labels require one. This checks
presence/format/binding only, not the predecessor's existence or measured success.

Row-text bytes are preserved verbatim; the PG profile is a caller claim, not
proof that text came from PostgreSQL. IDs/projection lists must already be
ascending. Nothing is sorted, filled, repaired, loaded, observed or persisted.
Single-connection claims may have snapshot_id=NULL with a required descriptor
and local transaction ID; this does not allocate or assert a PostgreSQL XID.
Epoch times are finite nonnegative seconds, TTL <=1800, interval [start,end],
and freshness is measured from start. Reconnected/recollected claims are refused.

Existing private *single-evidence* shape helpers are reused as an adapter;
validate_preservation(), migration delta logic and SourceSimulation are never
called. These dependencies must be included in future collector code hashes.
Even structural success is CONTRACT_VALID_UNVERIFIED and false in boolean
context: no DB identity, snapshot, writer, backup, approval or execution proof.
All envelope/payload values may be sensitive; results/errors contain only
fixed categories/field labels, never original values, SQL, paths or secrets.
"""
from dataclasses import dataclass
import hashlib
import math
import re

if __package__:
    from . import source_validation as preservation
    from .control import STAGES, encode, digest
else:
    import source_validation as preservation
    from control import STAGES, encode, digest

ROW_PROFILE = 'pg-jsonb-text-utf8-length8-sha256-v1'
ID_PROFILE = 'control-int-ascending-length8-sha256-v1'
V3_PROFILE = 'control-json-id-ascending-sha256-v1'
MAX_TTL = 1800


class AuditContractError(ValueError):
    def __init__(self, category, field):
        super().__init__(category + ': ' + field)
        self.category, self.field = category, field


@dataclass(frozen=True)
class ContractResult:
    status: str
    issues: tuple[str, ...] = ()

    @property
    def contract_valid(self):
        return self.status == 'CONTRACT_VALID_UNVERIFIED'

    @property
    def db_observed(self):
        return False

    @property
    def execution_authorized(self):
        return False

    def __bool__(self):
        return False


def _error(category, field):
    raise AuditContractError(category, field)


def _need(value, keys, field, exact=False):
    if type(value) is not dict: _error('INVALID_TYPE', field)
    if not set(keys) <= value.keys(): _error('MISSING_EVIDENCE', field)
    if exact and set(keys) != set(value): _error('STRUCTURE_MISMATCH', field)


def _json(value):
    try:
        preservation._json_tree(value)
        encode(value)
    except (preservation._Rejected, TypeError, ValueError, OverflowError, RecursionError):
        raise AuditContractError('INVALID_TYPE', 'json') from None


def _text(value, field):
    if type(value) is not str or not value.strip(): _error('INVALID_TYPE', field)


def _hash(value, field):
    if type(value) is not str or not re.fullmatch('[0-9a-f]{64}', value): _error('INVALID_HASH', field)


def _int(value, field, minimum=None):
    if type(value) is not int or minimum is not None and value < minimum: _error('INVALID_TYPE', field)


def _time(value):
    try:
        valid = type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        valid = False
    if not valid: _error('INVALID_TIME', 'time')


def _same(a, b, category, field):
    if encode(a) != encode(b): _error(category, field)


def _existing(fn, *args):
    try:
        return fn(*args)
    except preservation._Rejected as exc:
        status = 'MISSING_EVIDENCE' if exc.status == 'INSUFFICIENT_EVIDENCE' else 'PAYLOAD_INCOMPATIBLE'
        raise AuditContractError(status, 'payload.structure') from None


def serialization_profile():
    return {'version': 1, 'row_text': ROW_PROFILE, 'ids': ID_PROFILE,
            'v3_projection': V3_PROFILE, 'payload': 'control-json-sha256-v1'}


def _iter(values):
    if isinstance(values, (str, bytes, dict)): _error('INVALID_TYPE', 'records')
    try:
        return iter(values)
    except TypeError:
        raise AuditContractError('INVALID_TYPE', 'records') from None


def _framed(records):
    sha, count = hashlib.sha256(), 0
    for raw in records:
        sha.update(len(raw).to_bytes(8, 'big')); sha.update(raw); count += 1
    return {'rows': count, 'sha256': sha.hexdigest()}


def row_text_digest(rows, *, profile=ROW_PROFILE):
    """Exact UTF-8 row text framing, no JSON parsing or provenance assertion."""
    if profile != ROW_PROFILE: _error('INVALID_PROFILE', 'row_text')
    def records():
        for text in _iter(rows):
            if type(text) is not str: _error('INVALID_TYPE', 'row_text')
            try:
                yield text.encode('utf8')
            except UnicodeError:
                raise AuditContractError('INVALID_TYPE', 'row_text') from None
    return _framed(records())


def id_digest(ids, *, profile=ID_PROFILE):
    """Signed BIGINT integers, strictly ascending; never silently sorted/coerced."""
    if profile != ID_PROFILE: _error('INVALID_PROFILE', 'ids')
    def records():
        previous = None; seen = set()
        for identifier in _iter(ids):
            _int(identifier, 'ids')
            if not -(2**63) <= identifier < 2**63: _error('INVALID_TYPE', 'ids')
            if identifier in seen: _error('DUPLICATE_ID', 'ids')
            if previous is not None and identifier < previous: _error('ORDER_VIOLATION', 'ids')
            seen.add(identifier); previous = identifier
            yield encode(identifier)
    return _framed(records())


def projection_digest(v3_rows, *, profile=V3_PROFILE):
    if profile != V3_PROFILE: _error('INVALID_PROFILE', 'projection')
    _json(v3_rows)
    fields = {'industries': {'id', 'code'}, 'mappings': {'id', 'source', 'source_code', 'industry_id'},
              'stores': {'id', 'source_store_id', 'source_small_category_code', 'industry_id'}}
    _need(v3_rows, fields, 'projection', True)
    for name, keys in fields.items():
        rows = v3_rows[name]
        if type(rows) is not list: _error('INVALID_TYPE', 'projection.rows')
        for row in rows:
            _need(row, keys, 'projection.row', True); _int(row['id'], 'projection.id', 1)
            for key in keys - {'id', 'industry_id', 'source_small_category_code'}: _text(row[key], 'projection.text')
            if 'industry_id' in row and (row['industry_id'] is not None or name == 'mappings'):
                _int(row['industry_id'], 'projection.industry_id', 1)
            if name == 'stores' and row['source_small_category_code'] is not None and type(row['source_small_category_code']) is not str:
                _error('INVALID_TYPE', 'projection.category')
        id_digest(row['id'] for row in rows)
    return digest(v3_rows)


def _declared_digest(value):
    _need(value, ('rows', 'sha256'), 'payload.digest')
    _int(value['rows'], 'payload.digest.rows', 0); _hash(value['sha256'], 'payload.digest.sha256')
    if (value['rows'] == 0) != (value['sha256'] == preservation.EMPTY['sha256']):
        _error('COUNT_MISMATCH', 'payload.empty_digest')


def _payload(payload, mode):
    _need(payload, ('snapshot', 'audit', 'outcome'), 'payload')
    if payload['outcome'] != 'CONFIRMED': _error('COLLECTION_UNCONFIRMED', 'payload.outcome')
    s, a = payload['snapshot'], payload['audit']
    _need(s, ('physical', 'raw', 'columns', 'sequences', 'history'), 'snapshot')
    _need(a, ('ids', 'nulls', 'points', 'catalog', 'acl', 'sequence_definitions', 'history_rows'), 'audit')
    if type(s['physical']) is not dict: _error('INVALID_TYPE', 'payload.digest_map')
    for block in (s['raw'], a['points']):
        if type(block) is not dict: _error('INVALID_TYPE', 'payload.digest_map')
        if not set(block) <= set(s['physical']): _error('SCOPE_MISMATCH', 'payload.digest_map')
    for block in (s['physical'], s['raw'], a['ids'], a['points']):
        if type(block) is not dict: _error('INVALID_TYPE', 'payload.digest_map')
        for value in block.values(): _declared_digest(value)
    for name, physical in s['physical'].items():
        for block in (a['ids'], a['points'], s['raw']):
            if name in block and block[name]['rows'] != physical['rows']:
                _error('COUNT_MISMATCH', 'payload.row_counts')
    _existing(preservation._evidence, payload, 'payload')
    if mode == 'V3' or 'v3_rows' in payload:
        _need(payload, ('v3_rows',), 'projection')
        value = projection_digest(payload['v3_rows'])
        _need(a, ('projections',), 'audit.projections'); _need(a['projections'], ('v3',), 'audit.projections')
        _hash(a['projections']['v3'], 'audit.projections.v3')
        _same(a['projections']['v3'], value, 'COMPONENT_DIGEST_MISMATCH', 'audit.projections.v3')
        _existing(preservation._v3_rows, payload, 'payload')


def _v2_reference(reference):
    _json(reference)
    _need(reference, ('columns', 'catalog_tables', 'catalog_functions', 'sequence_definitions', 'acl_objects'), 'v2_additions', True)
    tables, functions = set(preservation.SPATIAL_TABLES), set(preservation.V2_FUNCTIONS)
    sequences = {t + '_id_seq' for t in tables}
    objects = {'table:' + t for t in tables} | {'sequence:' + q for q in sequences} | {'function:' + f for f in functions}
    for key, names in [('columns', tables), ('catalog_tables', tables), ('catalog_functions', functions),
                       ('sequence_definitions', sequences), ('acl_objects', objects)]:
        _need(reference[key], names, 'v2_additions.objects', True)
    for name in tables:
        _existing(preservation._table_definition, reference['catalog_tables'][name], 'reference')
        cols = reference['columns'][name]
        names = _existing(preservation._column_names, cols, 'reference')
        full = reference['catalog_tables'][name]['columns']
        _same(names, [c['column_name'] for c in full], 'STRUCTURE_MISMATCH', 'v2_additions.columns')
        for col, details in zip(cols, full):
            for key in col:
                if key not in details: _error('MISSING_EVIDENCE', 'v2_additions.columns')
                _same(col[key], details[key], 'STRUCTURE_MISMATCH', 'v2_additions.columns')
    for value in reference['catalog_functions'].values():
        _existing(preservation._named_metadata, value, ('definition', 'owner'), 'reference')
    for value in reference['sequence_definitions'].values():
        _existing(preservation._sequence_definition, value, 'reference')
    for value in reference['acl_objects'].values(): _existing(preservation._acl_value, value, 'reference')


def _result(call):
    try:
        call()
        return ContractResult('CONTRACT_VALID_UNVERIFIED')
    except AuditContractError as exc:
        return ContractResult(exc.category, (exc.field,))


def validate_v2_additions(reference):
    """Check reference format only, not its SQL origin or actual DDL correctness."""
    return _result(lambda: _v2_reference(reference))


def _artifacts(value):
    _need(value, ('git_sha', 'sql_hashes', 'collector_code_hash', 'validator_code_hash',
                 'input_hashes', 'profile_hashes', 'serialization_profile', 'v2_additions_hash'), 'artifacts', True)
    if type(value['git_sha']) is not str or not re.fullmatch('[0-9a-f]{40}', value['git_sha']): _error('INVALID_HASH', 'artifacts.git_sha')
    _same(value['serialization_profile'], serialization_profile(), 'INVALID_PROFILE', 'serialization_profile')
    for key, names in [('sql_hashes', ('V2', 'V3')), ('input_hashes', ('admin', 'commercial')),
                       ('profile_hashes', ('admin', 'commercial'))]:
        _need(value[key], names, 'artifacts.hashes', True)
        for sha in value[key].values(): _hash(sha, 'artifacts.hashes')
    for key in ('collector_code_hash', 'validator_code_hash'): _hash(value[key], 'artifacts.code_hash')
    if value['v2_additions_hash'] is not None: _hash(value['v2_additions_hash'], 'artifacts.reference_hash')


def _claims(value):
    _need(value, ('database', 'user', 'session_user', 'system_identifier', 'container_id',
                 'image_id', 'network_id', 'endpoint', 'postgres_version'), 'claims', True)
    for key in ('database', 'user', 'session_user'): _text(value[key], 'claims.identity')
    if type(value['system_identifier']) is not str or not re.fullmatch('[1-9][0-9]*', value['system_identifier']):
        _error('INVALID_TYPE', 'claims.system_identifier')
    for key in ('container_id', 'network_id'): _hash(value[key], 'claims.resource_hash')
    if type(value['image_id']) is not str or not value['image_id'].startswith('sha256:'): _error('INVALID_HASH', 'claims.image')
    _hash(value['image_id'][7:], 'claims.image')
    _need(value['endpoint'], ('transport', 'identity_hash'), 'claims.endpoint', True)
    if value['endpoint']['transport'] not in ('tcp', 'unix'): _error('INVALID_TYPE', 'claims.endpoint')
    _hash(value['endpoint']['identity_hash'], 'claims.endpoint')
    if type(value['postgres_version']) is not str or not re.fullmatch(r'16\.\d+', value['postgres_version']):
        _error('INVALID_TYPE', 'claims.postgres_version')


def _contract(payload, envelope, expected, now, ttl, v2_additions):
    _json(payload); _json(envelope); _json(expected)
    _need(envelope, ('schema_version', 'kind', 'run_id', 'collection_id', 'stage', 'stage_sequence',
        'validation_stage', 'artifacts', 'claims', 'consistency', 'bindings', 'payload_digest',
        'previous_evidence_digest', 'scope', 'collection_outcome'), 'envelope', True)
    _need(expected, ('run_id', 'collection_id', 'stage', 'stage_sequence', 'validation_stage',
                     'artifacts', 'previous_evidence_digest', 'target', 'window'), 'expected', True)
    if type(envelope['schema_version']) is not int or envelope['schema_version'] != 1:
        _error('INVALID_PROFILE', 'schema_version')
    if envelope['kind'] != 'UNVERIFIED_CLAIMS': _error('INVALID_PROFILE', 'envelope.kind')
    for key, category in [('run_id', 'RUN_MISMATCH'), ('collection_id', 'COLLECTION_MISMATCH')]:
        _text(envelope[key], 'envelope.identity'); _text(expected[key], 'expected.identity')
        _same(envelope[key], expected[key], category, 'envelope.identity')
    mode = envelope['validation_stage']
    if mode not in ('V1', 'V2', 'V3') or envelope['stage'] not in STAGES:
        _error('STAGE_MISMATCH', 'stage')
    _int(envelope['stage_sequence'], 'stage_sequence')
    if envelope['stage_sequence'] != STAGES.index(envelope['stage']) + 1:
        _error('STAGE_MISMATCH', 'stage_sequence')
    for key in ('stage', 'stage_sequence', 'validation_stage'):
        _same(envelope[key], expected[key], 'STAGE_MISMATCH', 'stage')
    _artifacts(envelope['artifacts']); _artifacts(expected['artifacts'])
    _same(envelope['artifacts'], expected['artifacts'], 'CONTEXT_MISMATCH', 'artifacts')
    _claims(envelope['claims']); _claims(expected['target'])
    _same(envelope['claims'], expected['target'], 'TARGET_MISMATCH', 'claims')
    for value in (envelope['previous_evidence_digest'], expected['previous_evidence_digest']):
        if value is not None: _hash(value, 'previous_evidence_digest')
    _same(envelope['previous_evidence_digest'], expected['previous_evidence_digest'], 'CONTEXT_MISMATCH', 'previous_evidence_digest')
    if envelope['stage'] == STAGES[0]:
        if envelope['previous_evidence_digest'] is not None:
            _error('STRUCTURE_MISMATCH', 'previous_evidence_digest')
    elif envelope['previous_evidence_digest'] is None:
        _error('MISSING_EVIDENCE', 'previous_evidence_digest')
    _hash(envelope['payload_digest'], 'payload_digest')
    _same(envelope['payload_digest'], digest(payload), 'PAYLOAD_DIGEST_MISMATCH', 'payload_digest')
    _payload(payload, mode)
    _same(envelope['collection_outcome'], payload['outcome'], 'COLLECTION_UNCONFIRMED', 'collection_outcome')
    reference_hash = envelope['artifacts']['v2_additions_hash']
    if mode == 'V2':
        if v2_additions is None or reference_hash is None: _error('MISSING_EVIDENCE', 'v2_additions')
        _v2_reference(v2_additions)
        _same(digest(v2_additions), reference_hash, 'CONTEXT_MISMATCH', 'v2_additions')
    elif reference_hash is not None or v2_additions is not None:
        _error('STRUCTURE_MISMATCH', 'v2_additions')
    window = envelope['consistency']
    _need(window, ('connection_id', 'transaction_id', 'isolation', 'read_only', 'snapshot_id',
        'snapshot_descriptor', 'started_at', 'finished_at', 'reconnected', 'recollected'), 'consistency', True)
    _need(expected['window'], ('connection_id', 'transaction_id', 'snapshot_id', 'snapshot_descriptor'), 'expected.window', True)
    for key in ('connection_id', 'transaction_id', 'snapshot_descriptor'): _text(window[key], 'consistency.identity')
    if window['snapshot_id'] is not None: _text(window['snapshot_id'], 'consistency.snapshot_id')
    if window['isolation'] != 'repeatable read' or window['read_only'] is not True:
        _error('STRUCTURE_MISMATCH', 'consistency.mode')
    for key in ('reconnected', 'recollected'):
        if type(window[key]) is not bool: _error('INVALID_TYPE', 'consistency.recollection')
        if window[key]: _error('RECOLLECTION_UNVERIFIED', 'consistency.recollection')
    for key in expected['window']:
        category = 'SNAPSHOT_MISMATCH' if key.startswith('snapshot') else 'CONNECTION_MISMATCH'
        _same(window[key], expected['window'][key], category, 'consistency.identity')
    start, finish = window['started_at'], window['finished_at']
    for value in (start, finish, now, ttl): _time(value)
    if not 0 < ttl <= MAX_TTL or finish < start: _error('INVALID_TIME', 'consistency.time')
    if finish > now: _error('FUTURE_EVIDENCE', 'consistency.time')
    if now - start >= ttl: _error('STALE_EVIDENCE', 'consistency.time')
    components = {'snapshot', 'audit'} | ({'v3_rows'} if 'v3_rows' in payload else set())
    bindings = envelope['bindings']
    if type(bindings) is not list: _error('INVALID_TYPE', 'bindings')
    if len(bindings) < len(components): _error('MISSING_EVIDENCE', 'bindings')
    seen = set()
    for binding in bindings:
        _need(binding, ('component', 'run_id', 'collection_id', 'stage', 'stage_sequence',
            'connection_id', 'transaction_id', 'snapshot_id', 'snapshot_descriptor', 'component_digest'), 'bindings', True)
        component = binding['component']
        if type(component) is not str or component not in components or component in seen:
            _error('STRUCTURE_MISMATCH', 'bindings.component')
        seen.add(component)
        for key in ('run_id', 'collection_id', 'stage', 'stage_sequence'):
            _same(binding[key], envelope[key], 'STAGE_MISMATCH' if key.startswith('stage') else 'RUN_MISMATCH', 'bindings.context')
        for key in expected['window']:
            _same(binding[key], window[key], 'SNAPSHOT_MISMATCH' if key.startswith('snapshot') else 'CONNECTION_MISMATCH', 'bindings.window')
        _hash(binding['component_digest'], 'bindings.digest')
        _same(binding['component_digest'], digest(payload[component]), 'COMPONENT_DIGEST_MISMATCH', 'bindings.digest')
    scope = envelope['scope']
    _need(scope, ('tables', 'columns', 'catalog_objects'), 'scope', True)
    wanted = {'tables': sorted(payload['snapshot']['physical']),
        'columns': {t: [c['column_name'] for c in cols] for t, cols in payload['snapshot']['columns'].items()},
        'catalog_objects': sorted(payload['audit']['acl']['objects'])}
    _same(scope, wanted, 'SCOPE_MISMATCH', 'scope')


def validate_contract(payload, envelope, expected, *, now, ttl=MAX_TTL, v2_additions=None):
    """Format/self-consistency only. No PASS, readiness or authorization returned."""
    return _result(lambda: _contract(payload, envelope, expected, now, ttl, v2_additions))
