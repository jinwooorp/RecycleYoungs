"""No Docker or DB access: reject unsafe demo routing before any connection."""
import copy
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import contextlib
import io
import json
import subprocess
import os

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from demo_safety import DB_IMAGE, DemoError, check_target, reject_environment


def fixture():
    owner = 'a' * 24
    target = dict(owner=owner, host='ry-demo-db-' + owner, network='ry-demo-net-' + owner,
                  database='recycleyoungs_demo_' + owner, user='ry_demo_owner',
                  container_id='b' * 64, network_id='c' * 64, sid='123456789',
                  pgdata='/var/lib/postgresql/data/pgdata', image=DB_IMAGE)
    container = dict(Id=target['container_id'], Name='/' + target['host'], Image=DB_IMAGE,
                     State={'Running': True}, Mounts=[],
                     HostConfig={'NetworkMode': target['network'], 'PortBindings': {}, 'Tmpfs': {
                         '/var/lib/postgresql/data': 'rw', '/docker-entrypoint-initdb.d': 'rw'}},
                     Config={'Labels': {'recycleyoungs.real-data-demo': owner},
                             'Env': ['PGDATA=' + target['pgdata']]},
                     NetworkSettings={'Networks': {target['network']: {
                         'NetworkID': target['network_id'], 'Aliases': [target['host']]}}})
    network = dict(Id=target['network_id'], Name=target['network'], Internal=True,
                   Labels={'recycleyoungs.real-data-demo': owner}, Containers={})
    return target, container, network


class DemoSafetyTests(unittest.TestCase):
    def worker_fixture(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        controller.attachments = {}
        controller.resources = {'fixture': {'network': 'fixture-net'}}
        controller.target = {'network': 'fixture-net'}
        controller.network_id = 'c' * 64
        process = unittest.mock.Mock()
        process.poll.return_value = None
        process.returncode = 0
        process.communicate.return_value = ('{"status":"PASS"}', '')
        ready = {'State': {'Status': 'running'}, 'NetworkSettings': {'Networks': {
            'fixture-net': {'NetworkID': controller.network_id}}}}
        return controller, process, ready

    def test_worker_readiness_failures_halt_before_input(self):
        for mode in ('runner', 'database', 'endpoint', 'timeout', 'exited'):
            with self.subTest(mode=mode):
                controller, process, ready = self.worker_fixture()
                failure = DemoError('fixture readiness failure')
                if mode in ('timeout', 'exited'):
                    ready['State']['Status'] = 'created'
                if mode == 'exited':
                    process.poll.return_value = 1
                if mode == 'endpoint':
                    ready['NetworkSettings']['Networks']['fixture-net']['NetworkID'] = 'd' * 64
                with patch('demo.subprocess.Popen', return_value=process), \
                     patch.object(controller, 'verify_runner', return_value=ready,
                                  side_effect=failure if mode == 'runner' else None), \
                     patch.object(controller, 'verify_db', side_effect=failure if mode == 'database' else None), \
                     patch.object(controller, 'halt_runner') as halt, patch('demo.time.sleep'):
                    with self.assertRaises(DemoError):
                        controller.start_checked('fixture', 'fixture input')
                halt.assert_called_once_with('fixture')
                process.communicate.assert_not_called()
                process.stdin.write.assert_not_called()

    def test_worker_normal_readiness_preserves_input_and_result(self):
        controller, process, ready = self.worker_fixture()
        with patch('demo.subprocess.Popen', return_value=process), \
             patch.object(controller, 'verify_runner', return_value=ready), \
             patch.object(controller, 'verify_db'), patch.object(controller, 'halt_runner') as halt:
            result = controller.start_checked('fixture', 'fixture input')
        self.assertEqual(json.loads(result), {'status': 'PASS'})
        process.communicate.assert_called_once_with('fixture input', timeout=1200)
        halt.assert_not_called()

    def test_worker_halt_failure_preserves_readiness_and_cleanup_errors(self):
        controller, process, ready = self.worker_fixture()
        failure, cleanup = DemoError('fixture readiness failure'), DemoError('fixture halt failure')
        with patch('demo.subprocess.Popen', return_value=process), \
             patch.object(controller, 'verify_runner', side_effect=failure), \
             patch.object(controller, 'halt_runner', side_effect=cleanup):
            with self.assertRaises(DemoError) as caught:
                controller.start_checked('fixture', 'fixture input')
        self.assertIs(caught.exception, failure)
        self.assertIs(caught.exception.cleanup_failure, cleanup)
        process.communicate.assert_not_called()

    def test_worker_unverified_ownership_never_kills_runner(self):
        controller, process, ready = self.worker_fixture()
        target, container, _ = fixture()
        cid = target['container_id']
        controller.owner = target['owner']
        controller.resources = {cid: {'image': DB_IMAGE, 'mounts': {}, 'network': target['network']}}
        container['Config']['Labels']['recycleyoungs.real-data-demo'] = 'foreign-owner'
        with patch('demo.subprocess.Popen', return_value=process), \
             patch.object(controller, 'inspect', return_value=container), \
             patch.object(controller, 'docker') as docker:
            with self.assertRaises(DemoError) as caught:
                controller.start_checked(cid, 'fixture input')
        docker.assert_not_called()
        self.assertIsInstance(caught.exception.cleanup_failure, DemoError)
        process.communicate.assert_not_called()
        self.assertIs(controller.attachments[cid], process)

    def test_worker_timeout_halt_failure_preserves_original_cause(self):
        controller, process, ready = self.worker_fixture()
        failure = subprocess.TimeoutExpired('fixture process', 1200)
        cleanup = DemoError('fixture halt failure')
        process.communicate.side_effect = failure
        with patch('demo.subprocess.Popen', return_value=process), \
             patch.object(controller, 'verify_runner', return_value=ready), patch.object(controller, 'verify_db'), \
             patch.object(controller, 'halt_runner', side_effect=cleanup):
            with self.assertRaises(DemoError) as caught:
                controller.start_checked('fixture', 'fixture input')
        self.assertIs(caught.exception.__cause__, failure)
        self.assertIs(caught.exception.cleanup_failure, cleanup)
        self.assertNotIn('runner halted', str(caught.exception))

    def test_java_halt_failure_keeps_primary_failure(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        target, _, _ = fixture()
        controller.owner, controller.target = target['owner'], target
        controller.db_id, controller.network_id = target['container_id'], target['network_id']
        controller.password = controller.reader_password = 'fixture'
        failure, cleanup = DemoError('fixture readiness failure'), DemoError('fixture halt failure')
        with patch.object(controller, 'verify_db'), patch.object(controller, 'create_runner', return_value='fixture'), \
             patch.object(controller, 'start_checked', side_effect=failure), \
             patch.object(controller, 'halt_runner', side_effect=cleanup):
            with self.assertRaises(DemoError) as caught:
                controller.java('migrate')
        self.assertIs(caught.exception, failure)
        self.assertIs(caught.exception.cleanup_failure, cleanup)

    def bridge_handler(self, failure=None):
        import threading
        from types import SimpleNamespace
        from demo import Demo
        controller = Demo.__new__(Demo)
        controller.stage, controller.server = 'SERVING', None
        controller.api_id, controller.lock = 'fixture', threading.Lock()
        server = SimpleNamespace(server_port=1234, serve_forever=unittest.mock.Mock())
        with patch('demo.ThreadingHTTPServer', return_value=server) as factory, patch('demo.threading.Thread'):
            controller.bridge()
        handler = factory.call_args.args[1].__new__(factory.call_args.args[1])
        handler.path = '/api/fixture'
        for name in ('send_response', 'send_header', 'end_headers', 'send_error'):
            setattr(handler, name, unittest.mock.Mock())
        handler.wfile = unittest.mock.Mock()
        controller.verify_db = unittest.mock.Mock(side_effect=failure)
        controller.verify_runner = unittest.mock.Mock()
        controller.docker = unittest.mock.Mock(return_value='{"status":200,"body":"{}"}')
        handler.fixture_controller = controller
        return handler

    def wire_handler(self, failure=None):
        handler = self.bridge_handler(failure)
        for name in ('send_response', 'send_header', 'end_headers', 'send_error'):
            delattr(handler, name)
        handler.request_version, handler.command = 'HTTP/1.1', 'GET'
        handler.requestline = 'GET /api/fixture HTTP/1.1'
        handler.close_connection = False
        handler.wfile = io.BytesIO()
        return handler

    def test_bridge_normal_response_preserves_wire_contract(self):
        handler = self.wire_handler()
        handler.do_GET()
        headers, body = handler.wfile.getvalue().split(b'\r\n\r\n', 1)
        self.assertTrue(headers.startswith(b'HTTP/1.0 200 OK\r\n'))
        self.assertIn(b'Content-Type: application/json; charset=utf-8', headers)
        self.assertIn(b'Content-Length: 2', headers)
        self.assertEqual(body, b'{}')

    def test_bridge_pre_response_failure_writes_one_503(self):
        handler = self.wire_handler(DemoError('fixture guard failure'))
        handler.do_GET()
        wire = handler.wfile.getvalue()
        self.assertTrue(wire.startswith(b'HTTP/1.0 503 '))
        self.assertEqual(wire.count(b'HTTP/1.0 '), 1)
        handler.fixture_controller.docker.assert_not_called()

    def test_bridge_response_errors_never_append_second_status(self):
        for method in ('send_response', 'send_header', 'end_headers', 'write', 'body_write'):
            for error in (RuntimeError, BrokenPipeError, ConnectionResetError):
                with self.subTest(method=method, error=error):
                    handler = self.wire_handler()
                    target = handler.wfile if method in ('write', 'body_write') else handler
                    attribute = 'write' if method == 'body_write' else method
                    original = getattr(target, attribute)
                    calls = 0

                    def fail_after_write(*args, **kwargs):
                        nonlocal calls
                        calls += 1
                        original(*args, **kwargs)
                        if calls == (2 if method == 'body_write' else 1):
                            raise error('fixture response failure')

                    with patch.object(target, attribute, side_effect=fail_after_write):
                        handler.do_GET()
                    wire = handler.wfile.getvalue()
                    self.assertLessEqual(wire.count(b'HTTP/1.0 '), 1)
                    self.assertNotIn(b'HTTP/1.0 503 ', wire)
                    self.assertTrue(handler.close_connection)

    def test_bridge_404_disconnect_is_quiet_and_never_probes(self):
        for error in (BrokenPipeError, ConnectionResetError):
            with self.subTest(error=error):
                handler = self.wire_handler()
                handler.path = '/not-api'
                with patch.object(handler.wfile, 'write', side_effect=error('fixture disconnect')):
                    handler.do_GET()
                handler.fixture_controller.verify_db.assert_not_called()
                handler.fixture_controller.docker.assert_not_called()
                self.assertTrue(handler.close_connection)

    def test_bridge_failure_releases_lock_for_next_request(self):
        for error in (DemoError, BrokenPipeError, ConnectionResetError):
            with self.subTest(error=error):
                handler = self.wire_handler()
                controller = handler.fixture_controller
                controller.docker.side_effect = error('fixture probe failure')
                handler.do_GET()
                self.assertTrue(controller.lock.acquire(blocking=False))
                controller.lock.release()
                controller.docker.side_effect = None
                handler.wfile = io.BytesIO()
                handler.do_GET()
                self.assertTrue(handler.wfile.getvalue().startswith(b'HTTP/1.0 200 OK\r\n'))

    def test_bridge_client_disconnect_does_not_attempt_error_response(self):
        for error in (BrokenPipeError, ConnectionResetError):
            with self.subTest(error=error):
                handler = self.bridge_handler()
                handler.wfile.write.side_effect = error('fixture disconnect')
                handler.do_GET()
                handler.send_error.assert_not_called()

    def test_bridge_guard_failure_still_returns_503(self):
        handler = self.bridge_handler(DemoError('fixture guard failure'))
        handler.do_GET()
        handler.send_error.assert_called_once_with(503, 'Verified demo bridge unavailable')

    def test_bridge_disconnect_during_guard_error_response_is_quiet(self):
        handler = self.bridge_handler(DemoError('fixture guard failure'))
        handler.send_error.side_effect = BrokenPipeError('fixture disconnect')
        handler.do_GET()

    def test_bridge_fallback_general_errors_close_without_second_status(self):
        for method in ('end_headers', 'header_write', 'body_write'):
            for error in (RuntimeError, OSError):
                with self.subTest(method=method, error=error):
                    handler = self.wire_handler(DemoError('fixture private guard detail'))
                    target = handler if method == 'end_headers' else handler.wfile
                    attribute = 'end_headers' if method == 'end_headers' else 'write'
                    original, calls = getattr(target, attribute), 0

                    def fail_once(*args, **kwargs):
                        nonlocal calls
                        calls += 1
                        original(*args, **kwargs)
                        if calls == (2 if method == 'body_write' else 1):
                            raise error('fixture private response detail')

                    with patch.object(target, attribute, side_effect=fail_once):
                        handler.do_GET()
                    wire = handler.wfile.getvalue()
                    self.assertEqual(wire.count(b'HTTP/1.0 '), 1)
                    self.assertTrue(wire.startswith(b'HTTP/1.0 503 '))
                    self.assertNotIn(b'fixture private', wire)
                    self.assertTrue(handler.close_connection)

    def test_bridge_fallback_failure_releases_lock_for_next_request(self):
        handler = self.wire_handler(DemoError('fixture guard failure'))
        with patch.object(handler.wfile, 'write', side_effect=OSError('fixture response failure')):
            handler.do_GET()
        controller = handler.fixture_controller
        self.assertTrue(controller.lock.acquire(blocking=False))
        controller.lock.release()
        controller.verify_db.side_effect = None
        # A failed connection is closed; a new request uses a fresh handler/buffer.
        next_handler = type(handler).__new__(type(handler))
        for name in ('path', 'request_version', 'command', 'requestline'):
            setattr(next_handler, name, getattr(handler, name))
        next_handler.close_connection = False
        next_handler.wfile = io.BytesIO()
        next_handler.do_GET()
        self.assertTrue(next_handler.wfile.getvalue().startswith(b'HTTP/1.0 200 OK\r\n'))

    def test_java_readiness_inspection_failure_halts_owned_runner(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        t, d, n = fixture()
        controller.owner, controller.target = t['owner'], t
        controller.db_id, controller.network_id = t['container_id'], t['network_id']
        controller.password = controller.reader_password = 'fixture'
        with patch.object(controller, 'verify_db'), patch.object(controller, 'create_runner', return_value='fixture'), \
             patch.object(controller, 'start_checked'), patch.object(controller, 'docker', side_effect=DemoError('fixture logs failure')), \
             patch.object(controller, 'verify_runner', return_value={'State': {'Status': 'running'}}), \
             patch.object(controller, 'halt_runner') as halt:
            with self.assertRaises(DemoError):
                controller.java('migrate')
        halt.assert_called_once_with('fixture')

    def test_repeated_readonly_final_uses_separate_owned_runners(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        controller.stage, controller.audit_runs = 'SERVING', 0
        with patch.object(controller, 'verify_db'), patch.object(controller, 'worker', return_value={'status': 'PASS'}) as worker:
            controller.dispatch('final')
            controller.dispatch('final')
        self.assertEqual(worker.call_args_list, [unittest.mock.call('final', name='final-1'),
                                               unittest.mock.call('final', name='final-2')])

    def test_java_readiness_timeout_halts_owned_runner(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        t, d, n = fixture()
        controller.owner, controller.target = t['owner'], t
        controller.db_id, controller.network_id = t['container_id'], t['network_id']
        controller.password = controller.reader_password = 'fixture'
        with patch.object(controller, 'verify_db'), patch.object(controller, 'create_runner', return_value='fixture'), \
             patch.object(controller, 'start_checked'), patch.object(controller, 'docker', return_value=''), \
             patch.object(controller, 'verify_runner', return_value={'State': {'Status': 'running'}}), \
             patch.object(controller, 'halt_runner') as halt, patch('demo.time.sleep'):
            with self.assertRaises(DemoError):
                controller.java('migrate')
        halt.assert_called_once_with('fixture')

    def test_incorrect_empty_resolution_policy_is_rejected(self):
        import demo_checks
        dataset = dict(referenceDateVerified=False, historicalCompatibilityStatus='UNRESOLVED', version='1')
        value = dict(coordinate={'lat': 0, 'lng': 0},
                     adminDong=dict(status='RESOLVED', reason=None, resolvedDong=None, candidates=[], dataset=dataset),
                     commercialArea=dict(status='MEMBERSHIP', memberships=[], dataset=dataset))
        with patch('demo_checks.location_reference', return_value={'ADMIN_DONG': [], 'COMMERCIAL_AREA': []}), \
             patch('demo_checks.request', return_value=(200, value, 1.0)), self.assertRaises(DemoError):
            demo_checks.check_location(None, 'fixture', 'fixture', 0, 0)

    def test_worker_timeout_halts_owned_runner(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        controller.attachments = {}
        controller.resources = {'fixture': {'network': 'none'}}
        process = unittest.mock.Mock()
        process.communicate.side_effect = subprocess.TimeoutExpired('docker start', 1200)
        with patch('demo.subprocess.Popen', return_value=process), \
             patch.object(controller, 'verify_runner', return_value={'State': {'Status': 'running'}}), \
             patch.object(controller, 'halt_runner', create=True) as halt:
            with self.assertRaises((DemoError, subprocess.TimeoutExpired)):
                controller.start_checked('fixture', 'fixture input')
        halt.assert_called_once_with('fixture')

    def test_partial_db_metadata_can_be_verified_for_cleanup(self):
        import demo_safety
        t, d, n = fixture()
        del t['sid']
        d['State']['Running'] = False
        d['HostConfig']['NetworkMode'] = t['network']
        demo_safety.check_owned_database(t, d, n)
        with self.assertRaises(DemoError):
            check_target(t, d, n)

    def test_all_demo_entrypoints_compile_without_dependencies(self):
        for name in ('demo.py', 'demo_safety.py', 'demo_worker.py', 'demo_checks.py'):
            path = Path(__file__).resolve().parents[1] / name
            with self.subTest(name=name):
                compile(path.read_text(), str(path), 'exec')

    def test_created_endpoint_cannot_pass_running_network_check(self):
        from demo import Demo
        t, d, n = fixture()
        controller = Demo.__new__(Demo)
        controller.owner = t['owner']
        controller.network_id = t['network_id']
        controller.resources = {d['Id']: dict(image=DB_IMAGE, mounts={}, network=t['network'])}
        d['HostConfig']['NetworkMode'] = t['network']
        d['State']['Status'] = 'created'
        endpoint = d['NetworkSettings']['Networks'][t['network']]
        endpoint['NetworkID'] = ''
        with patch.object(controller, 'inspect', return_value=d):
            controller.verify_runner(d['Id'])
            d['State']['Status'] = 'running'
            with self.assertRaises(DemoError):
                controller.verify_runner(d['Id'])
            endpoint['NetworkID'] = t['network_id']
            controller.verify_runner(d['Id'])
            endpoint['NetworkID'] = 'd' * 64
            with self.assertRaises(DemoError):
                controller.verify_runner(d['Id'])

    def test_explicit_docker_credentials_preserve_executable_path(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        success = subprocess.CompletedProcess(['docker'], 0, stdout='ok', stderr='')
        with patch.dict(os.environ, {'PATH': '/prepared/bin'}, clear=True), patch('demo.subprocess.run', return_value=success) as run:
            controller.docker('create', environment={'DEMO_PASSWORD': 'fixture'})
        self.assertEqual(run.call_args.kwargs['env']['PATH'], '/prepared/bin')
        self.assertEqual(run.call_args.kwargs['env']['DEMO_PASSWORD'], 'fixture')

    def test_docker_json_array_error_reports_operational_failure(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        failed = subprocess.CompletedProcess(['docker'], 1, stdout='[]', stderr='permission denied')
        with patch('demo.subprocess.run', return_value=failed), self.assertRaises(DemoError):
            controller.docker('image', 'inspect', DB_IMAGE)

    def test_protected_metadata_ignores_periodic_health_history(self):
        from demo import Demo
        controller = Demo.__new__(Demo)
        d = dict(Id='a' * 64, Image=DB_IMAGE, Mounts=[], NetworkSettings={'Networks': {}},
                 RestartCount=0, State={'Running': True, 'Restarting': False, 'StartedAt': 'start',
                                       'FinishedAt': '', 'Health': {'Log': ['first']}})
        with patch.object(controller, 'inspect', return_value=d):
            before = copy.deepcopy(controller.protected_metadata())
            d['State']['Health']['Log'] = ['next']
            self.assertEqual(before, controller.protected_metadata())
            d['State']['StartedAt'] = 'restarted'
            self.assertNotEqual(before, controller.protected_metadata())

    def test_default_cli_never_constructs_controller(self):
        from demo import main
        output = io.StringIO()
        with patch('sys.argv', ['demo.py']), patch('demo.Demo') as controller, contextlib.redirect_stdout(output):
            main()
        controller.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['status'], 'INERT')

    def test_accept_owned_internal_tmpfs_target(self):
        self.assertIsNone(check_target(*fixture()))

    def test_reject_protected_names_and_ids(self):
        for key, value in [('host', 'startup-analysis-postgres'),
                           ('database', 'startup_analysis'), ('user', 'app'),
                           ('sid', '7692329130053947430')]:
            t, d, n = fixture()
            t[key] = value
            with self.subTest(key=key), self.assertRaises(DemoError):
                check_target(t, d, n)

    def test_reject_volume_port_shared_network_and_changed_identity(self):
        mutations = [lambda d: d.update(Mounts=[{'Type': 'volume'}]),
                     lambda d: d['HostConfig'].update(PortBindings={'5432/tcp': [{}]}),
                     lambda d: d['NetworkSettings']['Networks'].update(recycleyoungs_default={}),
                     lambda d: d.update(Id='d' * 64),
                     lambda d: d['Config']['Labels'].update({'recycleyoungs.real-data-demo': 'other'}),
                     lambda d: d['HostConfig']['Tmpfs'].pop('/docker-entrypoint-initdb.d')]
        for mutation in mutations:
            t, d, n = copy.deepcopy(fixture())
            mutation(d)
            with self.assertRaises(DemoError):
                check_target(t, d, n)

    def test_reject_network_identity_and_external_network(self):
        for key, value in [('Internal', False), ('Id', 'd' * 64), ('Name', 'recycleyoungs_default')]:
            t, d, n = fixture()
            n[key] = value
            with self.subTest(key=key), self.assertRaises(DemoError):
                check_target(t, d, n)

    def test_reject_ambient_db_and_raw_opt_ins(self):
        for key in ['PGHOST', 'PGSERVICE', 'DB_HOST', 'FLYWAY_URL', 'SPRING_DATASOURCE_URL',
                    'STORES_REAL_DSN', 'SPATIAL_TEST_DSN']:
            with self.subTest(key=key), self.assertRaises(DemoError):
                reject_environment({key: 'unexpected'})
        reject_environment({'PATH': '/usr/bin'})


if __name__ == '__main__':
    unittest.main()
