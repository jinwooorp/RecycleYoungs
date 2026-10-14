"""Offline trust-boundary tests; never discovers or opens real inputs/DBs."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

import team_data

from team_data import (DataError, check_files, download, extract_package, release_url,
                       safe_members, sha, contract, migration_files)
from team_db import decide_load, migration_state, validate_identity


class TeamDataTests(unittest.TestCase):
    def test_release_pipeline_http_fixture_and_verified_cache(self):
        names = [s['name'] for s in contract()['files']]
        payloads = {name: ('fixture:' + name).encode() for name in names}
        expected = dict(version=team_data.VERSION, files=[dict(name=name, bytes=len(data),
                        sha256=hashlib.sha256(data).hexdigest()) for name, data in payloads.items()])
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            for name, data in payloads.items(): z.writestr(name, data)
            z.writestr('dataset.json', json.dumps(expected))
        blob = stream.getvalue(); requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path); self.send_response(200)
                self.send_header('Content-Length', str(len(blob))); self.end_headers(); self.wfile.write(blob)
            def log_message(self, *_): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        url = 'http://127.0.0.1:' + str(server.server_port) + '/release.zip'
        def fixture_download(source, target, digest):
            return download(source, target, digest, policy=lambda value: value == url)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); (root / 'data').mkdir()
                (root / 'data/release.json').write_text(json.dumps({'sha256': hashlib.sha256(blob).hexdigest()}))
                with patch('team_data.ROOT', root), patch('team_data.contract', return_value=expected), \
                     patch('team_data.release_url', return_value=url), patch('team_data.download', side_effect=fixture_download), \
                     patch('team_data.prepare'):
                    self.assertEqual(team_data.initialize(root / 'absent', root / 'cache', 'release')['action'], 'PREPARED')
                    self.assertEqual(team_data.initialize(root / 'absent', root / 'cache', 'release')['action'], 'VERIFIED_CACHE')
                    self.assertEqual(len(requests), 1)
                    (root / 'cache' / team_data.VERSION / names[0]).write_bytes(b'corrupt')
                    with self.assertRaises(DataError): team_data.initialize(root / 'absent', root / 'cache', 'release')
                    self.assertEqual(len(requests), 1)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_dataset_v1_rejects_extra_migration_before_bootstrap(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            actual = migration_files()
            for source in actual: (p / source.name).write_text('SELECT 1;')
            self.assertEqual(len(migration_files(p)), 3)
            for name in ['V4__fixture.sql', 'R__fixture.sql', 'beforeMigrate.sql', 'nested/V4__fixture.sql',
                         actual[0].name + '.conf']:
                with self.subTest(name=name):
                    extra = p / name; extra.parent.mkdir(exist_ok=True)
                    extra.write_text('SELECT 1;')
                    with self.assertRaises(DataError): migration_files(p)
                    extra.unlink()
                    if extra.parent != p: extra.parent.rmdir()

    def test_valid_package_roundtrip_and_wrong_internal_identity(self):
        specs = [{'name': 'stats.csv', 'bytes': 5, 'sha256': hashlib.sha256(b'valid').hexdigest()}]
        expected = {'version': 'fixture-v1', 'files': specs}
        with tempfile.TemporaryDirectory() as tmp, patch('team_data.contract', return_value=expected), \
             patch('team_data.prepare') as prepared:
            p = Path(tmp)
            for name, metadata in [('good', expected), ('bad', dict(expected, version='other'))]:
                path = p / (name + '.zip')
                with zipfile.ZipFile(path, 'w') as z:
                    z.writestr('stats.csv', b'valid'); z.writestr('dataset.json', json.dumps(metadata))
                if name == 'good':
                    extract_package(path, p / name, sha(path))
                    self.assertEqual((p / name / 'stats.csv').read_bytes(), b'valid')
                    prepared.assert_called_once()
                    with self.assertRaises(DataError): extract_package(path, p / name, sha(path))
                else:
                    with self.assertRaises(DataError): extract_package(path, p / name, sha(path))
                    self.assertFalse((p / name).exists())

    def test_contract_has_exact_eight_inputs(self):
        c = contract()
        self.assertEqual(len(c['files']), 8)
        self.assertEqual(sum(x['name'].endswith('.csv') for x in c['files']), 3)
        self.assertEqual(c['version'], 'real-data-v1')

    def test_missing_report_and_bad_csv_polygon_hash_rejected(self):
        for name in ['stats.csv', 'admin.zip', 'admin-report.json']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                p = Path(tmp)
                spec = {'name': name, 'sha256': hashlib.sha256(b'valid').hexdigest(), 'bytes': 5}
                with self.assertRaises(DataError):
                    check_files(p, [spec])
                (p / name).write_bytes(b'wrong')
                with self.assertRaises(DataError):
                    check_files(p, [spec])

    def test_symlink_input_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp); (p / 'source').write_bytes(b'valid')
            (p / 'stats.csv').symlink_to(p / 'source')
            with self.assertRaises(DataError):
                check_files(p, [{'name': 'stats.csv', 'bytes': 5, 'sha256': sha(p / 'source')}])

    def test_zip_paths_duplicates_symlinks_extra_files_rejected(self):
        for name in ['../escape', '/absolute', 'a/../../escape', 'C:/escape', 'a\\escape', 'extra']:
            with self.subTest(name=name), zipfile.ZipFile(io.BytesIO(), 'w') as z:
                z.writestr(name, b'x')
                with self.assertRaises(DataError): safe_members(z, {'stats.csv'})
        for duplicate in [True, False]:
            with zipfile.ZipFile(io.BytesIO(), 'w') as z:
                info = zipfile.ZipInfo('stats.csv')
                info.external_attr = (0o120777 if not duplicate else 0o100644) << 16
                z.writestr(info, b'x')
                if duplicate:
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore'); z.writestr('stats.csv', b'x')
                with self.assertRaises(DataError): safe_members(z, {'stats.csv'})

    def test_archive_hash_rejected_before_extract(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp); (p / 'a.zip').write_bytes(b'bad')
            with self.assertRaises(DataError): extract_package(p / 'a.zip', p / 'out', '0' * 64)
            self.assertFalse((p / 'out').exists())

    def test_unpublished_release_and_arbitrary_url_rejected(self):
        for config in [{}, {'status': 'UNPUBLISHED'},
                       {'status': 'PUBLISHED', 'tag': 'latest', 'sha256': 'a' * 64},
                       {'status': 'PUBLISHED', 'tag': 'v1', 'sha256': 'a' * 64, 'url': 'http://evil/a.zip'}]:
            with self.assertRaises(DataError): release_url(config)

    def test_http_fixture_status_redirect_partial_and_hash(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/redirect':
                    self.send_response(302); self.send_header('Location', 'http://evil.invalid/a'); self.end_headers(); return
                if self.path == '/404': self.send_response(404); self.end_headers(); return
                self.send_response(200)
                self.send_header('Content-Length', '20' if self.path == '/partial' else '5')
                self.end_headers(); self.wfile.write(b'valid')
            def log_message(self, *_): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        policy = lambda url: url.startswith(base + '/')
        try:
            with tempfile.TemporaryDirectory() as tmp:
                p = Path(tmp)
                for route, digest in [('/partial', hashlib.sha256(b'valid').hexdigest()), ('/404', 'a' * 64),
                                      ('/redirect', 'a' * 64), ('/ok', '0' * 64)]:
                    with self.subTest(route=route), self.assertRaises(DataError):
                        download(base + route, p / 'bad.zip', digest, policy=policy)
                    self.assertFalse((p / 'bad.zip').exists())
                download(base + '/ok', p / 'ok.zip', hashlib.sha256(b'valid').hexdigest(), policy=policy)
                self.assertEqual((p / 'ok.zip').read_bytes(), b'valid')
                with self.assertRaises(DataError):
                    download(base + '/ok', p / 'ok.zip', sha(p / 'ok.zip'), policy=policy)
        finally:
            server.shutdown(); server.server_close(); thread.join()


class TeamStateTests(unittest.TestCase):
    def test_version_contract_owner_gate_is_before_flyway(self):
        state = dict(owner='a' * 32, version='v1', contract='hash', status='READY')
        migration_state(state, 'v1', 'hash', 'a' * 32)
        for key, value in [('version', 'v2'), ('contract', 'changed'), ('owner', 'b' * 32), ('status', 'UNKNOWN')]:
            with self.subTest(key=key), self.assertRaises(DataError):
                migration_state(dict(state, **{key: value}), 'v1', 'hash', 'a' * 32)

    def test_bad_identity_rejected(self):
        expected = dict(db='recycleyoungs_team_dev', actor='ry_team_owner', sid='123',
                        pgdata='/var/lib/postgresql/data/team', owner='a' * 32, port='5432')
        validate_identity(expected, expected)
        for key, value in [('db', 'startup_analysis'), ('actor', 'app'), ('sid', '7692329130053947430'),
                           ('pgdata', '/other'), ('owner', 'b' * 32), ('port', '5433')]:
            with self.subTest(key=key), self.assertRaises(DataError):
                validate_identity(dict(expected, **{key: value}), expected)

    def test_first_same_changed_failed_state_transitions(self):
        self.assertEqual(decide_load(None, True, 'v1', 'hash'), 'LOAD')
        with self.assertRaises(DataError): decide_load(None, False, 'v1', 'hash')
        state = dict(version='v1', contract='hash', status='READY', stage='VERIFIED')
        self.assertEqual(decide_load(state, False, 'v1', 'hash'), 'VERIFY')
        with self.assertRaises(DataError): decide_load(state, False, 'v2', 'hash')
        with self.assertRaises(DataError): decide_load(state, False, 'v1', 'different')
        for status in ['FAILED', 'LOADING']:
            state.update(status=status, stage='CSV')
            self.assertEqual(decide_load(state, True, 'v1', 'hash'), 'LOAD')
            with self.assertRaises(DataError): decide_load(state, False, 'v1', 'hash')
            state['stage'] = 'CSV_DONE'
            self.assertEqual(decide_load(state, False, 'v1', 'hash'), 'RESUME')


if __name__ == '__main__': unittest.main()
