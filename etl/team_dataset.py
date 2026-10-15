"""Explicit versioned runtime; immutable v1/v2 contracts remain in their original modules."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import zipfile
import zlib

import team_data as v1
import team_public_data as v2
from team_data import DataError, ROOT, canonical, download, require, sha

V2_ARCHIVE_SHA = '6b11901f46d1a207c5b36353483e209f00a10fb401edcc5fd036a3025238ff0b'
SPATIAL_PROOF_SQL = """SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(
    id,boundary_kind,source_file_sha256,validation_report_sha256,processing_profile_sha256,
    processing_metadata,feature_count,load_status,is_current) ORDER BY boundary_kind)::text,'UTF8')),'hex')
    FROM public.spatial_dataset_versions"""


def version(value=None):
    value = os.environ.get('TEAM_DATA_VERSION', v2.VERSION) if value is None else value
    require(value in {v1.VERSION, v2.VERSION}, 'Unknown TEAM_DATA_VERSION; choose real-data-v1 or real-data-v2')
    return value


def module(value=None):
    return v1 if version(value) == v1.VERSION else v2


def contract(value=None):
    return module(value).contract()


def contract_sha(value=None):
    return hashlib.sha256(canonical(contract(value)).encode()).hexdigest()


def binding(value=None):
    return dict(version=version(value), contract=contract_sha(value))


def validate_binding(ledger, value=None):
    # Older v1 ownership ledgers predate this field. Missing never means an arbitrary version.
    recorded = ledger.get('dataset', dict(version=v1.VERSION, contract=v2.SOURCE_CONTRACT_SHA))
    require(recorded == binding(value), 'Owned dataset version/contract mismatch; preserve existing resources')


def cache_path(root=Path('/cache'), value=None):
    return Path(root) / version(value)


def check_files(root, value=None):
    expected = contract(value)
    root = Path(root)
    require(not root.is_symlink(), 'Symlink cache rejected')
    v1.check_files(root, expected['files'])
    require({p.name for p in root.iterdir()} == {s['name'] for s in expected['files']} | {'dataset.json'},
            'Unexpected/missing cached files')
    meta = root / 'dataset.json'
    require(not meta.is_symlink() and meta.stat().st_size <= 100_000, 'Unsafe cache metadata')
    payload = meta.read_bytes()
    require(parse_json(payload) == expected and payload == canonical(expected).encode(), 'Cached dataset contract mismatch')


def prepare(root, value=None):
    check_files(root, value)
    return module(value).prepare(root)


def spatial_specs(value=None):
    return v1.SPECS if version(value) == v1.VERSION else v2.public_specs()


def parse_json(payload):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key rejected')
            result[key] = value
        return result
    return json.loads(payload, object_pairs_hook=unique)


def release_url(config, value=None):
    selected = version(value); target = module(selected)
    require(isinstance(config, dict), 'Release configuration must be a JSON object')
    require(config.get('status') == 'PUBLISHED', 'RELEASE_UNPUBLISHED: no public asset is configured')
    require(config.get('version') == selected and config.get('tag') == selected,
            'Release version/tag must match the selected dataset')
    digest = config.get('sha256')
    import re
    require(isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest), 'Fixed Release SHA-256 required')
    if selected == v2.VERSION: require(digest == V2_ARCHIVE_SHA, 'Public v2 candidate archive SHA changed')
    expected = 'https://github.com/jinwooorp/RecycleYoungs/releases/download/' + selected + '/' + target.ASSET
    require(config.get('url') == expected, 'Release URL must match fixed repository/version/asset')
    return expected


def _extract_v1(path, destination, expected_sha):
    # Preserve v1's contract, with the same bounded-snapshot and canonical JSON boundary as v2.
    with Path(path).open('rb') as source: payload = source.read(v1.MAX_ARCHIVE + 1)
    require(0 < len(payload) <= v1.MAX_ARCHIVE and hashlib.sha256(payload).hexdigest() == expected_sha,
            'Release archive size/SHA mismatch')
    expected = contract(v1.VERSION)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        members = v1.safe_members(archive, {s['name'] for s in expected['files']} | {'dataset.json'})
        meta = archive.getinfo('dataset.json')
        require(meta.file_size <= 100_000 and archive.read(meta) == canonical(expected).encode(),
                'Release dataset contract mismatch')
        for spec in expected['files']:
            with archive.open(spec['name']) as source:
                require(archive.getinfo(spec['name']).file_size == spec['bytes']
                        and hashlib.file_digest(source, 'sha256').hexdigest() == spec['sha256'], 'Release member mismatch')
        destination.mkdir()
        for member in members:
            with archive.open(member) as source, (destination / member.filename).open('xb') as target:
                shutil.copyfileobj(source, target)


def initialize(source_root, cache, mode, value=None, release_config=None):
    import fcntl  # Cache writers run in Linux containers; host status/proof needs no POSIX lock API.
    selected = version(value); target = module(selected)
    require(mode in {'local', 'release'}, 'Unknown TEAM_DATA_MODE')
    config = None
    if mode == 'release':
        config = parse_json(Path(release_config or ROOT / 'data/release.json').read_bytes())
        url = release_url(config, selected)  # even an existing cache cannot bypass UNPUBLISHED
    cache = Path(cache)
    require(not cache.is_symlink(), 'Symlink cache root rejected')
    cache.mkdir(parents=True, exist_ok=True)
    fd = os.open(cache / ('.init-' + selected + '.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc: raise DataError('Another dataset initializer is running; retry after it exits') from exc
        final = cache_path(cache, selected)
        if final.exists() or final.is_symlink():
            check_files(final, selected)
            if mode == 'local': v1.check_files(source_root, original=True)
            target.prepare(final)
            return dict(status='PASS', action='VERIFIED_CACHE', version=selected, contract=contract_sha(selected))
        specs = v1.check_files(source_root, original=True) if mode == 'local' else None
        staging = Path(tempfile.mkdtemp(prefix='pending-' + selected + '-', dir=cache))
        dataset = staging / 'dataset'
        if mode == 'local':
            dataset.mkdir()
            for spec in specs:
                source = Path(source_root) / spec['path']
                if selected == v2.VERSION and spec['name'] in v2.SOURCE_REPORT_HASHES:
                    blob = v2.derive_report(spec['name'], source.read_bytes())
                    with (dataset / spec['name']).open('xb') as output: output.write(blob)
                else:
                    with source.open('rb') as input_file, (dataset / spec['name']).open('xb') as output:
                        shutil.copyfileobj(input_file, output)
            if selected == v2.VERSION:
                with (dataset / 'ATTRIBUTION.json').open('xb') as output:
                    output.write(canonical(v2.config()['attribution']).encode())
            with (dataset / 'dataset.json').open('xb') as output: output.write(canonical(contract(selected)).encode())
        else:
            archive = staging / target.ASSET
            download(url, archive, config['sha256'])
            if selected == v2.VERSION: v2.extract_package(archive, dataset, config['sha256'])
            else: _extract_v1(archive, dataset, config['sha256'])
        prepare(dataset, selected)
        require(not final.exists() and not final.is_symlink(), 'Cache destination appeared; refusing overwrite')
        os.rename(dataset, final)
        return dict(status='PASS', action='PREPARED', version=selected, contract=contract_sha(selected))


def expected_history():
    expected = []
    for path in v1.migration_files():
        crc = 0
        for line in path.read_text(encoding='utf-8-sig').splitlines(): crc = zlib.crc32(line.encode(), crc)
        expected.append(dict(version=path.name[1:].split('__')[0], checksum=crc if crc < 2**31 else crc - 2**32, success=True))
    return expected


def validate_spatial(rows, value=None):
    specs = spatial_specs(value)
    fields = {'boundary_kind', 'dataset_id', 'load_status', 'is_current', 'source_crs', 'feature_count',
              'source_file_sha256', 'validation_report_sha256', 'processing_metadata', 'processing_profile_sha256'}
    require(isinstance(rows, (list, tuple)) and len(rows) == 2
            and all(isinstance(row, dict) and fields <= row.keys() for row in rows)
            and {r['boundary_kind'] for r in rows} == {s.boundary_kind for s in specs.values()},
            'Spatial dataset count/kinds mismatch')
    for row in rows:
        spec = next(s for s in specs.values() if s.boundary_kind == row['boundary_kind'])
        profile = row['processing_metadata']; primary = 'repair' if 'repair' in spec.report_hashes else 'quality'
        require(isinstance(profile, dict) and {'reports', 'source_zip_sha256', 'source_members', 'geometry', 'implementation'} <= profile.keys(),
                'Spatial profile fields missing')
        reports = {role: dict(sha256=digest, artifact_path=spec.report_artifacts[role]) for role, digest in spec.report_hashes.items()}
        implementation = {name: sha(ROOT / 'etl/app' / name) for name in ['spatial_geometry.py', 'spatial_sources.py', 'spatial_load.py']}
        require(row['dataset_id'] == spec.dataset_id and row['load_status'] == 'READY' and row['is_current'] is True
                and row['source_crs'] == 5181 and row['feature_count'] == spec.feature_count
                and row['source_file_sha256'] == spec.archive_sha256
                and row['validation_report_sha256'] == spec.report_hashes[primary]
                and profile['reports'] == reports and profile['source_zip_sha256'] == spec.archive_sha256
                and profile['source_members'] == spec.member_hashes and profile['implementation'] == implementation
                and profile['geometry'] == dict(srid=5181, operational_type='MultiPolygon', repair_method='linework', keep_collapsed=True)
                and row['processing_profile_sha256'] == hashlib.sha256(canonical(profile).encode()).hexdigest(),
                'Spatial source/report/profile/version mismatch')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['init', 'validate'])
    args = parser.parse_args()
    try:
        if args.action == 'init': result = initialize(Path('/source'), Path('/cache'), os.getenv('TEAM_DATA_MODE', 'release'))
        else:
            v1.check_files(ROOT, original=True)
            result = dict(status='PASS', version=version(), contract=contract_sha(), source_files=8)
        print(canonical(result))
    except Exception as exc:
        print(canonical(dict(status='FAIL', reason=str(exc) if isinstance(exc, DataError) else type(exc).__name__)))
        raise SystemExit(1)


if __name__ == '__main__': main()
