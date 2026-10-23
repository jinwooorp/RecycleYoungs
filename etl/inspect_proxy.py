"""Fixed, redacted GET inspect API. Only this small service has the engine socket.

This is a local trust boundary, not a Docker authorization plugin: compromise of
this process still grants daemon access. Never add generic forwarding or exec.
"""
from contextlib import closing
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import socket

PROJECT = 'recycleyoungs-dev'
LABEL = 'org.recycleyoungs.environment'
OWNER = 'local-development-v1'
SERVICES = {'inspect-proxy', 'preflight', 'api-postgres', 'identity', 'migrate', 'initialize', 'api-backend', 'api-scheduler', 'frontend'}
NETWORKS = {PROJECT + '-' + key for key in ('data', 'inspect', 'access')}
VOLUMES = {PROJECT + '-' + key for key in ('db', 'control', 'data', 'reader', 'writer')}
MAX_RESPONSE = 1024 * 1024
DB_IMAGE_REFERENCE = 'postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5'


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


def fetch_engine(endpoint):
    # Endpoint is constructed below, never copied from an HTTP request target.
    with closing(UnixConnection('localhost', timeout=10)) as conn:
        conn.request('GET', endpoint)
        response = conn.getresponse()
        if response.status != 200:
            raise OSError('Required metadata unavailable')
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise ValueError('Oversized metadata')
        return json.loads(data)


def owned_labels(value):
    labels = value.get('Labels') or {}
    if labels.get(LABEL) != OWNER or labels.get('com.docker.compose.project') != PROJECT:
        raise PermissionError('Foreign resource')
    return {key: labels[key] for key in (LABEL, 'com.docker.compose.project', 'com.docker.compose.service') if key in labels}


def inspect_path(path):
    if path == '/inspect/image/postgis-pinned':
        # One immutable public image only; no generic image endpoint or config/Env.
        value = fetch_engine('/images/' + DB_IMAGE_REFERENCE + '/json')
        digests = value.get('RepoDigests')
        if not isinstance(digests, list): raise ValueError('Image digests unavailable')
        return dict(Id=value['Id'], RepoDigests=[d for d in digests if d == DB_IMAGE_REFERENCE],
                    Os=value['Os'], Architecture=value['Architecture'])
    match = re.fullmatch(r'/inspect/(container|network|volume)/([a-z0-9][a-z0-9_.-]{0,127})', path)
    if not match:
        raise PermissionError('Path rejected')
    kind, name = match.groups()
    if kind == 'container':
        names = {PROJECT + '-' + service + '-1' for service in SERVICES}
        if name not in names and not re.fullmatch(r'[a-f0-9]{12,64}', name):
            raise PermissionError('Container selector rejected')
        value = fetch_engine('/containers/' + name + '/json')
        labels = owned_labels(value['Config'])
        service = labels.get('com.docker.compose.service')
        if service not in SERVICES:
            raise PermissionError('Service rejected')
        actual_name = value['Name'].removeprefix('/')
        expected_name = PROJECT + '-' + service
        if actual_name != expected_name + '-1' and not re.fullmatch(re.escape(expected_name) + r'-run-[a-f0-9]+', actual_name):
            raise PermissionError('Container name rejected')
        if (name in names and actual_name != name) or (name not in names and not value['Id'].startswith(name)):
            raise PermissionError('Container identity rejected')
        env = [entry for entry in value['Config'].get('Env', []) if entry.split('=', 1)[0] in
               {'POSTGRES_DB', 'POSTGRES_USER', 'PGDATA', 'POSTGRES_PASSWORD_FILE'}]
        return dict(Id=value['Id'], Name=value['Name'], Image=value['Image'], Created=value['Created'],
                    Config=dict(Labels=labels, Env=env, Image=value['Config'].get('Image')),
                    State=dict(Running=value['State']['Running']),
                    HostConfig=dict(PortBindings=value['HostConfig'].get('PortBindings')),
                    NetworkSettings={key: value['NetworkSettings'].get(key) for key in ('Networks', 'Ports')},
                    Mounts=[{key: mount[key] for key in ('Destination', 'Type', 'Name', 'RW') if key in mount}
                            for mount in value.get('Mounts', [])])
    allowed = NETWORKS if kind == 'network' else VOLUMES
    if name not in allowed:
        raise PermissionError('Resource selector rejected')
    value = fetch_engine('/' + ('networks' if kind == 'network' else 'volumes') + '/' + name)
    labels = owned_labels(value)
    if value['Name'] != name:
        raise PermissionError('Resource identity rejected')
    if kind == 'network':
        return dict(Id=value['Id'], Name=name, Internal=value['Internal'], Driver=value['Driver'], Labels=labels,
                    Containers={cid: {} for cid in value.get('Containers', {})})
    return dict(Name=name, Driver=value['Driver'], CreatedAt=value['CreatedAt'], Labels=labels,
                Options={'unsupported': True} if value.get('Options') else value.get('Options'))


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_args):
        pass  # No request paths, private engine errors or metadata in logs.

    def reply(self, status, value):
        body = json.dumps(value, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
            self.reply(400, {'error': 'Request body rejected'})
            return
        if self.path == '/health':
            self.reply(200, {'status': 'UP'})
            return
        try:
            value = inspect_path(self.path)
        except PermissionError:
            self.reply(403, {'error': 'Inspect request rejected'})
        except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
            self.reply(503, {'error': 'Required metadata unavailable'})
        else:
            self.reply(200, value)

    def reject_method(self):
        self.reply(405, {'error': 'Only GET inspect is allowed'})

    do_POST = do_PUT = do_PATCH = do_DELETE = do_CONNECT = do_OPTIONS = do_TRACE = do_HEAD = reject_method


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8081), Handler).serve_forever()
