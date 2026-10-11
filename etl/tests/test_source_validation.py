"""Synthetic, standard-library-only preservation tests; never connects to a DB."""
import copy
import hashlib
import importlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    validation = importlib.import_module('source_validation')
except ModuleNotFoundError as error:
    if error.name != 'source_validation':
        raise
    validation = None

TABLES = ('industries', 'industry_mappings', 'commercial_areas', 'store_stats_dong',
          'sales_dong', 'sales_commercial_area', 'stores')
SPATIAL = ('spatial_dataset_versions', 'admin_dong_boundaries', 'commercial_area_boundaries')
FUNCTIONS = ('guard_spatial_boundary_write', 'guard_spatial_dataset_version')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def fingerprint(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def records_digest(records):
    sha = hashlib.sha256()
    for row in records:
        value = canonical(row)
        sha.update(len(value).to_bytes(8, 'big'))
        sha.update(value)
    return {'rows': len(records), 'sha256': sha.hexdigest()}


def columns(names):
    return [{'column_name': n, 'data_type': 'text', 'udt_name': 'text',
             'type': 'text', 'nullable': True, 'default': None, 'identity': '',
             'collation': None} for n in names]


def table_definition(cols):
    return {'columns': copy.deepcopy(cols), 'constraints': ['PRIMARY KEY (id)'],
            'indexes': ['id_unique'], 'triggers': [], 'owner': 'migration', 'rls': False}


def sequence_definition(table):
    return {'data_type': 'bigint', 'start_value': 1, 'min_value': 1,
            'max_value': 9223372036854775807, 'increment_by': 1, 'cache_size': 1,
            'cycle': False, 'owner': 'migration', 'owned_by': table + '.id'}


def history(version):
    return {'installed_rank': int(version), 'version': version,
            'description': {'1': '<< Flyway Baseline >>', '2': 'spatial schema',
                            '3': 'semas cafe mapping and store backfill'}[version],
            'type': 'BASELINE' if version == '1' else 'SQL',
            'script': {'1': '<< Flyway Baseline >>', '2': 'V2__spatial_schema.sql',
                       '3': 'V3__semas_cafe_mapping_and_store_backfill.sql'}[version],
            'checksum': {'1': None, '2': 237765795, '3': 617267104}[version],
            'installed_by': 'migration', 'installed_on': '2026-10-10T00:00:00+00:00',
            'execution_time': 10, 'success': True}


def sync(evidence):
    """Simulate a collector from synthetic rows, independently of production code."""
    snapshot, audit, rows = evidence['snapshot'], evidence['audit'], evidence['_rows']
    for table, values in rows.items():
        ordered = sorted(values, key=lambda r: r['id'])
        snapshot['physical'][table] = records_digest(ordered)
        audit['ids'][table] = records_digest([r['id'] for r in ordered])
        audit['nulls'][table] = {c['column_name']: sum(r[c['column_name']] is None for r in values)
                               for c in snapshot['columns'][table]}
    snapshot['raw']['stores'] = records_digest([
        {k: v for k, v in r.items() if k != 'industry_id'}
        for r in sorted(rows['stores'], key=lambda r: r['id'])])
    for table in ('stores', 'commercial_areas'):
        audit['points'][table] = records_digest([
            [r['id'], r['location_ndr'], r['location_srid']]
            for r in sorted(rows[table], key=lambda r: r['id'])])
    evidence['v3_rows'] = {
        'industries': [{k: r[k] for k in ('id', 'code')} for r in rows['industries']],
        'mappings': copy.deepcopy(rows['industry_mappings']),
        'stores': [{k: r[k] for k in ('id', 'source_store_id', 'source_small_category_code', 'industry_id')}
                   for r in rows['stores']]}
    audit['projections'] = {'v3': fingerprint(evidence['v3_rows'])}
    snapshot['history'] = [{k: r[k] for k in ('installed_rank', 'version', 'description',
                                           'type', 'script', 'checksum', 'success')}
                           for r in audit['history_rows']]
    return evidence


def baseline(stores=None, mapped=False):
    rows = {t: [{'id': 10, 'value': None}] for t in TABLES}
    rows['industries'] = [{'id': 7, 'code': 'CAFE'}, {'id': 9, 'code': 'HAIR'}]
    rows['industry_mappings'] = [{'id': 41, 'source': 'SEOUL', 'source_code': 'CS100010', 'industry_id': 7}]
    if mapped:
        rows['industry_mappings'].append({'id': 42, 'source': 'SEMAS', 'source_code': 'I21201', 'industry_id': 7})
    rows['commercial_areas'] = [{'id': 90, 'location_ndr': '0101000000000000', 'location_srid': 4326}]
    rows['stores'] = copy.deepcopy(stores or [])
    cols = {t: columns(list(values[0]) if values else
                        ['id', 'source_store_id', 'source_small_category_code', 'industry_id',
                         'name', 'location_ndr', 'location_srid']) for t, values in rows.items()}
    snapshot = {'physical': {}, 'raw': {}, 'sequences': {
        t + '_id_seq': {'last_value': 42 if mapped and t == 'industry_mappings' else
                        41 if t == 'industry_mappings' else 100, 'is_called': True} for t in TABLES},
                'columns': cols, 'history': []}
    definitions = {t + '_id_seq': sequence_definition(t) for t in TABLES}
    catalog = {'tables': {t: table_definition(c) for t, c in cols.items()},
               'functions': {}, 'extensions': {'postgis': {'version': '3.4', 'owner': 'migration'}},
               'schema': {'name': 'public', 'owner': 'migration'}}
    catalog['tables']['flyway_schema_history'] = table_definition(columns(list(history('1'))))
    objects = {**{'table:' + t: None for t in catalog['tables']},
               **{'sequence:' + s: None for s in definitions}}
    audit = {'catalog': catalog, 'acl': {'database': {'owner': 'migration', 'acl': None},
             'schema': {'owner': 'migration', 'acl': None}, 'default_acl': [],
             'roles': {'migration': {'login': True, 'superuser': False, 'createdb': False,
                 'createrole': False, 'inherit': True, 'replication': False, 'bypassrls': False,
                 'connection_limit': -1, 'valid_until': None, 'memberships': []}}, 'objects': objects},
             'sequence_definitions': definitions, 'history_rows': [history('1')],
             'ids': {}, 'nulls': {}, 'points': {}}
    return sync({'snapshot': snapshot, 'audit': audit, '_rows': rows, 'outcome': 'CONFIRMED'})


def v2_additions():
    cols = {t: columns(['id', 'dataset_id']) for t in SPATIAL}
    return {'columns': cols, 'catalog_tables': {t: table_definition(c) for t, c in cols.items()},
            'catalog_functions': {n: {'definition': n + ' verified body', 'owner': 'migration'} for n in FUNCTIONS},
            'sequence_definitions': {t + '_id_seq': sequence_definition(t) for t in SPATIAL},
            'acl_objects': {**{'table:' + t: None for t in SPATIAL},
                            **{'sequence:' + t + '_id_seq': None for t in SPATIAL},
                            **{'function:' + f: None for f in FUNCTIONS}}}


def apply_v2(before):
    after, delta = copy.deepcopy(before), v2_additions()
    after['snapshot']['columns'].update(copy.deepcopy(delta['columns']))
    after['audit']['catalog']['tables'].update(copy.deepcopy(delta['catalog_tables']))
    after['audit']['catalog']['functions'].update(copy.deepcopy(delta['catalog_functions']))
    after['audit']['sequence_definitions'].update(copy.deepcopy(delta['sequence_definitions']))
    after['audit']['acl']['objects'].update(copy.deepcopy(delta['acl_objects']))
    for t in SPATIAL:
        after['_rows'][t] = []
        after['snapshot']['sequences'][t + '_id_seq'] = {'last_value': 1, 'is_called': False}
    after['audit']['history_rows'].append(history('2'))
    return sync(after)


def apply_v3(before):
    after = copy.deepcopy(before)
    if not any(r['source'] == 'SEMAS' and r['source_code'] == 'I21201'
               for r in before['_rows']['industry_mappings']):
        after['_rows']['industry_mappings'].append(
            {'id': 42, 'source': 'SEMAS', 'source_code': 'I21201', 'industry_id': 7})
        after['snapshot']['sequences']['industry_mappings_id_seq'] = {'last_value': 42, 'is_called': True}
    for row in after['_rows']['stores']:
        if row['source_small_category_code'] == 'I21201' and row['industry_id'] is None:
            row['industry_id'] = 7
    after['audit']['history_rows'].append(history('3'))
    return sync(after)


def store(id, code='I21201', industry=None):
    return {'id': id, 'source_store_id': 'fixture-' + str(id),
            'source_small_category_code': code, 'industry_id': industry,
            'name': None, 'location_ndr': '0101000000000000', 'location_srid': 4326}


class SourceValidationTests(unittest.TestCase):
    def run_validation(self, before, after, stage='V1', **kwargs):
        self.assertIsNotNone(validation, 'source preservation validator not implemented')
        # _rows belongs to this synthetic collector, not to the input contract.
        return validation.validate_preservation(
            {k: v for k, v in before.items() if k != '_rows'},
            {k: v for k, v in after.items() if k != '_rows'}, stage, **kwargs)

    def v3(self, before, after):
        return self.run_validation(before, after, 'V3', migration_actor='migration')

    def test_v1_complete_preservation(self):
        b = baseline([store(1)])
        result = self.run_validation(b, copy.deepcopy(b))
        self.assertEqual(result.status, 'PASS')
        self.assertTrue(result.passed)

    def test_unexpected_original_value(self):
        b = baseline([store(1)]); a = copy.deepcopy(b)
        a['_rows']['store_stats_dong'][0]['value'] = 0
        self.assertEqual(self.run_validation(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_null_changed_to_zero(self):
        b = baseline([store(1)]); a = copy.deepcopy(b)
        a['_rows']['stores'][0]['name'] = 0
        self.assertEqual(self.run_validation(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_point_wkb_changed(self):
        b = baseline([store(1)]); a = copy.deepcopy(b)
        a['_rows']['stores'][0]['location_ndr'] = '0101000000111111'
        self.assertEqual(self.run_validation(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_point_srid_changed(self):
        b = baseline([store(1)]); a = copy.deepcopy(b)
        a['_rows']['commercial_areas'][0]['location_srid'] = 5181
        self.assertEqual(self.run_validation(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_existing_cafe_mapping_is_noop(self):
        b = apply_v2(baseline(mapped=True)); a = apply_v3(b)
        r = self.v3(b, a)
        self.assertEqual(r.status, 'PASS')
        self.assertEqual(r.expected_changes, {'mapping_added': 0, 'backfill_rows': 0})

    def test_new_mapping_and_zero_backfill(self):
        b = apply_v2(baseline()); r = self.v3(b, apply_v3(b))
        self.assertEqual(r.status, 'PASS')
        self.assertEqual(r.expected_changes, {'mapping_added': 1, 'backfill_rows': 0})

    def test_multiple_backfill_and_other_store_preserved(self):
        b = apply_v2(baseline([store(1), store(2), store(3, 'I21201', 7), store(4, 'OTHER')]))
        r = self.v3(b, apply_v3(b))
        self.assertEqual(r.status, 'PASS')
        self.assertEqual(r.expected_changes, {'mapping_added': 1, 'backfill_rows': 2})

    def test_wrong_mapping_conflict(self):
        b = apply_v2(baseline(mapped=True)); b['_rows']['industry_mappings'][-1]['industry_id'] = 9
        sync(b)
        self.assertEqual(self.v3(b, apply_v3(b)).status, 'UNEXPECTED_CHANGE')

    def test_wrong_preexisting_store_classification(self):
        b = apply_v2(baseline([store(1, industry=9)]))
        self.assertEqual(self.v3(b, apply_v3(b)).status, 'UNEXPECTED_CHANGE')

    def test_non_target_classification_changed(self):
        b = apply_v2(baseline([store(1), store(2, 'OTHER')]))
        a = apply_v3(b); a['_rows']['stores'][1]['industry_id'] = 7
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_raw_store_value_changed_with_backfill(self):
        b = apply_v2(baseline([store(1)])); a = apply_v3(b)
        a['_rows']['stores'][0]['name'] = 'unexpected'
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_store_id_changed(self):
        b = apply_v2(baseline([store(1)])); a = apply_v3(b)
        a['_rows']['stores'][0]['id'] = 2
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_mapping_added_with_wrong_identity(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['_rows']['industry_mappings'][-1]['id'] = 99
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_unexpected_sequence_value(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['snapshot']['sequences']['stores_id_seq']['last_value'] += 1
        self.assertEqual(self.v3(b, a).status, 'UNEXPECTED_CHANGE')

    def test_mapping_sequence_not_blanket_ignored(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['snapshot']['sequences']['industry_mappings_id_seq']['last_value'] = 999
        self.assertEqual(self.v3(b, a).status, 'UNEXPECTED_CHANGE')

    def test_sequence_definition_and_ownership_preserved(self):
        b = baseline(); a = copy.deepcopy(b)
        a['audit']['sequence_definitions']['stores_id_seq']['owned_by'] = 'other.id'
        self.assertEqual(self.run_validation(b, a).status, 'UNEXPECTED_CHANGE')

    def test_baseline_checksum_changed(self):
        b = baseline(); a = copy.deepcopy(b)
        a['audit']['history_rows'][0]['checksum'] = 123
        self.assertEqual(self.run_validation(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_full_v2_history_row_preserved_in_v3(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['audit']['history_rows'][1]['installed_by'] = 'other'
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_unexpected_new_history_row(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['audit']['history_rows'][-1]['checksum'] = 123
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_catalog_change_on_empty_table_rejected(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['audit']['catalog']['tables']['stores']['indexes'] = []
        self.assertEqual(self.v3(b, a).status, 'UNEXPECTED_CHANGE')

    def test_acl_change_rejected(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['audit']['acl']['objects']['table:stores'] = ['PUBLIC=ALL']
        self.assertEqual(self.v3(b, a).status, 'UNEXPECTED_CHANGE')

    def test_columns_change_rejected(self):
        b = baseline(); a = copy.deepcopy(b)
        a['snapshot']['columns']['stores'][0]['data_type'] = 'integer'
        self.assertNotEqual(self.run_validation(b, a).status, 'PASS')

    def test_legacy_snapshot_without_full_audit_not_pass(self):
        b = baseline(); del b['audit']
        r = self.run_validation(b, copy.deepcopy(b))
        self.assertEqual(r.status, 'INSUFFICIENT_EVIDENCE')
        self.assertFalse(r.passed)

    def test_missing_required_evidence_rejected(self):
        for section, key in [('audit', 'catalog'), ('audit', 'acl'), ('audit', 'ids'),
                             ('audit', 'points'), ('audit', 'nulls'),
                             ('audit', 'sequence_definitions'), ('audit', 'history_rows'),
                             ('snapshot', 'physical'), ('snapshot', 'columns')]:
            with self.subTest(key=key):
                b = baseline(); a = copy.deepcopy(b); del a[section][key]
                self.assertEqual(self.run_validation(b, a).status, 'INSUFFICIENT_EVIDENCE')

    def test_partial_history_evidence_rejected(self):
        b = baseline(); a = copy.deepcopy(b)
        del a['audit']['history_rows'][0]['installed_on']
        self.assertEqual(self.run_validation(b, a).status, 'INSUFFICIENT_EVIDENCE')

    def test_projection_mismatch_not_pass(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['v3_rows']['mappings'][-1]['source_code'] = 'wrong'
        self.assertEqual(self.v3(b, a).status, 'INDETERMINATE')

    def test_missing_v3_rows_not_pass(self):
        b = apply_v2(baseline()); a = apply_v3(b); del a['v3_rows']
        self.assertEqual(self.v3(b, a).status, 'INSUFFICIENT_EVIDENCE')

    def test_cached_sequence_outcome_indeterminate(self):
        b = apply_v2(baseline()); b['audit']['sequence_definitions']['industry_mappings_id_seq']['cache_size'] = 10
        self.assertEqual(self.v3(b, apply_v3(b)).status, 'INDETERMINATE')

    def test_unknown_execution_outcome_not_pass(self):
        b = baseline(); a = copy.deepcopy(b); a['outcome'] = 'UNKNOWN'
        self.assertEqual(self.run_validation(b, a).status, 'INDETERMINATE')

    def test_v2_only_approved_objects_added(self):
        b = baseline(); a = apply_v2(b)
        self.assertEqual(self.run_validation(b, a, 'V2', v2_additions=v2_additions(),
                                             migration_actor='migration').status, 'PASS')

    def test_v2_cannot_allow_v1_catalog_changes(self):
        b = baseline(); a = apply_v2(b)
        a['audit']['catalog']['tables']['stores']['owner'] = 'other'
        self.assertEqual(self.run_validation(b, a, 'V2', v2_additions=v2_additions(),
                                             migration_actor='migration').status, 'UNEXPECTED_CHANGE')

    def test_v2_unknown_object_addition_rejected(self):
        b = baseline(); a = apply_v2(b); delta = v2_additions()
        delta['catalog_tables']['rogue'] = table_definition(columns(['id']))
        self.assertNotEqual(self.run_validation(b, a, 'V2', v2_additions=delta,
                                                migration_actor='migration').status, 'PASS')

    def test_v2_reference_missing_not_pass(self):
        b = baseline()
        self.assertEqual(self.run_validation(b, apply_v2(b), 'V2', migration_actor='migration').status,
                         'INSUFFICIENT_EVIDENCE')

    def test_v2_sequence_and_empty_data_required(self):
        b = baseline(); a = apply_v2(b)
        a['snapshot']['sequences']['admin_dong_boundaries_id_seq']['is_called'] = True
        self.assertEqual(self.run_validation(b, a, 'V2', v2_additions=v2_additions(),
                                             migration_actor='migration').status, 'UNEXPECTED_CHANGE')

    def test_inputs_not_mutated(self):
        b = apply_v2(baseline([store(1)])); a = apply_v3(b)
        original = copy.deepcopy((b, a))
        self.assertEqual(self.v3(b, a).status, 'PASS')
        self.assertEqual((b, a), original)

    def test_unknown_catalog_and_acl_payloads_not_pass(self):
        paths = [('catalog', 'schema'), ('catalog', 'extensions', 'postgis'),
                 ('acl', 'database'), ('acl', 'schema'), ('acl', 'default_acl'),
                 ('acl', 'roles', 'migration'),
                 ('catalog', 'functions', FUNCTIONS[0])]
        for path in paths:
            with self.subTest(path=path):
                b = apply_v2(baseline())
                target = b['audit']
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = None
                self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status,
                                 'INSUFFICIENT_EVIDENCE')

    def test_mapping_extra_original_column_not_silently_ignored(self):
        b = apply_v2(baseline())
        b['snapshot']['columns']['industry_mappings'] += columns(['original_note'])
        b['audit']['catalog']['tables']['industry_mappings']['columns'] += columns(['original_note'])
        b['_rows']['industry_mappings'][0]['original_note'] = 'preserve'
        sync(b)
        # The four-field projection cannot attest the additional original field.
        b['v3_rows']['mappings'] = [{k: r[k] for k in ('id', 'source', 'source_code', 'industry_id')}
                                   for r in b['_rows']['industry_mappings']]
        b['audit']['projections']['v3'] = fingerprint(b['v3_rows'])
        a = copy.deepcopy(b)
        a['_rows']['industry_mappings'].append({'id': 42, 'source': 'SEMAS',
            'source_code': 'I21201', 'industry_id': 7, 'original_note': None})
        a['snapshot']['sequences']['industry_mappings_id_seq'] = {'last_value': 42, 'is_called': True}
        a['audit']['history_rows'].append(history('3'))
        a['_rows']['industry_mappings'][0]['original_note'] = 'changed'
        a['_rows']['industry_mappings'][-1]['original_note'] = None
        sync(a)
        a['v3_rows']['mappings'] = [{k: r[k] for k in ('id', 'source', 'source_code', 'industry_id')}
                                   for r in a['_rows']['industry_mappings']]
        a['audit']['projections']['v3'] = fingerprint(a['v3_rows'])
        self.assertEqual(self.v3(b, a).status, 'INSUFFICIENT_EVIDENCE')

    def test_v3_requires_complete_v2_object_evidence(self):
        b = baseline(); b['audit']['history_rows'].append(history('2')); sync(b)
        self.assertEqual(self.v3(b, apply_v3(b)).status, 'INSUFFICIENT_EVIDENCE')

    def test_projection_id_digest_inconsistent(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['audit']['ids']['industry_mappings']['sha256'] = 'f' * 64
        self.assertEqual(self.v3(b, a).status, 'INDETERMINATE')

    def test_projection_null_counts_inconsistent(self):
        b = apply_v2(baseline())
        b['audit']['nulls']['industry_mappings']['source'] = 1
        self.assertEqual(self.v3(b, apply_v3(b)).status, 'INDETERMINATE')

    def test_sql_history_checksum_cannot_be_unknown_on_both_sides(self):
        b = apply_v2(baseline()); b['audit']['history_rows'][1]['checksum'] = None
        sync(b)
        self.assertNotEqual(self.v3(b, apply_v3(b)).status, 'PASS')

    def test_nonpass_result_is_false(self):
        b = baseline(); a = copy.deepcopy(b); a['outcome'] = 'UNKNOWN'
        self.assertFalse(bool(self.run_validation(b, a)))

    def test_sequence_state_outside_definition_rejected(self):
        b = baseline(); b['snapshot']['sequences']['stores_id_seq']['last_value'] = 0
        self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status, 'INDETERMINATE')

    def test_incomplete_column_type_not_pass(self):
        b = baseline()
        b['audit']['catalog']['tables']['stores']['columns'][0]['type'] = None
        b['snapshot']['columns']['stores'][0]['type'] = None
        self.assertNotEqual(self.run_validation(b, copy.deepcopy(b)).status, 'PASS')

    def test_migration_actor_requires_role_evidence(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        a['audit']['history_rows'][-1]['installed_by'] = 'unknown_actor'; sync(a)
        self.assertEqual(self.run_validation(b, a, 'V3', migration_actor='unknown_actor').status,
                         'INSUFFICIENT_EVIDENCE')

    def test_noop_mapping_does_not_require_nextval_prediction(self):
        b = apply_v2(baseline(mapped=True))
        b['audit']['sequence_definitions']['industry_mappings_id_seq']['cache_size'] = 10
        self.assertEqual(self.v3(b, apply_v3(b)).status, 'PASS')

    def test_mapping_nextval_uses_dynamic_bigint_state(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        b['snapshot']['sequences']['industry_mappings_id_seq']['last_value'] = 9007199254740993
        a['_rows']['industry_mappings'][-1]['id'] = 9007199254740994
        a['snapshot']['sequences']['industry_mappings_id_seq']['last_value'] = 9007199254740994
        self.assertEqual(self.v3(b, sync(a)).status, 'PASS')

    def test_uncalled_sequence_uses_last_value(self):
        b = apply_v2(baseline()); a = apply_v3(b)
        b['snapshot']['sequences']['industry_mappings_id_seq'] = {'last_value': 50, 'is_called': False}
        a['_rows']['industry_mappings'][-1]['id'] = 50
        a['snapshot']['sequences']['industry_mappings_id_seq']['last_value'] = 50
        self.assertEqual(self.v3(b, sync(a)).status, 'PASS')

    def test_required_backfill_not_performed(self):
        b = apply_v2(baseline([store(1)])); a = apply_v3(b)
        a['_rows']['stores'][0]['industry_id'] = None
        self.assertEqual(self.v3(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_noop_mapping_sequence_must_be_preserved(self):
        b = apply_v2(baseline(mapped=True)); a = apply_v3(b)
        a['snapshot']['sequences']['industry_mappings_id_seq']['last_value'] += 1
        self.assertEqual(self.v3(b, a).status, 'UNEXPECTED_CHANGE')

    def test_baseline_installed_on_preserved(self):
        b = baseline(); a = copy.deepcopy(b)
        a['audit']['history_rows'][0]['installed_on'] = '2026-10-11T00:00:00+00:00'
        self.assertEqual(self.run_validation(b, sync(a)).status, 'UNEXPECTED_CHANGE')

    def test_unknown_catalog_list_entries_not_pass(self):
        for section in ('constraints', 'indexes', 'triggers'):
            with self.subTest(section=section):
                b = baseline()
                b['audit']['catalog']['tables']['stores'][section] = [None]
                self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status,
                                 'INSUFFICIENT_EVIDENCE')

    def test_v1_sql_history_identical_on_both_sides_rejected(self):
        b = baseline()
        b['audit']['history_rows'][0].update(type='SQL', script='V1__unverified.sql', checksum=123)
        sync(b)
        self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status, 'UNEXPECTED_CHANGE')

    def test_v1_unverified_baseline_markers_identical_rejected(self):
        for field in ('script', 'description'):
            with self.subTest(field=field):
                b = baseline(); b['audit']['history_rows'][0][field] = 'unverified baseline'
                sync(b)
                self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status, 'UNEXPECTED_CHANGE')

    def test_v2_v3_predecessor_v1_sql_history_rejected(self):
        for stage in ('V2', 'V3'):
            with self.subTest(stage=stage):
                b = baseline() if stage == 'V2' else apply_v2(baseline())
                b['audit']['history_rows'][0].update(type='SQL', script='V1__unverified.sql', checksum=123)
                sync(b)
                a = apply_v2(b) if stage == 'V2' else apply_v3(b)
                kwargs = {'migration_actor': 'migration'}
                if stage == 'V2':
                    kwargs['v2_additions'] = v2_additions()
                self.assertEqual(self.run_validation(b, a, stage, **kwargs).status, 'UNEXPECTED_CHANGE')

    def test_v1_nonnull_baseline_checksum_identical_rejected(self):
        b = baseline(); b['audit']['history_rows'][0]['checksum'] = 123; sync(b)
        self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status, 'UNEXPECTED_CHANGE')

    def test_v1_history_missing_script_is_insufficient(self):
        b = baseline(); a = copy.deepcopy(b); del a['audit']['history_rows'][0]['script']
        self.assertEqual(self.run_validation(b, a).status, 'INSUFFICIENT_EVIDENCE')

    def test_v1_original_actor_time_duration_preserved_in_all_stages(self):
        for stage in ('V1', 'V2', 'V3'):
            for field, value in [('installed_by', 'other_actor'),
                                 ('installed_on', '2026-10-12T00:00:00+00:00'),
                                 ('execution_time', 99)]:
                with self.subTest(stage=stage, field=field):
                    b = apply_v2(baseline()) if stage == 'V3' else baseline()
                    a = copy.deepcopy(b) if stage == 'V1' else apply_v2(b) if stage == 'V2' else apply_v3(b)
                    a['audit']['history_rows'][0][field] = value; sync(a)
                    kwargs = {} if stage == 'V1' else {'migration_actor': 'migration'}
                    if stage == 'V2':
                        kwargs['v2_additions'] = v2_additions()
                    self.assertEqual(self.run_validation(b, a, stage, **kwargs).status, 'UNEXPECTED_CHANGE')

    def test_v1_baseline_observation_fields_are_not_fixed_snapshot_constants(self):
        b = baseline()
        b['audit']['history_rows'][0].update(installed_by='verified_actor',
            installed_on='2026-10-01T09:00:00+09:00', execution_time=27)
        sync(b)
        self.assertEqual(self.run_validation(b, copy.deepcopy(b)).status, 'PASS')


if __name__ == '__main__':
    unittest.main()
