"""Full recovery packages are sealed, private and distinct from the live target."""
import hashlib
import importlib
import io
import json
import os
import stat
from unittest.mock import patch
from pathlib import Path
import tarfile
import tempfile
import unittest


class RecoveryTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module('dev_recovery')
        except ModuleNotFoundError:
            self.fail('full recovery package implementation is missing')

    def fixture(self, root):
        root.chmod(0o700)
        names = ['database.dump', 'snapshot.json', 'roles.json', 'data.tar', 'control.tar', 'reader.tar', 'writer.tar', 'runtime.json', 'frontend-source.tar']
        images = {}
        for index, role in enumerate(['db', 'worker', 'backend', 'frontend', 'proxy', 'migrator']):
            name = role + '-image.tar'; names.append(name)
            images[role] = dict(image_id='sha256:' + str(index + 1) * 64, file=name)
        artifacts = {}
        for name in names:
            data = name.encode(); p = root / name; p.write_bytes(data); p.chmod(0o600)
            artifacts[name] = dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        return dict(schema_version=1, kind='FULL_LOCAL_DEV_RECOVERY', created_at='2026-10-24T00:00:00+00:00',
                    source=dict(project='recycleyoungs-dev', owner='a' * 24, sid='123456', container_id='b' * 64,
                                network_id='c' * 64, release_id='d' * 64, exported_snapshot='00000003-00000001-1'),
                    artifacts=artifacts, images=images)

    def test_missing_module_is_a_failed_recovery_contract(self):
        self.assertTrue(callable(getattr(self.module(), 'verify_package', None)))

    def test_exclusive_receipt_syncs_file_then_directory_before_returning(self):
        m=self.module();sync=os.fsync;events=[]
        def checked(fd):
            events.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')
            sync(fd)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            with patch.object(m.os,'fsync',side_effect=checked):
                m.exclusive_json(root/'verified.json',dict(status='PASS'))
            self.assertEqual(events,['file','directory'])

    def test_directory_sync_failure_cannot_report_a_durable_receipt(self):
        m=self.module();sync=os.fsync
        def unavailable(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):raise OSError('injected directory sync failure')
            sync(fd)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            with patch.object(m.os,'fsync',side_effect=unavailable):
                with self.assertRaises(OSError):m.exclusive_json(root/'verified.json',dict(status='PASS'))

    def test_seal_then_readback_verifies_every_artifact(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); manifest = self.fixture(root)
            digest = m.seal_package(root, manifest)
            self.assertEqual(m.verify_package(root)['source']['sid'], '123456')
            self.assertEqual(json.loads((root / 'complete.json').read_text())['manifest_sha256'], digest)

    def test_partial_package_is_not_usable(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); self.fixture(root)
            with self.assertRaisesRegex(ValueError, 'RECOVERY_INCOMPLETE'):
                m.verify_package(root)

    def test_local_failure_notice_never_records_exception_details(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'failure_notice',None)))
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();root.chmod(0o700)
            m.failure_notice(root,'RESTORE',ValueError('password=private-key https://secret'))
            notices=list(root.glob('failure-notice-*.json'))
            self.assertEqual(len(notices),1)
            value=json.loads(notices[0].read_text())
            self.assertEqual(value['code'],'RECOVERY_OPERATION_FAILED')
            self.assertFalse(value['automatic_retry'])
            self.assertNotIn('private-key',notices[0].read_text())

    def test_retention_proposal_keeps_minimum_backups_and_never_deletes(self):
        m=self.module()
        self.assertTrue(callable(getattr(m,'retention_proposal',None)))
        records=[dict(package=f'backup-{i}',created_at=f'2026-01-{i+1:02d}T00:00:00+00:00',bytes=100) for i in range(5)]
        result=m.retention_proposal(records,now='2026-10-24T00:00:00+00:00',minimum=3,days=14)
        self.assertEqual(result['keep'],['backup-4','backup-3','backup-2'])
        self.assertEqual(result['review_for_removal'],['backup-1','backup-0'])
        self.assertFalse(result['deletion_performed'])

    def test_default_retention_proposes_only_last_verified_set_even_when_recent(self):
        m=self.module()
        rows=[dict(package=f'backup-{i}',created_at=f'2026-10-2{i}T00:00:00+00:00',bytes=100) for i in range(3)]
        result=m.retention_proposal(rows,now='2026-10-23T00:00:00+00:00')
        self.assertEqual(result['keep'],['backup-2'])
        self.assertEqual(result['review_for_removal'],['backup-1','backup-0'])
        self.assertFalse(result['deletion_performed'])

    def test_changed_bytes_after_seal_are_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); manifest = self.fixture(root); m.seal_package(root, manifest)
            (root / 'data.tar').write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'RECOVERY_ARTIFACT_CHANGED'):
                m.verify_package(root)

    def test_unlisted_artifact_and_world_readable_file_are_rejected(self):
        m = self.module()
        for change in ['extra', 'permissions']:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as d:
                root = Path(d).resolve(); manifest = self.fixture(root)
                if change == 'extra':
                    (root / 'secret-copy').write_text('extra')
                else:
                    (root / 'reader.tar').chmod(0o644)
                with self.assertRaises(ValueError):
                    m.seal_package(root, manifest)

    def test_symlinked_artifact_or_root_is_rejected(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve() / 'real'; root.mkdir(); manifest = self.fixture(root)
            (root / 'data.tar').unlink(); (root / 'data.tar').symlink_to(root / 'control.tar')
            with self.assertRaisesRegex(ValueError, 'RECOVERY_SYMLINK'):
                m.seal_package(root, manifest)

    def test_live_identity_cannot_be_adopted_as_a_restore(self):
        m = self.module()
        source = dict(sid='123', container_id='a' * 64, network_id='b' * 64, project='recycleyoungs-dev')
        fresh = dict(sid='456', container_id='c' * 64, network_id='d' * 64, project='recycleyoungs-dev-check-1234abcd')
        m.require_new_target(source, fresh)
        for key in source:
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.require_new_target(source, fresh | {key: source[key]})

    def test_archive_paths_links_and_devices_cannot_escape_new_root(self):
        m = self.module()
        for name, kind in [('../escape', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE), ('link', tarfile.SYMTYPE), ('device', tarfile.CHRTYPE)]:
            with self.subTest(name=name):
                value = io.BytesIO()
                with tarfile.open(fileobj=value, mode='w') as tar:
                    info = tarfile.TarInfo(name); info.type = kind; info.size = 0
                    tar.addfile(info)
                with tempfile.TemporaryDirectory() as d:
                    archive = Path(d) / 'data.tar'; archive.write_bytes(value.getvalue())
                    with self.assertRaisesRegex(ValueError, 'RECOVERY_ARCHIVE_REJECTED'):
                        m.verify_archive(archive)

    def test_archive_ordinary_dot_relative_paths_are_accepted(self):
        m = self.module(); value = io.BytesIO()
        with tarfile.open(fileobj=value, mode='w') as tar:
            tar.addfile(tarfile.TarInfo('./'))
            info = tarfile.TarInfo('./runs/file'); info.size = 3
            tar.addfile(info, io.BytesIO(b'raw'))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'data.tar'; p.write_bytes(value.getvalue())
            self.assertEqual(m.verify_archive(p), 2)

    def test_seal_is_exclusive_and_failure_never_reuses_package(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); manifest = self.fixture(root); m.seal_package(root, manifest)
            with self.assertRaises(ValueError):
                m.seal_package(root, manifest)

    def test_running_frontend_host_source_cannot_be_missing_from_full_backup(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); manifest = self.fixture(root)
            manifest['artifacts'].pop('frontend-source.tar'); (root / 'frontend-source.tar').unlink()
            with self.assertRaisesRegex(ValueError, 'RECOVERY_ARTIFACT_SET_REJECTED'):
                m.seal_package(root, manifest)


if __name__ == '__main__':
    unittest.main()
