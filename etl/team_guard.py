"""Docker ownership proof. Containers use the narrow inspect proxy; host uses CLI."""
from contextlib import closing
from datetime import datetime
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import urllib.parse

from team_data import DataError, canonical, require
from team_dataset import binding, parse_json, validate_binding

PROJECT = 'recycleyoungs-team-dev'
LABEL = 'org.recycleyoungs.environment'
OWNER = 'team-development-v1'
DATABASE = 'recycleyoungs_team_dev'
PGDATA = '/var/lib/postgresql/data/team'
NETWORK = PROJECT + '-net'
VOLUMES = {key: PROJECT + '-' + key for key in ('db', 'control', 'cache')}
DB_IMAGE = 'sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5'
DB_IMAGE_REFERENCE = 'postgis/postgis@' + DB_IMAGE
# Verified against the SHA-checked registry manifest above and its config blob.
# Classic stores report this config ID; containerd stores may report the manifest ID.
DB_IMAGE_CONFIG = 'sha256:06287eb8e12c43f425773085c48d6ad02d73f8b442ac209810c1b211eb0a643b'
SERVICES = {'inspect-proxy', 'preflight', 'data-init', 'team-postgres', 'db-identity', 'db-migrate', 'etl-init'}

# Exact, project-owned messages only. Never print an arbitrary exception message.
FAILURE_REASONS = {
    'DB image/running identity rejected': 'DB_IMAGE_IDENTITY_MISMATCH',
    'DB image identity rejected': 'DB_IMAGE_IDENTITY_MISMATCH',
    'DB is not running': 'DB_NOT_RUNNING',
    'DB full container identity rejected': 'DB_CONTAINER_IDENTITY_MISMATCH',
    'Foreign Docker resource ownership; do not reuse/delete it': 'DOCKER_OWNERSHIP_MISMATCH',
    'Docker service ownership mismatch': 'DOCKER_OWNERSHIP_MISMATCH',
    'Network is not dedicated/internal': 'DB_NETWORK_IDENTITY_MISMATCH',
    'Unexpected DB network': 'DB_NETWORK_IDENTITY_MISMATCH',
    'DB endpoint/alias mismatch': 'DB_NETWORK_IDENTITY_MISMATCH',
    'Host access network must contain only the owned DB': 'DB_NETWORK_IDENTITY_MISMATCH',
    'Unknown network member': 'DB_NETWORK_IDENTITY_MISMATCH',
    'Unexpected volume driver/mount': 'DB_VOLUME_IDENTITY_MISMATCH',
    'Unexpected DB mount': 'DB_VOLUME_IDENTITY_MISMATCH',
    'DB volume identity/access mismatch': 'DB_VOLUME_IDENTITY_MISMATCH',
    'DB init scripts must be read-only': 'DB_VOLUME_IDENTITY_MISMATCH',
    'DB host binding rejected': 'DB_PORT_BINDING_MISMATCH',
    'Declared port was not actually published': 'DB_PORT_BINDING_MISMATCH',
    'DB bootstrap configuration rejected': 'DB_BOOTSTRAP_CONFIGURATION_MISMATCH',
    'Actual team DB connection identity rejected': 'DB_SQL_IDENTITY_MISMATCH',
    'Session user mismatch': 'DB_SQL_IDENTITY_MISMATCH',
    'Missing owner marker on a populated DB; refusing adoption': 'DB_OWNER_MARKER_MISMATCH',
    'Missing owner marker with unknown schema': 'DB_OWNER_MARKER_MISMATCH',
    'Ownership ledger/resources mismatch': 'CONTROL_LEDGER_MISMATCH',
    'Persisted Docker proof mismatch': 'CONTROL_LEDGER_MISMATCH',
    'Host network identity changed': 'CONTROL_LEDGER_MISMATCH',
    'Recorded Docker identities changed; preserve resources and review': 'CONTROL_LEDGER_MISMATCH',
    'Dataset/ETL/owner mismatch BEFORE Flyway; preserve volume and review': 'DATASET_BINDING_MISMATCH',
    'Owned dataset version/contract mismatch; preserve existing resources': 'DATASET_BINDING_MISMATCH',
    'Flyway V1/V2/V3/checksum mismatch': 'MIGRATION_CHECKSUM_MISMATCH',
    'READY/actual DB fingerprint mismatch': 'READY_FINGERPRINT_MISMATCH',
    'READY/actual DB mismatch BEFORE Flyway': 'READY_FINGERPRINT_MISMATCH',
    'Spatial source/report/profile/version mismatch': 'SPATIAL_PROFILE_MISMATCH',
}
FAILURE_CODES = frozenset(FAILURE_REASONS.values()) | {
    'DATA_VALIDATION_FAILED', 'DATABASE_OPERATION_FAILED', 'UNEXPECTED_EXCEPTION', 'OS_OPERATION_FAILED'}
EXCEPTION_TYPES = frozenset({'DataError', 'ValueError', 'KeyError', 'TypeError', 'RuntimeError',
    'AssertionError', 'OSError', 'PermissionError', 'FileNotFoundError', 'TimeoutError',
    'OperationalError', 'ProgrammingError', 'UndefinedTable', 'InsufficientPrivilege',
    'InvalidPassword', 'ConnectionException', 'CheckViolation', 'UniqueViolation'})


def failure_details(exc):
    name = type(exc).__name__
    code = FAILURE_REASONS.get(str(exc), 'DATA_VALIDATION_FAILED') if isinstance(exc, DataError) else (
        'OS_OPERATION_FAILED' if isinstance(exc, OSError) else
        'DATABASE_OPERATION_FAILED' if getattr(exc, 'sqlstate', None) else 'UNEXPECTED_EXCEPTION')
    result = dict(code=code, error_type=name if name in EXCEPTION_TYPES else 'OtherException')
    sqlstate = getattr(exc, 'sqlstate', None)
    if isinstance(sqlstate, str) and re.fullmatch('[0-9A-Z]{5}', sqlstate): result['sqlstate'] = sqlstate
    return result


def failure_from_logs(text):
    # Service failures can be surrounded by Docker log lines. Extract bounded JSON
    # records and reconstruct a small allowlisted result, never return the record.
    for line in reversed(text[-65536:].splitlines()):
        try: value = parse_json(line.encode())
        except (DataError, ValueError): continue
        if not isinstance(value, dict) or value.get('status') != 'FAIL': continue
        code = value.get('code')
        if not isinstance(code, str) or code not in FAILURE_CODES:
            reason = value.get('reason')
            code = FAILURE_REASONS.get(reason) if isinstance(reason, str) else None
        if code is None: continue
        result = dict(code=code)
        name = value.get('error_type')
        if isinstance(name, str) and name in EXCEPTION_TYPES | {'OtherException'}: result['error_type'] = name
        sqlstate = value.get('sqlstate')
        if isinstance(sqlstate, str) and re.fullmatch('[0-9A-Z]{5}', sqlstate): result['sqlstate'] = sqlstate
        return result
    return {}


def inspect(kind, name):
    require(kind in {'container', 'network', 'volume', 'image'}, 'Metadata kind rejected')
    require(kind != 'image' or name == DB_IMAGE_REFERENCE, 'Image selector rejected')
    if os.getenv('TEAM_CONTAINER') == '1':
        with closing(http.client.HTTPConnection('inspect-proxy', 8081, timeout=15)) as conn:
            selector = 'postgis-pinned' if kind == 'image' else urllib.parse.quote(name, safe='')
            conn.request('GET', '/inspect/' + kind + '/' + selector)
            response = conn.getresponse()
            data = response.read(1024 * 1024 + 1)
            require(response.status == 200 and len(data) <= 1024 * 1024, 'Required Docker metadata missing/rejected: ' + name)
            return json.loads(data)
    result = subprocess.run(['docker', kind, 'inspect', name], capture_output=True, text=True, timeout=15)
    require(result.returncode == 0, 'Required Docker metadata missing: ' + name)
    return json.loads(result.stdout)[0]


def labels(resource, service=None):
    values = resource.get('Labels') if 'Config' not in resource else resource['Config'].get('Labels')
    values = values or {}
    require(values.get(LABEL) == OWNER and values.get('com.docker.compose.project') == PROJECT,
            'Foreign Docker resource ownership; do not reuse/delete it')
    if service:
        require(values.get('com.docker.compose.service') == service, 'Docker service ownership mismatch')


def resources():
    network = inspect('network', NETWORK)
    labels(network)
    require(network.get('Internal') is True and network.get('Driver') == 'bridge', 'Network is not dedicated/internal')
    volumes = {k: inspect('volume', v) for k, v in VOLUMES.items()}
    for v in volumes.values():
        labels(v)
        require(v.get('Driver') == 'local' and not v.get('Options'), 'Unexpected volume driver/mount')
    return dict(network_id=network['Id'], volumes={k: dict(name=v['Name'], created=v['CreatedAt']) for k, v in volumes.items()})


def claim(control=Path('/control')):
    require(os.getenv('TEAM_PROJECT', PROJECT) == PROJECT, 'COMPOSE_PROJECT_NAME/-p override rejected')
    own = inspect('container', os.environ['HOSTNAME'])
    labels(own, 'preflight')
    actual = resources()
    ledger = control / 'ownership.json'
    if ledger.exists():
        expected = parse_json(ledger.read_bytes())
        require(expected['resources'] == actual and len(expected['owner']) == 32,
                'Recorded Docker identities changed; preserve resources and review')
        validate_binding(expected)
        os.chmod(control, 0o700)
    else:
        pending = control / 'ownership.pending'
        if pending.exists():
            expected = parse_json(pending.read_bytes())
            require(expected['resources'] == actual, 'Pending ownership identities changed')
            validate_binding(expected)
            require(not inspect('container', PROJECT + '-team-postgres-1')['State']['Running'],
                    'Pending credential setup cannot resume with a running DB')
        else:
            created = datetime.fromisoformat(own['Created'].replace('Z', '+00:00')).timestamp()
            for v in actual['volumes'].values():
                stamp = datetime.fromisoformat(v['created'].replace('Z', '+00:00')).timestamp()
                require(abs(created - stamp) < 120, 'Unclaimed pre-existing volume; manual review required')
            expected = dict(owner=secrets.token_hex(16), resources=actual, dataset=binding())
            os.chmod(control, 0o700)
            with pending.open('x') as f:
                f.write(canonical(expected)); f.flush(); os.fsync(f.fileno())
            os.chmod(pending, 0o600)
        for name in ['password', 'reader-password']:
            path = control / name
            if not path.exists():
                secret = secrets.token_hex(32)
                with path.open('x') as f:
                    f.write(secret); f.flush(); os.fsync(f.fileno())
                os.chmod(path, 0o600)
            require(len(path.read_text()) == 64 and all(x in '0123456789abcdef' for x in path.read_text()),
                    'Incomplete credential file; preserve control volume and review')
        os.replace(pending, ledger)
    require(all((control / name).is_file() and len((control / name).read_text()) == 64
                and all(x in '0123456789abcdef' for x in (control / name).read_text())
                for name in ['password', 'reader-password']), 'Claimed credential missing; preserve volume and review')
    return dict(status='PASS', project=PROJECT, resources=actual)


def prove_database(expected=None):
    actual = resources()
    db = inspect('container', PROJECT + '-team-postgres-1')
    labels(db, 'team-postgres')
    require(db['State']['Running'], 'DB is not running')
    require(db['Image'] in {DB_IMAGE, DB_IMAGE_CONFIG}
            and db['Config'].get('Image') == DB_IMAGE_REFERENCE, 'DB image identity rejected')
    image = inspect('image', DB_IMAGE_REFERENCE)
    require(image.get('Id') == db['Image'] and isinstance(image.get('RepoDigests'), list)
            and DB_IMAGE_REFERENCE in image['RepoDigests'] and image.get('Os') == 'linux'
            and image.get('Architecture') == 'amd64', 'DB image identity rejected')
    require(db['Name'] == '/' + PROJECT + '-team-postgres-1' and len(db['Id']) == 64, 'DB full container identity rejected')
    host_name = PROJECT + '-host'
    require(set(db['NetworkSettings']['Networks']) == {NETWORK, host_name}, 'Unexpected DB network')
    endpoint = db['NetworkSettings']['Networks'][NETWORK]
    require(endpoint['NetworkID'] == actual['network_id'] and 'postgres' in (endpoint.get('Aliases') or []), 'DB endpoint/alias mismatch')
    require(db['HostConfig']['PortBindings'] == {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}, 'DB host binding rejected')
    require(db['NetworkSettings']['Ports'] == {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]},
            'Declared port was not actually published')
    host = inspect('network', host_name)
    labels(host)
    require(host.get('Internal') is False and host['Driver'] == 'bridge'
            and set(host.get('Containers', {})) == {db['Id']}
            and db['NetworkSettings']['Networks'][host_name]['NetworkID'] == host['Id'],
            'Host access network must contain only the owned DB')
    mounts = {m['Destination']: m for m in db['Mounts']}
    require(set(mounts) == {'/var/lib/postgresql/data', '/control', '/docker-entrypoint-initdb.d'}, 'Unexpected DB mount')
    for destination, key, rw in [('/var/lib/postgresql/data', 'db', True), ('/control', 'control', False)]:
        m = mounts[destination]
        require(m['Type'] == 'volume' and m.get('Name') == VOLUMES[key] and m['RW'] is rw, 'DB volume identity/access mismatch')
    require(mounts['/docker-entrypoint-initdb.d']['Type'] == 'bind' and not mounts['/docker-entrypoint-initdb.d']['RW'],
            'DB init scripts must be read-only')
    env = dict(x.split('=', 1) for x in db['Config']['Env'] if '=' in x)
    require(env.get('POSTGRES_DB') == DATABASE and env.get('POSTGRES_USER') == 'ry_team_owner'
            and env.get('PGDATA') == PGDATA and env.get('POSTGRES_PASSWORD_FILE') == '/control/password', 'DB bootstrap configuration rejected')
    for cid in inspect('network', NETWORK).get('Containers', {}):
        member = inspect('container', cid)
        labels(member)
        require(member['Config']['Labels'].get('com.docker.compose.service') in SERVICES, 'Unknown network member')
    result = dict(resources=actual, container_id=db['Id'], image=db['Image'], ip=endpoint['IPAddress'],
                  database=DATABASE, pgdata=PGDATA, host_port=55432, network=NETWORK, host_network_id=host['Id'])
    if expected:
        require(expected['resources'] == actual and expected['image'] == result['image'], 'Persisted Docker proof mismatch')
        if 'host_network_id' in expected:
            require(expected['host_network_id'] == host['Id'], 'Host network identity changed')
    return result


if __name__ == '__main__':
    try: print(canonical(claim()))
    except Exception as exc:
        print(canonical(dict(status='FAIL', **failure_details(exc))))
        raise SystemExit(1)
