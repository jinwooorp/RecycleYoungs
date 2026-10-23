"""Release-independent boundary inputs and immutable public report snapshots."""
import base64
import gzip
import hashlib
import importlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.request import Request


ROOT = Path(__file__).resolve().parents[2]
REPORTS = {
    'admin-report.json': (22454, '676671b3de305fe45d63f6fd7c6f3f5bbf1a23f01aa5da6e05ddaf3c8aa5fae3'),
    'commercial-report.json': (485933, '5f64f4fe6d59f3831e413ddd7a47490bb628a35b5c35ae44ca6b26b1148fdbd2'),
    'repair-report.json': (269967, '133b23b6ed9dc07fe8ba3f6801acc499f8232eef3f12b902d917e87d81716e74'),
}


class BoundaryDataTests(unittest.TestCase):
    def module(self):
        self.assertIsNotNone(importlib.util.find_spec('boundary_data'),
                             'current development needs Release-independent boundary inputs')
        return importlib.import_module('boundary_data')

    def test_public_reports_restore_exact_published_bytes(self):
        reports = self.module().report_bytes()
        self.assertEqual(set(reports), set(REPORTS))
        for name, (size, digest) in REPORTS.items():
            with self.subTest(name=name):
                self.assertEqual(len(reports[name]), size)
                self.assertEqual(hashlib.sha256(reports[name]).hexdigest(), digest)
                self.assertIsInstance(json.loads(reports[name]), dict)

    def test_reencoded_tampered_report_is_rejected(self):
        bundle = json.loads((ROOT / 'data/boundaries/public-reports.json').read_text())
        name = 'admin-report.json'
        payload = json.loads(gzip.decompress(base64.b64decode(bundle['reports'][name]['gzip_base64'])))
        payload['retirement_test_tamper'] = True
        changed = json.dumps(payload).encode()
        bundle['reports'][name].update(bytes=len(changed), sha256=hashlib.sha256(changed).hexdigest(),
                                      gzip_base64=base64.b64encode(gzip.compress(changed)).decode())
        with self.assertRaises(ValueError):
            self.module().report_bytes(bundle)

    def test_missing_report_is_rejected(self):
        bundle = json.loads((ROOT / 'data/boundaries/public-reports.json').read_text())
        del bundle['reports']['repair-report.json']
        with self.assertRaises(ValueError):
            self.module().report_bytes(bundle)

    def test_boundary_specs_keep_public_report_identities(self):
        specs = self.module().boundary_specs()
        self.assertEqual(specs['admin'].report_hashes, {'quality': REPORTS['admin-report.json'][1]})
        self.assertEqual(specs['commercial'].report_hashes, {
            'quality': REPORTS['commercial-report.json'][1], 'repair': REPORTS['repair-report.json'][1]})
        self.assertEqual(specs['admin'].feature_count, 425)
        self.assertEqual(specs['commercial'].feature_count, 1650)
        self.assertEqual(len(specs['commercial'].invalid_codes), 6)

    def test_download_accepts_only_verified_exact_bytes(self):
        module = self.module()
        url = module.DOWNLOADS['admin']['url']
        data = b'fixed-public-boundary'
        digest = hashlib.sha256(data).hexdigest()
        opener = lambda request, **kwargs: io.BytesIO(data)
        self.assertEqual(module.download_verified(url, len(data), digest, opener=opener), data)
        for size, sha in [(len(data) - 1, digest), (len(data) + 1, digest), (len(data), '0' * 64)]:
            with self.subTest(size=size, sha=sha):
                with self.assertRaises(ValueError):
                    module.download_verified(url, size, sha, opener=opener)

    def test_insecure_or_unrelated_download_and_redirect_are_rejected(self):
        module = self.module()
        valid = module.DOWNLOADS['admin']['url']
        invalid = [valid.replace('https:', 'http:'),
                   valid.replace('datafile.seoul.go.kr', 'example.com'),
                   valid.replace('datafile.seoul.go.kr', 'user@datafile.seoul.go.kr'),
                   valid.replace('nio_download.do', 'other.do')]
        for url in invalid:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    module.download_verified(url, 1, '0' * 64, opener=lambda *a, **k: self.fail('network used'))
                with self.assertRaises(ValueError):
                    module.OfficialRedirects().redirect_request(Request(valid), None, 302, '', {}, url)

    def test_existing_boundary_input_is_never_overwritten(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            (path / 'admin.zip').write_bytes(b'existing-original')
            with self.assertRaises(FileExistsError):
                module.prepare_boundaries(path, downloader=lambda *a: self.fail('network used'))
            self.assertEqual((path / 'admin.zip').read_bytes(), b'existing-original')
            self.assertFalse((path / 'commercial.zip').exists())


if __name__ == '__main__':
    unittest.main()
