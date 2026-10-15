"""Versioned runtime fixtures: no raw inputs, real DBs or daemon mutations."""
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch
import zipfile

import team_data
import team_public_data
import team_guard
import team_db
import team_dev


class TeamRuntimeTests(unittest.TestCase):
    def runtime(self):
        self.assertIsNotNone(importlib.util.find_spec('team_dataset'), 'Explicit versioned runtime required')
        import team_dataset
        return team_dataset

    def test_selection_defaults_v1_and_rejects_unknown_versions(self):
        m = self.runtime()
        with patch.dict(os.environ, {}, clear=True): self.assertEqual(m.version(), 'real-data-v1')
        for version in ['real-data-v1', 'real-data-v2']:
            with patch.dict(os.environ, {'TEAM_DATA_VERSION': version}):
                self.assertEqual(m.contract()['version'], version)
                self.assertEqual(m.cache_path(Path('/fixture')), Path('/fixture') / version)
        for version in ['', 'latest', 'real-data-v3', '../real-data-v2']:
            with self.subTest(version=version), self.assertRaises(team_data.DataError): m.version(version)
        self.assertEqual(team_data.contract_sha(), team_public_data.SOURCE_CONTRACT_SHA)

    def test_fixed_version_asset_sha_and_unpublished_gate(self):
        m = self.runtime()
        for version, asset in [('real-data-v1', team_data.ASSET), ('real-data-v2', team_public_data.ASSET)]:
            digest = m.V2_ARCHIVE_SHA if version.endswith('v2') else 'a' * 64
            good = dict(status='PUBLISHED', version=version, tag=version, sha256=digest,
                url='https://github.com/jinwooorp/RecycleYoungs/releases/download/' + version + '/' + asset)
            self.assertEqual(m.release_url(good, version), good['url'])
            for changed in [dict(good, status='UNPUBLISHED'), dict(good, version='other'),
                            dict(good, tag='latest'), dict(good, url='https://evil.invalid/a.zip'),
                            dict(good, tag='real-data-v1' if version.endswith('v2') else 'real-data-v2')]:
                with self.subTest(version=version, changed=list(changed)), self.assertRaises(team_data.DataError):
                    m.release_url(changed, version)
        with self.assertRaises(team_data.DataError): m.release_url(dict(good, sha256='a' * 64), 'real-data-v2')

    def test_superseded_unlicensed_candidate_is_not_the_release_pin(self):
        m = self.runtime()
        self.assertEqual(m.V2_ARCHIVE_SHA, '6b11901f46d1a207c5b36353483e209f00a10fb401edcc5fd036a3025238ff0b')
        candidate = dict(status='PUBLISHED', version='real-data-v2', tag='real-data-v2',
                         sha256='1f9cf2dc539096c2ccd0addcb30935814d8490e5afc21f755a2532ed54243805',
                         url='https://github.com/jinwooorp/RecycleYoungs/releases/download/real-data-v2/'
                             + team_public_data.ASSET)
        for digest in [candidate['sha256'], '987aae40d10caab2c86a4ab2fff2c6d678ba8d2e94af3716d48deedcaed9267e']:
            with self.subTest(digest=digest), self.assertRaises(team_data.DataError):
                m.release_url(dict(candidate, sha256=digest), 'real-data-v2')

    def test_duplicate_json_and_cache_metadata_are_rejected(self):
        m = self.runtime()
        with self.assertRaises(team_data.DataError): m.parse_json('{"version":"v1","version":"v2"}')
        with self.assertRaises(team_data.DataError): m.parse_json('{"nested":{"a":1,"a":2}}')

    def fixture_package(self):
        payloads = {name: b'{}' if name.endswith('.json') else b'fixture' for name in
                    ['stats.csv', 'sales.csv', 'stores.csv', 'admin.zip', 'commercial.zip',
                     'admin-report.json', 'commercial-report.json', 'repair-report.json', 'ATTRIBUTION.json']}
        files = [dict(name=name, bytes=len(blob), sha256=hashlib.sha256(blob).hexdigest())
                 for name, blob in payloads.items()]
        contract = dict(version='real-data-v2', files=files)
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for name, blob in payloads.items(): archive.writestr(name, blob)
            archive.writestr('dataset.json', team_data.canonical(contract))
        return stream.getvalue(), contract

    def test_v2_http_download_verified_cache_reuse_and_corruption_fail_closed(self):
        m = self.runtime(); payload, contract = self.fixture_package(); requests = []
        digest = hashlib.sha256(payload).hexdigest()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path); self.send_response(200)
                self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
            def log_message(self, *_): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        url = 'http://127.0.0.1:' + str(server.server_port) + '/fixed.zip'
        def fixture_download(source, target, sha):
            return team_data.download(source, target, sha, policy=lambda value: value == url)
        try:
            with tempfile.TemporaryDirectory() as tmp, patch.object(team_public_data, 'contract', return_value=contract), \
                 patch.object(team_public_data, 'prepare') as prepared, patch.object(m, 'release_url', return_value=url), \
                 patch.object(m, 'download', side_effect=fixture_download):
                root=Path(tmp); config=root/'release.json'; config.write_text(json.dumps(dict(sha256=digest)))
                result=m.initialize(root/'absent', root/'cache', 'release', 'real-data-v2', config)
                self.assertEqual(result['action'], 'PREPARED')
                self.assertEqual(m.initialize(root/'absent', root/'cache', 'release', 'real-data-v2', config)['action'], 'VERIFIED_CACHE')
                self.assertEqual(len(requests), 1)
                self.assertFalse((root/'cache/real-data-v1').exists())
                (root/'cache/real-data-v2/ATTRIBUTION.json').write_bytes(b'changed')
                with self.assertRaises(team_data.DataError): m.initialize(root/'absent', root/'cache', 'release', 'real-data-v2', config)
                self.assertEqual(len(requests), 1)
                self.assertGreaterEqual(prepared.call_count, 2)
        finally:
            server.shutdown(); server.server_close(); worker.join()

    def test_existing_v1_ledger_blocks_v2_before_any_chmod_or_write(self):
        m = self.runtime()
        resources={'network_id':'a'*64,'volumes':{}}
        own={'Config':{'Labels':{team_guard.LABEL:team_guard.OWNER,
             'com.docker.compose.project':team_guard.PROJECT,'com.docker.compose.service':'preflight'}}}
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); ledger=root/'ownership.json'
            ledger.write_text(json.dumps(dict(owner='a'*32,resources=resources)))
            before=ledger.read_bytes()
            with patch.dict(os.environ,{'TEAM_DATA_VERSION':'real-data-v2','HOSTNAME':'fixture'}), \
                 patch('team_guard.inspect',return_value=own),patch('team_guard.resources',return_value=resources), \
                 patch('team_guard.os.chmod') as chmod, self.assertRaises(team_data.DataError): team_guard.claim(root)
            chmod.assert_not_called(); self.assertEqual(ledger.read_bytes(),before)
            self.assertEqual(list(root.iterdir()),[ledger])

    def test_profile_source_report_and_v1_v2_mixing_are_rejected(self):
        m = self.runtime()
        rows=[]
        for spec in m.spatial_specs('real-data-v2').values():
            profile=dict(reports={role:dict(sha256=sha,artifact_path=spec.report_artifacts[role])
                         for role,sha in spec.report_hashes.items()},source_zip_sha256=spec.archive_sha256,
                         source_members=spec.member_hashes,geometry=dict(srid=5181,operational_type='MultiPolygon',
                         repair_method='linework',keep_collapsed=True),
                         implementation={name:team_data.sha(team_data.ROOT/'etl/app'/name) for name in
                                         ['spatial_geometry.py','spatial_sources.py','spatial_load.py']})
            primary='repair' if 'repair' in spec.report_hashes else 'quality'
            rows.append(dict(boundary_kind=spec.boundary_kind,dataset_id=spec.dataset_id,load_status='READY',is_current=True,
                    source_file_sha256=spec.archive_sha256,source_crs=5181,feature_count=spec.feature_count,
                    validation_report_sha256=spec.report_hashes[primary],processing_metadata=profile,
                    processing_profile_sha256=hashlib.sha256(team_data.canonical(profile).encode()).hexdigest()))
        m.validate_spatial(rows,'real-data-v2')
        with self.assertRaises(team_data.DataError): m.validate_spatial(rows,'real-data-v1')
        legacy=copy.deepcopy(rows)
        for row in legacy:
            spec=next(s for s in m.spatial_specs('real-data-v1').values() if s.boundary_kind==row['boundary_kind'])
            primary='repair' if 'repair' in spec.report_hashes else 'quality'
            row['validation_report_sha256']=spec.report_hashes[primary]
            row['processing_metadata']['reports']={role:dict(sha256=sha,artifact_path=spec.report_artifacts[role])
                                                 for role,sha in spec.report_hashes.items()}
            row['processing_profile_sha256']=hashlib.sha256(team_data.canonical(row['processing_metadata']).encode()).hexdigest()
        m.validate_spatial(legacy,'real-data-v1')
        with self.assertRaises(team_data.DataError):m.validate_spatial(legacy,'real-data-v2')
        for field,value in [('load_status','PENDING'),('source_file_sha256','0'*64),('source_crs',4326),
                            ('validation_report_sha256','0'*64),('processing_profile_sha256','0'*64),('is_current',False)]:
            bad=copy.deepcopy(rows);bad[0][field]=value
            with self.subTest(field=field),self.assertRaises(team_data.DataError):m.validate_spatial(bad,'real-data-v2')
        with self.assertRaises(team_data.DataError): m.validate_spatial(rows[:1],'real-data-v2')
        for broken in [None, [{},{}], [dict(rows[0],processing_metadata={}), rows[1]]]:
            with self.subTest(broken_shape=True),self.assertRaises(team_data.DataError):m.validate_spatial(broken,'real-data-v2')

    def test_wrong_db_version_is_rejected_before_write_mode_or_ddl(self):
        m = self.runtime()
        identity=dict(sid='12345',owner='a'*32,dataset=m.binding('real-data-v2'))
        actual=dict(db=team_guard.DATABASE,actor='ry_team_owner',sid='12345',pgdata=team_guard.PGDATA,
                    port='5432',owner='a'*32)
        connection=MagicMock(); executed=[]
        def execute(sql,*args):
            executed.append(sql)
            cursor=MagicMock()
            if 'current_database() AS db' in sql: result=actual
            elif 'session_user AS u' in sql: result=dict(u='ry_team_owner')
            elif 'to_regclass' in sql: result=dict(ok=True)
            else: result=dict(version='real-data-v1',contract=team_data.contract_sha(),owner='a'*32,status='READY')
            cursor.fetchone.return_value=result
            return cursor
        connection.execute.side_effect=execute
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'password').write_text('fixture')
            with patch.dict(os.environ,{'TEAM_DATA_VERSION':'real-data-v2'}),patch.object(team_db,'CONTROL',root), \
                 patch.object(team_db,'ownership',return_value=(dict(owner='a'*32),dict(ip='127.0.0.2'))), \
                 patch.object(team_db,'load_identity',return_value=identity),patch.object(team_db,'prove_database'), \
                 patch('psycopg.connect',return_value=connection),self.assertRaises(team_data.DataError):team_db.connect()
        self.assertFalse(any('default_transaction_read_only=off' in sql or sql.startswith(('CREATE','ALTER','INSERT','UPDATE')) for sql in executed))
        connection.close.assert_called_once()

    def test_ready_rerun_does_not_execute_setup_checkpoint_or_loader(self):
        m=self.runtime(); state=dict(version='real-data-v1',contract=team_data.contract_sha(),status='READY',stage='VERIFIED',verification={'fixture':'kept'})
        connection=MagicMock(); connection.__enter__.return_value=connection
        connection.execute.return_value.fetchone.return_value={'ok':True}
        with patch.dict(os.environ,{'TEAM_DATA_VERSION':'real-data-v1'}),patch.object(team_db,'check_files'), \
             patch.object(team_db,'prepare',return_value=([],[])),patch.object(team_db,'connect',return_value=connection), \
             patch.object(team_db,'history'),patch.object(team_db,'read_state',return_value=state), \
             patch.object(team_db,'empty',return_value=False),patch.object(team_db,'verify',return_value=state['verification']), \
             patch.object(team_db,'setup') as setup,patch.object(team_db,'checkpoint') as checkpoint,patch.object(team_db,'load_csv') as loader:
            self.assertEqual(team_db.initialize()['action'],'PRESERVED')
        setup.assert_not_called();checkpoint.assert_not_called();loader.assert_not_called()

    def test_host_proof_checks_version_sid_migrations_readiness_and_profiles(self):
        m=self.runtime()
        self.assertTrue(hasattr(team_dev,'validate_status'),'Host proof requires version-aware validation')
        identity=dict(owner='a'*32,sid='12345'); metadata=dict(pgdata=team_guard.PGDATA)
        state=dict(owner='a'*32,version='real-data-v2',contract=m.contract_sha('real-data-v2'),status='READY',
                   verification=dict(fingerprint={'fixture':'same'},migrations=m.expected_history()))
        result=dict(db=team_guard.DATABASE,actor='ry_team_owner',readonly='on',sid='12345',owner='a'*32,
                    pgdata=team_guard.PGDATA,state=state,fingerprint={'fixture':'same'},migrations=m.expected_history(),
                    spatial=[],spatial_proof='c'*64)
        with patch.dict(os.environ,{'TEAM_DATA_VERSION':'real-data-v2'}),patch('team_dev.validate_spatial'):
            team_dev.validate_status(result,metadata,identity)
            for field,value in [('sid','wrong'),('readonly','off'),('migrations',[]),('fingerprint',{}),('spatial_proof','invalid')]:
                bad=copy.deepcopy(result);bad[field]=value
                with self.subTest(field=field),self.assertRaises(team_data.DataError):team_dev.validate_status(bad,metadata,identity)
            for field,value in [('version','real-data-v1'),('contract','0'*64),('status','LOADING')]:
                bad=copy.deepcopy(result);bad['state'][field]=value
                with self.subTest(field=field),self.assertRaises(team_data.DataError):team_dev.validate_status(bad,metadata,identity)

    def test_failed_v2_validation_never_publishes_cache_and_can_retry(self):
        m=self.runtime(); payload,contract=self.fixture_package(); digest=hashlib.sha256(payload).hexdigest()
        def download_fixture(url,path,expected):
            self.assertEqual(expected,digest);Path(path).write_bytes(payload)
        with tempfile.TemporaryDirectory() as tmp,patch.object(team_public_data,'contract',return_value=contract), \
             patch.object(m,'release_url',return_value='fixture-only'),patch.object(m,'download',side_effect=download_fixture):
            root=Path(tmp); config=root/'config.json';config.write_text(json.dumps(dict(sha256=digest)))
            with patch.object(team_public_data,'prepare',side_effect=team_data.DataError('Injected partial validation')):
                with self.assertRaises(team_data.DataError):m.initialize(root/'absent',root/'cache','release','real-data-v2',config)
            self.assertFalse((root/'cache/real-data-v2').exists())
            self.assertEqual(len(list((root/'cache').glob('pending-*'))),1)
            with patch.object(team_public_data,'prepare'):
                self.assertEqual(m.initialize(root/'absent',root/'cache','release','real-data-v2',config)['action'],'PREPARED')
            self.assertEqual(len(list((root/'cache').glob('pending-*'))),2)

    def test_v1_runtime_download_and_cache_keep_the_original_contract(self):
        m=self.runtime();_,public_contract=self.fixture_package()
        expected=dict(version='real-data-v1',files=[item for item in public_contract['files'] if item['name']!='ATTRIBUTION.json'])
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            for item in expected['files']:archive.writestr(item['name'],b'{}' if item['name'].endswith('.json') else b'fixture')
            archive.writestr('dataset.json',team_data.canonical(expected))
        payload=stream.getvalue();digest=hashlib.sha256(payload).hexdigest();calls=[]
        def fetch(url,target,sha):
            self.assertEqual(sha,digest);calls.append(url);Path(target).write_bytes(payload)
        with tempfile.TemporaryDirectory() as tmp,patch.object(team_data,'contract',return_value=expected), \
             patch.object(team_data,'prepare'),patch.object(m,'download',side_effect=fetch):
            root=Path(tmp);config=root/'fixture.json'
            config.write_text(json.dumps(dict(status='PUBLISHED',version='real-data-v1',tag='real-data-v1',sha256=digest,
                url='https://github.com/jinwooorp/RecycleYoungs/releases/download/real-data-v1/'+team_data.ASSET)))
            self.assertEqual(m.initialize(root/'absent',root/'cache','release','real-data-v1',config)['action'],'PREPARED')
            self.assertEqual(m.initialize(root/'absent',root/'cache','release','real-data-v1',config)['action'],'VERIFIED_CACHE')
            self.assertEqual(len(calls),1)
            self.assertEqual(len(list((root/'cache/real-data-v1').iterdir())),9)
            self.assertFalse((root/'cache/real-data-v2').exists())

    def test_wrong_dataset_metadata_or_symlink_cache_is_never_reused(self):
        m=self.runtime();payload,contract=self.fixture_package()
        with tempfile.TemporaryDirectory() as tmp,patch.object(team_public_data,'contract',return_value=contract):
            root=Path(tmp);cache=root/'real-data-v2';cache.mkdir()
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for name in archive.namelist():(cache/name).write_bytes(archive.read(name))
            (cache/'dataset.json').write_text(team_data.canonical(dict(contract,version='real-data-v1')))
            with self.assertRaises(team_data.DataError):m.check_files(cache,'real-data-v2')
            link=root/'linked';link.symlink_to(cache,target_is_directory=True)
            with self.assertRaises(team_data.DataError):m.check_files(link,'real-data-v2')

    def test_concurrent_initializer_is_bounded_and_cannot_write_sources(self):
        import fcntl
        m=self.runtime()
        with tempfile.TemporaryDirectory() as tmp:
            cache=Path(tmp)
            with (cache/'.init-real-data-v2.lock').open('w') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaisesRegex(team_data.DataError,'Another dataset initializer'):
                    m.initialize(cache/'no-source',cache,'local','real-data-v2')
            self.assertFalse((cache/'real-data-v2').exists())

    def test_checkpoint_conflict_cannot_adopt_another_dataset(self):
        self.runtime();connection=MagicMock()
        connection.execute.return_value.fetchone.return_value=None
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'owner').write_text('a'*32)
            with patch.object(team_db,'CONTROL',root),patch.dict(os.environ,{'TEAM_DATA_VERSION':'real-data-v2'}), \
                 self.assertRaisesRegex(team_data.DataError,'Checkpoint dataset identity mismatch'):
                team_db.checkpoint(connection,'READY','VERIFIED',{})
        sql=connection.execute.call_args.args[0]
        self.assertIn('WHERE team_dev.state.version=excluded.version',sql)
        self.assertIn('team_dev.state.contract=excluded.contract',sql)
        self.assertIn('team_dev.state.owner=excluded.owner',sql)

    def test_missing_state_in_existing_team_schema_is_not_adopted(self):
        m=self.runtime();connection=MagicMock();executed=[]
        actual=dict(db=team_guard.DATABASE,actor='ry_team_owner',sid='12345',pgdata=team_guard.PGDATA,
                    port='5432',owner='a'*32)
        def execute(sql,*_):
            executed.append(sql);cursor=MagicMock()
            if 'current_database() AS db' in sql:row=actual
            elif 'session_user AS u' in sql:row=dict(u='ry_team_owner')
            elif 'to_regclass' in sql:row=dict(ok=False)
            else:row=dict(ok=True)
            cursor.fetchone.return_value=row;return cursor
        connection.execute.side_effect=execute
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'password').write_text('fixture')
            with patch.dict(os.environ,{'TEAM_DATA_VERSION':'real-data-v2'}),patch.object(team_db,'CONTROL',root), \
                 patch.object(team_db,'ownership',return_value=(dict(owner='a'*32),dict(ip='127.0.0.2'))), \
                 patch.object(team_db,'load_identity',return_value=dict(sid='12345',dataset=m.binding('real-data-v2'))), \
                 patch.object(team_db,'prove_database'),patch('psycopg.connect',return_value=connection), \
                 self.assertRaises(team_data.DataError):team_db.connect()
        self.assertNotIn('SET default_transaction_read_only=off',executed)
        connection.close.assert_called_once()


if __name__ == '__main__': unittest.main()
