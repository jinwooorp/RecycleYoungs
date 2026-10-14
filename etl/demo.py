"""Disposable real-data demo controller. Default inspect is inert; secrets remain in memory."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
import traceback

from demo_safety import (DB_IMAGE, ETL_IMAGE, JAVA_IMAGE, LABEL, PGDATA, DemoError,
                         check_target, check_owned_database, reject_environment, require)

ROOT = Path(__file__).resolve().parents[1]


class Demo:
    def __init__(self, dataset_dir, spatial_root):
        reject_environment(os.environ)
        self.owner = secrets.token_hex(12)
        self.password, self.reader_password = secrets.token_hex(24), secrets.token_hex(24)
        self.target = dict(owner=self.owner, host='ry-demo-db-' + self.owner,
                           network='ry-demo-net-' + self.owner, database='recycleyoungs_demo_' + self.owner,
                           user='ry_demo_owner', pgdata=PGDATA, image=DB_IMAGE)
        self.resources, self.network_id, self.db_id = {}, None, None
        self.attachments = {}
        self.stage, self.server = 'NEW', None
        self.audit_runs = 0
        self.lock = threading.Lock()
        manifest = json.loads((ROOT / 'data/manifest.json').read_text())
        self.files = {'manifest.json': ROOT / 'data/manifest.json'}
        for key, dest in [('administrative_store_stats', 'stats.csv'), ('administrative_sales', 'sales.csv'),
                          ('individual_stores', 'stores.csv')]:
            spec = next(d for d in manifest['datasets'] if d['dataset_id'] == key)
            self.files[dest] = dataset_dir / spec['filename']
        self.files.update({'admin.zip': spatial_root / '서울시 상권분석서비스(영역-행정동).zip',
                           'admin-report.json': spatial_root / 'validation-results.json',
                           'commercial.zip': spatial_root / 'stage4-research-20261007/official-commercial-area.zip',
                           'commercial-report.json': spatial_root / 'stage56-validation-20261007/results.json',
                           'repair-report.json': spatial_root / 'six-repair-validation-20261007/results.json'})
        for path in self.files.values():
            require(not path.is_symlink() and path.is_file(), 'Required explicit source file missing or symlink: ' + path.name)
        self.files = {name: path.resolve() for name, path in self.files.items()}
        self.fingerprint = {name: self.file_hash(path) for name, path in self.files.items()}
        self.protected = None

    @staticmethod
    def file_hash(path):
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()

    def docker(self, *args, input=None, environment=None, timeout=120):
        result = subprocess.run(['docker', *args], input=input,
                                env=None if environment is None else dict(os.environ, **environment), text=True,
                                capture_output=True, timeout=timeout)
        if result.returncode:
            try:
                value = json.loads(result.stdout)
                if isinstance(value, dict) and value.get('status') == 'STOP':
                    raise DemoError(value['reason'])
            except (ValueError, KeyError):
                pass
            # Never expose docker argv, Config.Env, connection strings, or unbounded logs.
            raise DemoError('Docker operation failed: ' + args[0] + ' (exit ' + str(result.returncode) + ')')
        return result.stdout.strip()

    def inspect(self, kind, identity):
        return json.loads(self.docker(kind, 'inspect', identity))[0]

    def protected_metadata(self):
        d = self.inspect('container', 'startup-analysis-postgres')
        return dict(id=d['Id'], image=d['Image'], mounts=d['Mounts'], networks=d['NetworkSettings'],
                    restart_count=d['RestartCount'],
                    state={k: d['State'][k] for k in ('Running', 'Restarting', 'StartedAt', 'FinishedAt')})

    def unchanged(self):
        require(self.fingerprint == {name: self.file_hash(path) for name, path in self.files.items()}, 'Input changed during demo')
        if self.protected is not None:
            require(self.protected == self.protected_metadata(), 'Protected container metadata changed; STOP')

    def verify_db(self):
        require(self.db_id is not None and self.network_id is not None, 'No owned database')
        d, n = self.inspect('container', self.db_id), self.inspect('network', self.network_id)
        check_target(self.target, d, n)
        require(set(n.get('Containers', {})) <= {self.db_id, *self.resources}, 'Unknown network member')
        self.unchanged()
        return dict(target=self.target, internal=True, mounts=d['Mounts'], tmpfs=d['HostConfig']['Tmpfs'],
                    host_ports=d['HostConfig'].get('PortBindings'), ownership_label=LABEL)

    def mounts(self):
        paths = [(ROOT / 'etl', '/workspace/etl'), *[(path, '/inputs/' + name) for name, path in self.files.items()]]
        return paths

    def create_runner(self, name, image, command, mounts, environment=None, interactive=False, offline=False):
        if self.db_id:
            self.verify_db()
        network = 'none' if offline else self.target['network']
        args = ['create', '--pull=never', '--name', 'ry-demo-' + name + '-' + self.owner,
                '--label', LABEL + '=' + self.owner, '--network', network,
                '--tmpfs', '/tmp:rw,nosuid,size=128m']
        if interactive:
            args.append('-i')
        for source, destination in mounts:
            args += ['--mount', 'type=bind,src=' + str(source) + ',dst=' + destination + ',readonly']
        for key in (environment or {}):
            args += ['-e', key]
        cid = self.docker(*args, '--entrypoint', command[0], image, *command[1:], environment=environment)
        self.resources[cid] = dict(image=image, mounts={destination: str(source) for source, destination in mounts},
                                   network=network, name=name)
        self.verify_runner(cid)
        return cid

    def verify_runner(self, cid):
        expected = self.resources[cid]
        d = self.inspect('container', cid)
        require(d['Id'] == cid and d['Image'] == expected['image'] and
                d['Config']['Labels'].get(LABEL) == self.owner and not d['HostConfig'].get('PortBindings'),
                'Runner identity/port/ownership changed')
        actual_mounts = {m['Destination']: m['Source'] for m in d['Mounts']}
        require(actual_mounts == expected['mounts'] and
                all(m['Type'] == 'bind' and not m['RW'] for m in d['Mounts']), 'Runner mounts changed')
        require(set(d['NetworkSettings']['Networks']) == {expected['network']}, 'Runner network changed')
        if expected['network'] != 'none':
            network_id = d['NetworkSettings']['Networks'][expected['network']]['NetworkID']
            require(d['HostConfig']['NetworkMode'] == expected['network'] and
                    (network_id == self.network_id or (d['State']['Status'] == 'created' and not network_id)),
                    'Runner network ID changed')
        return d

    def start_checked(self, cid, input_data, wait=True):
        # Workers block on stdin: no SQL can run before the started endpoint proof passes.
        process = subprocess.Popen(['docker', 'start', '-a', '-i', cid], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.attachments[cid] = process
        try:
            for _ in range(100):
                d = self.verify_runner(cid)
                if d['State']['Status'] == 'running':
                    if self.resources[cid]['network'] != 'none':
                        require(d['NetworkSettings']['Networks'][self.target['network']]['NetworkID'] == self.network_id,
                                'Started endpoint proof missing')
                        self.verify_db()
                    break
                require(process.poll() is None, 'Runner exited before input gate')
                time.sleep(0.05)
            else:
                raise DemoError('Runner endpoint readiness timeout')
            if wait:
                output, error = process.communicate(input_data, timeout=1200)
                require(process.returncode == 0, 'Worker process failed: ' +
                        (json.loads(output).get('reason', 'guarded operation') if output.startswith('{') else 'guarded operation'))
                return output.strip()
            process.stdin.write(input_data)
            process.stdin.flush()
            process.stdin.close()
            return None
        except BaseException as failure:
            halted = self._halt_after_failure(cid, failure)
            if isinstance(failure, subprocess.TimeoutExpired):
                error = DemoError('Worker timeout; ' + ('owned runner halted' if halted else 'runner halt not verified') +
                                  ', no following stage')
                if hasattr(failure, 'cleanup_failure'):
                    error.cleanup_failure = failure.cleanup_failure
                raise error from failure
            raise

    def _halt_after_failure(self, cid, failure):
        try:
            # halt_runner rechecks full identity/ownership before any stop command.
            self.halt_runner(cid)
            return True
        except BaseException as cleanup_failure:
            if not hasattr(failure, 'cleanup_failure'):
                failure.cleanup_failure = cleanup_failure
            return False

    def halt_runner(self, cid):
        d = self.verify_runner(cid)
        if d['State']['Running']:
            self.docker('kill', cid)
        process = self.attachments.get(cid)
        if process:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            process.wait(timeout=15)
        require(not self.verify_runner(cid)['State']['Running'], 'Owned runner did not halt')

    def worker(self, stage, offline=False, name=None):
        self.unchanged()
        cid = self.create_runner(name or stage, ETL_IMAGE, ['python', '/workspace/etl/demo_worker.py', stage],
                                 self.mounts(), interactive=True, offline=offline)
        config = dict(target=self.target, password=self.password, reader_password=self.reader_password)
        output = self.start_checked(cid, json.dumps(config) + '\n')
        self.verify_runner(cid)
        result = json.loads(output)
        require(result['status'] == 'PASS' and result['stage'] == stage, 'Worker validation failed')
        self.unchanged()
        return result

    def prepare(self):
        require(self.stage == 'NEW', 'Fresh controller required')
        for image in (DB_IMAGE, ETL_IMAGE, JAVA_IMAGE):
            require(self.inspect('image', image)['Id'] == image, 'Pinned local image unavailable')
        require((ROOT / 'backend/build/demo/classes/com/example/backend/demo/DemoApplication.class').is_file(),
                'Run backend ./gradlew prepareDemo first (no database connection)')
        validation = self.worker('validate', offline=True)
        self.protected = self.protected_metadata()
        self.network_id = self.docker('network', 'create', '--internal', '--label', LABEL + '=' + self.owner,
                                      self.target['network'])
        self.target['network_id'] = self.network_id
        env = dict(os.environ, POSTGRES_PASSWORD=self.password)
        self.db_id = self.docker('create', '--pull=never', '--name', self.target['host'],
                                 '--label', LABEL + '=' + self.owner, '--network', self.target['network'],
                                 '--network-alias', self.target['host'],
                                 '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=4g',
                                 '--tmpfs', '/docker-entrypoint-initdb.d:rw,nosuid,size=16m',
                                 '-e', 'POSTGRES_DB=' + self.target['database'], '-e', 'POSTGRES_USER=ry_demo_owner',
                                 '-e', 'POSTGRES_PASSWORD', '-e', 'PGDATA=' + PGDATA, DB_IMAGE, environment=env)
        self.target['container_id'] = self.db_id
        check_owned_database(self.target, self.inspect('container', self.db_id), self.inspect('network', self.network_id))
        self.docker('start', self.db_id)
        for _ in range(40):
            ready = subprocess.run(['docker', 'exec', self.db_id, 'pg_isready', '-U', 'ry_demo_owner',
                                    '-d', self.target['database']], capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise DemoError('Owned DB did not become ready')
        control = self.docker('exec', '-u', 'postgres', self.db_id, 'pg_controldata', PGDATA)
        self.target['sid'] = next(line.split(':', 1)[1].strip() for line in control.splitlines()
                                  if line.startswith('Database system identifier:'))
        identity = self.verify_db()
        self.stage = 'PREPARED'
        return dict(action='prepare', validation=validation, identity=identity)

    def java(self, mode):
        self.verify_db()
        read_only = mode == 'serve'
        values = dict(OWNER=self.owner, HOST=self.target['host'], DATABASE=self.target['database'],
                      USER='ry_demo_reader' if read_only else 'ry_demo_owner', SID=self.target['sid'],
                      PGDATA=PGDATA, CONTAINER_ID=self.db_id, NETWORK_ID=self.network_id,
                      PASSWORD=self.reader_password if read_only else self.password)
        env = {'DEMO_' + key: value for key, value in values.items()}
        env['DB_PASSWORD'] = values['PASSWORD']
        mounts = [(ROOT / 'backend/build/demo', '/app')]
        cid = self.create_runner('api' if read_only else 'migrate', JAVA_IMAGE,
                                 ['java', '-cp', '/app/classes:/app/lib/*',
                                  'com.example.backend.demo.DemoApplication', mode], mounts, environment=env, interactive=True)
        try:
            self.start_checked(cid, '\n', wait=False)
            for _ in range(60):
                d = self.verify_runner(cid)
                output = self.docker('logs', cid)
                marker = 'DEMO_SERVICE_READY' if read_only else 'DEMO_MIGRATIONS_PASS count=3'
                if marker in output and (read_only or d['State']['Status'] == 'exited'):
                    require(read_only or d['State']['ExitCode'] == 0, 'Flyway process failed')
                    self.verify_db()
                    if read_only:
                        self.api_id = cid
                    return dict(action=mode, container_id=cid, identity_guard='every actual JDBC connection',
                                read_only=read_only, marker=marker)
                require(d['State']['Status'] != 'exited' or d['State']['ExitCode'] == 0, 'Guarded Java process failed')
                time.sleep(0.5)
            raise DemoError('Guarded Java readiness timeout')
        except BaseException as failure:
            self._halt_after_failure(cid, failure)
            raise

    def bridge(self):
        require(self.stage == 'SERVING', 'Verified read-only service required')
        controller = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                response_started = False
                try:
                    if not self.path.startswith('/api/') or any(c in self.path for c in ('\n', '\r')):
                        response_started = True
                        self.send_error(404)
                        return
                    with controller.lock:
                        controller.verify_db()
                        controller.verify_runner(controller.api_id)
                        raw = controller.docker('exec', controller.api_id, 'java', '-cp', '/app/classes:/app/lib/*',
                                                'com.example.backend.demo.DemoApplication', 'probe', self.path)
                        response = json.loads(raw)
                    body = response['body'].encode()
                    # Treat even partial header preparation as started: never append a fallback.
                    response_started = True
                    self.send_response(response['status'])
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    self.close_connection = True
                    return
                except Exception:
                    if response_started:
                        self.close_connection = True
                        return
                    try:
                        self.send_error(503, 'Verified demo bridge unavailable')
                    except Exception:
                        self.close_connection = True
                        return

            def log_message(self, format, *args):
                pass

        require(self.server is None, 'Bridge already started')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return dict(action='bridge', url='http://127.0.0.1:' + str(self.server.server_port), backend_internal=True)

    def cleanup(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        with self.lock:
            # Validate the complete deletion set first, including unknown network members.
            if self.db_id:
                d, n = self.inspect('container', self.db_id), self.inspect('network', self.network_id)
                check_owned_database(self.target, d, n)
                self.unchanged()
            for cid in self.resources:
                self.verify_runner(cid)
            if self.network_id:
                n = self.inspect('network', self.network_id)
                require(n['Id'] == self.network_id and n['Labels'].get(LABEL) == self.owner and n['Internal'] is True,
                        'Cleanup network ownership mismatch')
                require(set(n.get('Containers', {})) <= {self.db_id, *self.resources}, 'Cleanup has foreign network member')
            removed = [*self.resources, *([self.db_id] if self.db_id else [])]
            for cid in removed:
                self.docker('rm', '-f', cid)
            for process in self.attachments.values():
                process.wait(timeout=10)
                process.stdout.close()
                process.stderr.close()
            if self.network_id:
                self.docker('network', 'rm', self.network_id)
            self.unchanged()
            return dict(action='cleanup', containers=removed, network=self.network_id, protected_metadata_unchanged=True,
                        source_hashes_unchanged=True, volumes_created=False, images_removed=False)

    def dispatch(self, action):
        if action == 'cleanup':
            return self.cleanup()
        if action == 'prepare':
            return self.prepare()
        if action == 'identity':
            return self.verify_db()
        sequence = {'migrate': ('PREPARED', 'MIGRATED'), 'load': ('MIGRATED', 'LOADED'),
                    'verify': ('LOADED', 'VERIFIED'), 'seal': ('VERIFIED', 'SEALED'),
                    'serve': ('SEALED', 'SERVING'), 'final': ('SERVING', 'SERVING')}
        if action == 'bridge':
            return self.bridge()
        require(action in sequence, 'Unknown explicit action')
        before, after = sequence[action]
        require(self.stage == before, 'Previous gate missing')
        self.verify_db()
        if action == 'final':
            self.audit_runs += 1
            result = self.worker(action, name='final-' + str(self.audit_runs))
        else:
            result = self.java(action) if action in ('migrate', 'serve') else self.worker(action)
        self.stage = after
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--isolated-run', action='store_true')
    parser.add_argument('--dataset-dir', type=Path)
    parser.add_argument('--spatial-root', type=Path)
    args = parser.parse_args()
    if not args.isolated_run:
        print(json.dumps(dict(status='INERT', db_connected=False, resources_created=False,
                              required='--isolated-run --dataset-dir PATH --spatial-root PATH; explicit JSON actions on stdin')))
        return
    if not args.dataset_dir or not args.spatial_root:
        parser.error('Both explicit source directories required')
    try:
        demo = Demo(args.dataset_dir, args.spatial_root)
    except Exception as failure:
        print(json.dumps(dict(status='STOP', reason=str(failure) if isinstance(failure, DemoError) else type(failure).__name__)))
        raise SystemExit(1)
    print(json.dumps(dict(status='READY_FOR_EXPLICIT_ACTIONS', owner=demo.owner)), flush=True)
    stopped = False
    for line in sys.stdin:
        try:
            action = json.loads(line)['action']
            require(not stopped or action == 'cleanup', 'Terminal STOP: cleanup only')
            result = demo.dispatch(action)
            print(json.dumps(result, ensure_ascii=False, default=str), flush=True)
            if action == 'cleanup':
                return
        except Exception as failure:
            stopped = True
            print(json.dumps(dict(status='STOP', reason=str(failure) if isinstance(failure, DemoError) else type(failure).__name__,
                                  cleanup_failure=type(failure.cleanup_failure).__name__ if hasattr(failure, 'cleanup_failure') else None,
                                  locations=[dict(file=Path(f.filename).name, line=f.lineno, function=f.name)
                                             for f in traceback.extract_tb(failure.__traceback__)],
                                  automatic_retry=False, owner=demo.owner)), flush=True)
    if demo.resources or demo.db_id or demo.network_id:
        print(json.dumps(dict(status='OWNED_RESOURCES_REMAIN', owner=demo.owner, container_ids=list(demo.resources),
                              db_id=demo.db_id, network_id=demo.network_id, automatic_cleanup=False)), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
