"""Build source-based API artifacts without accessing a database or API credentials."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
PLATFORM = 'linux/amd64'
ROLES = ('database', 'flyway', 'worker', 'backend', 'frontend')
UPSTREAM = {
    'database': 'postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5',
    'flyway': 'flyway/flyway@sha256:5be18367a9b3979a9f37234c371b80da457a448fb9577bd94d4bf24d923fafac',
}


class ImageError(ValueError): pass


def require(ok, code):
    if not ok: raise ImageError(code)


def context_files(root):
    """An allowlist archive, independent of the caller's Docker ignore files."""
    fixed = ['docker/api/Dockerfile','docker/api/migrate.sh', 'backend/gradlew', 'backend/build.gradle', 'backend/settings.gradle',
             'frontend/package.json', 'frontend/package-lock.json', 'frontend/index.html', 'frontend/src/data/seoul-boundary.json',
             'etl/requirements.txt', 'data/manifest.json', 'data/release.json', 'data/public-data-v2.json']
    patterns = ['backend/gradle/wrapper/*', 'backend/src/main/**/*.java', 'backend/src/main/**/*.yaml',
                'backend/src/main/**/*.yml', 'backend/src/main/**/*.sql', 'backend/src/main/**/*.properties',
                'frontend/tsconfig*.json', 'frontend/vite.config.*', 'frontend/src/**/*.ts',
                'frontend/src/**/*.tsx', 'frontend/src/**/*.css', 'frontend/src/**/*.svg',
                'etl/app/*.py', 'etl/api_*.py']
    helpers = ['team_public_data', 'team_data', 'demo_worker', 'demo_safety','dev_runtime','dev_inspect','team_inspect_proxy','control']
    files = {p for p in fixed if (root/p).is_file()}
    files.update('etl/'+p+'.py' for p in helpers)
    for pattern in patterns:
        files.update(str(p.relative_to(root)) for p in root.glob(pattern) if p.is_file() or p.is_symlink())
    return sorted(files)


def fingerprint(root, files):
    digest = hashlib.sha256()
    for name in sorted(files):
        p = root/name
        require(not any(x.is_symlink() for x in [p, *p.parents]), 'BUILD_CONTEXT_SYMLINK')
        require(p.is_file(), 'BUILD_CONTEXT_FILE_MISSING')
        content = p.read_bytes()
        digest.update(name.encode()+b'\0'+len(content).to_bytes(8, 'big')+content)
    return digest.hexdigest()


def source_fingerprint(): return fingerprint(ROOT, context_files(ROOT))


def manifest_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_manifest(value, *, source=False):
    require(isinstance(value, dict) and value.get('format') == 1 and value.get('platform') == PLATFORM,
            'IMAGE_MANIFEST_FORMAT_REJECTED')
    require(bool(re.fullmatch('[0-9a-f]{64}', str(value.get('source', '')))), 'IMAGE_SOURCE_REQUIRED')
    images = value.get('images')
    require(isinstance(images, dict) and set(images) == set(ROLES)
            and all(re.fullmatch('sha256:[0-9a-f]{64}', str(v)) for v in images.values()),
            'IMMUTABLE_IMAGES_REQUIRED')
    require(value.get('frontend_key_sha256') is None or re.fullmatch('[0-9a-f]{64}', str(value['frontend_key_sha256'])),
            'PUBLIC_CONFIG_FINGERPRINT_REJECTED')
    if source: require(value['source'] == source_fingerprint(), 'IMAGE_SOURCE_CHANGED_REBUILD_REQUIRED')
    return value


def load_manifest(path, *, source=False):
    path = Path(path)
    require(not any(p.is_symlink() for p in [path, *path.parents]), 'IMAGE_MANIFEST_SYMLINK')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as f:
        info = os.fstat(f.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
                'PRIVATE_IMAGE_MANIFEST_REQUIRED')
        value = f.read(20001)
    require(len(value) <= 20000, 'IMAGE_MANIFEST_TOO_LARGE')
    return validate_manifest(json.loads(value), source=source)


def home_manifest(home, *, expected=None):
    path = Path(home)/'images.json'
    if not path.exists() and not path.is_symlink():
        require(expected is None, 'IMAGE_MANIFEST_MISSING')
        return None  # Existing environments keep their original image contract.
    value = load_manifest(path)
    require(expected is None or manifest_hash(value) == expected, 'IMAGE_MANIFEST_CHANGED')
    return value


def verify_images(value):
    validate_manifest(value)
    for role, image in value['images'].items():
        r = subprocess.run(['docker', 'image', 'inspect', image], capture_output=True, timeout=30)
        require(r.returncode == 0, 'IMAGE_NOT_AVAILABLE_'+role.upper())
        d = json.loads(r.stdout)[0]
        require(d['Id'] == image, 'IMMUTABLE_IMAGE_CHANGED')
        selected = subprocess.run(['docker', 'image', 'inspect', '--platform', PLATFORM, image], capture_output=True, timeout=30)
        require(selected.returncode == 0, 'IMAGE_PLATFORM_NOT_AVAILABLE')
        platform = json.loads(selected.stdout)[0]
        require(platform['Os'] == 'linux' and platform['Architecture'] == 'amd64', 'IMAGE_PLATFORM_REJECTED')
        if role in UPSTREAM:
            require(UPSTREAM[role] in d.get('RepoDigests', []), 'UPSTREAM_IMAGE_REJECTED')
        else:
            labels = platform['Config'].get('Labels') or {}
            require(labels.get('org.recycleyoungs.source') == value['source']
                    and labels.get('org.recycleyoungs.role') == role, 'BUILT_IMAGE_PROVENANCE_REJECTED')


def build(output=None):
    require(not any(os.getenv(k) for k in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES')),
            'COMPOSE_OVERRIDES_REJECTED')
    public_key = os.getenv('VITE_KAKAO_MAP_APP_KEY', '')
    require(bool(re.fullmatch('[A-Za-z0-9_-]{0,128}', public_key)), 'PUBLIC_MAP_KEY_FORMAT_REJECTED')
    files = context_files(ROOT); source = fingerprint(ROOT, files)
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as tar:
        for name in files:
            p = ROOT/name; content = p.read_bytes(); entry = tarfile.TarInfo(name)
            entry.size = len(content); entry.mode = 0o755 if os.access(p, os.X_OK) else 0o644
            tar.addfile(entry, io.BytesIO(content))
    require(source == source_fingerprint(), 'BUILD_CONTEXT_CHANGED')
    output = Path(output) if output else ROOT/'.codex-local/tmp'/('api-build-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4))
    require(output.is_absolute() and not any(p.is_symlink() for p in [output, *output.parents]), 'BUILD_OUTPUT_PATH_REJECTED')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir(mode=0o700)
    for name, data in [('context.tar', archive.getvalue())]:
        with (output/name).open('xb') as f: os.chmod(f.fileno(), 0o600); f.write(data)
    images = {}; key_hash = hashlib.sha256(public_key.encode()).hexdigest() if public_key else None
    with (output/'build.log').open('xb') as log:
        os.chmod(log.fileno(), 0o600)
        def run(args, data=None):
            r = subprocess.run(args, input=data, stdout=log, stderr=log, timeout=1800)
            require(r.returncode == 0, 'IMAGE_BUILD_FAILED_SEE_LOG')
        for role, ref in UPSTREAM.items():
            print(json.dumps(dict(step='pull', role=role)), flush=True)
            run(['docker', 'pull', '--platform', PLATFORM, ref])
            images[role] = json.loads(subprocess.check_output(['docker', 'image', 'inspect', ref]))[0]['Id']
        for role in ('worker', 'backend', 'frontend'):
            print(json.dumps(dict(step='build', role=role)), flush=True)
            tag = 'recycleyoungs-api-'+role+':'+source[:20]+('-'+key_hash[:12] if role == 'frontend' and key_hash else '')
            args = ['docker', 'buildx', 'build', '--platform', PLATFORM, '--load', '--pull', '--progress', 'plain',
                    '-f', 'docker/api/Dockerfile', '--target', role, '-t', tag,
                    '--label', 'org.recycleyoungs.source='+source, '--label', 'org.recycleyoungs.role='+role]
            if role == 'frontend':
                args += ['--build-arg', 'PUBLIC_MAP_CONFIG_SHA256='+(key_hash or 'none')]
                if public_key: args += ['--secret', 'id=kakao_js,env=VITE_KAKAO_MAP_APP_KEY']
            run([*args, '-'], archive.getvalue())
            images[role] = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag]))[0]['Id']
    value = dict(format=1, platform=PLATFORM, source=source, images=images, frontend_key_sha256=key_hash)
    verify_images(value)
    require(source == source_fingerprint(), 'BUILD_CONTEXT_CHANGED_REBUILD_REQUIRED')
    with (output/'images.json').open('x') as f:
        os.chmod(f.fileno(), 0o600); json.dump(value, f, indent=2); f.write('\n')
    return dict(status='BUILT', manifest=str(output/'images.json'), source=source,
                platform=PLATFORM, frontend_key_configured=bool(public_key))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try: print(json.dumps(build(args.output)))
    except Exception as e:
        print(json.dumps(dict(status='FAIL', code=str(e) if isinstance(e, ImageError) else 'IMAGE_BUILD_FAILED',
                              type=type(e).__name__)), file=sys.stderr); sys.exit(2)
