"""Offline adversarial HTTP tests for the narrow Docker metadata boundary."""
from contextlib import closing, contextmanager
import http.client
from http.server import ThreadingHTTPServer
import json
import threading
import unittest
from unittest.mock import patch

import inspect_proxy as proxy
from inspect_proxy import LABEL, OWNER, PROJECT, SERVICES
VOLUMES = {key: PROJECT + '-' + key for key in ('db', 'control', 'data', 'reader', 'writer')}


class InspectProxyTests(unittest.TestCase):
    def test_only_fixed_postgis_image_inspect_is_exposed_without_config_or_env(self):
        reference = 'postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5'
        value = dict(Id='sha256:' + 'a' * 64, RepoDigests=[reference, 'private-fixture'],
                     Os='linux', Architecture='amd64', Config={'Env': ['password=private-fixture']})
        with self.server(value) as (port, fetch):
            status, body = self.request(port, 'GET', '/inspect/image/postgis-pinned')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), dict(Id=value['Id'], RepoDigests=[reference],
                                                   Os='linux', Architecture='amd64'))
            self.assertNotIn(b'private-fixture', body)
            fetch.assert_called_once_with('/images/' + reference + '/json')
            fetch.reset_mock()
            for path in ['/inspect/image/other', '/images/json', '/inspect/image/postgis-pinned?x=1',
                         '/inspect/image/postgis-pinned/extra']:
                self.assertEqual(self.request(port, 'GET', path)[0], 403)
            fetch.assert_not_called()

    def container(self, **extra):
        return dict(Id='a' * 64, Name='/' + PROJECT + '-preflight-1', Image='sha256:fixture',
                    Created='2026-10-14T00:00:00Z', State={'Running': True, 'Error': 'private'},
                    Config={'Labels': {LABEL: OWNER, 'com.docker.compose.project': PROJECT,
                                       'com.docker.compose.service': 'preflight'},
                            'Env': ['PRIVATE_SECRET=never-return', 'POSTGRES_DB=recycleyoungs_api_dev'],
                            'Cmd': ['secret-command']}, HostConfig={'PortBindings': {}, 'Secret': 'private'},
                    NetworkSettings={'Networks': {}, 'Ports': {}}, Mounts=[], **extra)

    @contextmanager
    def server(self, resource=None):
        with patch.object(proxy, 'fetch_engine', return_value=resource or self.container()) as fetch:
            server = ThreadingHTTPServer(('127.0.0.1', 0), proxy.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                yield server.server_port, fetch
            finally:
                server.shutdown(); server.server_close(); thread.join()

    def request(self, port, method, path, body=None, headers=None):
        with closing(http.client.HTTPConnection('127.0.0.1', port, timeout=3)) as conn:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, response.read()

    def test_allowlisted_inspect_redacts_secrets(self):
        with self.server() as (port, fetch):
            status, body = self.request(port, 'GET', '/inspect/container/' + 'a' * 12)
            self.assertEqual(status, 200)
            value = json.loads(body)
            self.assertEqual(value['Id'], 'a' * 64)
            self.assertEqual(value['Config']['Env'], ['POSTGRES_DB=recycleyoungs_api_dev'])
            for private in [b'PRIVATE_SECRET', b'never-return', b'secret-command', b'private']:
                self.assertNotIn(private, body)
            fetch.assert_called_once_with('/containers/' + 'a' * 12 + '/json')
        self.assertEqual(proxy.SERVICES, SERVICES)

    def test_only_get_exact_inspect_paths_reach_engine(self):
        paths = ['/containers/json', '/containers/a/archive', '/v1.51/containers/json',
                 '/inspect/container/startup-analysis-postgres', '/inspect/container/../a',
                 '/inspect/container/%61aaaaaaaaaaa', '/inspect/container/' + 'a' * 12 + '?size=true',
                 '/inspect/network/recycleyoungs_default', '/inspect/volume/recycleyoungs_postgres_data',
                 'http://localhost/inspect/container/' + 'a' * 12]
        with self.server() as (port, fetch):
            for path in paths:
                with self.subTest(path=path):
                    self.assertEqual(self.request(port, 'GET', path)[0], 403)
            for method in ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'HEAD']:
                with self.subTest(method=method):
                    self.assertEqual(self.request(port, method, '/inspect/container/' + 'a' * 12)[0], 405)
            self.assertEqual(self.request(port, 'GET', '/inspect/container/' + 'a' * 12, body='x')[0], 400)
            fetch.assert_not_called()

    def test_foreign_or_misnamed_resources_are_denied(self):
        mutations = [lambda d: d['Config']['Labels'].update({LABEL: 'foreign'}),
                     lambda d: d['Config']['Labels'].update({'com.docker.compose.project': 'foreign'}),
                     lambda d: d['Config']['Labels'].update({'com.docker.compose.service': 'foreign'}),
                     lambda d: d.update(Name='/unexpected-name')]
        for mutate in mutations:
            resource = self.container(); mutate(resource)
            with self.subTest(mutate=mutate), self.server(resource) as (port, _):
                self.assertEqual(self.request(port, 'GET', '/inspect/container/' + 'a' * 12)[0], 403)

    def test_network_and_volume_inspect_preserve_ownership_metadata(self):
        labels = {LABEL: OWNER, 'com.docker.compose.project': PROJECT}
        network = dict(Id='b' * 64, Name=PROJECT + '-data', Internal=True, Driver='bridge',
                       Labels=labels, Containers={'a' * 64: {'Name': 'private'}}, Options={'private': 'omit'})
        with self.server(network) as (port, fetch):
            status, body = self.request(port, 'GET', '/inspect/network/' + PROJECT + '-data')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['Containers'], {'a' * 64: {}})
            self.assertNotIn(b'private', body)
            fetch.assert_called_once_with('/networks/' + PROJECT + '-data')
        volume = dict(Name=VOLUMES['db'], Labels=labels, Driver='local', Options=None,
                      CreatedAt='2026-10-14T00:00:00Z', Mountpoint='/private/path')
        with self.server(volume) as (port, _):
            status, body = self.request(port, 'GET', '/inspect/volume/' + VOLUMES['db'])
            self.assertEqual(status, 200)
            self.assertNotIn(b'Mountpoint', body)

    def test_upstream_failure_is_sanitized_and_health_needs_no_daemon(self):
        with self.server() as (port, fetch):
            self.assertEqual(self.request(port, 'GET', '/health')[0], 200)
            fetch.assert_not_called()
            fetch.side_effect = OSError('private upstream detail')
            status, body = self.request(port, 'GET', '/inspect/container/' + 'a' * 12)
            self.assertEqual(status, 503)
            self.assertNotIn(b'private', body)


if __name__ == '__main__': unittest.main()
