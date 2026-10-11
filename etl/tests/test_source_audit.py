"""Synthetic contract tests; no DB, private inputs or evidence files."""
import ast
import copy
import hashlib
import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_source_validation import baseline, apply_v2, apply_v3, store, v2_additions

try:
    audit = importlib.import_module('source_audit')
except ModuleNotFoundError as exc:
    if exc.name != 'source_audit': raise
    audit = None

PROFILE = {'version': 1, 'row_text': 'pg-jsonb-text-utf8-length8-sha256-v1',
           'ids': 'control-int-ascending-length8-sha256-v1',
           'v3_projection': 'control-json-id-ascending-sha256-v1',
           'payload': 'control-json-sha256-v1'}


def sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False).encode()).hexdigest()


def fixture(mode='V1'):
    p = baseline([store(1), store(2)])
    if mode in ('V2', 'V3'): p = apply_v2(p)
    if mode == 'V3': p = apply_v3(p)
    p = {k: v for k, v in p.items() if k != '_rows'}
    if mode != 'V3':
        del p['v3_rows']; del p['audit']['projections']
    artifacts = {'git_sha': 'a' * 40, 'sql_hashes': {'V2': '1' * 64, 'V3': '2' * 64},
        'collector_code_hash': '3' * 64, 'validator_code_hash': '4' * 64,
        'input_hashes': {'admin': '5' * 64, 'commercial': '6' * 64},
        'profile_hashes': {'admin': '7' * 64, 'commercial': '8' * 64},
        'serialization_profile': copy.deepcopy(PROFILE),
        'v2_additions_hash': sha(v2_additions()) if mode == 'V2' else None}
    claims = {'database': 'synthetic-private-db', 'user': 'fixture-auditor',
        'session_user': 'fixture-auditor', 'system_identifier': '123456',
        'container_id': 'b' * 64, 'image_id': 'sha256:' + 'c' * 64, 'network_id': 'd' * 64,
        'endpoint': {'transport': 'tcp', 'identity_hash': 'e' * 64}, 'postgres_version': '16.4'}
    consistency = {'connection_id': 'connection-1', 'transaction_id': 'transaction-1',
        'isolation': 'repeatable read', 'read_only': True,
        'snapshot_id': None, 'snapshot_descriptor': '100:101:',
        'started_at': 1000, 'finished_at': 1004, 'reconnected': False, 'recollected': False}
    stage, sequence = {'V1': ('PRECHECK', 1), 'V2': ('V2_VERIFIED', 4), 'V3': ('V3_VERIFIED', 6)}[mode]
    e = {'schema_version': 1, 'kind': 'UNVERIFIED_CLAIMS', 'run_id': 'run-1',
        'collection_id': 'collection-1', 'stage': stage, 'stage_sequence': sequence,
        'validation_stage': mode, 'artifacts': artifacts, 'claims': claims,
        'consistency': consistency, 'bindings': [], 'payload_digest': sha(p),
        'previous_evidence_digest': None if mode == 'V1' else 'f' * 64,
        'scope': {'tables': sorted(p['snapshot']['physical']),
            'columns': {t: [c['column_name'] for c in cols] for t, cols in p['snapshot']['columns'].items()},
            'catalog_objects': sorted(p['audit']['acl']['objects'])}, 'collection_outcome': 'CONFIRMED'}
    for component in ('snapshot', 'audit', 'v3_rows'):
        if component not in p: continue
        e['bindings'].append({'component': component, 'run_id': e['run_id'],
            'collection_id': e['collection_id'], 'stage': stage, 'stage_sequence': sequence,
            'connection_id': consistency['connection_id'], 'transaction_id': consistency['transaction_id'],
            'snapshot_id': consistency['snapshot_id'], 'snapshot_descriptor': consistency['snapshot_descriptor'],
            'component_digest': sha(p[component])})
    expected = {k: copy.deepcopy(e[k]) for k in ('run_id', 'collection_id', 'stage',
                'stage_sequence', 'validation_stage', 'artifacts', 'previous_evidence_digest')}
    expected['target'] = copy.deepcopy(claims)
    expected['window'] = {k: consistency[k] for k in ('connection_id', 'transaction_id',
                                                   'snapshot_id', 'snapshot_descriptor')}
    return p, e, expected


def rebind(p, e):
    e['payload_digest'] = sha(p)
    for binding in e['bindings']:
        if binding['component'] in p:
            binding['component_digest'] = sha(p[binding['component']])


class SourceAuditTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(audit, 'pure audit contract not implemented')
        self.p, self.e, self.expected = fixture()

    def check(self, **kwargs):
        return audit.validate_contract(self.p, self.e, self.expected, now=1005, **kwargs)

    def test_valid_v1_without_v3_supplement(self):
        r = self.check()
        self.assertEqual(r.status, 'CONTRACT_VALID_UNVERIFIED')
        self.assertTrue(r.contract_valid)

    def test_stage_specific_v2_and_v3_contracts(self):
        for mode in ('V2', 'V3'):
            with self.subTest(mode=mode):
                p, e, expected = fixture(mode)
                kwargs = {'v2_additions': v2_additions()} if mode == 'V2' else {}
                self.assertTrue(audit.validate_contract(p, e, expected, now=1005, **kwargs).contract_valid)

    def test_missing_payload_and_audit_sections_rejected(self):
        for owner, key in [('payload', 'snapshot'), ('payload', 'audit'), ('payload', 'outcome'),
            ('snapshot', 'physical'), ('snapshot', 'raw'), ('snapshot', 'columns'),
            ('snapshot', 'sequences'), ('snapshot', 'history'), ('audit', 'ids'),
            ('audit', 'nulls'), ('audit', 'points'), ('audit', 'catalog'), ('audit', 'acl'),
            ('audit', 'sequence_definitions'), ('audit', 'history_rows')]:
            with self.subTest(key=key):
                p, e, expected = fixture()
                del (p if owner == 'payload' else p[owner])[key]; rebind(p, e)
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'MISSING_EVIDENCE')

    def test_sql_null_is_present_but_missing_acl_is_not_null(self):
        self.assertTrue(self.check().contract_valid)
        del self.p['audit']['acl']['database']['acl']; rebind(self.p, self.e)
        self.assertEqual(self.check().status, 'MISSING_EVIDENCE')

    def test_null_zero_empty_string_and_no_rows_remain_distinct(self):
        results = [audit.row_text_digest(rows) for rows in (['null'], ['0'], ['""'], [])]
        self.assertEqual(len({r['sha256'] for r in results}), 4)
        self.assertEqual(results[-1]['rows'], 0)

    def test_utf8_row_digest_preserves_exact_input_text(self):
        text = '{"이름": "카페", "값": null}'
        raw = text.encode('utf8')
        expected = hashlib.sha256(len(raw).to_bytes(8, 'big') + raw).hexdigest()
        self.assertEqual(audit.row_text_digest([text]), {'rows': 1, 'sha256': expected})
        self.assertNotEqual(audit.row_text_digest(['{"a": 1}']), audit.row_text_digest(['{"a":1}']))

    def test_matches_existing_digest_records_without_importing_db_helpers(self):
        path = Path(__file__).with_name('integration_support.py')
        node = next(n for n in ast.parse(path.read_text()).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'digest_records')
        namespace = {'hashlib': hashlib}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)
        rows = ['null', '0', '""', '{"한글": "카페"}']
        self.assertEqual(audit.row_text_digest(iter(rows)), namespace['digest_records'](iter(rows)))

    def test_row_order_and_length_framing_are_not_normalized(self):
        self.assertNotEqual(audit.row_text_digest(['a', 'bc']), audit.row_text_digest(['ab', 'c']))
        self.assertNotEqual(audit.row_text_digest(['a', 'b']), audit.row_text_digest(['b', 'a']))

    def test_python_objects_and_bytes_are_not_pg_row_text(self):
        for rows in ([{'id': 1}], [b'{}']):
            with self.subTest(type=type(rows[0]).__name__), self.assertRaises(audit.AuditContractError):
                audit.row_text_digest(rows)

    def test_integer_id_digest_and_bigint_precision(self):
        ids = [1, 9007199254740993, 9223372036854775807]
        framed = b''.join(len(str(i).encode()).to_bytes(8, 'big') + str(i).encode() for i in ids)
        self.assertEqual(audit.id_digest(ids), {'rows': 3, 'sha256': hashlib.sha256(framed).hexdigest()})

    def test_duplicate_unsorted_bool_and_float_ids_rejected(self):
        for ids, category in [([1, 1], 'DUPLICATE_ID'), ([2, 1], 'ORDER_VIOLATION'),
                              ([True], 'INVALID_TYPE'), ([1.0], 'INVALID_TYPE')]:
            with self.subTest(ids=ids), self.assertRaises(audit.AuditContractError) as exc:
                audit.id_digest(ids)
            self.assertEqual(exc.exception.category, category)

    def test_v3_projection_digest_matches_control_digest(self):
        p, _, _ = fixture('V3')
        from control import digest
        original = copy.deepcopy(p['v3_rows'])
        self.assertEqual(audit.projection_digest(p['v3_rows']), digest(p['v3_rows']))
        self.assertEqual(p['v3_rows'], original)

    def test_v3_rejects_missing_row_and_field(self):
        for corruption in ('row', 'field'):
            with self.subTest(corruption=corruption):
                p, e, expected = fixture('V3')
                if corruption == 'row': p['v3_rows']['stores'].pop()
                else: del p['v3_rows']['stores'][0]['industry_id']
                p['audit']['projections']['v3'] = sha(p['v3_rows']); rebind(p, e)
                self.assertFalse(audit.validate_contract(p, e, expected, now=1005).contract_valid)

    def test_v3_projection_sorting_is_rejected_not_repaired(self):
        p, e, expected = fixture('V3'); p['v3_rows']['stores'].reverse()
        original = copy.deepcopy(p)
        p['audit']['projections']['v3'] = sha(p['v3_rows']); rebind(p, e)
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'ORDER_VIOLATION')
        self.assertEqual(p['v3_rows'], original['v3_rows'])

    def test_v3_supplement_missing_is_stage_specific(self):
        self.assertTrue(self.check().contract_valid)
        p, e, expected = fixture('V3'); del p['v3_rows']; rebind(p, e)
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'MISSING_EVIDENCE')

    def test_v3_duplicate_ids_rejected(self):
        p, e, expected = fixture('V3'); p['v3_rows']['stores'][1]['id'] = 1
        p['audit']['projections']['v3'] = sha(p['v3_rows']); rebind(p, e)
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'DUPLICATE_ID')

    def test_row_and_id_count_mismatch_rejected(self):
        self.p['audit']['ids']['stores']['rows'] += 1; rebind(self.p, self.e)
        self.assertEqual(self.check().status, 'COUNT_MISMATCH')

    def test_hash_shape_and_payload_digest_mismatch(self):
        self.e['payload_digest'] = 'not-a-hash'
        self.assertEqual(self.check().status, 'INVALID_HASH')
        self.e['payload_digest'] = '0' * 64
        self.assertEqual(self.check().status, 'PAYLOAD_DIGEST_MISMATCH')

    def test_payload_tamper_after_binding_rejected(self):
        self.p['audit']['nulls']['stores']['name'] = 0
        self.assertEqual(self.check().status, 'PAYLOAD_DIGEST_MISMATCH')

    def test_profile_unknown_or_modified_rejected(self):
        self.e['artifacts']['serialization_profile']['row_text'] = 'python-reserialized'
        self.assertEqual(self.check().status, 'INVALID_PROFILE')
        with self.assertRaises(audit.AuditContractError): audit.row_text_digest(['{}'], profile='unknown')

    def test_other_run_or_collection_id_rejected(self):
        for field, status in [('run_id', 'RUN_MISMATCH'), ('collection_id', 'COLLECTION_MISMATCH')]:
            with self.subTest(field=field):
                p, e, expected = fixture(); e[field] = 'another'
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, status)

    def test_stage_and_sequence_mismatch_rejected(self):
        for field, value in [('stage', 'V3_VERIFIED'), ('stage_sequence', 0), ('validation_stage', 'V3')]:
            with self.subTest(field=field):
                p, e, expected = fixture(); e[field] = value
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'STAGE_MISMATCH')

    def test_snapshot_mix_across_components_rejected(self):
        self.e['bindings'][1]['snapshot_descriptor'] = '200:201:'
        self.assertEqual(self.check().status, 'SNAPSHOT_MISMATCH')

    def test_other_connection_or_transaction_claim_rejected(self):
        for field in ('connection_id', 'transaction_id'):
            with self.subTest(field=field):
                p, e, expected = fixture(); e['bindings'][0][field] = 'other'
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'CONNECTION_MISMATCH')

    def test_recollection_or_reconnection_is_unverified(self):
        for field in ('reconnected', 'recollected'):
            with self.subTest(field=field):
                p, e, expected = fixture(); e['consistency'][field] = True
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'RECOLLECTION_UNVERIFIED')

    def test_missing_connection_identity_is_missing_evidence(self):
        del self.e['consistency']['connection_id']
        self.assertEqual(self.check().status, 'MISSING_EVIDENCE')

    def test_future_expired_and_reversed_times_rejected(self):
        for start, finish, now, status in [(1000, 1006, 1005, 'FUTURE_EVIDENCE'),
            (1000, 1004, 2800, 'STALE_EVIDENCE'), (1004, 1000, 1005, 'INVALID_TIME')]:
            with self.subTest(status=status):
                p, e, expected = fixture(); e['consistency'].update(started_at=start, finished_at=finish)
                self.assertEqual(audit.validate_contract(p, e, expected, now=now).status, status)

    def test_bool_and_nonfinite_time_types_rejected(self):
        for value in (True, float('nan'), float('inf')):
            with self.subTest(value=str(value)):
                self.assertFalse(audit.validate_contract(self.p, self.e, self.expected, now=value).contract_valid)

    def test_target_code_input_and_previous_evidence_are_bound(self):
        for field in ('target', 'artifacts', 'previous_evidence_digest'):
            with self.subTest(field=field):
                p, e, expected = fixture()
                if field == 'target': e['claims']['container_id'] = 'f' * 64
                elif field == 'artifacts': e['artifacts']['input_hashes']['admin'] = 'f' * 64
                else: e[field] = 'f' * 64
                self.assertFalse(audit.validate_contract(p, e, expected, now=1005).contract_valid)

    def test_declared_scope_matches_payload(self):
        self.e['scope']['columns']['stores'].pop()
        self.assertEqual(self.check().status, 'SCOPE_MISMATCH')

    def test_component_digest_and_binding_coverage_rejected(self):
        self.e['bindings'][0]['component_digest'] = 'f' * 64
        self.assertEqual(self.check().status, 'COMPONENT_DIGEST_MISMATCH')
        self.e['bindings'] = []
        self.assertEqual(self.check().status, 'MISSING_EVIDENCE')

    def test_unknown_outcome_never_valid(self):
        self.p['outcome'] = 'UNKNOWN'; self.e['collection_outcome'] = 'UNKNOWN'; rebind(self.p, self.e)
        self.assertEqual(self.check().status, 'COLLECTION_UNCONFIRMED')

    def test_v2_additions_shape_reference_and_hash_are_required(self):
        p, e, expected = fixture('V2')
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'MISSING_EVIDENCE')
        ref = v2_additions(); self.assertTrue(audit.validate_v2_additions(ref).contract_valid)
        ref['catalog_tables']['rogue'] = copy.deepcopy(ref['catalog_tables']['admin_dong_boundaries'])
        self.assertFalse(audit.validate_v2_additions(ref).contract_valid)
        self.assertFalse(audit.validate_contract(p, e, expected, now=1005, v2_additions=ref).contract_valid)

    def test_inputs_are_unchanged(self):
        p, e, expected = fixture('V3'); original = copy.deepcopy((p, e, expected))
        self.assertTrue(audit.validate_contract(p, e, expected, now=1005).contract_valid)
        self.assertEqual((p, e, expected), original)

    def test_structural_success_cannot_be_db_pass_or_authorization(self):
        r = self.check()
        self.assertEqual(r.status, 'CONTRACT_VALID_UNVERIFIED')
        self.assertFalse(bool(r)); self.assertFalse(r.db_observed); self.assertFalse(r.execution_authorized)
        from source_control import deny_execution, SourceControlError
        with self.assertRaises(SourceControlError): deny_execution(r)

    def test_no_preservation_comparison_or_execution_controller_called(self):
        with patch('source_validation.validate_preservation', side_effect=AssertionError('preservation comparison')), \
             patch('source_control.SourceSimulation', side_effect=AssertionError('execution controller')):
            self.assertTrue(self.check().contract_valid)

    def test_sensitive_values_are_not_echoed_in_error_result(self):
        self.e['claims']['database'] = 'secret://synthetic-private-value'
        r = self.check()
        self.assertFalse(r.contract_valid)
        self.assertNotIn('synthetic-private-value', repr(r))
        self.assertNotIn('secret://', repr(r))

    def test_unknown_raw_or_point_table_is_not_declared_coverage(self):
        for owner, key in [('snapshot', 'raw'), ('audit', 'points')]:
            with self.subTest(key=key):
                p, e, expected = fixture()
                p[owner][key]['rogue'] = {'rows': 2, 'sha256': 'a' * 64}; rebind(p, e)
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'SCOPE_MISMATCH')

    def test_every_declared_zero_row_digest_requires_empty_sha(self):
        p, e, expected = fixture()
        empty = baseline()
        p['snapshot'] = copy.deepcopy(empty['snapshot']); p['audit'] = copy.deepcopy(empty['audit'])
        del p['audit']['projections']
        rebind(p, e)
        self.assertTrue(audit.validate_contract(p, e, expected, now=1005).contract_valid)
        for owner, block in [('snapshot', 'physical'), ('snapshot', 'raw'), ('audit', 'ids'), ('audit', 'points')]:
            with self.subTest(block=block):
                bad = copy.deepcopy(p); envelope = copy.deepcopy(e)
                bad[owner][block]['stores']['sha256'] = 'a' * 64; rebind(bad, envelope)
                self.assertEqual(audit.validate_contract(bad, envelope, expected, now=1005).status, 'COUNT_MISMATCH')
        p, e, expected = fixture('V2')
        p['audit']['points']['admin_dong_boundaries'] = {'rows': 0, 'sha256': 'a' * 64}
        rebind(p, e)
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005,
                                               v2_additions=v2_additions()).status, 'COUNT_MISMATCH')

    def test_nonzero_rows_cannot_declare_empty_sha_in_any_digest_map(self):
        empty_sha = hashlib.sha256(b'').hexdigest()
        for owner, block in [('snapshot', 'physical'), ('snapshot', 'raw'), ('audit', 'ids'), ('audit', 'points')]:
            with self.subTest(block=block):
                p, e, expected = fixture()
                self.assertEqual(p[owner][block]['stores']['rows'], 2)
                p[owner][block]['stores']['sha256'] = empty_sha; rebind(p, e)
                original = copy.deepcopy((p, e, expected))
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'COUNT_MISMATCH')
                self.assertEqual((p, e, expected), original)

    def test_normal_empty_and_nonempty_declared_digests_still_valid(self):
        self.assertTrue(self.check().contract_valid)
        p, e, expected = fixture()
        empty = baseline()
        p['snapshot'] = copy.deepcopy(empty['snapshot']); p['audit'] = copy.deepcopy(empty['audit'])
        del p['audit']['projections']; rebind(p, e)
        self.assertTrue(audit.validate_contract(p, e, expected, now=1005).contract_valid)
        for owner, block in [('snapshot', 'physical'), ('snapshot', 'raw'), ('audit', 'ids'), ('audit', 'points')]:
            self.assertEqual(p[owner][block]['stores'], {'rows': 0, 'sha256': hashlib.sha256(b'').hexdigest()})

    def test_precheck_sha_predecessor_rejected_even_if_expected_matches(self):
        self.assertTrue(self.check().contract_valid)
        self.e['previous_evidence_digest'] = 'f' * 64
        self.expected['previous_evidence_digest'] = 'f' * 64
        self.assertEqual(self.check().status, 'STRUCTURE_MISMATCH')

    def test_v2_v3_missing_predecessor_rejected_even_if_expected_matches(self):
        for mode in ('V2', 'V3'):
            with self.subTest(mode=mode):
                p, e, expected = fixture(mode)
                e['previous_evidence_digest'] = None; expected['previous_evidence_digest'] = None
                kwargs = {'v2_additions': v2_additions()} if mode == 'V2' else {}
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005, **kwargs).status,
                                 'MISSING_EVIDENCE')

    def test_all_followup_labels_require_and_accept_predecessor_hash(self):
        from control import STAGES
        for sequence, stage in enumerate(STAGES[1:], 2):
            with self.subTest(stage=stage):
                p, e, expected = fixture()
                e.update(stage=stage, stage_sequence=sequence, previous_evidence_digest='f' * 64)
                expected.update(stage=stage, stage_sequence=sequence, previous_evidence_digest='f' * 64)
                for binding in e['bindings']:
                    binding.update(stage=stage, stage_sequence=sequence)
                self.assertTrue(audit.validate_contract(p, e, expected, now=1005).contract_valid)
                e['previous_evidence_digest'] = None; expected['previous_evidence_digest'] = None
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'MISSING_EVIDENCE')

    def test_predecessor_key_hash_format_and_expected_binding_preserved(self):
        for owner in ('envelope', 'expected'):
            with self.subTest(owner=owner):
                p, e, expected = fixture('V3')
                del (e if owner == 'envelope' else expected)['previous_evidence_digest']
                self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'MISSING_EVIDENCE')
        p, e, expected = fixture('V3'); e['previous_evidence_digest'] = 'not-a-hash'
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'INVALID_HASH')
        e['previous_evidence_digest'] = 'a' * 64
        self.assertEqual(audit.validate_contract(p, e, expected, now=1005).status, 'CONTEXT_MISMATCH')


if __name__ == '__main__':
    unittest.main()
