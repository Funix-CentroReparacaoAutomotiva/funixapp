"""Regression tests: HML TLS edge convergence must not weaken the auth contract.

This module uses an in-memory HTTP fake. It never calls production/HML networks,
Docker, the updater transaction, or credential stores.
"""
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


UPDATER_PATH = Path(__file__).resolve().parents[1] / "hml-update.py"
spec = importlib.util.spec_from_file_location("hml_update_transition_test", UPDATER_PATH)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
REVISION = "a" * 40
ROUTES = {"/", "/api/ready", "/release.json", "/healthz"}


class FakeResponse:
    def __init__(self, status, body=b"", challenge=True):
        self.status = status
        self.body = body
        self.challenge = challenge
        self.offset = 0
        self.length = len(body)

    def getheader(self, name, default=""):
        if name.lower() == "www-authenticate" and self.status == 401 and self.challenge:
            return 'Basic realm="HML"'
        return default

    def read1(self, amount):
        result = self.body[self.offset:self.offset + amount]
        self.offset += len(result)
        self.length = len(self.body) - self.offset
        return result


class TestHmlHttpsTransition(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.normal = root / "normal.json"
        self.temporary = root / "maintenance.json"
        self.normal.write_text(json.dumps({"username": "normal", "password": "normal-test-only"}))
        self.temporary.write_text(json.dumps({"username": "maintenance", "password": "maintenance-test-only"}))
        self.normal_token = updater.read_login(self.normal)
        self.temporary_token = updater.read_login(self.temporary)
        self.calls = []

    def response(self, method, endpoint, headers):
        auth = headers.get("Authorization")
        if method == "GET" and endpoint in ROUTES:
            if auth == self.temporary_token:
                payload = b""
                if endpoint in ("/api/ready", "/release.json"):
                    payload = json.dumps({
                        "revision": REVISION,
                        **({"status": "ready"} if endpoint == "/api/ready" else {}),
                    }).encode()
                return FakeResponse(200, payload)
            return FakeResponse(401)
        return FakeResponse(503)

    def validate(self, override=None):
        owner = self
        class FakeHTTPSConnection:
            def __init__(self, host, timeout, context):
                assert host == "hml.funix.com.br"
                self.sock = None
                self.request_args = None

            def request(self, method, endpoint, headers=None):
                self.request_args = (method, endpoint, headers or {})

            def getresponse(self):
                method, endpoint, headers = self.request_args
                owner.calls.append((method, endpoint, headers.get("Authorization")))
                if override is not None:
                    result = override(method, endpoint, headers)
                    if result is not None:
                        return result
                return owner.response(method, endpoint, headers)

            def close(self):
                pass

        logs = io.StringIO()
        with patch.object(updater.http.client, "HTTPSConnection", FakeHTTPSConnection), \
             patch.object(updater.ssl, "create_default_context", return_value=object()), \
             patch.object(updater.time, "sleep", return_value=None), \
             contextlib.redirect_stderr(logs):
            try:
                updater.validator(self.temporary, normal_credentials=self.normal)(
                    {"revision": REVISION})
            except Exception:
                self.last_log = logs.getvalue()
                raise
        self.last_log = logs.getvalue()

    def test_edge_503_on_expected_401_retries_until_available(self):
        remaining = [4]

        def edge(method, endpoint, headers):
            if method == "GET" and endpoint == "/" and not headers and remaining[0]:
                remaining[0] -= 1
                return FakeResponse(503)
            return None

        self.validate(edge)
        self.assertEqual(remaining[0], 0)
        self.assertIn("category=transient retry=true", self.last_log)
        self.assertNotIn("category=contract", self.last_log)
        self.assertGreaterEqual(len(self.calls), 29)

    def test_edge_502_on_denied_route_retries_but_never_accepts_502(self):
        remaining = [1]

        def edge(method, endpoint, headers):
            if method == "GET" and endpoint == "/api/session" and remaining[0]:
                remaining[0] -= 1
                return FakeResponse(502)
            return None

        self.validate(edge)
        self.assertIn("category=transient retry=true", self.last_log)
        self.assertEqual(remaining[0], 0)

    def test_unauthenticated_success_is_not_retried(self):
        def unsafe(method, endpoint, headers):
            if method == "GET" and endpoint == "/" and not headers:
                return FakeResponse(200)
            return None

        with self.assertRaisesRegex(ValueError, "contract"):
            self.validate(unsafe)
        self.assertEqual(len(self.calls), 1)
        self.assertIn("category=contract retry=false", self.last_log)

    def test_missing_basic_challenge_is_not_retried(self):
        def unsafe(method, endpoint, headers):
            if method == "GET" and endpoint == "/" and not headers:
                return FakeResponse(401, challenge=False)
            return None

        with self.assertRaisesRegex(ValueError, "Basic challenge"):
            self.validate(unsafe)
        self.assertEqual(len(self.calls), 1)
        self.assertIn("category=contract retry=false", self.last_log)

    def test_wrong_revision_is_not_retried(self):
        def stale(method, endpoint, headers):
            if method == "GET" and endpoint == "/release.json" \
                    and headers.get("Authorization") == self.temporary_token:
                return FakeResponse(200, json.dumps({"revision": "b" * 40}).encode())
            return None

        with self.assertRaisesRegex(ValueError, "revision mismatch"):
            self.validate(stale)
        self.assertLessEqual(len(self.calls), 16)
        self.assertIn("category=contract retry=false", self.last_log)


if __name__ == "__main__":
    unittest.main()
