"""Regression for the HML-only Docker healthcheck validated on the VPS."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class GatewayHealthcheckTest(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / "hml-gateway-healthcheck.compose.json"
        self.config = json.loads(path.read_text(encoding="utf-8"))
        self.health = self.config["services"]["gateway"]["healthcheck"]

    def test_override_scope_and_exact_validated_contract(self):
        self.assertEqual(set(self.config), {"services"})
        self.assertEqual(set(self.config["services"]), {"gateway"})
        self.assertEqual(set(self.config["services"]["gateway"]), {"healthcheck"})
        self.assertEqual(self.health, {
            "test": ["CMD-SHELL", "wget -S -O /dev/null http://127.0.0.1:8080/healthz 2>&1 | grep -q ' 401 '"],
            "interval": "6s", "timeout": "5s", "retries": 3, "start_period": "15s",
        })

    def test_shell_accepts_401_and_rejects_other_results(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "wget"
            fake.write_text('#!/bin/sh\nprintf "%s\\n" "$MOCK_RESPONSE" >&2\nexit "$MOCK_EXIT"\n', encoding="utf-8")
            fake.chmod(0o700)
            for response, code, expected in (
                ("  HTTP/1.1 401 Unauthorized", "8", True),
                ("  HTTP/1.1 200 OK", "0", False),
                ("  HTTP/1.1 404 Not Found", "8", False),
                ("  HTTP/1.1 500 Internal Server Error", "8", False),
                ("wget: connection refused", "1", False),
            ):
                with self.subTest(response=response):
                    env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"],
                               MOCK_RESPONSE=response, MOCK_EXIT=code)
                    result = subprocess.run(["sh", "-c", self.health["test"][1]],
                                            env=env, capture_output=True, timeout=5)
                    self.assertEqual(result.returncode == 0, expected)
