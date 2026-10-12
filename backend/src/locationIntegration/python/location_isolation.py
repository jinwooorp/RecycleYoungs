"""Interactive controller for this authorized, disposable synthetic-location validation only.

Credentials stay in this process's memory. Public JSON omits passwords and connection strings.
This is not a source DB executor or a replacement for etl/control.py.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

ROOT = next(parent for parent in Path(__file__).resolve().parents
            if (parent / 'backend/build.gradle').is_file() and (parent / 'frontend/package.json').is_file())
OWNER = secrets.token_hex(12)
NETWORK = 'ry-8c1-net-' + OWNER
HOST = 'ry-8c1-db-' + OWNER
DATABASE = 'recycleyoungs_integration_test_' + OWNER
USER = 'integration_test'
PASSWORD = secrets.token_hex(24)
PGDATA = '/var/lib/postgresql/data/pgdata'
LABEL = 'recycleyoungs.location-integration'
DB_IMAGE = 'sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5'
network_id = None
db_id = None
sid = None
runners = {}


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def docker(*args, env=None, timeout=60):
    result = subprocess.run(['docker', *args], capture_output=True, text=True,
                            env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError(('Docker operation failed: ' + result.stderr[:500]).replace(PASSWORD, '[redacted]'))
    return result.stdout.strip()


def inspect_container(identity):
    return json.loads(docker('inspect', identity))[0]


def inspect_network():
    n = json.loads(docker('network', 'inspect', network_id))[0]
    require(n['Id'] == network_id and n['Name'] == NETWORK and n['Internal'] is True, 'Network identity/isolation differs')
    require(n['Labels'].get(LABEL) == OWNER, 'Network ownership differs')
    require(set(n.get('Containers') or {}) <= ({db_id} | set(runners)), 'Network has unowned members')
    return n


def verify_db():
    d = inspect_container(db_id)
    require(d['Id'] == db_id and d['Name'] == '/' + HOST and d['Image'] == DB_IMAGE, 'DB container/image identity differs')
    require(d['Config']['Labels'].get(LABEL) == OWNER, 'DB ownership differs')
    require(not d['HostConfig']['PortBindings'] and not any((d['NetworkSettings']['Ports'] or {}).values()), 'DB published ports forbidden')
    require(all(m['Type'] == 'tmpfs' for m in d['Mounts']), 'DB persistent mounts forbidden')
    require(set(d['HostConfig']['Tmpfs']) == {'/var/lib/postgresql/data', '/docker-entrypoint-initdb.d'}, 'DB tmpfs isolation differs')
    require(set(d['NetworkSettings']['Networks']) == {NETWORK}, 'DB network route differs')
    endpoint = d['NetworkSettings']['Networks'][NETWORK]
    require(endpoint['NetworkID'] == network_id and HOST in (endpoint.get('Aliases') or []), 'DB alias/network differs')
    env = dict(item.split('=', 1) for item in d['Config']['Env'] if '=' in item)
    require(env['PGDATA'] == PGDATA and env['POSTGRES_USER'] == USER and env['POSTGRES_DB'] == DATABASE, 'DB configured identity differs')
    inspect_network()
    return d


def identity():
    verify_db()
    raw = docker('exec', db_id, 'psql', '-X', '-U', USER, '-d', DATABASE, '-Atc',
        "SELECT json_build_object('database',current_database(),'user',current_user,"
        "'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),"
        "'dataDirectory',current_setting('data_directory'),'port',current_setting('port'),"
        "'postgresVersion',current_setting('server_version'))")
    value = json.loads(raw)
    require(value['database'] == DATABASE and value['user'] == USER and value['dataDirectory'] == PGDATA and value['port'] == '5432', 'Connected DB identity differs')
    if sid is not None:
        require(value['systemIdentifier'] == sid, 'Connected system identifier differs')
    return value


def prepare():
    global network_id, db_id, sid
    require(network_id is None and db_id is None, 'Preparation cannot overwrite existing run state')
    network_id = docker('network', 'create', '--internal', '--label', LABEL + '=' + OWNER, NETWORK)
    env = os.environ.copy()
    env['POSTGRES_PASSWORD'] = PASSWORD
    db_id = docker('run', '-d', '--name', HOST, '--network', NETWORK, '--network-alias', HOST,
        '--label', LABEL + '=' + OWNER, '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=512m',
        '--tmpfs', '/docker-entrypoint-initdb.d:rw,noexec,nosuid,size=1m',
        '-e', 'PGDATA=' + PGDATA, '-e', 'POSTGRES_USER=' + USER, '-e', 'POSTGRES_DB=' + DATABASE,
        '-e', 'POSTGRES_PASSWORD', DB_IMAGE, env=env)
    verify_db()
    for _ in range(40):
        # The entrypoint's temporary init server accepts Unix sockets but not TCP.
        ready = subprocess.run(['docker', 'exec', db_id, 'pg_isready', '-h', '127.0.0.1', '-U', USER, '-d', DATABASE], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Isolated DB did not become ready')
    proof = identity()
    sid = proof['systemIdentifier']
    return {'action': 'prepared', 'owner': OWNER, 'containerId': db_id, 'networkId': network_id,
            'imageId': DB_IMAGE, 'internal': True, 'hostPorts': [], 'volumes': [],
            'tmpfs': ['/var/lib/postgresql/data', '/docker-entrypoint-initdb.d'], 'identity': proof}


def verify_runner(runner_id):
    d = inspect_container(runner_id)
    require(d['Id'] == runner_id and d['Config']['Labels'].get(LABEL) == OWNER, 'Runner ownership/identity differs')
    require(d['Image'] == runners[runner_id], 'Runner image differs')
    require(not d['HostConfig']['PortBindings'] and not any((d['NetworkSettings']['Ports'] or {}).values()), 'Runner published ports forbidden')
    require(set(d['NetworkSettings']['Networks']) == {NETWORK}, 'Runner network route differs')
    require(d['NetworkSettings']['Networks'][NETWORK]['NetworkID'] == network_id, 'Runner network identity differs')
    require(len(d['Mounts']) == 1, 'Runner unexpected mounts')
    m = d['Mounts'][0]
    require(m['Type'] == 'bind' and m['Source'] == str(ROOT / 'backend/build/location-integration') and m['Destination'] == '/app' and m['RW'] is False, 'Runner code mount differs')
    inspect_network()
    return d


def start_runner():
    identity()
    image = docker('image', 'inspect', 'eclipse-temurin:21-jdk', '--format', '{{.Id}}')
    env = os.environ.copy()
    env.update(LOCATION_JDBC_PASSWORD=PASSWORD, DB_PASSWORD=PASSWORD)
    # Only this process creates and passes these test credentials and target proof.
    args = ['run', '-d', '--name', 'ry-location-java-' + OWNER + '-' + str(len(runners)),
            '--network', NETWORK, '--label', LABEL + '=' + OWNER,
            '--mount', 'type=bind,src=' + str(ROOT / 'backend/build/location-integration') + ',dst=/app,readonly',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            '-e', 'LOCATION_JDBC_PASSWORD', '-e', 'DB_PASSWORD',
            '-e', 'LOCATION_DB_HOST=' + HOST, '-e', 'LOCATION_DB_NAME=' + DATABASE,
            '-e', 'LOCATION_DB_USER=' + USER, '-e', 'LOCATION_DB_SID=' + sid,
            '-e', 'LOCATION_DB_CONTAINER_ID=' + db_id, '-e', 'LOCATION_NETWORK_ID=' + network_id,
            '-e', 'LOCATION_OWNER=' + OWNER, '-e', 'LOCATION_PGDATA=' + PGDATA,
            image, 'java', '-cp', '/app/classes:/app/lib/*',
            'com.example.backend.location.LocationIntegrationRunner']
    runner_id = docker(*args, env=env)
    runners[runner_id] = image
    verify_runner(runner_id)
    return {'action': 'runner-started', 'runnerId': runner_id, 'imageId': image, 'owner': OWNER}


def status():
    value = []
    for runner_id in runners:
        d = verify_runner(runner_id)
        logs = docker('logs', runner_id).replace(PASSWORD, '[redacted]')
        markers = [line for line in logs.splitlines() if line.startswith('LOCATION_')]
        if d['State']['Status'] == 'exited' and not markers:
            # Preserve compact diagnostics only, never raw log/connection configuration.
            markers = [line[:350] for line in logs.splitlines() if any(x in line for x in ['Exception', 'ERROR', 'Caused by:', 'error:', 'Assertion'])][-15:]
        value.append({'runnerId': runner_id, 'state': d['State']['Status'], 'exitCode': d['State']['ExitCode'], 'evidence': markers})
    return {'action': 'status', 'runners': value}


def cleanup():
    # Check every resource and all network members before touching any lifecycle.
    if network_id is None:
        require(db_id is None and not runners, 'Missing network identity for created resources')
        return {'action': 'cleaned', 'ownedResources': {}, 'imagesRemoved': False}
    if db_id is None:
        n = inspect_network()
        require(not runners and not n.get('Containers'), 'Partial preparation network has members')
        docker('network', 'rm', network_id)
        return {'action': 'cleaned', 'ownedResources': {'containers': [], 'network': network_id, 'owner': OWNER}, 'imagesRemoved': False}
    verify_db()
    for runner_id in runners:
        verify_runner(runner_id)
    before = {'containers': [*runners, db_id], 'network': network_id, 'owner': OWNER}
    for runner_id in runners:
        docker('rm', '-f', runner_id)
    docker('rm', '-f', db_id)
    docker('network', 'rm', network_id)
    return {'action': 'cleaned', 'ownedResources': before, 'imagesRemoved': False}


print(json.dumps({'action': 'controller-ready', 'owner': OWNER}), flush=True)
for line in sys.stdin:
    try:
        action = json.loads(line)['action']
        result = {'prepare': prepare, 'start-runner': start_runner, 'status': status, 'identity': identity, 'cleanup': cleanup}[action]()
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if action == 'cleanup':
            break
    except Exception as error:
        print(json.dumps({'action': 'STOP', 'reason': str(error).replace(PASSWORD, '[redacted]')[:600]}, ensure_ascii=False), flush=True)
