import contextlib
import importlib
import importlib.util
from http.client import IncompleteRead
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError

from api_fixtures import FakeClient, seoul, stats


class RuntimeTests(unittest.TestCase):
    def module(self, name):
        self.assertIsNotNone(importlib.util.find_spec("app." + name),
                             "DB-free API runtime is required")
        return importlib.import_module("app." + name)

    def test_http_exact_json_and_bounded_retry(self):
        m = self.module("api_http")
        responses = [(429, b""), (503, b""), (200, b'{"amount":9007199254740993.0}')]
        sleeps = []
        client = m.HttpClient(transport=lambda url, timeout: responses.pop(0), sleep=sleeps.append)
        data, raw = client.get_json("https://example.test/", secret="synthetic-key")
        self.assertEqual(str(data["amount"]), "9007199254740993.0")
        self.assertEqual(len(sleeps), 2)

    def test_http_errors_never_expose_response_url_or_key(self):
        m = self.module("api_http")
        e = self.module("api_records").CollectionError
        for status, body in [(401, b"secret"), (302, b"secret"), (200, b"<xml>secret</xml>"),
                             (200, b'{"echo":"synthetic-key"}'), (200, b'{"x":NaN}'),
                             (200, b'{"x":1,"x":2}')]:
            client = m.HttpClient(transport=lambda u, t: (status, body), sleep=lambda t: None)
            with self.subTest(status=status, body=body), self.assertRaises(e) as failure:
                client.get_json("https://example.test/synthetic-key", secret="synthetic-key")
            self.assertNotIn("synthetic-key", str(failure.exception))
            self.assertNotIn("secret", str(failure.exception))
        calls = []
        def fail(url, timeout):
            calls.append(url)
            raise URLError("synthetic-key")
        with self.assertRaises(e) as failure:
            m.HttpClient(transport=fail, sleep=lambda t: None).get_json("https://example.test/", secret="synthetic-key")
        self.assertEqual(len(calls), 3)
        self.assertNotIn("synthetic-key", str(failure.exception))

    def test_truncated_transport_response_is_retried_without_exposing_body(self):
        m = self.module("api_http")
        calls = []
        def truncated(url, timeout):
            calls.append(url)
            if len(calls) == 1:
                raise IncompleteRead(b"synthetic-key", 20)
            return 200, b'{"ok":true}'
        result, _ = m.HttpClient(transport=truncated, sleep=lambda t: None).get_json(
            "https://example.test/", secret="synthetic-key")
        self.assertTrue(result["ok"])
        self.assertEqual(len(calls), 2)

    def test_transport_refuses_redirect_and_limits_body_read(self):
        m = self.module("api_http")
        self.assertIsNone(m.NoRedirect().redirect_request(None, None, 302, None, None, "https://elsewhere.test/"))
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{}'
        with patch.object(m, "build_opener") as factory:
            factory.return_value.open.return_value = response
            self.assertEqual(m.request("https://example.test/", 20), (200, b'{}'))
        response.read.assert_called_once_with(m.MAX_BYTES + 1)

    def test_config_init_private_no_overwrite_and_no_source_execution(self):
        m = self.module("api_config")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "private" / "api.env"
            m.init_config(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            original = path.read_bytes()
            with self.assertRaises(m.CollectionError): m.init_config(path)
            self.assertEqual(path.read_bytes(), original)
            path.write_text("SEOUL_OPENAPI_KEY=synthetic-key\nSEMAS_SERVICE_KEY=a+/=\n")
            config = m.load_keys(path, environ={})
            self.assertEqual(config["SEMAS_SERVICE_KEY"], "a+/=")
            path.write_text("SEOUL_OPENAPI_KEY=$(touch SHOULD_NOT_EXIST)\n")
            with self.assertRaises(m.CollectionError): m.load_keys(path, environ={})
            self.assertFalse((path.parent / "SHOULD_NOT_EXIST").exists())

    def test_config_rejects_symlink_permissions_and_project_path(self):
        m = self.module("api_config")
        with self.assertRaises(m.CollectionError): m.init_config(m.PROJECT_ROOT / "must-not-create.env")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "api.env"; path.write_text("SEOUL_OPENAPI_KEY=key\n"); path.chmod(0o644)
            with self.assertRaises(m.CollectionError): m.load_keys(path, environ={})
            path.chmod(0o600)
            link = Path(tmp) / "alias.env"; link.symlink_to(path)
            with self.assertRaises(m.CollectionError): m.load_keys(link, environ={})

    def test_explicit_project_etl_key_file_is_allowed_but_artifacts_stay_private(self):
        m = self.module("api_config")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "etl").mkdir(mode=0o755)
            (root / ".git").mkdir()
            (root / "etl" / "api.env.example").write_text("SEOUL_OPENAPI_KEY=\nSEMAS_SERVICE_KEY=\n")
            path = root / "etl" / "api.env"
            with patch.object(m, "PROJECT_ROOT", root):
                m.init_config(path)
                self.assertEqual(m.load_keys(path, environ={})["SEOUL_OPENAPI_KEY"], "")
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(m.CollectionError): m.private_parent(path)
                with self.assertRaises(m.CollectionError): m.init_config(root / "other.env")

    def test_keys_from_environment_and_encoded_semas_key_rejection(self):
        m = self.module("api_config")
        self.assertEqual(m.load_keys(None, environ={"SEOUL_OPENAPI_KEY": "key"})["SEOUL_OPENAPI_KEY"], "key")
        with self.assertRaises(m.CollectionError):
            m.load_keys(None, environ={"SEMAS_SERVICE_KEY": "a%2Bb%3D"})

    def test_artifacts_stream_hash_and_never_publish(self):
        a = self.module("api_artifacts"); s = self.module("seoul_api")
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "run"
            pages = s.pages(FakeClient(seoul([stats()])), "stores", "20251", "key")
            result = a.write_run(output, pages, source="seoul-stores", scope={"quarter": "20251"}, mode="collect")
            self.assertEqual(result["status"], "COLLECTED_UNPUBLISHED")
            self.assertFalse(result["published"])
            self.assertEqual(result["received_count"], 1)
            self.assertEqual(len(result["normalized_sha256"]), 64)
            self.assertEqual(len(list((output / "pages").glob("*.json"))), 1)
            self.assertEqual(json.loads((output / "normalized.jsonl").read_text())["store_count"], "10")
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all(x.stat().st_mode & 0o777 == 0o600 for x in output.rglob('*') if x.is_file()))
            with self.assertRaises(a.CollectionError):
                a.write_run(output, iter(()), source="seoul-stores", scope={}, mode="collect")
            self.assertEqual(json.loads((output / "manifest.json").read_text())["status"], "COLLECTED_UNPUBLISHED")

    def test_probe_empty_duplicate_and_partial_failure_status(self):
        a = self.module("api_artifacts"); s = self.module("seoul_api")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = a.write_run(root / "probe", s.pages(FakeClient(seoul([stats()], 10)), "stores", "20251", "key", page_size=1, probe=True), source="seoul-stores", scope={}, mode="probe")
            self.assertEqual(result["status"], "PROBE_ONLY")
            self.assertFalse(result["complete"])
            result = a.write_run(root / "empty", s.pages(FakeClient({"RESULT": {"CODE": "INFO-200"}}), "stores", "20251", "key"), source="seoul-stores", scope={}, mode="collect")
            self.assertEqual(result["status"], "EMPTY_UNPUBLISHED")
            self.assertFalse(result["complete"])
            pages = s.pages(FakeClient(seoul([stats()], 2), seoul([stats()], 2)), "stores", "20251", "key", page_size=1)
            with self.assertRaises(a.CollectionError):
                a.write_run(root / "duplicate", pages, source="seoul-stores", scope={}, mode="collect")
            failed = json.loads((root / "duplicate" / "manifest.json").read_text())
            self.assertEqual(failed["status"], "FAILED")
            self.assertFalse(failed["complete"])
            self.assertTrue((root / "duplicate" / "pages" / "000001.json").exists())

    def test_cli_help_config_status_and_db_free_probe(self):
        m = self.module("collect_main")
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as exit:
            m.main(["--help"])
        self.assertEqual(exit.exception.code, 0)
        with patch.dict(os.environ, {"SEOUL_OPENAPI_KEY": "synthetic-key"}, clear=True), contextlib.redirect_stdout(out):
            self.assertEqual(m.main(["check-config"]), 2)
        self.assertNotIn("synthetic-key", out.getvalue())
        with tempfile.TemporaryDirectory() as tmp:
            fixture = seoul([stats(ADSTRD_CD=str(11110515 + i)) for i in range(5)], 10)
            with patch.dict(os.environ, {"SEOUL_OPENAPI_KEY": "synthetic-key"}, clear=True), patch.object(m, "HttpClient", return_value=FakeClient(fixture)), contextlib.redirect_stdout(out):
                self.assertEqual(m.main(["probe", "seoul-stores", "--quarter", "20251", "--output", str(Path(tmp) / "run")]), 0)
        self.assertNotIn("synthetic-key", out.getvalue())


if __name__ == "__main__":
    unittest.main()
