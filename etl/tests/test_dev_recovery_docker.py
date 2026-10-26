"""Docker recovery preconditions: no container or DB is touched by this suite."""
import importlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import sqlite3
import hashlib
from unittest.mock import patch
import contextlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
import unittest


class RecoveryDockerTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('dev_recovery_docker')
        except ModuleNotFoundError:
            self.fail('explicit full recovery orchestration is missing')

    def inventory(self):
        roles = ['api-postgres', 'api-backend', 'api-scheduler', 'frontend', 'inspect-proxy']
        return [dict(id=str(i + 1) * 64, service=role, project='recycleyoungs-dev',
                     environment='local-development-v1', running=True, image='sha256:' + str(i + 1) * 64,
                     volumes=['recycleyoungs-dev-db'] if role == 'api-postgres' else []) for i, role in enumerate(roles)]

    def test_duplicate_service_or_foreign_owner_is_rejected(self):
        m = self.module(); rows = self.inventory()
        m.validate_inventory(rows, 'recycleyoungs-dev')
        for changed in [rows + [rows[0]], [rows[0] | dict(project='other'), *rows[1:]],
                        [rows[0] | dict(volumes=['foreign-db']), *rows[1:]]]:
            with self.assertRaises(ValueError):
                m.validate_inventory(changed, 'recycleyoungs-dev')

    def test_stopped_live_service_is_not_a_backup_source(self):
        m = self.module(); rows = self.inventory(); rows[2]['running'] = False
        with self.assertRaisesRegex(ValueError, 'RECOVERY_LIVE_INVENTORY_REJECTED'):
            m.validate_inventory(rows, 'recycleyoungs-dev')

    def test_changed_source_state_blocks_followup_steps(self):
        m = self.module(); original = dict(services=self.inventory(), volumes={'db': 'created'}, networks={'data': 'a' * 64})
        m.require_unchanged(original, original)
        with self.assertRaisesRegex(ValueError, 'RECOVERY_SOURCE_CHANGED'):
            m.require_unchanged(original, original | dict(networks={'data': 'b' * 64}))

    def test_failed_final_source_check_never_issues_ready_and_records_stop(self):
        m=self.module();events=[]
        self.assertTrue(callable(getattr(m,'finalize_restore',None)))
        def changed(): events.append('check');raise ValueError('RECOVERY_SOURCE_CHANGED')
        with self.assertRaisesRegex(ValueError,'RECOVERY_SOURCE_CHANGED'):
            m.finalize_restore(verify_source=changed,issue=lambda:events.append('issue'),
                record_verified=lambda:events.append('PASS'),quiesce=lambda:events.append('stop-db'),
                activate=lambda:events.append('start-db'),unblock=lambda:events.append('unblock'),stop=lambda:events.append('STOP'))
        self.assertEqual(events,['check','STOP'])

    def test_partial_unblock_failure_never_opens_a_running_database(self):
        m=self.module();state=dict(database_running=True,first_route_open=False);events=[]
        def quiesce():state['database_running']=False;events.append('stop-db')
        def broken_unblock():
            state['first_route_open']=True
            self.assertFalse(state['database_running'])
            raise OSError('second marker removal failed')
        with self.assertRaises(OSError):
            m.finalize_restore(verify_source=lambda:None,issue=lambda:None,quiesce=quiesce,
                unblock=broken_unblock,activate=lambda:events.append('MUST_NOT_START'),
                record_verified=lambda:events.append('MUST_NOT_PASS'),stop=lambda:events.append('STOP'))
        self.assertEqual(events,['stop-db','STOP']);self.assertFalse(state['database_running'])

    def test_full_verification_is_durable_before_the_new_database_can_start(self):
        m=self.module();events=[]
        m.finalize_restore(verify_source=lambda:events.append('source-check'),issue=lambda:events.append('issue'),
            quiesce=lambda:events.append('stop-db'),unblock=lambda:events.append('unblock'),
            record_verified=lambda:events.append('verified-at-rest'),activate=lambda:events.append('start-db'),stop=lambda:events.append('STOP'))
        self.assertLess(events.index('verified-at-rest'),events.index('start-db'))
        self.assertLess(events.index('stop-db'),events.index('issue'))
        self.assertNotIn('source-check',events[events.index('verified-at-rest')+1:])

    def test_restore_control_writes_sync_every_file_and_parent_directory(self):
        m=self.module();self.assertTrue(isinstance(getattr(m,'DURABLE_CONTROL_WRITE',None),str))
        import os,stat
        sync=os.fsync;events=[]
        def observed(fd):events.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file');sync(fd)
        def create(path,value):
            with path.open('xb') as f:f.write(json.dumps(value).encode())
        namespace=dict(create=create,os=os,Path=Path)
        exec(m.DURABLE_CONTROL_WRITE,namespace)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve()
            with patch.object(os,'fsync',side_effect=observed):namespace['write'](root/'target.json',dict(sid='123'))
        self.assertEqual(events,['file','directory'])

    def test_shutdown_failure_cannot_skip_the_durable_stop_record(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'durable_stop',None)))
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            def unavailable():raise OSError('Docker unavailable')
            with self.assertRaises(OSError):m.durable_stop(root,shutdown=unavailable)
            self.assertEqual(json.loads((root/'STOP.json').read_text())['status'],'STOP')

    def test_restart_comparison_failure_records_stop_and_stops_only_the_new_database(self):
        m=self.module();source=dict(project='recycleyoungs-dev',sid='1',container_id='a'*64,network_id='b'*64)
        target=dict(project='recycleyoungs-dev-check-a1b2c3d4',sid='2',container_id='c'*64,network_id='d'*64)
        database=dict(Config=dict(Labels={m.LABEL:'nonce','com.docker.compose.project':target['project']}),
            State=dict(Running=True),HostConfig=dict(PortBindings={}),
            NetworkSettings=dict(Networks={target['project']+'-data':{}}),Image='sha256:'+'e'*64)
        state=dict(status='SUCCEEDED',release_id='f'*64)
        before=dict(snapshot=dict(tables={}),role_logins=3,registry_versions=[],release_id=state['release_id'])
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            for name,value in [('verified.json',dict(status='PASS',target=target,receipt=dict(source=source))),
                ('resources.json',dict(project=target['project'],nonce='nonce')),('worker.json',dict(id='worker'))]:
                m.exclusive_json(root/name,value)
            from unittest.mock import MagicMock
            docker=MagicMock();docker.prefix=['test-docker'];docker.inspect.return_value=database;docker.run.return_value=b''
            docker.execute.side_effect=[state,before,dict(status='PASS'),before|dict(release_id='changed')]
            with patch.object(m,'Docker',return_value=docker),patch.object(m,'protected_source',return_value={}),\
                patch.object(m.subprocess,'run',return_value=MagicMock(returncode=0)):
                with self.assertRaisesRegex(ValueError,'RECOVERY_SOURCE_CHANGED'):m.restart_check(root,context='test')
            self.assertEqual(json.loads((root/'STOP.json').read_text())['status'],'STOP')
            docker.run.assert_any_call('stop','--time','30',target['container_id'])
            self.assertTrue(any(call.args[1]==m.RESTART_BLOCK for call in docker.execute.call_args_list))
            self.assertFalse((root/'restart-verified.json').exists())

    def test_successful_reader_verification_can_be_repeated_without_overwrite(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'record_reader_check',None)))
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            value=dict(status='PASS',quarters=22)
            m.record_reader_check(root,value);before=(root/'readers.json').read_bytes()
            m.record_reader_check(root,value)
            self.assertEqual((root/'readers.json').read_bytes(),before)
            self.assertEqual(len(list(root.glob('readers-recheck-*.json'))),1)
            with self.assertRaisesRegex(ValueError,'RECOVERY_READER_MEASUREMENT_CHANGED'):
                m.record_reader_check(root,value|dict(quarters=1))

    def test_retention_cli_rejects_the_same_package_before_hashing(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'retention_inputs',None)))
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            with patch.object(m,'verify_package',side_effect=AssertionError('duplicates must be rejected first')):
                with self.assertRaisesRegex(ValueError,'RECOVERY_DUPLICATE_PACKAGE'):
                    m.retention_inputs([root,root])

    def test_empty_destination_host_does_not_require_a_live_source(self):
        m = self.module()
        class EmptyDocker:
            def run(self, *args): return b''
        self.assertIsNone(m.protected_source(EmptyDocker(), 'recycleyoungs-dev'))
        class PartialDocker:
            def run(self, *args): return b'leftover-volume' if args[0] == 'volume' else b''
        with self.assertRaisesRegex(ValueError, 'RECOVERY_PARTIAL_SOURCE_PRESENT'):
            m.protected_source(PartialDocker(), 'recycleyoungs-dev')

    def test_archive_tags_cannot_replace_another_local_image(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'require_image_tags', None)))
        rows = [dict(Config='a' * 64 + '.json', RepoTags=['project:local'])]
        m.require_image_tags(rows, {'project:local': 'sha256:' + 'a' * 64})
        m.require_image_tags(rows, {'project:local': None})
        with self.assertRaisesRegex(ValueError, 'RECOVERY_IMAGE_TAG_CONFLICT'):
            m.require_image_tags(rows, {'project:local': 'sha256:' + 'b' * 64})

    def test_restore_runtime_requires_exact_new_target_and_sql(self):
        m = self.module()
        source = dict(sid='123', container_id='a' * 64, network_id='b' * 64, project='recycleyoungs-dev')
        target = dict(sid='456', container_id='c' * 64, network_id='d' * 64, project='recycleyoungs-dev-check-a1b2c3d4')
        volumes = {name: 'created-' + name for name in ['db', 'data', 'control', 'reader', 'writer']}
        sql = {'/api-migration/V5__api_context_and_quality_contract.sql': 'e' * 64}
        binding = m.new_binding(source, target, volumes, sql)
        self.assertEqual(binding, dict(project=target['project'], volumes=volumes, sql=sql))
        with self.assertRaises(ValueError):
            m.new_binding(source, target | dict(sid=source['sid']), volumes, sql)
        with self.assertRaises(ValueError):
            m.new_binding(source, target, {'db': 'only-one'}, sql)

    def test_saved_image_must_contain_the_executed_configuration(self):
        m = self.module(); config=b'{"os":"linux","architecture":"amd64"}'
        identity=hashlib.sha256(config).hexdigest()
        for name in [identity+'.json', 'blobs/sha256/'+identity]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                path = Path(d) / 'image.tar'
                with tarfile.open(path, 'w') as archive:
                    entries={'manifest.json':json.dumps([dict(Config=name)]).encode(),name:config}
                    for entry,data in entries.items():
                        info=tarfile.TarInfo(entry);info.size=len(data);archive.addfile(info,io.BytesIO(data))
                m.verify_executed_image(path, 'sha256:'+identity)
                with self.assertRaisesRegex(ValueError, 'RECOVERY_EXECUTED_IMAGE_NOT_ARCHIVED'):
                    m.verify_executed_image(path, 'sha256:' + 'b' * 64)

    def test_legacy_config_id_requires_the_actual_unchanged_config_blob(self):
        m=self.module();data=b'{"os":"linux","architecture":"amd64"}'
        identity=hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'image.tar'
            for blob in [None,b'{}']:
                with tarfile.open(path,'w') as archive:
                    entries={'manifest.json':json.dumps([dict(Config=identity+'.json')]).encode()}
                    if blob is not None:entries[identity+'.json']=blob
                    for name,content in entries.items():
                        entry=tarfile.TarInfo(name);entry.size=len(content);archive.addfile(entry,io.BytesIO(content))
                with self.assertRaises(ValueError):m.verify_executed_image(path,'sha256:'+identity)

    def test_oci_index_and_executed_manifest_are_bound_to_the_saved_config(self):
        m = self.module()
        config = b'{"architecture":"amd64","os":"linux"}'
        config_id = hashlib.sha256(config).hexdigest()
        manifest = json.dumps(dict(schemaVersion=2, config=dict(digest='sha256:'+config_id))).encode()
        manifest_id = hashlib.sha256(manifest).hexdigest()
        index = json.dumps(dict(schemaVersion=2, manifests=[dict(digest='sha256:'+manifest_id,
            platform=dict(os='linux', architecture='amd64'))])).encode()
        index_id = hashlib.sha256(index).hexdigest()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'image.tar'
            entries = dict(zip(['blobs/sha256/'+config_id, 'blobs/sha256/'+manifest_id, 'blobs/sha256/'+index_id],
                               [config, manifest, index]))
            entries['manifest.json'] = json.dumps([dict(Config='blobs/sha256/'+config_id, RepoTags=['project:local'])]).encode()
            def write(values):
                with tarfile.open(path, 'w') as archive:
                    for name, data in values.items():
                        info=tarfile.TarInfo(name); info.size=len(data); archive.addfile(info,io.BytesIO(data))
            write(entries)
            for identity in [index_id, manifest_id, config_id]:
                self.assertEqual(m.verify_executed_image(path,'sha256:'+identity),{config_id})
            # A mutable tag or a filename alone cannot prove the executed image.
            for changed in [entries|{'blobs/sha256/'+manifest_id:b'{}'},
                            entries|{'blobs/sha256/'+config_id:b'{"os":"linux","architecture":"arm64"}'}]:
                write(changed)
                with self.assertRaises(ValueError): m.verify_executed_image(path,'sha256:'+index_id)
            # A valid but different platform chain must also fail, even with correct hashes.
            arm_config=b'{"architecture":"arm64","os":"linux"}'
            arm_config_id=hashlib.sha256(arm_config).hexdigest()
            arm_manifest=json.dumps(dict(config=dict(digest='sha256:'+arm_config_id))).encode()
            arm_manifest_id=hashlib.sha256(arm_manifest).hexdigest()
            arm_entries={'manifest.json':json.dumps([dict(Config='blobs/sha256/'+arm_config_id)]).encode(),
                'blobs/sha256/'+arm_config_id:arm_config, 'blobs/sha256/'+arm_manifest_id:arm_manifest}
            write(arm_entries)
            with self.assertRaisesRegex(ValueError,'RECOVERY_IMAGE_PLATFORM_REJECTED'):
                m.verify_executed_image(path,'sha256:'+arm_manifest_id)
            write(entries)
            with self.assertRaises(ValueError): m.verify_executed_image(path,'sha256:'+'b'*64)
            m.require_image_tags([dict(Config='blobs/sha256/'+config_id,RepoTags=['project:local'])],
                {'project:local':'sha256:'+index_id},image_id='sha256:'+index_id,config_ids={config_id})
            with self.assertRaisesRegex(ValueError,'RECOVERY_IMAGE_TAG_CONFLICT'):
                m.require_image_tags([dict(Config='blobs/sha256/'+'c'*64,RepoTags=['project:local'])],
                    {'project:local':'sha256:'+index_id},image_id='sha256:'+index_id,config_ids={config_id})

    def test_background_launcher_is_not_a_client_writer_but_other_owner_is(self):
        m = self.module()
        self.assertIsInstance(getattr(m, 'WRITER_QUERY', None), str, 'client writer selection must be explicit')
        with sqlite3.connect(':memory:') as conn:
            conn.create_function('pg_backend_pid', 0, lambda: 7)
            conn.execute('CREATE TABLE pg_stat_activity(pid integer, usename text, backend_type text)')
            conn.executemany('INSERT INTO pg_stat_activity VALUES(?,?,?)', [(7, 'ry_api_owner', 'client backend'),
                (8, 'ry_api_owner', 'logical replication launcher'), (9, 'api_reader', 'client backend')])
            self.assertEqual(conn.execute(m.WRITER_QUERY).fetchone(), (0,))
            conn.execute("INSERT INTO pg_stat_activity VALUES(10,'ry_api_owner','client backend')")
            self.assertEqual(conn.execute(m.WRITER_QUERY).fetchone(), (1,))

    def test_rootfs_capture_requires_same_live_config_and_exact_layer(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'verify_rootfs_capture', None)), 'rootfs capture must be verified')
        config = dict(User='10001:10001', WorkingDir='/build', Entrypoint=['npm'], Cmd=['run', 'dev'], Env=['PATH=/bin', 'VITE_MAP=public-browser-key'])
        c = dict(Id='a' * 64, Image='sha256:' + 'b' * 64, Config=config, State=dict(Running=True))
        image = dict(Id='sha256:' + 'c' * 64, RootFS=dict(Layers=['sha256:' + 'd' * 64]), Config=config | dict(Env=['PATH=/bin']))
        capture = dict(kind='ROOTFS_EXPORT_IMPORT', source_container=c['Id'], source_image=c['Image'], image_id=image['Id'],
                       rootfs_sha256='d' * 64, rootfs_diff_sha256=hashlib.sha256(b'unchanged').hexdigest(), runtime_environment=config['Env'],
                       application_files={'/build/package.json': 'e' * 64})
        m.verify_rootfs_capture(c, image, capture, b'unchanged', capture['application_files'])
        for changed in [capture | dict(source_container='e' * 64), capture | dict(rootfs_sha256='e' * 64),
                        capture | dict(runtime_environment=['PATH=/wrong'])]:
            with self.assertRaises(ValueError):
                m.verify_rootfs_capture(c, image, changed, b'unchanged', capture['application_files'])

    def test_full_rootfs_hash_detects_unlisted_dependency_changes_and_ignores_tar_order(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'rootfs_fingerprint',None)))
        def archive(rows):
            stream=io.BytesIO()
            with tarfile.open(fileobj=stream,mode='w') as tar:
                for name,data in rows:
                    entry=tarfile.TarInfo(name);entry.size=len(data);tar.addfile(entry,io.BytesIO(data))
            stream.seek(0);return stream
        rows=[('build/package.json',b'unchanged'),('build/node_modules/dependency.js',b'original')]
        self.assertEqual(m.rootfs_fingerprint(archive(rows)),m.rootfs_fingerprint(archive(list(reversed(rows)))))
        self.assertNotEqual(m.rootfs_fingerprint(archive(rows)),m.rootfs_fingerprint(archive([rows[0],(rows[1][0],b'modified')])) )

    def test_incomplete_package_cannot_create_a_restore_resource(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'restore', None)), 'full restore operation is required')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); package = root / 'partial'; package.mkdir(mode=0o700)
            with patch.object(m, 'Docker', side_effect=AssertionError('Docker must not run')) as docker:
                with self.assertRaisesRegex(ValueError, 'RECOVERY_INCOMPLETE'):
                    m.restore(package, root / 'restore', context='desktop-linux')
                docker.assert_not_called()
            self.assertFalse((root / 'restore').exists())

    def test_bootstrap_authentication_is_only_for_a_new_owner_then_requires_scram(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'hba_for_target', None)), 'new target bootstrap authentication is required')
        source = dict(sid='123', container_id='a' * 64, network_id='b' * 64, project='recycleyoungs-dev')
        target = dict(sid='456', container_id='c' * 64, network_id='d' * 64, project='recycleyoungs-dev-check-a1b2c3d4')
        self.assertEqual(m.hba_for_target(source, target, 'BOOTSTRAP'), 'local all all trust\nhost all ry_api_owner samenet trust\n')
        self.assertEqual(m.hba_for_target(source, target, 'VERIFIED'), 'local all all trust\nhost all all samenet scram-sha-256\n')
        with self.assertRaises(ValueError): m.hba_for_target(source, target | dict(sid='123'), 'BOOTSTRAP')

    def test_readers_cannot_start_before_full_restore_verification(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'start_readers', None)), 'verified reader activation is required')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            with patch.object(m, 'Docker', side_effect=AssertionError('Docker must not run')) as docker:
                with self.assertRaisesRegex(ValueError, 'RECOVERY_RESTORE_NOT_VERIFIED'):
                    m.start_readers(root, root / 'package', context='desktop-linux')
                docker.assert_not_called()

    def test_reader_http_coverage_uses_the_bound_release_quarters(self):
        """A newly published quarter must survive recovery HTTP verification."""
        from unittest.mock import MagicMock
        m=self.module();version='a'*64;project='recycleyoungs-dev-check-a1b2c3d4';nonce='a1b2c3d4'+'0'*16
        target=dict(project=project,container_id='b'*64,network_id='c'*64,sid='456')
        manifest=dict(source=dict(project='recycleyoungs-dev',container_id='d'*64,network_id='e'*64,sid='123',release_id=version),images={r:dict(image_id='sha256:'+str(i)*64) for i,r in enumerate(['proxy','backend','frontend'],1)})
        for observed in [23,22]:
            with self.subTest(observed=observed),tempfile.TemporaryDirectory() as folder:
                root=Path(folder).resolve();root.chmod(0o700);package=root/'package';package.mkdir(mode=0o700)
                records={root/'verified.json':dict(status='PASS',target=target,receipt=dict(manifest_sha256='f'*64)),
                    root/'readers-intent.json':dict(target=target,nonce=nonce,frontend_port=15177),
                    root/'worker.json':dict(id='worker'),package/'runtime.json':dict(state=dict(status='SUCCEEDED',release_id=version))}
                for path,value in records.items():path.write_text(json.dumps(value));path.chmod(0o600)
                docker=MagicMock()
                def inspect(kind,name):
                    role=next(role for role in ['inspect-proxy','api-backend','frontend'] if name==project+'-'+role+'-1')
                    image_role={'inspect-proxy':'proxy','api-backend':'backend','frontend':'frontend'}[role]
                    return dict(Id=role,Config=dict(Labels={m.LABEL:nonce,'com.docker.compose.project':project,'com.docker.compose.service':role}),State=dict(Running=True),Image=manifest['images'][image_role]['image_id'])
                docker.inspect.side_effect=inspect
                quarters=[str(y)+str(q) for y in range(2021,2027) for q in range(1,5) if y<2026 or q<=3]
                docker.execute.side_effect=lambda _client,script,*_args:dict(ready=True,quarters=observed) if script==m.HTTP_PROBE else dict(release_id=version,quarters=quarters)
                docker.run.return_value=json.dumps(records[package/'runtime.json']['state']).encode()
                with patch.object(m,'Docker',return_value=docker),patch.object(m,'verify_package',return_value=manifest),patch.object(m,'file_digest',return_value=dict(sha256='f'*64)):
                    if observed==23:self.assertEqual(m.verify_readers(root,package,context='test')['quarters'],23)
                    else:
                        with self.assertRaisesRegex(ValueError,'RECOVERY_HTTP_NOT_READY'):m.verify_readers(root,package,context='test')

    def test_restart_check_cannot_touch_an_unverified_target(self):
        m = self.module()
        self.assertTrue(callable(getattr(m, 'restart_check', None)))
        with tempfile.TemporaryDirectory() as d:
            with patch.object(m, 'Docker', side_effect=AssertionError('Docker must not run')) as docker:
                with self.assertRaisesRegex(ValueError, 'RECOVERY_RESTORE_NOT_VERIFIED'):
                    m.restart_check(Path(d).resolve(), context='desktop-linux')
                docker.assert_not_called()

    def test_internal_frontend_probe_preserves_the_local_host_restriction(self):
        m = self.module()
        self.assertIsInstance(getattr(m, 'HTTP_PROBE', None), str, 'reader probe must handle the local Host restriction')
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                code = 200 if self.headers.get('Host') == 'localhost' else 403
                self.send_response(code); self.end_headers()
                if code == 200: self.wfile.write(b'[1,2]')
            def log_message(self, *args): pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            out = io.StringIO()
            with patch('sys.stdin', io.StringIO(json.dumps({'url': 'http://127.0.0.1:' + str(server.server_port)}))), contextlib.redirect_stdout(out):
                exec(m.HTTP_PROBE, {})
            self.assertEqual(json.loads(out.getvalue()), dict(ready=True, quarters=2))
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
