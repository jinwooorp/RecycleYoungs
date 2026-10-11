"""DB-free tests of an inert source controller and explicitly synthetic model."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    source = importlib.import_module('source_control')
except ModuleNotFoundError as exc:
    if exc.name != 'source_control':
        raise
    source = None

STEPS = ('PRECHECK', 'BACKUP_RESTORE_VERIFIED', 'V2_APPLIED', 'V2_VERIFIED',
         'V3_APPLIED', 'V3_VERIFIED', 'ADMIN_POLYGON_APPLIED', 'ADMIN_POLYGON_VERIFIED',
         'COMMERCIAL_POLYGON_APPLIED', 'COMMERCIAL_POLYGON_VERIFIED', 'FINAL_VERIFIED')


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False).encode()).hexdigest()


def plan():
    return {'run_id': 'synthetic-run-1', 'git_head': 'b' * 40,
            'target': {'database': 'startup_analysis', 'user': 'fixture_actor',
                'system_identifier': '123456', 'container_id': 'a' * 64,
                'container_name': 'startup-analysis-postgres', 'image_id': 'sha256:' + 'c' * 64,
                'network_id': 'd' * 64, 'host': 'fixture', 'port': 5432,
                'data_directory': '/fixture/pgdata', 'volume_name': 'recycleyoungs_postgres_data'},
            'scope': ['V2', 'V3', 'ADMIN_POLYGON', 'COMMERCIAL_POLYGON'],
            'hashes': {'V2_SQL': '1' * 64, 'V3_SQL': '2' * 64,
                       'ADMIN_INPUT': '3' * 64, 'COMMERCIAL_INPUT': '4' * 64},
            'validation_policy_hash': '5' * 64}


def approval(p):
    return {'kind': 'SIMULATED_ONLY', 'run_id': p['run_id'], 'plan_hash': fingerprint(p),
            'target': copy.deepcopy(p['target']), 'scope': copy.deepcopy(p['scope']),
            'issued_at': 1000, 'expires_at': 1200,
            'user_confirmation': {'kind': 'SIMULATED_ONLY', 'actor': 'fixture-human',
                'target_hash': fingerprint(p['target']), 'scope': copy.deepcopy(p['scope'])},
            'latest_verification': {'kind': 'SIMULATED_ONLY', 'plan_hash': fingerprint(p),
                'snapshot_id': 'synthetic-snapshot-1', 'evidence_hash': '6' * 64, 'observed_at': 1000},
            'backup_recovery': {'kind': 'SIMULATED_ONLY', 'snapshot_id': 'synthetic-snapshot-1',
                'backup_hash': '7' * 64, 'restore_hash': '8' * 64,
                'state': 'VERIFIED', 'observed_at': 1000}}


class SourceControlTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(source, 'inert source controller not implemented')
        self.p = plan(); self.a = approval(self.p); self.now = 1000

    def model(self, **kwargs):
        return source.SourceSimulation(self.p, self.a, clock=lambda: self.now, **kwargs)

    def evidence(self, model, stage='PRECHECK', outcome='PASS'):
        return model.synthetic_evidence(stage, outcome, evidence_refs={'audit': '9' * 64})

    def advance(self, model, evidence):
        return model.advance(evidence, current_plan=self.p, current_approval=self.a)

    def assert_stopped(self, model, category):
        self.assertEqual(model.state, 'STOP')
        self.assertEqual(model.stop_category, category)
        self.assertFalse(model.simulated_complete)
        self.assertIs(model.inspect()['execution_enabled'], False)
        self.assertIs(model.inspect()['rollback_confirmed'], False)

    def test_default_cli_inspects_without_connections_commands_or_files(self):
        out = io.StringIO()
        with patch('builtins.open', side_effect=AssertionError('file access')), \
             patch('pathlib.Path.open', side_effect=AssertionError('path access')), \
             patch('subprocess.Popen', side_effect=AssertionError('external command')), \
             patch('control.Controller', side_effect=AssertionError('isolated backend')), \
             patch.dict('os.environ', {'SOURCE_EXECUTE': 'true', 'FLYWAY_URL': 'fixture'}, clear=True), \
             redirect_stdout(out):
            self.assertEqual(source.main([]), 0)
        report = json.loads(out.getvalue())
        self.assertEqual(report['status'], 'NOT_READY')
        self.assertEqual(report['stages'], list(STEPS))
        self.assertIs(report['execution_enabled'], False)

    def test_execution_flags_are_not_cli_options(self):
        for flag in ('--execute', '--migrate', '--load', '--resume'):
            with self.subTest(flag=flag), redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as exc:
                    source.main([flag])
                self.assertEqual(exc.exception.code, 2)

    def test_any_manifest_or_string_cannot_enable_execution(self):
        for value in (None, 'APPROVED', self.a, {'kind': 'APPROVED_FOR_SPECIFIC_RUN'}):
            with self.subTest(value=type(value).__name__), self.assertRaises(source.SourceControlError) as exc:
                source.deny_execution(value)
            self.assertEqual(exc.exception.category, 'EXECUTION_REJECTED')

    def test_normal_order_is_only_a_simulation(self):
        model = self.model()
        with patch('subprocess.Popen', side_effect=AssertionError('command')), \
             patch('control.Controller', side_effect=AssertionError('backend')):
            for stage in STEPS:
                self.now += 1
                record = self.advance(model, self.evidence(model, stage))
                self.assertEqual(record['kind'], 'SIMULATED_ONLY')
            self.assertTrue(model.simulated_complete)
        self.assertEqual(model.state, 'SIMULATION_COMPLETE')
        self.assertEqual(model.inspect()['status'], 'NOT_READY')
        with self.assertRaises(source.SourceControlError):
            model.request_execution(self.a)
        self.assert_stopped(model, 'EXECUTION_REJECTED')

    def test_real_approval_marker_is_not_accepted_as_simulation(self):
        self.a['kind'] = 'APPROVED_FOR_SPECIFIC_RUN'
        with self.assertRaises(source.SourceControlError):
            self.model()

    def test_missing_approval_is_insufficient(self):
        with self.assertRaises(source.SourceControlError) as exc:
            source.SourceSimulation(self.p, None, clock=lambda: self.now)
        self.assertEqual(exc.exception.category, 'INSUFFICIENT_EVIDENCE')

    def test_approval_target_scope_and_plan_mismatch_rejected(self):
        for field, value in [('target', {}), ('scope', ['V2']), ('plan_hash', '0' * 64),
                             ('run_id', 'other-run')]:
            with self.subTest(field=field):
                a = copy.deepcopy(self.a); a[field] = value
                with self.assertRaises(source.SourceControlError):
                    source.SourceSimulation(self.p, a, clock=lambda: self.now)

    def test_unknown_backup_or_verification_evidence_rejected(self):
        for section in ('latest_verification', 'backup_recovery', 'user_confirmation'):
            with self.subTest(section=section):
                a = copy.deepcopy(self.a); del a[section]
                with self.assertRaises(source.SourceControlError) as exc:
                    source.SourceSimulation(self.p, a, clock=lambda: self.now)
                self.assertEqual(exc.exception.category, 'INSUFFICIENT_EVIDENCE')
        self.a['backup_recovery']['state'] = 'UNKNOWN'
        with self.assertRaises(source.SourceControlError):
            self.model()

    def test_backup_and_verification_must_share_snapshot(self):
        self.a['backup_recovery']['snapshot_id'] = 'other-snapshot'
        with self.assertRaises(source.SourceControlError):
            self.model()

    def test_confirmation_target_and_scope_are_bound(self):
        for field, value in [('target_hash', '0' * 64), ('scope', ['V2'])]:
            with self.subTest(field=field):
                a = copy.deepcopy(self.a); a['user_confirmation'][field] = value
                with self.assertRaises(source.SourceControlError):
                    source.SourceSimulation(self.p, a, clock=lambda: self.now)

    def test_context_change_stops_before_advancing(self):
        for section in ('target', 'scope', 'git_head', 'hashes', 'validation_policy_hash'):
            with self.subTest(section=section):
                self.p = plan(); self.a = approval(self.p)
                model = self.model(); token = self.evidence(model)
                if section == 'target': self.p[section]['container_id'] = 'f' * 64
                elif section == 'scope': self.p[section] = ['V2']
                elif section == 'hashes': self.p[section]['ADMIN_INPUT'] = 'f' * 64
                else: self.p[section] = 'f' * (40 if section == 'git_head' else 64)
                with self.assertRaises(source.SourceControlError): self.advance(model, token)
                self.assert_stopped(model, 'CONTEXT_CHANGED')
                self.assertEqual(model.records, ())

    def test_approval_change_after_start_stops(self):
        model = self.model(); token = self.evidence(model)
        self.a['expires_at'] += 1
        with self.assertRaises(source.SourceControlError): self.advance(model, token)
        self.assert_stopped(model, 'APPROVAL_MISMATCH')

    def test_missing_reverse_or_duplicate_stage_stops(self):
        for stages in [('V2_APPLIED',), ('BACKUP_RESTORE_VERIFIED',), ('PRECHECK', 'PRECHECK')]:
            with self.subTest(stages=stages):
                model = self.model()
                for stage in stages[:-1]: self.advance(model, self.evidence(model, stage))
                with self.assertRaises(source.SourceControlError):
                    self.advance(model, self.evidence(model, stages[-1]))
                self.assert_stopped(model, 'ORDER_REJECTED')

    def test_failure_unknown_and_insufficient_are_terminal(self):
        for outcome, category in [('FAIL', 'VERIFICATION_FAILED'), ('UNKNOWN', 'UNKNOWN'),
                                  ('INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE')]:
            with self.subTest(outcome=outcome):
                model = self.model()
                with self.assertRaises(source.SourceControlError):
                    self.advance(model, self.evidence(model, outcome=outcome))
                self.assert_stopped(model, category)
                with self.assertRaises(source.SourceControlError) as exc:
                    self.advance(model, {'outcome': 'PASS'})
                self.assertEqual(exc.exception.category, 'TERMINAL_STOP')

    def test_pass_without_refs_is_insufficient(self):
        model = self.model(); token = model.synthetic_evidence('PRECHECK', 'PASS', evidence_refs={})
        with self.assertRaises(source.SourceControlError): self.advance(model, token)
        self.assert_stopped(model, 'INSUFFICIENT_EVIDENCE')

    def test_external_pass_text_does_not_count_as_evidence(self):
        model = self.model()
        with self.assertRaises(source.SourceControlError): self.advance(model, 'PASS')
        self.assert_stopped(model, 'INSUFFICIENT_EVIDENCE')

    def test_evidence_tamper_even_rehashed_is_rejected(self):
        for field, value in [('outcome', 'FAIL'), ('issued_at', 999), ('kind', 'REAL_VERIFIED'),
                             ('evidence_refs', {'audit': 'f' * 64})]:
            with self.subTest(field=field):
                model = self.model(); token = self.evidence(model); token[field] = value
                with self.assertRaises(source.SourceControlError): self.advance(model, token)
                self.assert_stopped(model, 'TAMPERED_EVIDENCE')

    def test_cross_run_evidence_is_rejected(self):
        model = self.model(); token = self.evidence(model)
        p = plan(); p['run_id'] = 'other-run'
        other = source.SourceSimulation(p, approval(p), clock=lambda: self.now)
        with self.assertRaises(source.SourceControlError):
            other.advance(token, current_plan=p, current_approval=approval(p))
        self.assert_stopped(other, 'CROSS_RUN_EVIDENCE')

    def test_new_instance_cannot_reuse_old_pass_even_same_run_id(self):
        first = self.model(); old = self.evidence(first)
        self.advance(first, old)
        second = self.model()
        with self.assertRaises(source.SourceControlError): self.advance(second, old)
        self.assert_stopped(second, 'TAMPERED_EVIDENCE')

    def test_stale_and_future_evidence_rejected(self):
        for now, category in [(1200, 'STALE'), (999, 'FUTURE_EVIDENCE')]:
            with self.subTest(now=now):
                self.now = 1000; model = self.model(); token = self.evidence(model)
                self.now = now
                with self.assertRaises(source.SourceControlError): self.advance(model, token)
                self.assert_stopped(model, category)

    def test_future_and_expired_approval_rejected_before_simulation(self):
        for key, value in [('issued_at', 1001), ('expires_at', 1000)]:
            with self.subTest(key=key):
                a = copy.deepcopy(self.a); a[key] = value
                with self.assertRaises(source.SourceControlError):
                    source.SourceSimulation(self.p, a, clock=lambda: self.now)

    def test_expired_previous_pass_cannot_continue(self):
        model = self.model(); self.advance(model, self.evidence(model))
        self.now = 1200
        with self.assertRaises(source.SourceControlError):
            model.synthetic_evidence('BACKUP_RESTORE_VERIFIED', 'PASS', evidence_refs={'audit': '9' * 64})
        self.assert_stopped(model, 'STALE')

    def test_completed_simulation_expires(self):
        model = self.model()
        for stage in STEPS: self.advance(model, self.evidence(model, stage))
        self.now = 1200
        self.assertFalse(model.simulated_complete)
        self.assert_stopped(model, 'STALE')

    def test_stop_never_resumes_or_claims_rollback(self):
        model = self.model(); self.advance(model, self.evidence(model))
        with self.assertRaises(source.SourceControlError): model.stop_unknown('TIMEOUT')
        self.assert_stopped(model, 'UNKNOWN')
        with self.assertRaises(source.SourceControlError) as exc: model.resume()
        self.assertEqual(exc.exception.category, 'TERMINAL_STOP')
        self.assertEqual(model.inspect()['db_state'], 'UNMEASURED')

    def test_no_backend_or_resume_state_can_be_supplied(self):
        for key in ('backend', 'executor', 'records', 'resume'):
            with self.subTest(key=key), self.assertRaises(TypeError):
                source.SourceSimulation(self.p, self.a, clock=lambda: self.now, **{key: object()})

    def test_input_and_returned_records_are_not_live_mutable_state(self):
        originals = copy.deepcopy((self.p, self.a))
        model = self.model(); token = self.evidence(model)
        result = self.advance(model, token); result['outcome'] = 'UNKNOWN'; token['outcome'] = 'FAIL'
        exported = model.records; exported[0]['outcome'] = 'FAIL'
        self.assertEqual(model.records[0]['outcome'], 'PASS')
        self.assertEqual((self.p, self.a), originals)
        self.assertIs(model.inspect()['execution_enabled'], False)

    def test_clock_nan_error_or_reversal_is_terminal(self):
        model = self.model(); self.advance(model, self.evidence(model)); self.now = float('nan')
        self.assertFalse(model.simulated_complete)
        self.assert_stopped(model, 'UNKNOWN')
        self.now = 1000; model = self.model(); self.now = 1001
        self.advance(model, self.evidence(model)); self.now = 1000
        with self.assertRaises(source.SourceControlError): self.advance(model, {})
        self.assert_stopped(model, 'FUTURE_EVIDENCE')

    def test_malformed_refs_stop_instead_of_allowing_another_attempt(self):
        model = self.model(); valid = self.evidence(model)
        with self.assertRaises(source.SourceControlError):
            model.synthetic_evidence('PRECHECK', 'PASS', evidence_refs={'audit': object()})
        self.assert_stopped(model, 'INSUFFICIENT_EVIDENCE')
        with self.assertRaises(source.SourceControlError) as exc: self.advance(model, valid)
        self.assertEqual(exc.exception.category, 'TERMINAL_STOP')

    def test_unencodable_context_approval_or_token_stops(self):
        for part in ('plan', 'approval', 'token'):
            with self.subTest(part=part):
                model = self.model(); valid = self.evidence(model)
                p, a, token = copy.deepcopy((self.p, self.a, valid))
                if part == 'plan': p['run_id'] = chr(0xd800)
                elif part == 'approval': a['user_confirmation']['actor'] = chr(0xd800)
                else: token['evidence_refs'][chr(0xd800)] = 'f' * 64
                with self.assertRaises(source.SourceControlError):
                    model.advance(token, current_plan=p, current_approval=a)
                self.assert_stopped(model, 'INSUFFICIENT_EVIDENCE')
                with self.assertRaises(source.SourceControlError) as exc: self.advance(model, valid)
                self.assertEqual(exc.exception.category, 'TERMINAL_STOP')

    def test_inspect_and_state_detect_expiry_without_a_complete_probe(self):
        model = self.model()
        for stage in STEPS: self.advance(model, self.evidence(model, stage))
        self.now = 1200
        report = model.inspect()
        self.assertEqual(report['simulation_state'], 'STOP')
        self.assertEqual(report['stop_category'], 'STALE')
        self.now = 1000; model = self.model(); self.advance(model, self.evidence(model))
        self.now = 1200
        self.assertEqual(model.state, 'STOP')
        self.assertEqual(model.stop_category, 'STALE')

    def test_clock_exception_is_unknown_stop(self):
        model = self.model(); self.advance(model, self.evidence(model))
        def failed_clock(): raise RuntimeError('synthetic clock failure')
        model._clock = failed_clock
        self.assert_stopped(model, 'UNKNOWN')

    def test_stored_pass_tamper_is_terminal(self):
        model = self.model(); self.advance(model, self.evidence(model))
        model._records[0]['evidence_refs']['audit'] = 'f' * 64
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')

    def assert_corrupt_record_stops(self, corrupt):
        model = self.model(); self.advance(model, self.evidence(model))
        next_token = self.evidence(model, 'BACKUP_RESTORE_VERIFIED')
        corrupt(model)
        with self.assertRaises(source.SourceControlError) as exc:
            self.advance(model, next_token)
        self.assertEqual(exc.exception.category, 'TAMPERED_EVIDENCE')
        self.assertNotIn('synthetic-private-value', str(exc.exception))
        self.assertIsNone(exc.exception.__context__)
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')
        for action in (lambda: self.advance(model, next_token), model.resume):
            with self.assertRaises(source.SourceControlError) as stopped:
                action()
            self.assertEqual(stopped.exception.category, 'TERMINAL_STOP')

    def test_stored_seal_missing_stops(self):
        self.assert_corrupt_record_stops(lambda m: m._records[0].pop('seal'))

    def test_stored_record_wrong_type_stops(self):
        for value in (None, [], 'synthetic-private-value', 42):
            with self.subTest(type=type(value).__name__):
                self.assert_corrupt_record_stops(lambda m: m._records.__setitem__(0, value))

    def test_stored_other_required_field_missing_stops(self):
        for field in ('kind', 'run_id', 'plan_hash', 'approval_hash', 'stage', 'sequence',
                      'previous', 'outcome', 'issued_at', 'expires_at', 'evidence_refs'):
            with self.subTest(field=field):
                self.assert_corrupt_record_stops(lambda m: m._records[0].pop(field))

    def test_stored_seal_changed_or_wrong_type_stops(self):
        for value in ('f' * 64, 'synthetic-private-value', None, 42):
            with self.subTest(type=type(value).__name__):
                self.assert_corrupt_record_stops(lambda m: m._records[0].__setitem__('seal', value))

    def test_stored_nonjson_or_unencodable_value_stops(self):
        for value in (object(), chr(0xd800)):
            with self.subTest(type=type(value).__name__):
                self.assert_corrupt_record_stops(lambda m: m._records[0].__setitem__('evidence_refs', value))

    def test_stored_ledger_wrong_type_or_excess_records_stops(self):
        for value in (None, {}, [None] * 12):
            with self.subTest(type=type(value).__name__):
                self.assert_corrupt_record_stops(lambda m: setattr(m, '_records', value))

    def test_seal_programming_error_is_not_hidden_as_input_tamper(self):
        model = self.model(); self.advance(model, self.evidence(model))
        with patch.object(model, '_seal', side_effect=RuntimeError('controlled programming error')):
            with self.assertRaisesRegex(RuntimeError, 'controlled programming error'):
                model.inspect()

    def test_last_accepted_record_deleted_stops_on_state_read(self):
        model = self.model(); self.advance(model, self.evidence(model))
        model._records.pop()
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')
        with self.assertRaises(source.SourceControlError) as exc: model.resume()
        self.assertEqual(exc.exception.category, 'TERMINAL_STOP')

    def test_partial_accepted_ledger_cleared_stops(self):
        model = self.model()
        for stage in STEPS[:3]: self.advance(model, self.evidence(model, stage))
        model._records.clear()
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')

    def test_complete_accepted_ledger_cleared_stops(self):
        model = self.model()
        for stage in STEPS: self.advance(model, self.evidence(model, stage))
        self.assertEqual(model.state, 'SIMULATION_COMPLETE')
        model._records.clear()
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')

    def test_other_valid_signed_token_cannot_replace_accepted_record(self):
        model = self.model()
        accepted = self.evidence(model)
        alternate = model.synthetic_evidence('PRECHECK', 'PASS', evidence_refs={'audit': 'f' * 64})
        self.advance(model, accepted)
        model._records[0] = alternate
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')

    def test_deleted_record_cannot_be_replayed_as_same_stage(self):
        model = self.model(); accepted = self.evidence(model)
        self.advance(model, accepted); model._records.pop()
        with self.assertRaises(source.SourceControlError) as exc: self.advance(model, accepted)
        self.assertEqual(exc.exception.category, 'TAMPERED_EVIDENCE')
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')
        with self.assertRaises(source.SourceControlError) as stopped: self.advance(model, accepted)
        self.assertEqual(stopped.exception.category, 'TERMINAL_STOP')

    def test_replaced_record_cannot_continue_using_its_new_chain(self):
        model = self.model(); accepted = self.evidence(model)
        alternate = model.synthetic_evidence('PRECHECK', 'PASS', evidence_refs={'audit': 'f' * 64})
        self.advance(model, accepted); model._records[0] = alternate
        with self.assertRaises(source.SourceControlError) as exc:
            self.advance(model, self.evidence(model, 'BACKUP_RESTORE_VERIFIED'))
        self.assertEqual(exc.exception.category, 'TAMPERED_EVIDENCE')
        self.assert_stopped(model, 'TAMPERED_EVIDENCE')
        with self.assertRaises(source.SourceControlError) as stopped: model.resume()
        self.assertEqual(stopped.exception.category, 'TERMINAL_STOP')

    def test_accepted_11_steps_still_complete_without_execution_authority(self):
        model = self.model()
        for stage in STEPS: self.advance(model, self.evidence(model, stage))
        self.assertEqual(model.state, 'SIMULATION_COMPLETE')
        self.assertTrue(model.simulated_complete)
        self.assertEqual(len(model.records), 11)
        report = model.inspect()
        self.assertEqual(report['simulated_steps'], 11)
        self.assertEqual(report['status'], 'NOT_READY')
        self.assertIs(report['execution_enabled'], False)


if __name__ == '__main__':
    unittest.main()
