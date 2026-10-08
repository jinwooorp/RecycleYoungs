from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from spatial_fixtures import write_fixture
try:
    from app import spatial_main as cli
except ImportError:
    cli = None


class SpatialCliTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(cli, 'standalone Polygon CLI is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        spec, archive, reports = write_fixture(self.temp.name)
        self.spec = spec
        self.args = ['--only', 'admin', '--admin-zip', str(archive), '--admin-report', str(reports['quality'])]

    def run_cli(self, args):
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()), patch.object(cli, 'SPECS', {'admin': self.spec}):
            return cli.main(args)

    def test_help_has_no_connection_or_data_reads(self):
        with patch.object(cli, 'connect_database', side_effect=AssertionError('DB connected')):
            with self.assertRaises(SystemExit) as result:
                self.run_cli(['--help'])
        self.assertEqual(result.exception.code, 0)

    def test_default_and_validate_only_never_connect(self):
        with patch.object(cli, 'connect_database', side_effect=AssertionError('DB connected')):
            self.assertEqual(self.run_cli(self.args), 0)
            self.assertEqual(self.run_cli(self.args + ['--validate-only']), 0)

    def test_load_requires_explicit_dsn_and_inputs(self):
        for args in [self.args + ['--load'], ['--only', 'admin', '--load', '--dsn', 'unused'],
                     self.args + ['--dsn', 'unused']]:
            with self.subTest(args=args), patch.object(cli, 'connect_database', side_effect=AssertionError('DB connected')):
                with self.assertRaises(SystemExit) as result:
                    self.run_cli(args)
                self.assertEqual(result.exception.code, 2)

    def test_invalid_input_fails_before_connection_even_in_load_mode(self):
        Path(self.args[self.args.index('--admin-zip') + 1]).write_bytes(b'not approved')
        with patch.object(cli, 'connect_database', side_effect=AssertionError('DB connected')):
            self.assertEqual(self.run_cli(self.args + ['--load', '--dsn', 'unused']), 1)


if __name__ == '__main__':
    unittest.main()
