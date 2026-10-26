"""Private full-environment recovery packages; verification never changes a DB.

A package receipt proves file integrity, not a restore. The operator must also
verify the restored DB, roles, registry and new Docker identity before issuing
fresh runtime bindings. Partial packages and failed restores are never resumed.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import secrets

BASE_ARTIFACTS = {'database.dump', 'snapshot.json', 'roles.json', 'data.tar',
                  'control.tar', 'reader.tar', 'writer.tar', 'runtime.json', 'frontend-source.tar'}
IMAGE_ROLES = {'db', 'worker', 'backend', 'frontend', 'proxy', 'migrator'}
HEX = r'[0-9a-f]{64}'


def require(ok, code):
    if not ok:
        raise ValueError(code)


def private_path(path, *, directory=False):
    path = Path(path)
    require(path.is_absolute(), 'RECOVERY_ABSOLUTE_PATH_REQUIRED')
    # System temp aliases are resolved by callers; never resolve user symlinks.
    require(not any(p.is_symlink() for p in [path, *path.parents]), 'RECOVERY_SYMLINK')
    info = path.stat()
    require(info.st_uid == os.getuid() and not info.st_mode & 0o077,
            'RECOVERY_PRIVATE_PERMISSIONS')
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode),
            'RECOVERY_FILE_TYPE')
    require(directory or info.st_nlink == 1, 'RECOVERY_HARDLINK_REJECTED')
    return path


def file_digest(path):
    path = private_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    digest = hashlib.sha256()
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                and not before.st_mode & 0o077 and before.st_nlink == 1,
                'RECOVERY_PRIVATE_PERMISSIONS')
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
        after = os.fstat(source.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
            'RECOVERY_ARTIFACT_CHANGED')
    return dict(bytes=after.st_size, sha256=digest.hexdigest())


def exclusive_json(path, value):
    private_path(Path(path).parent, directory=True)
    data = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    directory=os.open(Path(path).parent,os.O_RDONLY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)
    return hashlib.sha256(data).hexdigest()


def failure_notice(root, phase, error):
    """Local operator notice only; no exception payload, network or retry."""
    require(phase in {'BACKUP','RESTORE','READERS','RESTART','VERIFY'}, 'RECOVERY_NOTICE_PHASE')
    root=private_path(root,directory=True)
    code=str(error)
    if not re.fullmatch('RECOVERY_[A-Z_]{1,100}',code): code='RECOVERY_OPERATION_FAILED'
    exclusive_json(root/('failure-notice-'+secrets.token_hex(8)+'.json'),dict(
        timestamp=datetime.now(timezone.utc).isoformat(),phase=phase,status='ACTION_REQUIRED',
        code=code,automatic_retry=False,external_notification_sent=False))


def retention_proposal(records, *, now, minimum=1, days=0):
    """Pure proposal over already verified manifests. This never deletes files."""
    require(type(minimum) is int and minimum>=1 and type(days) is int and days>=0,'RECOVERY_RETENTION_POLICY')
    current=datetime.fromisoformat(now)
    require(current.tzinfo is not None,'RECOVERY_TIMESTAMP_REJECTED')
    require(len({r['package'] for r in records})==len(records),'RECOVERY_DUPLICATE_PACKAGE')
    parsed=[]
    for row in records:
        stamp=datetime.fromisoformat(row['created_at'])
        require(stamp.tzinfo is not None and stamp<=current and type(row['bytes']) is int and row['bytes']>0,'RECOVERY_RETENTION_INPUT')
        parsed.append((stamp,row))
    parsed.sort(key=lambda pair:pair[0],reverse=True)
    keep=[];review=[]
    for index,(stamp,row) in enumerate(parsed):
        (keep if index<minimum or (days>0 and current-stamp<=timedelta(days=days)) else review).append(row['package'])
    return dict(keep=keep,review_for_removal=review,total_bytes=sum(r['bytes'] for r in records),
                minimum=minimum,days=days,deletion_performed=False,policy_status='PROPOSAL_REQUIRES_OPERATOR_REVIEW')


def validate_manifest(value):
    require(set(value) == {'schema_version', 'kind', 'created_at', 'source', 'artifacts', 'images'}
            and value['schema_version'] == 1 and value['kind'] == 'FULL_LOCAL_DEV_RECOVERY',
            'RECOVERY_MANIFEST_REJECTED')
    try:
        stamp = datetime.fromisoformat(value['created_at'])
        require(stamp.tzinfo is not None, 'RECOVERY_TIMESTAMP_REJECTED')
    except (ValueError, TypeError):
        raise ValueError('RECOVERY_TIMESTAMP_REJECTED') from None
    source = value['source']
    require(set(source) == {'project', 'owner', 'sid', 'container_id', 'network_id', 'release_id', 'exported_snapshot'},
            'RECOVERY_SOURCE_REJECTED')
    require(re.fullmatch(r'recycleyoungs-dev(?:-check-[0-9a-f]{8})?', source['project'])
            and re.fullmatch(r'[0-9a-f]{24}', source['owner'])
            and re.fullmatch(r'[0-9]+', source['sid'])
            and all(re.fullmatch(HEX, source[k]) for k in ['container_id', 'network_id', 'release_id'])
            and re.fullmatch(r'[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+', source['exported_snapshot']),
            'RECOVERY_SOURCE_REJECTED')
    require(set(value['images']) == IMAGE_ROLES, 'RECOVERY_IMAGES_REQUIRED')
    files = set(BASE_ARTIFACTS)
    for role, image in value['images'].items():
        require(set(image) == {'image_id', 'file'} and re.fullmatch('sha256:' + HEX, image['image_id'])
                and image['file'] == role + '-image.tar', 'RECOVERY_IMAGE_REJECTED')
        files.add(image['file'])
    require(set(value['artifacts']) == files, 'RECOVERY_ARTIFACT_SET_REJECTED')
    for record in value['artifacts'].values():
        require(set(record) == {'bytes', 'sha256'} and type(record['bytes']) is int and record['bytes'] > 0
                and re.fullmatch(HEX, record['sha256']), 'RECOVERY_ARTIFACT_REJECTED')


def verify_inputs(root, value, *, sealed=False):
    root = private_path(root, directory=True)
    validate_manifest(value)
    expected = set(value['artifacts']) | ({'manifest.json', 'complete.json'} if sealed else set())
    require({p.name for p in root.iterdir()} == expected, 'RECOVERY_ARTIFACT_SET_REJECTED')
    for name, record in value['artifacts'].items():
        require(file_digest(root / name) == record, 'RECOVERY_ARTIFACT_CHANGED')


def seal_package(root, value):
    root = Path(root)
    verify_inputs(root, value)
    digest = exclusive_json(root / 'manifest.json', value)
    # The completion marker is deliberately last; no existing package is replaced.
    exclusive_json(root / 'complete.json', dict(schema_version=1, manifest_sha256=digest))
    verify_package(root)
    return digest


def verify_package(root):
    root = private_path(root, directory=True)
    require((root / 'manifest.json').exists() and (root / 'complete.json').exists(), 'RECOVERY_INCOMPLETE')
    try:
        value = json.loads(private_path(root / 'manifest.json').read_text())
        receipt = json.loads(private_path(root / 'complete.json').read_text())
    except (ValueError, OSError):
        raise ValueError('RECOVERY_MANIFEST_REJECTED') from None
    require(receipt == dict(schema_version=1, manifest_sha256=file_digest(root / 'manifest.json')['sha256']),
            'RECOVERY_MANIFEST_CHANGED')
    verify_inputs(root, value, sealed=True)
    return value


def require_new_target(source, target):
    require(re.fullmatch(r'recycleyoungs-dev-check-[0-9a-f]{8}', target.get('project', '')),
            'RECOVERY_NEW_PROJECT_REQUIRED')
    require(all(target.get(k) != source.get(k) for k in ['project', 'sid', 'container_id', 'network_id']),
            'RECOVERY_SOURCE_IDENTITY_REJECTED')
    require(re.fullmatch(r'[0-9]+', target.get('sid', ''))
            and all(re.fullmatch(HEX, target.get(k, '')) for k in ['container_id', 'network_id']),
            'RECOVERY_NEW_IDENTITY_REJECTED')


def verify_archive(path):
    """Accept only regular files/directories; never extract links or device nodes."""
    seen = set()
    with tarfile.open(path, 'r:*') as archive:
        for entry in archive:
            name = PurePosixPath(entry.name)
            require(not name.is_absolute() and '..' not in name.parts and '\\' not in entry.name
                    and (entry.isfile() or entry.isdir()) and str(name) not in seen,
                    'RECOVERY_ARCHIVE_REJECTED')
            seen.add(str(name))
    return len(seen)
