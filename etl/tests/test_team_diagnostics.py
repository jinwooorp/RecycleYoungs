"""Failure diagnostics disclose fixed categories, never source error content."""
import ast
import json
import pathlib
from pathlib import Path
import tempfile
import textwrap
import unittest

import team_guard
from team_data import DataError


class TeamDiagnosticsTests(unittest.TestCase):
    def details(self, exc):
        fn = getattr(team_guard, 'failure_details', None)
        self.assertTrue(callable(fn), 'Structured diagnostics must be available')
        return fn(exc)

    def from_log(self, value):
        fn = getattr(team_guard, 'failure_from_logs', None)
        self.assertTrue(callable(fn), 'Structured service JSON must be parsed')
        return fn(value)

    def test_fixed_identity_categories_preserve_the_failed_check(self):
        for reason, code in [
            ('DB image/running identity rejected', 'DB_IMAGE_IDENTITY_MISMATCH'),
            ('DB endpoint/alias mismatch', 'DB_NETWORK_IDENTITY_MISMATCH'),
            ('DB volume identity/access mismatch', 'DB_VOLUME_IDENTITY_MISMATCH'),
            ('DB host binding rejected', 'DB_PORT_BINDING_MISMATCH'),
            ('DB bootstrap configuration rejected', 'DB_BOOTSTRAP_CONFIGURATION_MISMATCH'),
            ('Actual team DB connection identity rejected', 'DB_SQL_IDENTITY_MISMATCH'),
            ('Ownership ledger/resources mismatch', 'CONTROL_LEDGER_MISMATCH')]:
            with self.subTest(code=code):
                self.assertEqual(self.details(DataError(reason))['code'], code)
        from team_dataset import validate_binding
        try:
            validate_binding({'dataset': {'version': 'unapproved', 'contract': 'unapproved'}})
        except DataError as exc:
            self.assertEqual(self.details(exc)['code'], 'DATASET_BINDING_MISMATCH')
        else: self.fail('Invalid dataset binding was accepted')
        from team_dataset import spatial_specs, validate_spatial
        rows = [dict(boundary_kind=s.boundary_kind, dataset_id='unapproved', load_status='READY',
                     is_current=True, source_crs=5181, feature_count=s.feature_count,
                     source_file_sha256='', validation_report_sha256='', processing_profile_sha256='',
                     processing_metadata=dict(reports={}, source_zip_sha256='', source_members={},
                                              geometry={}, implementation={}))
                for s in spatial_specs('real-data-v2').values()]
        try: validate_spatial(rows, 'real-data-v2')
        except DataError as exc:
            self.assertEqual(self.details(exc)['code'], 'SPATIAL_PROFILE_MISMATCH')
        else: self.fail('Invalid spatial profile was accepted')

    def test_unknown_messages_and_exception_attributes_never_escape(self):
        secret = 'password=private-fixture /Users/private-fixture/store-name DSN=private-fixture'
        for exc in [DataError(secret), RuntimeError(secret), OSError(secret)]:
            exc.password = secret
            value = self.details(exc)
            self.assertNotIn('private-fixture', json.dumps(value))
            self.assertNotIn('reason', value)
        class DatabaseFailure(Exception):
            sqlstate = '28P01'
        self.assertEqual(self.details(DatabaseFailure(secret))['sqlstate'], '28P01')
        bad = DatabaseFailure(secret); bad.sqlstate = secret
        self.assertNotIn('sqlstate', self.details(bad))

    def test_structured_failure_is_preferred_and_only_allowlisted_fields_escape(self):
        line = json.dumps(dict(status='FAIL', code='DB_IMAGE_IDENTITY_MISMATCH',
                               error_type='DataError', sqlstate='28000', password='private-fixture'))
        self.assertEqual(self.from_log('noise\n' + line),
                         dict(code='DB_IMAGE_IDENTITY_MISMATCH', error_type='DataError', sqlstate='28000'))
        old = json.dumps(dict(status='FAIL', reason='DB endpoint/alias mismatch'))
        self.assertEqual(self.from_log(old)['code'], 'DB_NETWORK_IDENTITY_MISMATCH')

    def test_forged_duplicate_and_unexpected_json_are_rejected(self):
        for text in ['{"status":"FAIL","code":"private-fixture"}',
                     '{"status":"FAIL","code":"DB_IMAGE_IDENTITY_MISMATCH","code":"private-fixture"}',
                     '{"status":"PASS","code":"DB_IMAGE_IDENTITY_MISMATCH"}',
                     '[{"status":"FAIL"}]', 'private-fixture']:
            with self.subTest(text=text):
                self.assertEqual(self.from_log(text), {})

    def test_real_workflow_diagnostics_prefer_json_without_leaking_metadata(self):
        path = Path(__file__).resolve().parents[2] / '.github/workflows/v2-clean-clone-e2e.yml'
        body = path.read_text().split("python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0]
        tree = ast.parse(textwrap.dedent(body))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in {'safe_hint', 'safe_diagnostics'}]
        self.assertEqual(len(nodes), 2)
        secret = 'password=private-fixture /Users/private-fixture/store-name'
        log = 'permission denied ' + secret + '\n' + json.dumps(dict(status='FAIL',
            code='DB_IMAGE_IDENTITY_MISMATCH', error_type='DataError', reason=secret, sqlstate='28000'))
        metadata = [dict(Config={'Labels': {'com.docker.compose.service': 'db-identity'}, 'Env': [secret]},
                         State={'Status': 'exited', 'ExitCode': 1})]
        def command(args, timeout):
            if args[:4] == ['docker', 'compose', 'ps', '-aq']: return 'a' * 64
            if args[:2] == ['docker', 'inspect']: return json.dumps(metadata)
            if args[:3] == ['docker', 'compose', 'logs']: return log
            self.fail('Unexpected diagnostic command')
        with tempfile.TemporaryDirectory() as tmp:
            scope = dict(json=json, pathlib=pathlib, os=type('Env', (), {'environ': {'RUNNER_TEMP': tmp}}),
                         re=__import__('re'), command=command, last_status_hint='UNCLASSIFIED',
                         failure_from_logs=team_guard.failure_from_logs, DB_IMAGE=team_guard.DB_IMAGE)
            exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)
            value = scope['safe_diagnostics']()
        self.assertEqual(value['services'][0]['code'], 'DB_IMAGE_IDENTITY_MISMATCH')
        self.assertEqual(value['services'][0]['hint'], 'DB_IMAGE_IDENTITY_MISMATCH')
        self.assertEqual(value['services'][0]['sqlstate'], '28000')
        self.assertNotIn('private-fixture', json.dumps(value))

    def test_workflow_statistics_comparison_requires_distinct_null_zero_and_no_row(self):
        path = Path(__file__).resolve().parents[2] / '.github/workflows/v2-clean-clone-e2e.yml'
        body = path.read_text().split("python3 - <<'PY'\n", 1)[1].split('\n          PY', 1)[0]
        nodes = [node for node in ast.parse(textwrap.dedent(body)).body if isinstance(node, ast.FunctionDef)
                 and node.name == 'compare_statistics']
        self.assertEqual(len(nodes), 1, 'HTTP semantics need explicit observed witnesses')
        scope = {'json': json}; exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)
        compare = scope['compare_statistics']; fields = [('value', 'value')]
        for sql_value, api_value, stringify in [(None, None, False), (0, 0, False),
                (None, None, True), (0, '0', True), (9223372036854775807, '9223372036854775807', True)]:
            value = dict(storeStats={'value': api_value}, missingReasons={'storeStats': None})
            flags = compare([{'value': sql_value}], value, 'storeStats', fields, stringify)
            self.assertEqual(flags, dict(null=sql_value is None, zero=sql_value == 0, no_row=False))
        missing = dict(storeStats=None, missingReasons={'storeStats': 'NO_ROW'})
        self.assertEqual(compare([], missing, 'storeStats', fields, False),
                         dict(null=False, zero=False, no_row=True))
        for payload in [dict(storeStats={'value': None}, missingReasons={'storeStats': 'NO_ROW'}),
                        dict(storeStats={'value': False}, missingReasons={'storeStats': None}),
                        dict(storeStats={'value': '0'}, missingReasons={'storeStats': None})]:
            with self.assertRaises(AssertionError): compare([{'value': 0}], payload, 'storeStats', fields, False)


if __name__ == '__main__': unittest.main()
