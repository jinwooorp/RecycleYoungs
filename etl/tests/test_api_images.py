"""Source-built runtime boundaries; no Docker, database or credentials."""
import importlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class ImageTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('api_images'), 'source image builder required')
        return importlib.import_module('api_images')

    def test_context_excludes_secrets_local_outputs_and_private_data(self):
        m = self.module()
        names = set(m.context_files(m.ROOT))
        self.assertIn('backend/gradlew', names)
        self.assertIn('frontend/package-lock.json', names)
        self.assertTrue('frontend/src/data/seoul-boundary.json' in names, 'frontend build requires the tracked outline')
        self.assertIn('etl/api_worker.py', names)
        self.assertIn('docker/api/Dockerfile', names)
        self.assertFalse(any(p == 'etl/api.env' or '/.env' in p or p.startswith(('.git/', '.codex-local/', 'data/raw/'))
                             or '/node_modules/' in p or '/build/' in p for p in names))

    def test_source_fingerprint_tracks_content_and_rejects_symlinks(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); (root/'one').write_text('original')
            first = m.fingerprint(root, ['one'])
            (root/'one').write_text('changed')
            self.assertNotEqual(first, m.fingerprint(root, ['one']))
            (root/'link').symlink_to(root/'one')
            with self.assertRaisesRegex(ValueError, 'BUILD_CONTEXT_SYMLINK'):
                m.fingerprint(root, ['link'])

    def manifest(self, m):
        return dict(format=1, platform='linux/amd64', source=m.source_fingerprint(),
                    images={role: 'sha256:' + str(i)*64 for i, role in enumerate(m.ROLES, 1)})

    def test_manifest_rejects_missing_roles_mutable_tags_and_wrong_source(self):
        m = self.module(); value = self.manifest(m)
        self.assertEqual(m.validate_manifest(value, source=True), value)
        for changed in [value | {'source': 'a'*64}, value | {'platform': 'linux/arm64'},
                        value | {'images': {**value['images'], 'worker': 'worker:latest'}},
                        value | {'images': {k:v for k,v in value['images'].items() if k != 'backend'}}]:
            with self.assertRaises(ValueError): m.validate_manifest(changed, source=True)

    def test_legacy_home_keeps_its_images_without_reading_private_files(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            with patch.object(m, 'load_manifest', side_effect=AssertionError('legacy must not load new manifest')):
                self.assertIsNone(m.home_manifest(Path(d)))

    def test_recorded_manifest_hash_cannot_be_silently_changed(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as d:
            home=Path(d).resolve(); value=self.manifest(m)
            (home/'images.json').write_text(json.dumps(value)); (home/'images.json').chmod(0o600)
            original=m.manifest_hash(value)
            self.assertEqual(m.home_manifest(home, expected=original), value)
            (home/'images.json').write_text(json.dumps(value | {'source':'a'*64}))
            with self.assertRaisesRegex(ValueError, 'IMAGE_MANIFEST_CHANGED'):
                m.home_manifest(home, expected=original)

    def test_source_built_compose_does_not_need_host_jar_or_code_mounts(self):
        m = self.module()
        from api_dev import compose
        with tempfile.TemporaryDirectory() as d:
            home=Path(d).resolve(); value=self.manifest(m)
            (home/'images.json').write_text(json.dumps(value)); (home/'images.json').chmod(0o600)
            with patch('api_dev.run', return_value=b'') as command:
                compose(home, 'config', '--quiet')
            args=command.call_args.args[0]
            self.assertIn(str(m.ROOT/'docker-compose.api.images.yml'), args)
            self.assertEqual(command.call_args.kwargs['env']['API_BACKEND_IMAGE'], value['images']['backend'])

    def test_initialization_requires_image_manifest_before_creating_home(self):
        self.module()
        from api_dev import init
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as d:
            home=Path(d).resolve()/'new-home'
            with patch('api_dev.inspect', side_effect=AssertionError('must fail before Docker')):
                with self.assertRaisesRegex(ValueError, 'BUILD_IMAGES_FIRST'):
                    init(home, Namespace(images=None))
            self.assertFalse(home.exists())

    def test_new_db_allows_only_its_owned_readonly_password_mount(self):
        self.module()
        import api_dev
        self.assertTrue(hasattr(api_dev, 'verify_db_mounts'), 'DB secret mount guard required')
        home=Path('/approved/private'); target={'volume':'owned-db'}
        volume=dict(Type='volume',Name='owned-db',Destination='/var/lib/postgresql/data',RW=True)
        secret=dict(Type='bind',Source=str(home/'owner-password'),Destination='/run/secrets/owner-password',RW=False)
        api_dev.verify_db_mounts([volume],target,home,False)
        api_dev.verify_db_mounts([volume,secret],target,home,True)
        for mounts,new in [([volume,secret],False),([volume],True),([volume,secret|{'RW':True}],True),
                           ([volume,secret|{'Source':'/other/password'}],True),([volume,secret,secret],True)]:
            with self.assertRaises(ValueError): api_dev.verify_db_mounts(mounts,target,home,new)

    def test_multiplatform_index_and_platform_config_ids_can_differ(self):
        m=self.module(); value=self.manifest(m)
        from types import SimpleNamespace
        def inspect(args, **kwargs):
            image=args[-1]; role=next(k for k,v in value['images'].items() if v==image)
            platform='--platform' in args
            obj=dict(Id='sha256:'+'f'*64 if platform else image,Os='linux',Architecture='amd64' if platform else 'arm64',
                     RepoDigests=[m.UPSTREAM[role]] if role in m.UPSTREAM else [],
                     Config={'Labels':{'org.recycleyoungs.source':value['source'],'org.recycleyoungs.role':role}})
            return SimpleNamespace(returncode=0,stdout=json.dumps([obj]).encode())
        with patch.object(m.subprocess,'run',side_effect=inspect): m.verify_images(value)


if __name__ == '__main__': unittest.main()
