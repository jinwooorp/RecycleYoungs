"""A scheduler must not overlap jobs or accept a writable shared lock file."""
import importlib
import importlib.util
from pathlib import Path
import tempfile
import unittest


class RefreshJobTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('app.api_refresh_job'),'bounded scheduled job required')
        return importlib.import_module('app.api_refresh_job')

    def test_overlapping_job_is_rejected_and_lock_is_reusable_after_exit(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with m.job_lock(root):
                with self.assertRaisesRegex(m.CollectionError,'REFRESH_ALREADY_RUNNING'):
                    with m.job_lock(root): self.fail('overlap accepted')
            with m.job_lock(root): pass
            self.assertEqual((root/'refresh.lock').stat().st_mode&0o777,0o600)

    def test_shared_or_symlink_lock_is_rejected_without_overwriting(self):
        m=self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); lock=root/'refresh.lock'; lock.write_text('preserve'); lock.chmod(0o644)
            with self.assertRaisesRegex(m.CollectionError,'PRIVATE_JOB_LOCK_REQUIRED'):
                with m.job_lock(root): self.fail('shared lock accepted')
            self.assertEqual(lock.read_text(),'preserve')


if __name__=='__main__': unittest.main()
