"""Offline, explicitly versioned public derivatives. Never activates the v1 runtime."""
import argparse
import copy
from dataclasses import replace
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
from urllib.parse import parse_qsl, unquote, urlsplit
import zipfile

import team_data as original
from team_data import DataError, canonical, require, sha

ROOT = original.ROOT
VERSION = 'real-data-v2'
ASSET = 'recycleyoungs-real-data-v2.zip'
POLICY = 'public-reports-v1'
SOURCE_CONTRACT_SHA = '57594dc6f49495bcc5644f753b07b0bedff07934ac48aecd428215c2329937c3'
CONFIG = ROOT / 'data/public-data-v2.json'
SOURCE_REPORT_HASHES = {
    'admin-report.json': original.SPECS['admin'].report_hashes['quality'],
    'commercial-report.json': original.SPECS['commercial'].report_hashes['quality'],
    'repair-report.json': original.SPECS['commercial'].report_hashes['repair'],
}
# Exact removals from hash-pinned source reports, never a recursive best-effort redactor.
# All other original values, including every feature/replay/topology result, are retained.
REMOVALS = {
    'admin-report.json': [('analysis_provenance', key) for key in
                          ('script_path', 'execution_command', 'temporary_environment')],
    'commercial-report.json': [('polygon', 'zip_reused_from')],
    'repair-report.json': [('postgis', key) for key in
                           ('versions', 'isolation', 'network', 'host_ports', 'storage', 'container_name', 'cleanup')],
}
PRIVATE_KEY = re.compile(r'^(?:password|passwd|credential|credentials|api_?key|access_?token|secret|'
                         r'private_?key|dsn|script_path|execution_command|temporary_environment|container_name)$', re.I)
PRIVATE_VALUE = re.compile(
    r'file://|(?:jdbc:)?postgres(?:ql)?://|-----BEGIN [A-Z ]*PRIVATE KEY-----|'
    r'\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|sk-proj-[A-Za-z0-9_-]+|AKIA[A-Z0-9]{16})|'
    r'(?<![\w])(?:[A-Za-z]:[\\/]|\\\\[^\s\\]+\\)|'
    r'(?<![\w/])/(?:Users|home|var|private|tmp|usr|etc|opt|Volumes|root|mnt|media|run|proc|sys|dev|srv|Library|Applications)(?:/|\b)|'
    r'(?<![\w/:])/(?!/)(?:[\w.~%+-]+/)+[^\s\"\x27<>]*', re.I)


def assert_public_content(value):
    """Fail closed on suspicious fields/strings, without echoing their private values."""
    if isinstance(value, dict):
        for key, item in value.items():
            require(isinstance(key, str) and not PRIVATE_KEY.fullmatch(key), 'Private metadata field rejected')
            assert_public_content(key)
            assert_public_content(item)
    elif isinstance(value, list):
        for item in value: assert_public_content(item)
    elif isinstance(value, str):
        # Public source URLs have rooted URL paths, which are not filesystem paths.
        for url in re.findall(r'https?://[^\s\"\x27<>]+', value):
            parts = urlsplit(url)
            require(parts.username is None and parts.password is None, 'Credential-bearing public URL rejected')
            for key, item in parse_qsl(parts.query):
                require(not PRIVATE_KEY.fullmatch(key) and not PRIVATE_VALUE.search(unquote(item)),
                        'Private public-URL query rejected')
            require(not re.search(r'ghp_|github_pat_|sk-proj-|-----BEGIN', url), 'Credential in public URL rejected')
        text = re.sub(r'https?://[^\s\"\x27<>]+', '', value)
        require(not PRIVATE_VALUE.search(text), 'Private path/credential pattern rejected')


def project_report(name, source):
    require(name in REMOVALS and isinstance(source, dict) and '_public_derivation' not in source,
            'Unknown source report/schema')
    result = copy.deepcopy(source)
    try:
        for parts in REMOVALS[name]:
            parent = result
            for key in parts[:-1]: parent = parent[key]
            del parent[parts[-1]]
    except (KeyError, TypeError) as exc:
        raise DataError('Pinned source report removal schema changed') from exc
    return result


def derive_report(name, payload):
    require(name in SOURCE_REPORT_HASHES and hashlib.sha256(payload).hexdigest() == SOURCE_REPORT_HASHES[name],
            'Pinned source report SHA-256 mismatch')
    source = json.loads(payload)
    result = project_report(name, source)
    derivation = dict(policy=POLICY, package_version=VERSION, source_snapshot_version=original.VERSION,
                      source_report_sha256=SOURCE_REPORT_HASHES[name],
                      removed_fields=['.'.join(parts) for parts in REMOVALS[name]],
                      scientific_results='All original values outside the listed metadata fields are unchanged',
                      origin='RecycleYoungs project validation output; this is a derived report, not an official agency report')
    if name == 'repair-report.json':
        versions = source['postgis']['versions']
        patterns = {'PostgreSQL': r'PostgreSQL ([0-9.]+)', 'PostGIS': r'POSTGIS="([0-9.]+)',
                    'GEOS': r'GEOS="([0-9.]+)', 'PROJ': r'PROJ="([0-9.]+)'}
        engines = {key: re.search(pattern, versions) for key, pattern in patterns.items()}
        require(all(engines.values()), 'Pinned PostGIS engine versions could not be retained')
        derivation['validation_engine_versions'] = {key: match.group(1) for key, match in engines.items()}
    result['_public_derivation'] = derivation
    assert_public_content(result)
    require({k: v for k, v in result.items() if k != '_public_derivation'} == project_report(name, source),
            'Scientific report values changed')
    return canonical(result).encode('utf-8')


def config():
    value = json.loads(CONFIG.read_text(encoding='utf-8'))
    require(value['version'] == VERSION and value['asset'] == ASSET and value['policy'] == POLICY
            and value['schema_version'] == 1 and value['source_contract_sha256'] == SOURCE_CONTRACT_SHA,
            'Public data contract changed; activation is a separate operation')
    require(original.contract_sha() == SOURCE_CONTRACT_SHA, 'Original v1 ETL contract changed')
    require(set(value['reports']) == set(SOURCE_REPORT_HASHES), 'Public report contract is incomplete')
    for name, item in value['reports'].items():
        require(set(item) == {'name', 'bytes', 'sha256'} and item['name'] == name
                and type(item['bytes']) is int and 0 < item['bytes'] < 5_000_000
                and re.fullmatch('[0-9a-f]{64}', item['sha256'] or '')
                and item['sha256'] != SOURCE_REPORT_HASHES[name], 'Invalid derived report identity')
    assert_public_content(value)
    return value


def contract():
    value = config()
    source = original.contract()
    files = []
    for spec in source['files']:
        identity = value['reports'][spec['name']] if spec['name'] in SOURCE_REPORT_HASHES else spec
        files.append({k: identity[k] for k in ('name', 'bytes', 'sha256')})
    attribution = canonical(value['attribution']).encode('utf-8')
    files.append(dict(name='ATTRIBUTION.json', bytes=len(attribution), sha256=hashlib.sha256(attribution).hexdigest()))
    return dict(version=VERSION, source_snapshot_version=original.VERSION, derivation_policy=POLICY,
                source_contract_sha256=SOURCE_CONTRACT_SHA, files=files,
                etl_contract=dict(source['etl_contract'], **{'etl/team_public_data.py': sha(Path(__file__)),
                                                            'data/public-data-v2.json': sha(CONFIG)}),
                provenance=source['provenance'], csv_period=source['csv_period'], limitations=source['limitations'],
                compatibility='Same CSV/Polygon bytes and feature results; report hashes/profile differ. No automatic v1 DB adoption or reload',
                publication='No publication authorization is implied. Release state and rights approval are maintained separately')


def public_specs():
    reports = config()['reports']
    return {key: replace(spec, report_hashes={
                role: reports['repair-report.json' if role == 'repair' else key + '-report.json']['sha256']
                for role in spec.report_hashes},
                report_artifacts={role: 'repair-report.json' if role == 'repair' else key + '-report.json'
                                  for role in spec.report_hashes})
            for key, spec in original.SPECS.items()}


def prepare(root):
    """Use the unchanged CSV validator and geometry engine with explicit derived-report specs."""
    from app.spatial_geometry import prepare_dataset
    from demo_worker import input_validation
    root = Path(root)
    original.check_files(root, contract()['files'])
    for name in (*SOURCE_REPORT_HASHES, 'ATTRIBUTION.json'):
        assert_public_content(json.loads((root / name).read_text(encoding='utf-8')))
    csv = input_validation(root, ROOT / 'data/manifest.json')
    polygons = [prepare_dataset(spec, root / (key + '.zip'),
                               {role: root / name for role, name in spec.report_artifacts.items()})
                for key, spec in public_specs().items()]
    return csv, polygons


def _archive_snapshot(path, expected_sha):
    require(re.fullmatch('[0-9a-f]{64}', expected_sha or ''), 'Public archive SHA-256 mismatch')
    # One bounded, immutable byte snapshot prevents replacing a checked ZIP before extraction.
    with Path(path).open('rb') as source: payload = source.read(original.MAX_ARCHIVE + 1)
    require(0 < len(payload) <= original.MAX_ARCHIVE, 'Public archive exceeds size limit')
    require(hashlib.sha256(payload).hexdigest() == expected_sha, 'Public archive SHA-256 mismatch')
    return zipfile.ZipFile(io.BytesIO(payload))


def _verify_archive(archive, expected):
    members = original.safe_members(archive, {s['name'] for s in expected['files']} | {'dataset.json'})
    require(not archive.comment and not any(m.comment or m.extra for m in members),
            'Unexpected ZIP metadata')
    meta = archive.getinfo('dataset.json')
    require(meta.file_size <= 100_000 and archive.read(meta) == canonical(expected).encode('utf-8'),
            'Public dataset/ETL contract mismatch')
    for spec in expected['files']:
        require(archive.getinfo(spec['name']).file_size == spec['bytes'], 'Public member size mismatch')
        with archive.open(spec['name']) as stream:
            require(hashlib.file_digest(stream, 'sha256').hexdigest() == spec['sha256'],
                    'Public member SHA-256 mismatch')
        if spec['name'].endswith('.json'): assert_public_content(json.loads(archive.read(spec['name'])))


def verify_package(path, expected_sha):
    expected = contract()
    with _archive_snapshot(path, expected_sha) as archive: _verify_archive(archive, expected)
    return expected


def extract_package(path, destination, expected_sha):
    # All archive/inner hashes and metadata pass before any directory/file is created.
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'Refusing extraction over existing path')
    with _archive_snapshot(path, expected_sha) as archive:
        _verify_archive(archive, contract())
        destination.mkdir()  # exclusive claim; an incomplete directory is never a verified cache
        for member in archive.infolist():
            with archive.open(member) as source, (destination / member.filename).open('xb') as target:
                shutil.copyfileobj(source, target)
    return prepare(destination)


def package(output):
    output = Path(output)
    require(output.name == ASSET and not output.exists() and not output.is_symlink(),
            'Refusing existing or incorrectly named public candidate')
    require(output.parent.resolve().is_relative_to((ROOT / '.codex-local/tmp').resolve()),
            'Public candidate must stay in the ignored local artifact directory')
    specs = original.check_files(ROOT, original=True)
    value = config()
    reports = {s['name']: derive_report(s['name'], (ROOT / s['path']).read_bytes())
               for s in specs if s['name'] in SOURCE_REPORT_HASHES}
    for name, payload in reports.items():
        spec = value['reports'][name]
        require(len(payload) == spec['bytes'] and hashlib.sha256(payload).hexdigest() == spec['sha256'],
                'Derived public report differs from its pinned contract')
    generated = {**reports, 'ATTRIBUTION.json': canonical(value['attribution']).encode(),
                 'dataset.json': canonical(contract()).encode()}
    for payload in generated.values(): assert_public_content(json.loads(payload))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('xb') as stream, zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in [s['name'] for s in specs] + ['ATTRIBUTION.json', 'dataset.json']:
            info = zipfile.ZipInfo(name, (2026, 10, 15, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            with archive.open(info, 'w') as target:
                if name in generated: target.write(generated[name])
                else:
                    source_spec = next(s for s in specs if s['name'] == name)
                    with (ROOT / source_spec['path']).open('rb') as source: shutil.copyfileobj(source, target)
    expected = verify_package(output, sha(output))
    return dict(status='PASS', version=VERSION, archive=output.name, bytes=output.stat().st_size,
                sha256=sha(output), members=len(expected['files']) + 1, source_files_unchanged=5,
                derived_reports=3, publication_authorized=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['package', 'verify', 'extract'])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    args = parser.parse_args()
    try:
        if args.action == 'package':
            require(args.output is not None, '--output required')
            result = package(args.output)
        else:
            require(args.archive is not None and args.sha256 is not None, '--archive and --sha256 required')
            if args.action == 'extract':
                require(args.output is not None, '--output required')
                csv, polygons = extract_package(args.archive, args.output, args.sha256)
                result = dict(status='PASS', csv=csv, polygons=[dict(key=p.spec.key, features=len(p.features)) for p in polygons])
            else:
                result = dict(status='PASS', version=verify_package(args.archive, args.sha256)['version'])
        print(canonical(result))
    except (DataError, ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as exc:
        print(canonical(dict(status='FAIL', reason=str(exc) if isinstance(exc, DataError) else type(exc).__name__)))
        raise SystemExit(1)


if __name__ == '__main__': main()
