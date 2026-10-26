"""Run the shared setup implementation against disposable public templates only."""
import importlib.util
from pathlib import Path
import tempfile
import unittest


class SetupTests(unittest.TestCase):
    def module(self):
        path=Path(__file__).resolve().parents[2]/'docker/api/setup_env.py'
        self.assertTrue(path.is_file(),'shared Compose setup implementation required')
        spec=importlib.util.spec_from_file_location('setup_env',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def fixture(self,root):
        for directory,name in [('etl','api.env'),('frontend','.env.local')]:
            folder=root/directory;folder.mkdir()
            (folder/(name+'.example')).write_bytes(b'KEY=\r\n')

    def test_setup_handles_spaces_unicode_and_never_overwrites_existing_settings(self):
        m=self.module()
        with tempfile.TemporaryDirectory(prefix='setup 한글 space ') as d:
            root=Path(d).resolve();self.fixture(root)
            m.prepare(root)
            self.assertEqual((root/'etl/api.env').read_bytes(),b'KEY=\n')
            self.assertEqual((root/'etl/api.env').stat().st_mode&0o777,0o600)
            path=root/'frontend/.env.local';path.write_bytes(b'KEEP=exact\r\n')
            before=[(p,p.stat().st_mtime_ns,p.read_bytes()) for p in [root/'etl/api.env',path]]
            m.prepare(root)
            for p,mtime,raw in before:
                self.assertEqual((p.stat().st_mtime_ns,p.read_bytes()),(mtime,raw))

    def test_setup_rejects_symlinks_and_directories_without_touching_targets(self):
        m=self.module()
        for kind in ['file-link','directory-link','directory']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as d:
                root=Path(d).resolve();self.fixture(root);external=root/'external';external.write_bytes(b'KEEP')
                path=root/'etl/api.env'
                if kind=='file-link':path.symlink_to(external)
                elif kind=='directory':path.mkdir()
                else:
                    (root/'elsewhere').mkdir();(root/'etl').rename(root/'elsewhere/etl')
                    (root/'etl').symlink_to(root/'elsewhere/etl',target_is_directory=True)
                with self.assertRaises(ValueError):m.prepare(root)
                self.assertEqual(external.read_bytes(),b'KEEP')


if __name__=='__main__':unittest.main()
