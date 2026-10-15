"""Synthetic/offline public-package tests. No real inputs, Docker or DB discovery."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import team_data


class PublicReportTests(unittest.TestCase):
    def public(self):
        self.assertIsNotNone(importlib.util.find_spec('team_public_data'),
                             'An explicit derived-report pipeline is required')
        import team_public_data
        return team_public_data

    def fixture(self, role):
        if role == 'admin-report.json':
            return {'analysis_provenance': {'script_path': '/private/tmp/test/analyze.py',
                    'execution_command': 'python /private/tmp/test/analyze.py',
                    'temporary_environment': '/var/folders/test', 'script_sha256': 'a' * 64,
                    'scope': 'source validation'},
                    'geometry': {'valid_count': 425, 'invalid': []}, 'topology': {'overlaps': [0, None]}}
        if role == 'commercial-report.json':
            return {'polygon': {'zip_reused_from': 'data/raw/fixture.zip', 'invalid': [1, 2]},
                    'cafe_mapping': {'decision': 'APPROVED', 'M_cafe': 'I21201'}}
        return {'postgis': {'performed': True,
                'versions': 'PostgreSQL 16.4 POSTGIS="3.4.3" GEOS="3.9.0" PROJ="7.2.1 /usr/share/proj"',
                'isolation': 'test /var/lib/postgresql/data', 'network': 'none', 'host_ports': None,
                'storage': 'tmpfs', 'container_name': 'fixture-db', 'cleanup': 'removed',
                'structure_comparison': 'not performed: GEOS below 3.10', 'comparison_scope': 'version comparison'},
                'features': [{'code': str(i), 'decision': 'ACCEPTABLE', 'raw': {'wkb_sha256': str(i) * 64},
                              'methods': {'linework': {'make_valid_result': {'valid': True, 'holes': 1}}}}
                             for i in range(6)], 'replay': [{'same_wkb_new_process': True}],
                'policy': {'historical_boundary': 'UNRESOLVED', 'hongjimun': 'H5'}}

    def derive(self, name):
        m = self.public(); original = self.fixture(name)
        blob = team_data.canonical(original).encode()
        with patch.dict(m.SOURCE_REPORT_HASHES, {name: hashlib.sha256(blob).hexdigest()}):
            derived = m.derive_report(name, blob)
        return m, original, json.loads(derived), derived

    def test_explicit_removal_preserves_every_other_value_and_original(self):
        self.public()
        for name in ['admin-report.json', 'commercial-report.json', 'repair-report.json']:
            with self.subTest(name=name):
                m, original, public, blob = self.derive(name)
                expected = copy.deepcopy(original)
                for parts in m.REMOVALS[name]:
                    parent = expected
                    for key in parts[:-1]: parent = parent[key]
                    del parent[parts[-1]]
                self.assertEqual({k: v for k, v in public.items() if k != '_public_derivation'}, expected)
                self.assertEqual(public['_public_derivation']['source_report_sha256'],
                                 hashlib.sha256(team_data.canonical(original).encode()).hexdigest())
                self.assertEqual(original, self.fixture(name))
                self.assertNotIn(b'/private/tmp/', blob)
                self.assertNotIn(b'/var/folders/', blob)
                m.assert_public_content(public)
        self.assertEqual(public['features'], original['features'])
        self.assertEqual(public['replay'], original['replay'])
        self.assertEqual(public['_public_derivation']['validation_engine_versions']['GEOS'], '3.9.0')

    def test_unknown_source_bytes_never_silently_sanitized(self):
        m = self.public()
        with self.assertRaisesRegex(team_data.DataError, 'source report'):
            m.derive_report('admin-report.json', b'{}')

    def test_privacy_checks_include_macos_windows_generic_paths_and_credentials(self):
        m = self.public()
        for value in ['/var/folders/test/run.py', '/private/tmp/run.py', '/unexpected/host/file',
                      'C:\\Users\\fixture\\data', '\\\\host\\share\\data', 'file:///tmp/fixture',
                      'postgresql://user:secret@localhost/db', 'jdbc:postgresql://localhost/db',
                      '-----BEGIN OPENSSH PRIVATE KEY-----', 'ghp_' + 'x' * 36,
                      'https://user:password@example.invalid/data',
                      'https://example.invalid/file?api_key=hidden',
                      'https://example.invalid/file?path=%2Fprivate%2Ftmp%2Fsecret']:
            with self.subTest(value=value), self.assertRaises(team_data.DataError):
                m.assert_public_content({'nested': [value]})
        for key in ['password', 'API_KEY', 'access_token', 'credential', 'script_path', 'container_name']:
            with self.subTest(key=key), self.assertRaises(team_data.DataError):
                m.assert_public_content({key: 'hidden'})
        m.assert_public_content({'source': 'https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do',
                                 'relative': 'data/raw/fixture.zip', 'unit': 'm2/m2', 'null': None})

    def test_derivation_is_deterministic_and_refuses_unknown_environment(self):
        m, original, _, first = self.derive('admin-report.json')
        blob = team_data.canonical(original).encode()
        with patch.dict(m.SOURCE_REPORT_HASHES, {'admin-report.json': hashlib.sha256(blob).hexdigest()}):
            self.assertEqual(m.derive_report('admin-report.json', blob), first)
        original['unexpected'] = {'local_file': '/unknown/private/file'}
        blob = team_data.canonical(original).encode()
        with patch.dict(m.SOURCE_REPORT_HASHES, {'admin-report.json': hashlib.sha256(blob).hexdigest()}):
            with self.assertRaises(team_data.DataError): m.derive_report('admin-report.json', blob)


class PublicPackageTests(unittest.TestCase):
    def public(self):
        self.assertIsNotNone(importlib.util.find_spec('team_public_data'))
        import team_public_data
        return team_public_data

    def test_cc_by_notice_is_limited_to_project_reports(self):
        m = self.public()
        notice = m.config()['attribution']
        reports = notice['project_reports']
        self.assertEqual(set(reports['members']), set(m.SOURCE_REPORT_HASHES))
        self.assertEqual(reports['license'], 'CC BY 4.0')
        self.assertEqual(reports['license_url'], 'https://creativecommons.org/licenses/by/4.0/')
        self.assertEqual(reports['attribution_name'], 'RecycleYoungs 프로젝트')
        self.assertEqual(set(reports['permitted_uses']), {'copy', 'share', 'redistribute', 'adapt', 'commercial_use'})
        self.assertEqual(set(reports['conditions']),
                         {'attribution', 'license_link', 'changes_notice', 'no_endorsement', 'no_additional_restrictions'})
        self.assertIn('보유하거나 적법하게', reports['license_scope'])
        self.assertEqual(reports['third_party_rights']['status'], 'UNKNOWN')
        self.assertIn('별도', reports['third_party_rights']['notice'])
        # Publication state belongs to release.json, so publishing never requires repacking this notice.
        self.assertNotIn('publication_status', reports)
        self.assertIn('data/release.json', reports['publication_notice'])
        self.assertEqual({s['member'] for s in notice['sources']},
                         {'stats.csv', 'sales.csv', 'stores.csv', 'admin.zip', 'commercial.zip'})
        for source in notice['sources']:
            self.assertNotIn('CC BY', source['license'])
            if source['member'] != 'stores.csv':
                self.assertEqual(source['license'], '공공누리 제1유형: 출처표시')
        m.assert_public_content(notice)

    def test_attribution_bytes_are_canonical_and_bound_to_dataset_contract(self):
        m = self.public()
        value = m.config()
        attribution = team_data.canonical(value['attribution']).encode('utf-8')
        record = next(s for s in m.contract()['files'] if s['name'] == 'ATTRIBUTION.json')
        self.assertEqual(record, dict(name='ATTRIBUTION.json', bytes=len(attribution),
                                     sha256=hashlib.sha256(attribution).hexdigest()))
        changed = copy.deepcopy(value)
        changed['attribution']['project_reports']['attribution_name'] = 'unapproved credit'
        original_contract = team_data.canonical(m.contract())
        with patch.object(m, 'config', return_value=changed):
            changed_record = next(s for s in m.contract()['files'] if s['name'] == 'ATTRIBUTION.json')
            self.assertNotEqual(changed_record['sha256'], record['sha256'])
            self.assertNotEqual(team_data.canonical(m.contract()), original_contract)

    def test_notice_retains_unknown_dates_and_interpretation_limits(self):
        notice = self.public().config()['attribution']
        limits = '\n'.join(notice['limitations'])
        for required in ['최초 CSV 취득일 UNKNOWN', '경계 기준일 UNKNOWN', '완전성', 'UNRESOLVED', '성공', '6개']:
            with self.subTest(required=required): self.assertIn(required, limits)
        commercial = next(s for s in notice['sources'] if s['member'] == 'commercial.zip')
        self.assertEqual(set(commercial['repair_codes']),
                         {'3110137', '3110270', '3110234', '3110407', '3110515', '3110542'})

    def fixture_archive(self, path, *, data=b'csv', version='fixture-v2', extra=None, metadata=None):
        files = [{'name': 'stats.csv', 'bytes': 3, 'sha256': hashlib.sha256(b'csv').hexdigest()}]
        contract = {'version': 'fixture-v2', 'files': files}
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('stats.csv', data)
            archive.writestr('dataset.json', team_data.canonical(metadata or dict(contract, version=version)))
            if extra: archive.writestr(extra, b'bad')
        return contract

    def test_package_hash_contract_members_and_bytes_before_extract(self):
        m = self.public()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for case in ['good', 'sha', 'bytes', 'version', 'extra', 'slip', 'metadata']:
                with self.subTest(case=case):
                    archive = root / (case + '.zip')
                    expected = self.fixture_archive(archive, data=b'bad' if case == 'bytes' else b'csv',
                        version='other' if case == 'version' else 'fixture-v2',
                        extra={'extra': 'unwanted', 'slip': '../escape'}.get(case),
                        metadata={'version': 'fixture-v2', 'files': [], 'private': '/private/tmp/test'}
                                 if case == 'metadata' else None)
                    digest = '0' * 64 if case == 'sha' else team_data.sha(archive)
                    with patch.object(m, 'contract', return_value=expected), patch.object(m, 'prepare') as prepared:
                        if case == 'good':
                            m.extract_package(archive, root / case, digest)
                            self.assertEqual((root / case / 'stats.csv').read_bytes(), b'csv')
                            prepared.assert_called_once()
                            with self.assertRaises(team_data.DataError):
                                m.extract_package(archive, root / case, digest)
                        else:
                            with self.assertRaises(team_data.DataError):
                                m.extract_package(archive, root / case, digest)
                            self.assertFalse((root / case).exists())

    def test_v1_contract_stays_identical_and_v2_cannot_be_used_by_v1(self):
        m = self.public()
        self.assertEqual(team_data.contract_sha(),
                         '57594dc6f49495bcc5644f753b07b0bedff07934ac48aecd428215c2329937c3')
        self.assertEqual(team_data.VERSION, 'real-data-v1')
        self.assertEqual(m.VERSION, 'real-data-v2')
        self.assertNotEqual(m.contract()['version'], team_data.contract()['version'])
        for key, spec in m.public_specs().items():
            original = team_data.SPECS[key]
            self.assertEqual(spec.archive_sha256, original.archive_sha256)
            self.assertEqual(spec.invalid_codes, original.invalid_codes)
            self.assertNotEqual(spec.report_hashes, original.report_hashes)
        self.assertEqual(json.loads((team_data.ROOT / 'data/release.json').read_text())['status'], 'UNPUBLISHED')

    def test_hidden_duplicate_json_metadata_and_zip_comment_rejected(self):
        m = self.public()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'fixture.zip'
            expected = {'version': 'fixture-v2', 'files': []}
            for hidden in [True, False]:
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr('dataset.json',
                        '{"version":"/private/tmp/hidden",' + team_data.canonical(expected)[1:]
                        if hidden else team_data.canonical(expected))
                    if not hidden: archive.comment = b'private environment'
                with patch.object(m, 'contract', return_value=expected), self.assertRaises(team_data.DataError):
                    m.verify_package(path, team_data.sha(path))

    def test_public_report_contract_refuses_missing_size_sha_and_source_alias(self):
        m = self.public()
        config = m.config()
        for change in ['missing', 'size', 'sha', 'alias', 'original']:
            value = copy.deepcopy(config)
            report = value['reports']['admin-report.json']
            if change == 'missing': del value['reports']['repair-report.json']
            if change == 'size': report['bytes'] = -1
            if change == 'sha': report['sha256'] = 'invalid'
            if change == 'alias': report['name'] = '../escape'
            if change == 'original': report['sha256'] = m.SOURCE_REPORT_HASHES['admin-report.json']
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'config.json'; path.write_text(json.dumps(value))
                with patch.object(m, 'CONFIG', path), self.assertRaises(team_data.DataError): m.config()

    def test_missing_and_changed_public_reports_rejected_before_geometry(self):
        m = self.public()
        spec = next(s for s in m.contract()['files'] if s['name'] == 'admin-report.json')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for content in [None, b'changed']:
                path = root / spec['name']
                if content: path.write_bytes(content)
                with patch.object(m, 'contract', return_value={'files': [spec]}), self.assertRaises(team_data.DataError):
                    m.prepare(root)

    def test_deterministic_packaging_preserves_sources_and_never_overwrites(self):
        m = self.public()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'input').mkdir()
            raw = root / 'input/stats.csv'; raw.write_bytes(b'fixture bytes\r\n')
            report = root / 'input/admin.json'
            blob = team_data.canonical(PublicReportTests().fixture('admin-report.json')).encode()
            report.write_bytes(blob)
            with patch.dict(m.SOURCE_REPORT_HASHES, {'admin-report.json': hashlib.sha256(blob).hexdigest()}):
                derived = m.derive_report('admin-report.json', blob)
                reports = {'admin-report.json': dict(name='admin-report.json', bytes=len(derived),
                           sha256=hashlib.sha256(derived).hexdigest())}
                sources = [dict(name='stats.csv', path='input/stats.csv', bytes=raw.stat().st_size, sha256=team_data.sha(raw)),
                           dict(name='admin-report.json', path='input/admin.json', bytes=len(blob), sha256=team_data.sha(report))]
                attribution = {'license': 'fixture attribution'}
                attr_blob = team_data.canonical(attribution).encode()
                expected = dict(version='fixture-v2', files=[{k: sources[0][k] for k in ['name', 'bytes', 'sha256']},
                           reports['admin-report.json'], dict(name='ATTRIBUTION.json', bytes=len(attr_blob),
                           sha256=hashlib.sha256(attr_blob).hexdigest())])
                before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in [raw, report]]
                with patch.object(m, 'ROOT', root), patch.object(m, 'config', return_value=dict(reports=reports, attribution=attribution)), \
                     patch.object(m, 'contract', return_value=expected), patch.object(m.original, 'check_files', return_value=sources):
                    candidates = [root / '.codex-local/tmp' / name / m.ASSET for name in ['first', 'second']]
                    result = [m.package(path) for path in candidates]
                    self.assertEqual(result[0]['sha256'], result[1]['sha256'])
                    with self.assertRaises(team_data.DataError): m.package(candidates[0])
                    self.assertEqual(team_data.sha(candidates[0]), result[0]['sha256'])
                    with self.assertRaises(team_data.DataError): m.package(root / m.ASSET)
                    with zipfile.ZipFile(candidates[0]) as archive:
                        self.assertEqual(archive.read('stats.csv'), before[0][0])
                        self.assertEqual(archive.read('admin-report.json'), derived)
                        self.assertEqual(len(archive.infolist()), 4)
                self.assertEqual(before, [(p.read_bytes(), p.stat().st_mtime_ns) for p in [raw, report]])

    def test_archive_replacement_between_validation_and_extraction_cannot_escape(self):
        m = self.public(); real_zip = zipfile.ZipFile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); path = root / 'fixture.zip'
            expected = self.fixture_archive(path)
            digest = team_data.sha(path); opens = 0
            def replaced_on_reopen(*args, **kwargs):
                nonlocal opens
                opens += 1
                if opens == 2:
                    with real_zip(path, 'w') as attacker:
                        attacker.writestr('stats.csv', b'csv')
                        attacker.writestr('dataset.json', team_data.canonical(expected))
                        attacker.writestr('../escaped', b'bad')
                return real_zip(*args, **kwargs)
            with patch.object(m, 'contract', return_value=expected), patch.object(m, 'prepare'), \
                 patch.object(m.zipfile, 'ZipFile', side_effect=replaced_on_reopen):
                m.extract_package(path, root / 'out', digest)
            self.assertFalse((root / 'escaped').exists())
            self.assertEqual((root / 'out/stats.csv').read_bytes(), b'csv')

if __name__ == '__main__': unittest.main()
