"""Pinned real-data input/package boundary. No database access or implicit URLs."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from app.spatial_sources import SPECS

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'real-data-v1'
ASSET = 'recycleyoungs-real-data-v1.zip'
INPUTS = {'administrative_store_stats': 'stats.csv', 'administrative_sales': 'sales.csv',
          'individual_stores': 'stores.csv'}
MAX_ARCHIVE = 400_000_000
MAX_EXPANDED = 500_000_000


class DataError(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise DataError(message)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def migration_files(directory=None):
    directory = Path(directory) if directory is not None else ROOT / 'backend/src/main/resources/db/migration'
    approved = ('V1__initial_schema.sql', 'V2__spatial_schema.sql',
                'V3__semas_cafe_mapping_and_store_backfill.sql')
    entries = list(directory.rglob('*'))
    require({p.relative_to(directory).as_posix() for p in entries} == set(approved)
            and all(p.is_file() and not p.is_symlink() for p in entries),
            'real-data-v1 permits only approved root V1/V2/V3 files; extra migrations, callbacks and script config rejected')
    return [directory / name for name in approved]


def contract():
    manifest = json.loads((ROOT / 'data/manifest.json').read_text())
    files = [dict(name=INPUTS[d['dataset_id']], path=d['path'], bytes=d['bytes'], sha256=d['sha256'])
             for d in manifest['datasets'] if d['dataset_id'] in INPUTS]
    for key, spec in SPECS.items():
        files.append(dict(name=key + '.zip', path='data/raw/spatial/' +
                          (spec.stem + '.zip' if key == 'admin' else 'stage4-research-20261007/official-commercial-area.zip'),
                          sha256=spec.archive_sha256, bytes=1676539 if key == 'admin' else 2123078))
        for role, digest in spec.report_hashes.items():
            name = 'repair-report.json' if role == 'repair' else key + '-report.json'
            files.append(dict(name=name, path=spec.report_artifacts[role], sha256=digest,
                              bytes={'admin-report.json': 31247, 'commercial-report.json': 846162,
                                     'repair-report.json': 585220}[name]))
    policy_files = ['etl/app/' + name for name in ['etl_store_stats.py', 'etl_sales.py', 'etl_stores.py',
                    'spatial_geometry.py', 'spatial_load.py', 'spatial_sources.py']]
    policy_files += [str(p.relative_to(ROOT)) for p in migration_files()]
    return dict(version=VERSION, files=files, source_manifest_sha256=sha(ROOT / 'data/manifest.json'),
                etl_contract={p: sha(ROOT / p) for p in policy_files},
                provenance=[s.provenance for s in SPECS.values()],
                csv_period='SEOUL 20251-20254; SEMAS filename 202606, reference date UNVERIFIED',
                limitations='Historical compatibility UNRESOLVED; H5 conflict/source overlaps retained; six approved linework repairs only',
                publication='UNPUBLISHED; public upload requires separate license/content review and human approval')


def contract_sha():
    return hashlib.sha256(canonical(contract()).encode()).hexdigest()


def check_files(root, specs=None, original=False):
    specs = specs if specs is not None else contract()['files']
    missing = [s['path'] if original else s['name'] for s in specs
               if not (Path(root) / (s['path'] if original else s['name'])).is_file()]
    require(not missing, 'Missing required files: ' + ', '.join(missing))
    for spec in specs:
        p = Path(root) / (spec['path'] if original else spec['name'])
        require(not p.is_symlink() and p.resolve().is_relative_to(Path(root).resolve()),
                'Symlink/path escape rejected: ' + spec['name'])
        require(p.stat().st_size == spec['bytes'] and sha(p) == spec['sha256'],
                'Size/SHA-256 mismatch: ' + spec['name'])
    return specs


def prepare(root):
    from demo_worker import input_validation, prepared
    # Only the demo's pure validation functions are shared. Its DB/controller is never invoked.
    csv = input_validation(Path(root), ROOT / 'data/manifest.json')
    polygons = prepared(Path(root))
    return csv, polygons


def safe_members(archive, expected):
    members = archive.infolist()
    names = [m.filename for m in members]
    require(len(names) == len(set(names)) and set(names) == set(expected), 'Unexpected/missing/duplicate ZIP members')
    require(sum(m.file_size for m in members) <= MAX_EXPANDED, 'Expanded package exceeds size limit')
    for m in members:
        p = PurePosixPath(m.filename)
        require(not p.is_absolute() and '..' not in p.parts and ':' not in m.filename and '\\' not in m.filename
                and not m.is_dir() and not stat.S_ISLNK(m.external_attr >> 16) and not m.flag_bits & 1,
                'Unsafe ZIP path/member')
    return members


def extract_package(path, destination, expected_sha):
    require(re.fullmatch('[0-9a-f]{64}', expected_sha or '') and sha(path) == expected_sha,
            'Release archive SHA-256 mismatch')
    destination = Path(destination)
    require(not destination.exists(), 'Refusing extraction over existing path')
    with zipfile.ZipFile(path) as archive:
        specs = contract()['files']
        members = safe_members(archive, {s['name'] for s in specs} | {'dataset.json'})
        meta = next(m for m in members if m.filename == 'dataset.json')
        require(meta.file_size <= 100_000, 'Oversized package metadata')
        require(json.loads(archive.read(meta)) == contract(), 'Release dataset/ETL contract mismatch')
        destination.mkdir()
        for m in members:
            with archive.open(m) as source, (destination / m.filename).open('xb') as target:
                shutil.copyfileobj(source, target)
    check_files(destination)
    prepare(destination)


def release_url(config):
    require(config.get('status') == 'PUBLISHED', 'RELEASE_UNPUBLISHED: use local mode; no published asset is configured')
    tag, digest = config.get('tag', ''), config.get('sha256', '')
    require(re.fullmatch(r'real-data-v[0-9]+(?:\.[0-9]+)*', tag or '') and
            re.fullmatch('[0-9a-f]{64}', digest or ''), 'Pinned release tag/SHA required (latest forbidden)')
    url = 'https://github.com/jinwooorp/RecycleYoungs/releases/download/' + tag + '/' + ASSET
    require(config.get('url') == url, 'Release URL must match the fixed repository/tag/asset')
    return url


def github_url(url):
    p = urllib.parse.urlsplit(url)
    return (p.scheme == 'https' and p.hostname in {'github.com', 'release-assets.githubusercontent.com',
            'objects.githubusercontent.com'} and p.port in (None, 443) and not p.username and not p.password)


def download(url, destination, expected_sha, *, policy=github_url):
    """The policy override is for in-process HTTP fixtures, never exposed in CLI/environment."""
    require(policy(url), 'Download URL rejected')
    destination = Path(destination)
    require(not destination.exists() and not destination.with_suffix('.partial').exists(), 'Download/cache path already exists')
    partial = destination.with_suffix('.partial')

    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            require(policy(newurl), 'Redirect destination rejected')
            return super().redirect_request(request, fp, code, msg, headers, newurl)
    try:
        with urllib.request.build_opener(Redirect).open(url, timeout=30) as response, partial.open('xb') as output:
            require(response.status == 200 and policy(response.url), 'Invalid HTTP status/final URL')
            size = response.headers.get('Content-Length')
            require(size is not None and size.isdecimal() and 0 < int(size) <= MAX_ARCHIVE, 'Invalid/missing HTTP content length')
            count = 0
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                require(count <= int(size) and count <= MAX_ARCHIVE, 'Download size exceeded')
                output.write(chunk)
            require(count == int(size), 'Partial download rejected')
        require(sha(partial) == expected_sha, 'Download archive SHA-256 mismatch')
        os.rename(partial, destination)
    except (OSError, urllib.error.URLError, http.client.HTTPException, DataError) as exc:
        # Delete only this call's unpublished partial file; never modify an existing cache.
        if partial.exists(): partial.unlink()
        raise DataError('Download failed; no valid package published') from exc


def initialize(source_root, cache, mode):
    cache = Path(cache)
    final = cache / VERSION
    if final.exists():
        check_files(final)
        require(json.loads((final / 'dataset.json').read_text()) == contract(), 'Cached contract changed')
        if mode == 'local': check_files(source_root, original=True)
        else: release_url(json.loads((ROOT / 'data/release.json').read_text()))
        prepare(final)
        return dict(status='PASS', action='VERIFIED_CACHE', version=VERSION, files=8)
    if mode == 'local': check_files(source_root, original=True)
    else: require(mode == 'release', 'Unknown data mode')
    cache.mkdir(parents=True, exist_ok=True)
    # Failed staging is retained for investigation. A subsequent run uses a new private directory.
    staging = Path(tempfile.mkdtemp(prefix='pending-', dir=cache))
    target = staging / 'dataset'
    if mode == 'local':
        target.mkdir()
        for spec in contract()['files']:
            with (Path(source_root) / spec['path']).open('rb') as src, (target / spec['name']).open('xb') as dst:
                shutil.copyfileobj(src, dst)
        (target / 'dataset.json').write_text(canonical(contract()), encoding='utf-8')
        check_files(target); prepare(target)
    else:
        config = json.loads((ROOT / 'data/release.json').read_text())
        download(release_url(config), staging / ASSET, config['sha256'])
        extract_package(staging / ASSET, target, config['sha256'])
    os.rename(target, final)
    return dict(status='PASS', action='PREPARED', version=VERSION, files=8)


def package(output):
    output = Path(output)
    require(not output.exists(), 'Refusing to overwrite existing release candidate')
    specs = check_files(ROOT, original=True)
    # Do not sanitize the fixed reports: any private content blocks packaging instead.
    for spec in specs:
        if spec['name'].endswith('.json'):
            text = (ROOT / spec['path']).read_text()
            require(not re.search(r'/Users/|/home/|postgres(?:ql)?://|password\s*[=:]|sk-proj-', text, re.I),
                    'Private-path/credential pattern in fixed report; publication blocked')
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream, zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for spec in specs:
            info = zipfile.ZipInfo(spec['name'], (2026, 10, 14, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            with (ROOT / spec['path']).open('rb') as src, archive.open(info, 'w') as dst:
                shutil.copyfileobj(src, dst)
        archive.writestr('dataset.json', canonical(contract()))
    with zipfile.ZipFile(output) as archive:
        safe_members(archive, {s['name'] for s in specs} | {'dataset.json'})
        for spec in specs:
            with archive.open(spec['name']) as f:
                require(hashlib.file_digest(f, 'sha256').hexdigest() == spec['sha256'], 'Package bytes differ from source')
    return dict(status='PASS', archive=output.name, bytes=output.stat().st_size, sha256=sha(output),
                source_files=8, members=9, byte_identical=True, release_status='UNPUBLISHED')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['init', 'package', 'validate'])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'init': result = initialize(Path('/source'), Path('/cache'), os.getenv('TEAM_DATA_MODE', 'local'))
        elif args.action == 'package':
            require(args.output is not None, '--output is required'); result = package(args.output)
        else: result = dict(status='PASS', files=check_files(ROOT, original=True))
        print(canonical(result))
    except (DataError, ValueError, OSError, zipfile.BadZipFile) as exc:
        # Fixed file identities are public; filesystem/HTTP errors may contain private locations.
        print(canonical(dict(status='FAIL', reason=str(exc) if isinstance(exc, DataError) else type(exc).__name__)))
        raise SystemExit(1)


if __name__ == '__main__': main()
