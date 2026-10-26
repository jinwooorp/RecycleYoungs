"""Explicit owned-Docker backup/restore operations. No prune or automatic retry.

This host-side tool only uses a caller-selected Docker context and exact saved
identities. Evidence and credentials stay in a new private directory outside Git.
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile
import time
from pathlib import PurePosixPath

from dev_recovery import (BASE_ARTIFACTS, IMAGE_ROLES, exclusive_json, file_digest,
                          private_path, require, require_new_target, seal_package,
                          verify_archive, verify_package)

LABEL = 'org.recycleyoungs.recovery'
SERVICES = {'api-postgres', 'api-backend', 'api-scheduler', 'frontend', 'inspect-proxy'}
VOLUMES = {'db', 'data', 'control', 'reader', 'writer'}
WRITER_QUERY = "SELECT count(*) FROM pg_stat_activity WHERE usename IN ('ry_api_owner','api_writer') AND backend_type='client backend' AND pid<>pg_backend_pid()"


def validate_inventory(rows, project):
    require(len(rows) == 5 and {r['service'] for r in rows} == SERVICES
            and len({r['id'] for r in rows}) == 5
            and all(r['project'] == project and r['environment'] == 'local-development-v1'
                    and r['running'] and re.fullmatch('[0-9a-f]{64}', r['id'])
                    and all(v.startswith(project + '-') for v in r['volumes']) for r in rows),
            'RECOVERY_LIVE_INVENTORY_REJECTED')


def require_unchanged(before, after):
    require(before == after, 'RECOVERY_SOURCE_CHANGED')


def finalize_restore(*, verify_source, issue, record_verified, quiesce, unblock, activate, stop):
    try:
        verify_source()
        # Runtime controls are first issued only while the new DB is stopped.
        quiesce()
        issue()  # Both writer routes remain persistently blocked here.
        verify_source()
        # Old archived workers understand one marker per control volume. Keep
        # their new DB stopped while those two files are removed, so even a
        # killed process after the first unlink cannot open a writer route.
        unblock()
        # All restore/source comparisons are complete and the DB is stopped.
        # Persist that verified state before start: a kill during activation
        # can then leave only a fully verified DB running, never an unverified
        # writable target without a receipt.
        record_verified()
        activate()
    except BaseException:
        stop()
        raise


def durable_stop(root, *, shutdown):
    try:
        exclusive_json(Path(root)/'STOP.json',dict(status='STOP',code='RECOVERY_FINALIZATION_FAILED',automatic_retry=False))
    finally:
        # Persist the host gate before Docker I/O; if persistence itself fails,
        # still make one fail-closed shutdown attempt, never an automatic retry.
        shutdown()


def record_reader_check(root, value):
    first=Path(root)/'readers.json'
    if first.exists():
        require(json.loads(private_path(first).read_text())==value, 'RECOVERY_READER_MEASUREMENT_CHANGED')
        exclusive_json(Path(root)/('readers-recheck-'+secrets.token_hex(8)+'.json'),value)
    else:
        exclusive_json(first,value)


def retention_inputs(packages):
    identities=[]
    for package in packages:
        path=private_path(package,directory=True);info=path.stat();identities.append((info.st_dev,info.st_ino))
    require(len(set(identities))==len(identities), 'RECOVERY_DUPLICATE_PACKAGE')
    rows=[];manifests=set()
    for index,package in enumerate(packages):
        manifest=verify_package(package);identity=file_digest(Path(package)/'manifest.json')['sha256']
        require(identity not in manifests,'RECOVERY_DUPLICATE_PACKAGE');manifests.add(identity)
        rows.append(dict(package=f'input-{index+1}',created_at=manifest['created_at'],bytes=sum(r['bytes'] for r in manifest['artifacts'].values())))
    return rows


def new_binding(source, target, volumes, sql):
    require_new_target(source, target)
    require(set(volumes) == VOLUMES and all(isinstance(v, str) and v for v in volumes.values()),
            'RECOVERY_VOLUME_BINDING_REJECTED')
    require(sql and all(re.fullmatch('[0-9a-f]{64}', v) for v in sql.values()), 'RECOVERY_SQL_BINDING_REJECTED')
    return dict(project=target['project'], volumes=volumes, sql=sql)


def hba_for_target(source, target, phase):
    require_new_target(source, target)
    require(phase in ['BOOTSTRAP', 'VERIFIED'], 'RECOVERY_AUTH_PHASE_REJECTED')
    return 'local all all trust\n' + ('host all ry_api_owner samenet trust\n' if phase == 'BOOTSTRAP'
                                     else 'host all all samenet scram-sha-256\n')


def verify_executed_image(path, image_id):
    """Bind a config, manifest or index digest to the saved amd64 config.

    Recent Docker versions expose an OCI index in image.Id while container
    ImageManifestDescriptor identifies the executed platform manifest. A tag
    alone is never evidence that those two images contain the same code.
    """
    require(bool(re.fullmatch('sha256:[0-9a-f]{64}', image_id)), 'RECOVERY_IMAGE_ID_REJECTED')
    with tarfile.open(path) as archive:
        manifest = json.load(archive.extractfile('manifest.json'))
        configs = {Path(entry['Config']).name.removesuffix('.json') for entry in manifest}
        identity = image_id.split(':')[1]
        names = archive.getnames()

        def blob(digest, name=None):
            require(bool(re.fullmatch('sha256:[0-9a-f]{64}', digest)), 'RECOVERY_IMAGE_DIGEST_REJECTED')
            name = name or 'blobs/sha256/' + digest.split(':')[1]
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts,
                    'RECOVERY_IMAGE_METADATA_REJECTED')
            require(names.count(name) == 1, 'RECOVERY_EXECUTED_IMAGE_NOT_ARCHIVED')
            entry = archive.getmember(name)
            require(entry.isfile() and entry.size <= 1024*1024, 'RECOVERY_IMAGE_METADATA_REJECTED')
            data = archive.extractfile(entry).read()
            require(hashlib.sha256(data).hexdigest() == digest.split(':')[1], 'RECOVERY_IMAGE_DIGEST_CHANGED')
            return json.loads(data)

        def configuration(digest, depth=0):
            require(depth <= 2, 'RECOVERY_IMAGE_INDEX_REJECTED')
            value = blob(digest)
            if 'manifests' in value:
                choices = [d for d in value['manifests'] if d.get('platform') == dict(os='linux', architecture='amd64')]
                require(len(choices) == 1, 'RECOVERY_IMAGE_PLATFORM_REJECTED')
                return configuration(choices[0]['digest'], depth+1)
            require('config' in value, 'RECOVERY_IMAGE_MANIFEST_REJECTED')
            config_digest = value['config']['digest']
            config = blob(config_digest)
            require(config.get('os') == 'linux' and config.get('architecture') == 'amd64',
                    'RECOVERY_IMAGE_PLATFORM_REJECTED')
            config_id = config_digest.split(':')[1]
            require(config_id in configs, 'RECOVERY_EXECUTED_IMAGE_NOT_ARCHIVED')
            return {config_id}

        if identity in configs:
            paths = {e['Config'] for e in manifest if Path(e['Config']).name.removesuffix('.json') == identity}
            require(len(paths) == 1, 'RECOVERY_IMAGE_METADATA_REJECTED')
            config = blob(image_id, next(iter(paths)))
            require(config.get('os') == 'linux' and config.get('architecture') == 'amd64',
                    'RECOVERY_IMAGE_PLATFORM_REJECTED')
            return {identity}
        return configuration(image_id)


def rootfs_fingerprint(source):
    """Hash every rootfs entry and byte without extracting links or devices."""
    rows={}
    with tarfile.open(fileobj=source,mode='r|*') if hasattr(source,'read') else tarfile.open(source,'r:*') as archive:
        for entry in archive:
            name=str(PurePosixPath(entry.name))
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts and name not in rows,
                    'RECOVERY_ROOTFS_PATH_REJECTED')
            digest=None
            if entry.isfile():
                h=hashlib.sha256()
                with archive.extractfile(entry) as stream:
                    for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
                digest=h.hexdigest()
            rows[name]=[entry.type.decode('ascii'),entry.mode,entry.uid,entry.gid,entry.size,str(entry.mtime),
                entry.linkname,entry.devmajor,entry.devminor,{k:v for k,v in entry.pax_headers.items() if k not in ['atime','ctime']},digest]
    payload=json.dumps(rows,sort_keys=True,separators=(',',':')).encode()
    return dict(entries=len(rows),sha256=hashlib.sha256(payload).hexdigest())


def verify_captured_rootfs(docker, container, image_archive, evidence, role):
    with tarfile.open(image_archive) as archive:
        entries=json.load(archive.extractfile('manifest.json'))
        require(len(entries)==1 and len(entries[0]['Layers'])==1,'RECOVERY_CAPTURE_LAYER_REJECTED')
        frozen=rootfs_fingerprint(archive.extractfile(entries[0]['Layers'][0]))
    for number in [1,2]:
        path=evidence/(role+'-live-rootfs-'+str(number)+'.tar')
        docker.run('export',container,output=path)
        require(rootfs_fingerprint(path)==frozen,'RECOVERY_FULL_ROOTFS_CHANGED')
    return frozen


def verify_rootfs_capture(container, image, capture, changes, application_files):
    normalized = '\n'.join(sorted(changes.decode().splitlines())).encode()
    require(capture.get('kind') == 'ROOTFS_EXPORT_IMPORT' and container['State']['Running']
            and capture.get('source_container') == container['Id'] and capture.get('source_image') == container['Image']
            and capture.get('image_id') == image['Id']
            and image['RootFS']['Layers'] == ['sha256:' + capture['rootfs_sha256']]
            and capture['rootfs_diff_sha256'] == hashlib.sha256(normalized).hexdigest()
            and capture['runtime_environment'] == container['Config']['Env']
            and capture['application_files'] and capture['application_files'] == application_files,
            'RECOVERY_CAPTURE_CHANGED')
    require(all(container['Config'].get(k) == image['Config'].get(k) for k in ['User', 'WorkingDir', 'Entrypoint', 'Cmd']),
            'RECOVERY_CAPTURE_CONFIGURATION_CHANGED')
    saved = dict(v.split('=', 1) for v in image['Config'].get('Env', []))
    require(all(v.split('=', 1)[0].startswith('VITE_') or saved.get(v.split('=', 1)[0]) == v.split('=', 1)[1]
                for v in container['Config']['Env']), 'RECOVERY_CAPTURE_ENVIRONMENT_CHANGED')


class Docker:
    def __init__(self, context, evidence):
        require(re.fullmatch('[A-Za-z0-9_.-]+', context), 'RECOVERY_CONTEXT_REJECTED')
        self.prefix = ['docker', '--context', context]
        self.evidence = private_path(evidence, directory=True)

    def error_file(self):
        path = self.evidence / ('stderr-' + secrets.token_hex(8) + '.log')
        return open(path, 'xb')

    def run(self, *args, data=None, output=None, stdin=None):
        with self.error_file() as error:
            if output:
                fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as destination:
                    result = subprocess.run(self.prefix + list(args), input=data, stdin=stdin,
                                            stdout=destination, stderr=error)
                    destination.flush(); os.fsync(destination.fileno())
            else:
                result = subprocess.run(self.prefix + list(args), input=data, stdin=stdin,
                                        stdout=subprocess.PIPE, stderr=error)
        require(result.returncode == 0, 'RECOVERY_DOCKER_OPERATION_FAILED')
        return b'' if output else result.stdout

    def inspect(self, kind, name):
        return json.loads(self.run(kind, 'inspect', name))[0]

    def execute(self, container, script, value=None):
        return json.loads(self.run('exec', '-i', container, 'python', '-u', '-c', script,
                                  data=json.dumps(value).encode() if value is not None else b''))


def inventory(docker, project):
    ids = docker.run('ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project).decode().split()
    containers = [docker.inspect('container', c) for c in ids]
    rows = []
    for c in containers:
        labels = c['Config'].get('Labels') or {}
        # Completed initialization containers are allowed, but never selected.
        if labels.get('com.docker.compose.service') not in SERVICES:
            require(not c['State']['Running'], 'RECOVERY_UNEXPECTED_ACTIVE_SERVICE')
            continue
        rows.append(dict(id=c['Id'], service=labels.get('com.docker.compose.service'), project=labels.get('com.docker.compose.project'),
                         environment=labels.get('org.recycleyoungs.environment'), running=c['State']['Running'], image=c['Image'],
                         volumes=[m['Name'] for m in c['Mounts'] if m['Type'] == 'volume'], mounts=c['Mounts'],
                         networks=sorted(c['NetworkSettings']['Networks']), restart_count=c['RestartCount']))
    rows.sort(key=lambda c: c['service'])
    validate_inventory(rows, project)
    volumes = {name: docker.inspect('volume', project + '-' + name) for name in VOLUMES}
    for name, volume in volumes.items():
        labels = volume.get('Labels') or {}
        require(volume['Name'] == project + '-' + name and labels.get('com.docker.compose.project') == project
                and labels.get('org.recycleyoungs.environment') == 'local-development-v1' and not volume.get('Options'),
                'RECOVERY_VOLUME_OWNER_REJECTED')
    networks = {name: docker.inspect('network', project + '-' + name)['Id'] for name in ['data', 'inspect', 'access']}
    db = next(c for c in containers if c['Config']['Labels'].get('com.docker.compose.service') == 'api-postgres')
    require(not db['HostConfig'].get('PortBindings') and set(db['NetworkSettings']['Networks']) == {project + '-data'}
            and docker.inspect('network', project + '-data')['Internal'], 'RECOVERY_SOURCE_DB_ROUTE_REJECTED')
    return dict(services=rows, volumes=volumes, networks=networks)


def protected_source(docker, project):
    """An empty destination is valid; an incomplete same-name source is not."""
    containers = docker.run('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project).decode().split()
    if containers:
        return inventory(docker, project)
    for kind in ['volume', 'network']:
        require(not docker.run(kind, 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + project).strip(),
                'RECOVERY_PARTIAL_SOURCE_PRESENT')
    return None


def require_image_tags(entries, existing, *, image_id=None, config_ids=()):
    for entry in entries:
        identity = 'sha256:' + Path(entry['Config']).name.removesuffix('.json')
        for tag in entry.get('RepoTags') or []:
            require(existing[tag] in (None, identity) or (identity.split(':')[1] in config_ids
                    and image_id is not None and existing[tag] == image_id), 'RECOVERY_IMAGE_TAG_CONFLICT')


def load_image(docker, path, image_id):
    config_ids = verify_executed_image(path, image_id)
    with tarfile.open(path) as archive:
        entries = json.load(archive.extractfile('manifest.json'))
    existing = {}
    for tag in {tag for entry in entries for tag in entry.get('RepoTags') or []}:
        result = subprocess.run(docker.prefix + ['image', 'inspect', tag], capture_output=True)
        existing[tag] = json.loads(result.stdout)[0]['Id'] if result.returncode == 0 else None
    require_image_tags(entries, existing, image_id=image_id, config_ids=config_ids)
    docker.run('image', 'load', '--input', str(path))


HOLD = r'''import json,sys
from pathlib import Path
from api_runtime import connect,verify_connection,require
from api_snapshot import snapshot
from dev_transition import require_clear
require_clear('/api-control');require_clear('/archive-writer')
require(not Path('/api-data/reference-transition-pending.json').exists() and not Path('/api-data/reference-transition-pending.json').is_symlink(),'RECOVERY_TRANSITION_PENDING')
with connect('/api-control','ry_api_owner',True)[0] as conn:
 with conn.transaction():
  conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  require(conn.execute('SELECT pg_try_advisory_lock(20261021,51)').fetchone()==(True,),'RECOVERY_WRITER_BUSY')
  require(conn.execute("__WRITER_QUERY__").fetchone()==(0,),'RECOVERY_OTHER_WRITER_PRESENT')
  require(conn.execute('SELECT count(*) FROM pg_prepared_xacts').fetchone()==(0,),'RECOVERY_PREPARED_TRANSACTION_PRESENT')
  require(conn.execute('SELECT count(*) FROM pg_subscription').fetchone()==(0,),'RECOVERY_SUBSCRIPTION_PRESENT')
  state=conn.execute('SELECT status,release_id FROM api_runtime.state CROSS JOIN api_current_release WHERE api_runtime.state.singleton AND api_current_release.singleton').fetchone()
  require(state[0] in ('IDLE','SUCCEEDED'),'RECOVERY_JOB_NOT_QUIESCENT')
  t=json.loads(open('/api-control/target.json').read());verify_connection(conn,t,'ry_api_owner',True)
  print(json.dumps(dict(target=t,release_id=state[1],exported_snapshot=conn.execute('SELECT pg_export_snapshot()').fetchone()[0])),flush=True)
  print(json.dumps(snapshot(conn)),flush=True)
  require(sys.stdin.readline()=='release\n','RECOVERY_SNAPSHOT_RELEASE_REQUIRED')
'''.replace('__WRITER_QUERY__', WRITER_QUERY)

MEASURE = '''import json
from api_runtime import connect,verify_connection
from api_snapshot import snapshot
with connect('/api-control','ry_api_owner',True)[0] as conn:
 with conn.transaction():
  conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  t=json.loads(open('/api-control/target.json').read());verify_connection(conn,t,'ry_api_owner',True)
  print(json.dumps(snapshot(conn)))
'''

HTTP_PROBE = '''import json,sys,urllib.request
c=json.load(sys.stdin)
try:
 request=urllib.request.Request(c['url'],headers={'Host':'localhost'})
 with urllib.request.urlopen(request,timeout=3) as response:rows=json.load(response)
 print(json.dumps(dict(ready=True,quarters=len(rows))))
except Exception:print(json.dumps(dict(ready=False)))
'''

RECOVERY_QUARTERS = '''import json,sys
from api_runtime import connect,verify_connection,require
c=json.load(sys.stdin)
with connect('/api-control','api_reader',True)[0] as conn:
 with conn.transaction():
  conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  verify_connection(conn,c['target'],'api_reader',True)
  row=conn.execute("SELECT r.release_id,r.metadata->'quarters' FROM api_current_release p JOIN api_releases r USING(release_id) WHERE p.singleton").fetchone()
  require(row is not None and row[0]==c['release_id'],'RECOVERY_PUBLIC_RELEASE_CHANGED')
print(json.dumps(dict(release_id=row[0],quarters=row[1])))
'''


def backup(root, *, context, project, expected_container, expected_sid, expected_release, image_captures=None):
    root = Path(root)
    from app.api_config import outside_project
    outside_project(root)
    require(root.is_absolute() and not root.exists() and not any(p.is_symlink() for p in root.parents), 'RECOVERY_NEW_PRIVATE_ROOT_REQUIRED')
    private_path(root.parent, directory=True)
    root.mkdir(mode=0o700)
    package = root / 'package'; evidence = root / 'evidence'
    package.mkdir(mode=0o700); evidence.mkdir(mode=0o700)
    docker = Docker(context, evidence)
    before = inventory(docker, project)
    db = next(c for c in before['services'] if c['service'] == 'api-postgres')
    require(db['id'] == expected_container, 'RECOVERY_EXPECTED_CONTAINER_CHANGED')
    require(re.fullmatch('[0-9]+', expected_sid) and re.fullmatch('[0-9a-f]{64}', expected_release), 'RECOVERY_EXPECTED_IDENTITY_REJECTED')
    nonce = secrets.token_hex(12)
    exclusive_json(evidence / 'intent.json', dict(action='BACKUP', nonce=nonce, before=before,
                                                 expected_sid=expected_sid, expected_release=expected_release))
    worker = next(c for c in before['services'] if c['service'] == 'api-scheduler')['image']
    args = ['create', '--name', 'ry-recovery-' + nonce + '-source', '--label', LABEL + '=' + nonce,
            '--network', project + '-data', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--user', '10001:10001', '--memory', '2g', '--tmpfs', '/tmp:rw,size=256m,uid=10001,gid=10001,mode=0700']
    for name in ['control', 'data', 'reader', 'writer']:
        args += ['--mount', 'type=volume,src=' + project + '-' + name + ',dst=/archive-' + name + ',readonly']
    args += ['--mount', 'type=volume,src=' + project + '-control,dst=/api-control,readonly',
             '--mount', 'type=volume,src=' + project + '-data,dst=/api-data,readonly',
             '--entrypoint', 'sh', worker, '-c', 'trap "exit 0" TERM INT; while :; do sleep 30 & wait $!; done']
    client = docker.run(*args).decode().strip()
    exclusive_json(evidence / 'source-client.json', dict(id=client, image=worker, nonce=nonce))
    docker.run('start', client)
    error = docker.error_file()
    process = subprocess.Popen(docker.prefix + ['exec', '-i', client, 'python', '-u', '-c', HOLD],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=error, text=True)
    try:
        header_line = process.stdout.readline(); snapshot_line = process.stdout.readline()
        require(bool(header_line and snapshot_line), 'RECOVERY_SNAPSHOT_UNAVAILABLE')
        header = json.loads(header_line); measured = json.loads(snapshot_line)
        require(header['target']['sid'] == expected_sid and header['target']['container_id'] == expected_container
                and header['target']['network_id'] == before['networks']['data'] and header['release_id'] == expected_release,
                'RECOVERY_SOURCE_CONNECTION_CHANGED')
        exclusive_json(package / 'snapshot.json', measured)
        globals_sql = docker.run('exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', expected_container,
                                'pg_dumpall', '--globals-only', '--no-role-passwords', '--quote-all-identifiers',
                                '-h', '/var/run/postgresql', '-U', 'ry_api_owner', '-d', 'dbname=postgres').decode()
        exclusive_json(package / 'roles.json', dict(sql=globals_sql))
        docker.run('exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', expected_container,
                   'pg_dump', '--format=custom', '--create', '--snapshot=' + header['exported_snapshot'],
                   '-h', '/var/run/postgresql', '-U', 'ry_api_owner', '-d', 'recycleyoungs_api_dev',
                   output=package / 'database.dump')
        for role in ['control', 'data', 'reader', 'writer']:
            path = package / (role + '.tar')
            docker.run('exec', client, 'tar', '-C', '/archive-' + role, '-cpf', '-', '.', output=path)
            verify_archive(path)
            second = evidence / (role + '-readback.tar')
            docker.run('exec', client, 'tar', '-C', '/archive-' + role, '-cpf', '-', '.', output=second)
            require(file_digest(path) == file_digest(second), 'RECOVERY_VOLUME_CHANGED_DURING_BACKUP')
        frontend = docker.inspect('container', next(c for c in before['services'] if c['service'] == 'frontend')['id'])
        bind = [m for m in frontend['Mounts'] if m['Destination'] == '/build/src' and m['Type'] == 'bind' and not m['RW']]
        require(len(bind) == 1 and Path(bind[0]['Source']).resolve().name == 'src', 'RECOVERY_FRONTEND_SOURCE_REJECTED')
        source = Path(bind[0]['Source'])
        with tarfile.open(package / 'frontend-source.tar', 'x') as archive:
            archive.add(source, arcname='.')
        (package / 'frontend-source.tar').chmod(0o600); verify_archive(package / 'frontend-source.tar')
        with tarfile.open(evidence/'frontend-source-readback.tar','x') as archive:archive.add(source,arcname='.')
        (evidence/'frontend-source-readback.tar').chmod(0o600)
        require(rootfs_fingerprint(package/'frontend-source.tar')==rootfs_fingerprint(evidence/'frontend-source-readback.tar'),
                'RECOVERY_FRONTEND_SOURCE_CHANGED')
        sql_hashes = docker.execute(client, "import dev_runtime,json;print(json.dumps(dev_runtime.schemas()))")
        runtime = dict(source=header['target'], sql=sql_hashes,
                       state=docker.execute(client, "import api_worker,json;print(json.dumps(api_worker.status()))"),
                       frontend_environment=[v for v in frontend['Config']['Env'] if v.startswith('VITE_')],
                       protected_inventory=before)
        require(measured == docker.execute(client, MEASURE), 'RECOVERY_SOURCE_DATA_CHANGED')
        require_unchanged(before, inventory(docker, project))
    finally:
        if process.poll() is None:
            try:
                process.stdin.write('release\n'); process.stdin.flush(); process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        process.wait(timeout=60); error.close()
    require(process.returncode == 0, 'RECOVERY_SNAPSHOT_HOLDER_FAILED')
    image_roles = {'db': 'api-postgres', 'worker': 'api-scheduler', 'backend': 'api-backend',
                   'frontend': 'frontend', 'proxy': 'inspect-proxy'}
    images = {}
    runtime['image_captures'] = image_captures or {}
    for role in sorted(IMAGE_ROLES):
        if role == 'migrator':
            ref = project + '-migrator:local'
        else:
            c = docker.inspect('container', next(c for c in before['services'] if c['service'] == image_roles[role])['id'])
            if role in runtime['image_captures']:
                capture = runtime['image_captures'][role]
                ref = capture['image_id']
                script = "const fs=require('fs'),c=require('crypto');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{let out={};for(let p of JSON.parse(s)){if(fs.statSync(p).isFile())out[p]=c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}process.stdout.write(JSON.stringify(out))})"
                files = json.loads(docker.run('exec', '-i', c['Id'], 'node', '-e', script,
                                              data=json.dumps(list(capture['application_files'])).encode()))
                verify_rootfs_capture(c, docker.inspect('image', ref), capture, docker.run('diff', c['Id']), files)
            else:
                try:
                    docker.inspect('image', c['Image']); ref = c['Image']
                except ValueError:
                    ref = c['Config']['Image']
        image = docker.inspect('image', ref)
        path = role + '-image.tar'
        docker.run('image', 'save', ref, output=package / path)
        if role in runtime['image_captures']:
            runtime['image_captures'][role]=dict(runtime['image_captures'][role],full_rootfs=verify_captured_rootfs(docker,c['Id'],package/path,evidence,role))
        verify_executed_image(package / path, image['Id'])
        if role != 'migrator' and image['Id'] != c['Image'] and role not in runtime['image_captures']:
            executed = c.get('ImageManifestDescriptor')
            if executed is not None:
                require(executed.get('platform') == dict(os='linux', architecture='amd64'),
                        'RECOVERY_IMAGE_PLATFORM_REJECTED')
            verify_executed_image(package / path, executed['digest'] if executed else c['Image'])
        images[role] = dict(image_id=image['Id'], file=path)
    require_unchanged(before, inventory(docker, project))
    exclusive_json(package / 'runtime.json', runtime)
    source = {k: header['target'][k] for k in ['project', 'owner', 'sid', 'container_id', 'network_id']}
    source.update(release_id=header['release_id'], exported_snapshot=header['exported_snapshot'])
    manifest = dict(schema_version=1, kind='FULL_LOCAL_DEV_RECOVERY', created_at=datetime.now(timezone.utc).isoformat(),
                    source=source, images=images,
                    artifacts={p.name: file_digest(p) for p in package.iterdir()})
    digest = seal_package(package, manifest)
    exclusive_json(evidence / 'backup-verified.json', dict(status='PASS', manifest_sha256=digest,
                                                         tables=len(measured['tables']), source_unchanged=True))
    return dict(status='PASS', phase='FULL_BACKUP_VERIFIED', tables=len(measured['tables']),
                manifest_sha256=digest, source_unchanged=True)


RESTORE_VERIFY = '''import json,sys
from pathlib import Path
import psycopg
from psycopg import sql
from api_runtime import private_read,verify_connection,require
from api_snapshot import snapshot
import api_worker
c=json.load(sys.stdin);target=c['target']
def opened(role,readonly=True):
 name={'ry_api_owner':'owner','api_writer':'writer','api_reader':'reader'}[role]
 conn=psycopg.connect(host='api-postgres',port=5432,dbname='recycleyoungs_api_dev',user=role,
  password=private_read('/api-control/'+name+'-password').strip(),autocommit=True,connect_timeout=5,
  options='-c lock_timeout=5s -c statement_timeout=600000 -c default_transaction_read_only='+('on' if readonly else 'off'))
 verify_connection(conn,target,role,readonly);return conn
if c['mode']=='credentials':
 with opened('ry_api_owner',False) as conn:
  for role,name in [('ry_api_owner','owner'),('api_reader','reader'),('api_writer','writer')]:
   conn.execute(sql.SQL('ALTER ROLE {} PASSWORD {}').format(sql.Identifier(role),sql.Literal(private_read('/api-control/'+name+'-password').strip())))
 print(json.dumps({'status':'PASS','credentials_restored':3}))
else:
 with opened('ry_api_owner') as conn:
  with conn.transaction():
   conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
   measured=snapshot(conn)
   versions=[]
   for version,runs in conn.execute('SELECT release_id,runs FROM api_runtime.artifacts ORDER BY release_id'):
    require(api_worker.registered_release(runs)['release_id']==version,'RECOVERY_REGISTRY_BYTES_CHANGED');versions.append(version)
   references=[]
   if conn.execute("SELECT to_regclass('public.api_reference_snapshots') IS NOT NULL").fetchone()==(True,):
    from app.reference_release import verify_registered_snapshots
    references=verify_registered_snapshots(conn,verify_identity=lambda c:verify_connection(c,target,'ry_api_owner',True))
   current=conn.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()[0]
   require(current==c['release_id'],'RECOVERY_PUBLIC_RELEASE_CHANGED')
 for role in ['api_reader','api_writer']:
  with opened(role) as conn:
   with conn.transaction():
    conn.execute('SET TRANSACTION READ ONLY');verify_connection(conn,target,role,True)
    conn.execute('SELECT release_id FROM api_current_release WHERE singleton').fetchone()
    if role=='api_reader':
     require(conn.execute("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname IN ('public','api_runtime') AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE'))").fetchone()==(False,),'RECOVERY_READER_WRITABLE')
 print(json.dumps(dict(status='PASS',snapshot=measured,role_logins=3,registry_versions=versions,reference_snapshots=references,release_id=current)))
'''

DURABLE_CONTROL_WRITE = '''def write(path,value):
 create(path,value)
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
 fd=os.open(Path(path).parent,os.O_RDONLY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
'''

RESTART_BLOCK = '''import json,sys
from pathlib import Path
from api_runtime import private_read,require
from dev_transition import require_clear,exclusive_json,PENDING
c=json.load(sys.stdin)
for folder in ['/api-control','/writer-control']:
 require_clear(folder)
 require(json.loads(private_read(Path(folder)/'target.json'))==c['target'],'RECOVERY_TARGET_CHANGED')
for folder in ['/api-control','/writer-control']:exclusive_json(Path(folder)/PENDING,c['marker'])
print(json.dumps({'status':'PASS'}))
'''

RESTART_UNBLOCK = '''import json,sys,os
from pathlib import Path
from api_runtime import private_read,require
from dev_transition import PENDING
c=json.load(sys.stdin)
for folder in ['/api-control','/writer-control']:
 require(json.loads(private_read(Path(folder)/'target.json'))==c['target'],'RECOVERY_TARGET_CHANGED')
 require(json.loads(private_read(Path(folder)/PENDING))==c['marker'],'RECOVERY_PENDING_CHANGED')
for folder in ['/api-control','/writer-control']:
 (Path(folder)/PENDING).unlink()
 fd=os.open(folder,os.O_RDONLY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
print(json.dumps({'status':'PASS'}))
'''


def restore(package, root, *, context):
    package = Path(package)
    manifest = verify_package(package)  # No resource creation before this gate.
    runtime = json.loads(private_path(package / 'runtime.json').read_text())
    root = Path(root)
    from app.api_config import outside_project
    outside_project(root)
    require(root.is_absolute() and not root.exists(), 'RECOVERY_NEW_PRIVATE_ROOT_REQUIRED')
    private_path(root.parent, directory=True)
    root.mkdir(mode=0o700)
    docker = Docker(context, root)
    nonce = secrets.token_hex(12); project = 'recycleyoungs-dev-check-' + nonce[:8]
    existing = set(docker.run('volume', 'ls', '-q').decode().split())
    require(not any(name.startswith(project + '-') for name in existing), 'RECOVERY_TARGET_ALREADY_EXISTS')
    for role in ['data', 'control', 'reader', 'writer']:
        verify_archive(package / (role + '.tar'))
    verify_archive(package / 'frontend-source.tar')
    protected = protected_source(docker, manifest['source']['project'])
    exclusive_json(root / 'intent.json', dict(kind='FULL_ENVIRONMENT_RESTORE', nonce=nonce, project=project,
                                             manifest_sha256=file_digest(package / 'manifest.json')['sha256'], protected=protected))
    for image in manifest['images'].values():
        check = subprocess.run(docker.prefix + ['image', 'inspect', image['image_id']], capture_output=True)
        if check.returncode != 0:
            load_image(docker, package / image['file'], image['image_id'])
        require(docker.inspect('image', image['image_id'])['Id'] == image['image_id'], 'RECOVERY_IMAGE_LOAD_MISMATCH')
    labels = ['--label', 'com.docker.compose.project=' + project, '--label', 'org.recycleyoungs.environment=local-development-v1',
              '--label', LABEL + '=' + nonce]
    networks = {}
    for role in ['data', 'inspect', 'access']:
        args = ['network', 'create', *labels]
        if role in ['data', 'inspect']:
            args += ['--internal']
        docker.run(*args, project + '-' + role)
        networks[role] = docker.inspect('network', project + '-' + role)['Id']
    for role in sorted(VOLUMES):
        docker.run('volume', 'create', *labels, '--label', 'com.docker.compose.volume=' + role, project + '-' + role)
    volumes = {role: docker.inspect('volume', project + '-' + role)['CreatedAt'] for role in VOLUMES}
    worker = manifest['images']['worker']['image_id']; db_image = manifest['images']['db']['image_id']
    base = ['--read-only', '--security-opt', 'no-new-privileges', '--memory', '2g', '--tmpfs', '/tmp:rw,size=256m']
    prep_args = ['create', '--name', project + '-restore-prep', '--label', LABEL + '=' + nonce, *base,
                 '--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER', '--network', project + '-data']
    for role, destination in [('db', '/db-new'), ('control', '/api-control'), ('data', '/api-data'), ('reader', '/reader-control'), ('writer', '/writer-control')]:
        prep_args += ['--mount', 'type=volume,src=' + project + '-' + role + ',dst=' + destination]
    prep = docker.run(*prep_args, '--entrypoint', 'sh', worker, '-c', 'trap "exit 0" TERM INT; while :; do sleep 30 & wait $!; done').decode().strip()
    docker.run('start', prep)
    exclusive_json(root / 'resources.json', dict(nonce=nonce, project=project, prep=prep, networks=networks, volumes=volumes))
    docker.execute(prep, "import os,json;os.chown('/db-new',999,999);os.makedirs('/api-control/source-control',mode=0o700);os.makedirs('/api-data/frontend-source',mode=0o700);print(json.dumps({'status':'PASS'}))")
    destinations = {'control': '/api-control/source-control', 'data': '/api-data', 'reader': '/reader-control', 'writer': '/writer-control'}
    # Reader/writer archives are staged below a non-runtime subdirectory.
    for role in ['reader', 'writer']:
        docker.run('exec', prep, 'mkdir', '-m', '700', destinations[role] + '/source-' + role)
        destinations[role] += '/source-' + role
    for role, destination in destinations.items():
        with (package / (role + '.tar')).open('rb') as stream:
            docker.run('exec', '-i', prep, 'tar', '-C', destination, '-xpf', '-', '--no-same-owner', stdin=stream)
    with (package / 'frontend-source.tar').open('rb') as stream:
        docker.run('exec', '-i', prep, 'tar', '-C', '/api-data/frontend-source', '-xpf', '-', '--no-same-owner', stdin=stream)
    prepare_files = '''import os,shutil,json
from pathlib import Path
s=Path('/api-control/source-control')
from dev_transition import require_clear
require_clear(s);require_clear('/writer-control/source-writer')
for name in ['owner','owner-password','reader-password','writer-password','api.env']:
 p=s/name;assert p.is_file() and not p.is_symlink();shutil.copyfile(p,Path('/api-control')/name);os.chmod(Path('/api-control')/name,0o600)
for root in ['/api-control','/api-data','/reader-control','/writer-control']:
 for folder,dirs,files in os.walk(root):
  os.chown(folder,10001,10001);os.chmod(folder,0o700)
  for name in files:os.chown(Path(folder)/name,10001,10001);os.chmod(Path(folder)/name,0o600)
print(json.dumps({'status':'PASS'}))
'''
    docker.execute(prep, prepare_files)
    init = docker.run('create', '--name', project + '-initdb', '--label', LABEL + '=' + nonce, '--network', 'none',
                      '--platform', 'linux/amd64', '--user', '999:999', *base,
                      '--mount', 'type=volume,src=' + project + '-db,dst=/var/lib/postgresql/data',
                      '--entrypoint', 'initdb', db_image, '--pgdata=/var/lib/postgresql/data/api',
                      '--username=ry_api_owner', '--auth-local=trust', '--auth-host=trust').decode().strip()
    docker.run('start', '--attach', init)
    require(docker.inspect('container', init)['State']['ExitCode'] == 0, 'RECOVERY_INITDB_FAILED')
    db = docker.run('create', '--name', project + '-api-postgres-1', *labels,
                    '--label', 'com.docker.compose.service=api-postgres', '--network', project + '-data', '--network-alias', 'api-postgres',
                    '--platform', 'linux/amd64', '--user', '999:999', *base,
                    '--mount', 'type=volume,src=' + project + '-db,dst=/var/lib/postgresql/data',
                    '--mount', 'type=volume,src=' + project + '-control,dst=/api-control,readonly',
                    '--env', 'POSTGRES_DB=recycleyoungs_api_dev', '--env', 'POSTGRES_USER=ry_api_owner',
                    '--env', 'POSTGRES_PASSWORD_FILE=/api-control/owner-password', '--env', 'PGDATA=/var/lib/postgresql/data/api',
                    '--entrypoint', 'postgres', db_image, '-D', '/var/lib/postgresql/data/api', '-c', 'listen_addresses=*',
                    '-c', 'unix_socket_directories=/tmp', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic').decode().strip()
    exclusive_json(root / 'database.json', dict(id=db, init=init, image=db_image))
    docker.run('start', db)
    for attempt in range(90):
        ready = subprocess.run(docker.prefix + ['exec', db, 'pg_isready', '-q', '-h', '/tmp', '-U', 'ry_api_owner'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise ValueError('RECOVERY_DATABASE_NOT_READY')
    control = docker.run('exec', db, 'pg_controldata', '/var/lib/postgresql/data/api').decode()
    sid = re.search(r'Database system identifier:\s*([0-9]+)', control).group(1)
    target = dict(runtime='local-dev', project=project, owner=manifest['source']['owner'], dbname='recycleyoungs_api_dev',
                  host='api-postgres', port='5432', data='/var/lib/postgresql/data/api', sid=sid,
                  container_id=db, network_id=networks['data'], volume=project + '-db')
    require_new_target(manifest['source'], target)
    exclusive_json(root / 'target.json', target)
    globals_sql = json.loads(private_path(package / 'roles.json').read_text())['sql']
    lines = []
    for line in globals_sql.splitlines():
        if line == 'CREATE ROLE "ry_api_owner";':
            continue
        if line.startswith('GRANT ') and ' GRANTED BY ' in line:
            grantor = re.search(r' GRANTED BY ("(?:[^"]|"")*");$', line)
            require(grantor is not None, 'RECOVERY_GLOBAL_GRANTOR_REJECTED')
            lines += ['SET SESSION AUTHORIZATION ' + grantor[1] + ';', line, 'RESET SESSION AUTHORIZATION;']
        else:
            lines.append(line)
    sql_prefix = ['exec', '-i', db, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', '/tmp', '-U', 'ry_api_owner', '-d', 'postgres']
    docker.run(*sql_prefix, data=('\n'.join(lines) + '\n').encode())
    with (package / 'database.dump').open('rb') as stream:
        docker.run('exec', '-i', db, 'pg_restore', '--exit-on-error', '--create', '--role=ry_api_owner',
                   '-h', '/tmp', '-U', 'ry_api_owner', '-d', 'postgres', stdin=stream)
    client = docker.run('create', '--name', project + '-restore-worker', '--label', LABEL + '=' + nonce,
                        '--network', project + '-data', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                        '--memory', '2g', '--user', '10001:10001', '--tmpfs', '/tmp:rw,size=256m,uid=10001,gid=10001',
                        '--mount', 'type=volume,src=' + project + '-control,dst=/api-control',
                        '--mount', 'type=volume,src=' + project + '-data,dst=/api-data',
                        '--mount', 'type=volume,src=' + project + '-reader,dst=/reader-control',
                        '--mount', 'type=volume,src=' + project + '-writer,dst=/writer-control',
                        '--entrypoint', 'sh', worker, '-c', 'trap "exit 0" TERM INT; while :; do sleep 30 & wait $!; done').decode().strip()
    exclusive_json(root / 'worker.json', dict(id=client, image=worker))
    docker.run('start', client)
    hba = "import json,os,sys;from pathlib import Path;p=Path('/db-new/api/pg_hba.conf');p.write_text(json.load(sys.stdin)['content']);os.chown(p,999,999);os.chmod(p,0o600);print(json.dumps({'status':'PASS'}))"
    docker.execute(prep, hba, dict(content=hba_for_target(manifest['source'], target, 'BOOTSTRAP')))
    docker.run(*sql_prefix, '-c', 'SELECT pg_reload_conf()')
    docker.execute(client, RESTORE_VERIFY, dict(mode='credentials', target=target))
    docker.execute(prep, hba, dict(content=hba_for_target(manifest['source'], target, 'VERIFIED')))
    docker.run(*sql_prefix, '-c', 'SELECT pg_reload_conf()')
    proof = docker.execute(client, RESTORE_VERIFY, dict(mode='verify', target=target, release_id=manifest['source']['release_id']))
    require(proof['snapshot'] == json.loads(private_path(package / 'snapshot.json').read_text()), 'RECOVERY_FULL_COMPARISON_FAILED')
    require(proof['role_logins'] == 3 and manifest['source']['release_id'] in proof['registry_versions'], 'RECOVERY_AUTH_OR_REGISTRY_FAILED')
    require(docker.execute(client, "import json,dev_runtime;print(json.dumps(dev_runtime.schemas()))") == runtime['sql'], 'RECOVERY_SQL_IMAGE_CHANGED')
    binding = new_binding(manifest['source'], target, volumes, runtime['sql'])
    receipt = dict(kind='FULL_ENVIRONMENT_RECOVERY', manifest_sha256=file_digest(package / 'manifest.json')['sha256'],
                   source=manifest['source'], target=target, images=manifest['images'], role_logins=3,
                   registry_versions=proof['registry_versions'], snapshot_sha256=file_digest(package / 'snapshot.json')['sha256'])
    issue = '''import json,sys,os,shutil
from pathlib import Path
from dev_runtime import write as create
from dev_transition import require_clear,PENDING
''' + DURABLE_CONTROL_WRITE + '''
c=json.load(sys.stdin)
for root in ['/api-control','/reader-control','/writer-control']:require_clear(root)
for root in ['/api-control','/writer-control']:write(Path(root)/PENDING,c['marker'])
for root in ['/api-control','/reader-control','/writer-control']:
 write(Path(root)/'target.json',c['target']);write(Path(root)/'recovery-receipt.json',c['receipt'])
for root in ['/api-control','/writer-control']:write(Path(root)/'binding.json',c['binding'])
for name in ['reader-password','writer-password','api.env']:
 for root in (['/reader-control','/writer-control'] if name=='reader-password' else ['/writer-control']):
  write(Path(root)/name,Path('/api-control',name).read_bytes())
write(Path('/api-control/ready.json'),c['ready'])
print(json.dumps({'status':'PASS'}))
'''
    marker=dict(kind='FULL_ENVIRONMENT_RECOVERY',manifest_sha256=receipt['manifest_sha256'],nonce=nonce)
    unblock='''import json,sys,os
from pathlib import Path
from api_runtime import private_read,require
from dev_transition import PENDING
c=json.load(sys.stdin)
for folder in ['/api-control','/writer-control']:
 require(json.loads(private_read(Path(folder)/PENDING))==c['marker'],'RECOVERY_PENDING_CHANGED')
 require(json.loads(private_read(Path(folder)/'binding.json'))==c['binding'],'RECOVERY_BINDING_CHANGED')
for folder in ['/api-control','/writer-control']:
 (Path(folder)/PENDING).unlink()
 fd=os.open(folder,os.O_RDONLY);os.fsync(fd);os.close(fd)
print(json.dumps({'status':'PASS'}))
'''
    def quiesce():
        require(docker.inspect('container',target['container_id'])['Config']['Labels'].get(LABEL)==nonce,'RECOVERY_DATABASE_CHANGED')
        docker.run('stop','--time','30',target['container_id'])
        require(not docker.inspect('container',target['container_id'])['State']['Running'],'RECOVERY_DATABASE_NOT_STOPPED')
    activation_started=False
    def activate():
        nonlocal activation_started
        activation_started=True
        docker.run('start',target['container_id'])
        for attempt in range(90):
            ready=subprocess.run(docker.prefix+['exec',target['container_id'],'pg_isready','-q','-h','/tmp','-U','ry_api_owner'],capture_output=True)
            if ready.returncode==0:break
            time.sleep(1)
        else:raise ValueError('RECOVERY_DATABASE_NOT_READY')
        require(docker.execute(client,MEASURE)==proof['snapshot'],'RECOVERY_ACTIVATION_CHANGED_DATA')
    def stop():
        # No automatic restart follows a failed activation or partial unblock.
        def shutdown():
            if activation_started and docker.inspect('container',target['container_id'])['State']['Running']:quiesce()
        durable_stop(root,shutdown=shutdown)
    finalize_restore(
        verify_source=lambda:require_unchanged(protected,protected_source(docker,manifest['source']['project'])),
        issue=lambda:docker.execute(client,issue,dict(target=target,receipt=receipt,binding=binding,marker=marker,
            ready=dict(kind='FULL_ENVIRONMENT_RECOVERY',release_id=manifest['source']['release_id']))),
        record_verified=lambda:exclusive_json(root/'verified.json',dict(status='PASS',target=target,proof=proof,receipt=receipt)),
        quiesce=quiesce,activate=activate,
        unblock=lambda:docker.execute(client,unblock,dict(marker=marker,binding=binding)),
        stop=stop)
    return dict(status='PASS', phase='FULL_RESTORE_VERIFIED', project=project, source_present=protected is not None,
                new_sid=True, role_logins=3, tables=len(proof['snapshot']['tables']), registry_versions=len(proof['registry_versions']),
                worker=client, database=db, external_device_tested=False)


def start_readers(root, package, *, context, frontend_port=15174):
    root = Path(root)
    require((root / 'verified.json').is_file(), 'RECOVERY_RESTORE_NOT_VERIFIED')
    verified = json.loads(private_path(root / 'verified.json').read_text())
    require(verified.get('status') == 'PASS' and not (root / 'STOP.json').exists(), 'RECOVERY_RESTORE_NOT_VERIFIED')
    manifest = verify_package(package)
    require(verified['receipt']['manifest_sha256'] == file_digest(Path(package) / 'manifest.json')['sha256'], 'RECOVERY_PACKAGE_CHANGED')
    require(type(frontend_port) is int and 1024 <= frontend_port <= 65535, 'RECOVERY_FRONTEND_PORT_REJECTED')
    require(not (root / 'readers-intent.json').exists(), 'RECOVERY_READERS_ALREADY_ATTEMPTED')
    runtime = json.loads(private_path(Path(package) / 'runtime.json').read_text())
    resources = json.loads(private_path(root / 'resources.json').read_text())
    target = verified['target']; project = target['project']; nonce = resources['nonce']
    require_new_target(manifest['source'], target)
    docker = Docker(context, root)
    db = docker.inspect('container', target['container_id'])
    require(db['Config']['Labels'].get(LABEL) == nonce and db['State']['Running'] and not db['HostConfig'].get('PortBindings'), 'RECOVERY_DATABASE_CHANGED')
    labels = ['--label', 'com.docker.compose.project=' + project, '--label', 'org.recycleyoungs.environment=local-development-v1', '--label', LABEL + '=' + nonce]
    exclusive_json(root / 'readers-intent.json', dict(target=target, nonce=nonce, frontend_port=frontend_port))
    proxy = docker.run('create', '--name', project + '-inspect-proxy-1', *labels, '--label', 'com.docker.compose.service=inspect-proxy',
                       '--network', project + '-inspect', '--network-alias', 'inspect-proxy', '--read-only', '--cap-drop', 'ALL',
                       '--user', '0:0', '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly',
                       '--env', 'DEV_PROJECT=' + project, '--entrypoint', 'python', manifest['images']['proxy']['image_id'],
                       '/workspace/etl/dev_inspect.py').decode().strip()
    docker.run('start', proxy)
    backend = docker.run('create', '--name', project + '-api-backend-1', *labels, '--label', 'com.docker.compose.service=api-backend',
                         '--network', project + '-data', '--network-alias', 'api-backend', '--read-only', '--cap-drop', 'ALL',
                         '--security-opt', 'no-new-privileges', '--memory', '1g', '--user', '10001:10001',
                         '--tmpfs', '/tmp:rw,size=128m,uid=10001,gid=10001',
                         '--mount', 'type=volume,src=' + project + '-reader,dst=/api-control,readonly', manifest['images']['backend']['image_id']).decode().strip()
    docker.run('network', 'connect', '--alias', 'api-backend', project + '-access', backend)
    docker.run('start', backend)
    client = json.loads(private_path(root / 'worker.json').read_text())['id']
    for network in ['inspect', 'access']:
        docker.run('network', 'connect', project + '-' + network, client)
    for attempt in range(90):
        output = docker.execute(client, HTTP_PROBE, dict(url='http://api-backend:8080/api/quarters'))
        if output['ready']:
            break
        time.sleep(1)
    else:
        raise ValueError('RECOVERY_BACKEND_NOT_READY')
    env_path = root / 'frontend.env'
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output_file:
        require(all('\n' not in v and '\r' not in v for v in runtime['frontend_environment']), 'RECOVERY_FRONTEND_ENV_REJECTED')
        output_file.write('\n'.join(runtime['frontend_environment']) + '\n')
    frontend = docker.run('create', '--name', project + '-frontend-1', *labels, '--label', 'com.docker.compose.service=frontend',
                          '--network', project + '-access', '--network-alias', 'frontend', '--user', '10001:10001',
                          '--env-file', str(env_path), '--publish', '127.0.0.1:' + str(frontend_port) + ':5173',
                          '--mount', 'type=volume,src=' + project + '-data,dst=/build/src,volume-subpath=frontend-source,readonly',
                          manifest['images']['frontend']['image_id']).decode().strip()
    docker.run('start', frontend)
    for attempt in range(60):
        output = docker.execute(client, HTTP_PROBE, dict(url='http://frontend:5173/api/quarters'))
        if output['ready']:
            break
        time.sleep(1)
    else:
        raise ValueError('RECOVERY_FRONTEND_NOT_READY')
    cli = json.loads(docker.run('exec', '-e', 'DEV_PROJECT=' + project, client, 'python', '/workspace/etl/dev_runtime.py', 'status'))
    require(cli == runtime['state'], 'RECOVERY_RUNTIME_STATE_CHANGED')
    result = dict(status='PASS', project=project, proxy=proxy, backend=backend, frontend=frontend, frontend_port=frontend_port,
                  quarters=output['quarters'], reader_only=True, scheduler_started=False)
    record_reader_check(root,result)
    return result


def verify_readers(root, package, *, context):
    """Read-only remeasurement of already created, exact owned reader resources."""
    root = Path(root); package = Path(package)
    require((root / 'verified.json').is_file() and (root / 'readers-intent.json').is_file(), 'RECOVERY_RESTORE_NOT_VERIFIED')
    verified = json.loads(private_path(root / 'verified.json').read_text())
    intent = json.loads(private_path(root / 'readers-intent.json').read_text())
    runtime = json.loads(private_path(package / 'runtime.json').read_text())
    manifest = verify_package(package)
    require(verified['receipt']['manifest_sha256'] == file_digest(package / 'manifest.json')['sha256'], 'RECOVERY_PACKAGE_CHANGED')
    require(verified['status'] == 'PASS' and not (root / 'STOP.json').exists(), 'RECOVERY_RESTORE_NOT_VERIFIED')
    target = verified['target']; require_new_target(manifest['source'], target)
    require(intent['target'] == target, 'RECOVERY_TARGET_CHANGED')
    project = target['project']; nonce = intent['nonce']; docker = Docker(context, root)
    results = {}
    for role, image_role in [('inspect-proxy', 'proxy'), ('api-backend', 'backend'), ('frontend', 'frontend')]:
        c = docker.inspect('container', project + '-' + role + '-1')
        require(c['Config']['Labels'].get(LABEL) == nonce and c['Config']['Labels'].get('com.docker.compose.project') == project
                and c['Config']['Labels'].get('com.docker.compose.service') == role and c['State']['Running']
                and c['Image'] == manifest['images'][image_role]['image_id'], 'RECOVERY_READER_RESOURCE_CHANGED')
        results[image_role] = c['Id']
    client = json.loads(private_path(root / 'worker.json').read_text())['id']
    publication = docker.execute(client, RECOVERY_QUARTERS, dict(target=target, release_id=manifest['source']['release_id']))
    quarters = publication.get('quarters')
    require(publication.get('release_id') == manifest['source']['release_id'] and isinstance(quarters, list) and quarters
            and all(isinstance(q, str) and re.fullmatch('[1-9][0-9]{3}[1-4]', q) for q in quarters)
            and quarters == sorted(set(quarters)), 'RECOVERY_QUARTERS_CHANGED')
    for url in ['http://api-backend:8080/api/quarters', 'http://frontend:5173/api/quarters']:
        value = docker.execute(client, HTTP_PROBE, dict(url=url))
        require(value['ready'] and value['quarters'] == len(quarters), 'RECOVERY_HTTP_NOT_READY')
    cli = json.loads(docker.run('exec', '-e', 'DEV_PROJECT=' + project, client, 'python', '/workspace/etl/dev_runtime.py', 'status'))
    require(cli == runtime['state'], 'RECOVERY_RUNTIME_STATE_CHANGED')
    result = dict(status='PASS', project=project, **results, frontend_port=intent['frontend_port'], quarters=value['quarters'],
                  reader_only=True, scheduler_started=False)
    record_reader_check(root,result)
    return result


def restart_check(root, *, context):
    """Restart only this tool's verified isolated DB, preserving all data."""
    root = Path(root)
    require((root / 'verified.json').is_file(), 'RECOVERY_RESTORE_NOT_VERIFIED')
    verified = json.loads(private_path(root / 'verified.json').read_text())
    resources = json.loads(private_path(root / 'resources.json').read_text())
    require(verified['status'] == 'PASS' and not (root / 'STOP.json').exists()
            and not (root / 'restart-intent.json').exists(), 'RECOVERY_RESTART_NOT_READY')
    target = verified['target']; source = verified['receipt']['source']
    require_new_target(source, target)
    require(resources['project'] == target['project'], 'RECOVERY_TARGET_CHANGED')
    docker = Docker(context, root)
    before_source = protected_source(docker, source['project'])
    database = docker.inspect('container', target['container_id'])
    require(database['Config']['Labels'].get(LABEL) == resources['nonce']
            and database['Config']['Labels'].get('com.docker.compose.project') == target['project']
            and database['State']['Running'] and not database['HostConfig'].get('PortBindings')
            and set(database['NetworkSettings']['Networks']) == {target['project'] + '-data'}, 'RECOVERY_DATABASE_CHANGED')
    require(not docker.run('ps', '-q', '--filter', 'label=com.docker.compose.project=' + target['project'],
                           '--filter', 'label=com.docker.compose.service=api-scheduler').strip(), 'RECOVERY_SCHEDULER_PRESENT')
    worker = json.loads(private_path(root / 'worker.json').read_text())['id']
    require(docker.inspect('container', worker)['Config']['Labels'].get(LABEL) == resources['nonce'], 'RECOVERY_WORKER_CHANGED')
    quiescent = '''import json
from api_runtime import connect,require
with connect('/api-control','ry_api_owner',True)[0] as c:
 with c.transaction():
  c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  require(c.execute('SELECT pg_try_advisory_lock(20261021,51)').fetchone()==(True,),'RECOVERY_WRITER_BUSY')
  require(c.execute("__WRITER_QUERY__").fetchone()==(0,),'RECOVERY_OTHER_WRITER_PRESENT')
  status,version=c.execute('SELECT status,release_id FROM api_runtime.state CROSS JOIN api_current_release WHERE api_runtime.state.singleton AND api_current_release.singleton').fetchone()
  require(status in ('IDLE','SUCCEEDED'),'RECOVERY_JOB_NOT_QUIESCENT')
  print(json.dumps(dict(status=status,release_id=version)))
'''.replace('__WRITER_QUERY__', WRITER_QUERY)
    state = docker.execute(worker, quiescent)
    before = docker.execute(worker, RESTORE_VERIFY, dict(mode='verify', target=target, release_id=state['release_id']))
    exclusive_json(root / 'restart-before.json', before)
    exclusive_json(root / 'restart-intent.json', dict(target=target, release_id=state['release_id']))
    guard=dict(target=target,marker=dict(kind='FULL_ENVIRONMENT_RESTART',nonce=secrets.token_hex(12),release_id=state['release_id']))
    def ready():
        for attempt in range(90):
            response=subprocess.run(docker.prefix+['exec',target['container_id'],'pg_isready','-q','-h','/tmp','-U','ry_api_owner'],capture_output=True)
            if response.returncode==0:return
            time.sleep(1)
        raise ValueError('RECOVERY_DATABASE_NOT_READY')
    try:
        require(docker.execute(worker,RESTART_BLOCK,guard)==dict(status='PASS'),'RECOVERY_RESTART_GUARD_FAILED')
        docker.run('restart', '--time', '30', target['container_id'])
        ready()
        after = docker.execute(worker, RESTORE_VERIFY, dict(mode='verify', target=target, release_id=state['release_id']))
        exclusive_json(root / 'restart-after.json', after)
        require_unchanged(before, after)
        require_unchanged(state, docker.execute(worker, quiescent))
        require_unchanged(before_source, protected_source(docker, source['project']))
        require(docker.inspect('container', target['container_id'])['Image'] == database['Image'], 'RECOVERY_DATABASE_CHANGED')
        result = dict(status='PASS', same_database=True, tables=len(after['snapshot']['tables']), role_logins=after['role_logins'],
                      registry_versions=len(after['registry_versions']), release_id=state['release_id'], source_unchanged=True)
        docker.run('stop','--time','30',target['container_id'])
        require(not docker.inspect('container',target['container_id'])['State']['Running'],'RECOVERY_DATABASE_NOT_STOPPED')
        require(docker.execute(worker,RESTART_UNBLOCK,guard)==dict(status='PASS'),'RECOVERY_RESTART_GUARD_FAILED')
        exclusive_json(root / 'restart-verified.json', result)
        docker.run('start',target['container_id']);ready()
        require(docker.execute(worker,MEASURE)==after['snapshot'],'RECOVERY_ACTIVATION_CHANGED_DATA')
        return result
    except BaseException:
        def shutdown():
            current=docker.inspect('container',target['container_id'])
            require(current['Config']['Labels'].get(LABEL)==resources['nonce'],'RECOVERY_DATABASE_CHANGED')
            if current['State']['Running']:docker.run('stop','--time','30',target['container_id'])
        durable_stop(root,shutdown=shutdown)
        raise


def main(argv=None):
    import argparse
    from dev_recovery import failure_notice, retention_proposal
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='action',required=True)
    for action in ['backup','restore','readers','verify-readers','restart-check']:
        command=commands.add_parser(action)
        command.add_argument('--context',required=True)
        command.add_argument('--root',type=Path,required=True,help='프로젝트 밖 private 운영 기록 디렉터리; backup/restore는 새 경로만 허용')
        if action in ['restore','readers','verify-readers']: command.add_argument('--package',type=Path,required=True)
        if action=='readers': command.add_argument('--frontend-port',type=int,default=15174)
        if action=='backup':
            command.add_argument('--project',required=True)
            command.add_argument('--expected-container',required=True)
            command.add_argument('--expected-sid',required=True)
            command.add_argument('--expected-release',required=True)
            command.add_argument('--frontend-capture',type=Path)
    verify=commands.add_parser('verify');verify.add_argument('--package',type=Path,required=True)
    retention=commands.add_parser('retention-plan')
    retention.add_argument('--package',type=Path,action='append',required=True)
    retention.add_argument('--minimum',type=int,default=1);retention.add_argument('--days',type=int,default=0)
    args=parser.parse_args(argv)
    notice=getattr(args,'root',None)
    if args.action in ['backup','restore'] and notice.exists(): notice=None
    try:
        if args.action=='verify':
            manifest=verify_package(args.package)
            result=dict(status='PASS',kind='PACKAGE_INTEGRITY_ONLY',artifacts=len(manifest['artifacts']),restore_tested=False)
        elif args.action=='retention-plan':
            rows=retention_inputs(args.package)
            result=retention_proposal(rows,now=datetime.now(timezone.utc).isoformat(),minimum=args.minimum,days=args.days)
        elif args.action=='backup':
            captures={} if args.frontend_capture is None else {'frontend':json.loads(private_path(args.frontend_capture).read_text())}
            result=backup(args.root,context=args.context,project=args.project,expected_container=args.expected_container,
                expected_sid=args.expected_sid,expected_release=args.expected_release,image_captures=captures)
        elif args.action=='restore': result=restore(args.package,args.root,context=args.context)
        elif args.action=='readers': result=start_readers(args.root,args.package,context=args.context,frontend_port=args.frontend_port)
        elif args.action=='verify-readers': result=verify_readers(args.root,args.package,context=args.context)
        else: result=restart_check(args.root,context=args.context)
        print(json.dumps(result));return 0
    except Exception as error:
        recorded=False
        if notice is not None and notice.is_dir():
            phase={'backup':'BACKUP','restore':'RESTORE','readers':'READERS','verify-readers':'READERS','restart-check':'RESTART'}[args.action]
            try: failure_notice(notice,phase,error);recorded=True
            except Exception: pass
        print(json.dumps(dict(status='STOP',code='RECOVERY_OPERATION_FAILED',local_failure_notice=recorded,automatic_retry=False)))
        return 2


if __name__=='__main__':
    raise SystemExit(main())
