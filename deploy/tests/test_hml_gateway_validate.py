"""Regression tests for the read-only HML gateway revision validator."""

import importlib.util
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "hml_gateway_validate", ROOT / "deploy/hml-gateway-validate.py"
)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)

REVISION = "8e801e9b0a8fc1fe5feec40d533d9e639e8b013b"


class HmlGatewayValidatorTests(unittest.TestCase):
    def test_http_request_uses_host_and_basic_auth_without_changing_payload(self):
        expected_auth = "Basic " + base64.b64encode(b"homologacao:synthetic").decode()

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get("Host") != "hml.funix.com.br" or self.headers.get("Authorization") != expected_auth:
                    self.send_response(401)
                    self.end_headers()
                    return
                body = (f'{{"revision":"{REVISION}"}}').encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(worker.join, 2)
        self.addCleanup(server.shutdown)
        payload = VALIDATOR.request_json(
            "http",
            "127.0.0.1",
            server.server_port,
            "hml.funix.com.br",
            "/release.json",
            ("homologacao", "synthetic"),
            2,
        )
        self.assertEqual(payload, {"revision": REVISION})

    def test_observed_values_do_not_reproduce_original_failure(self):
        revision = REVISION
        api_data = {
            "status": "ready",
            "revision": REVISION,
            "source": "app",
            "storage": "sqlite",
        }
        web_data = {"revision": REVISION}
        self.assertTrue(api_data.get("revision") == revision)
        self.assertTrue(web_data.get("revision") == revision)
        VALIDATOR.validate_revisions(
            revision, api_data.get("revision"), web_data.get("revision")
        )

    def test_diagnostics_show_complete_values_types_lengths_and_comparisons(self):
        web = "f" * 40
        lines = VALIDATOR.revision_diagnostics(REVISION, REVISION, web)
        self.assertEqual(
            lines,
            [
                f"revision source=release.env type=str length=40 value='{REVISION}'",
                f"revision source=/api/ready type=str length=40 value='{REVISION}'",
                f"revision source=/release.json type=str length=40 value='{web}'",
                "revision comparisons api==release:True web==release:False api==web:False",
            ],
        )
        with self.assertRaisesRegex(
            VALIDATOR.ValidationError, "revisao divergente.*?/release.json"
        ):
            VALIDATOR.validate_revisions(REVISION, REVISION, web)

    def test_diagnostics_make_hidden_character_and_type_difference_visible(self):
        lines = VALIDATOR.revision_diagnostics(REVISION, REVISION + " ", None)
        self.assertIn("type=str length=41", lines[1])
        self.assertIn("value='" + REVISION + " '", lines[1])
        self.assertIn("type=NoneType length=n/a value=None", lines[2])
        with self.assertRaisesRegex(
            VALIDATOR.ValidationError, r"/api/ready, /release.json"
        ):
            VALIDATOR.validate_revisions(REVISION, REVISION + " ", None)

    def test_release_file_requires_one_full_lowercase_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "release.env"
            path.write_text(f"FUNIX_RELEASE={REVISION}\n", encoding="utf-8")
            self.assertEqual(VALIDATOR.release_revision(path, "FUNIX_RELEASE"), REVISION)
            path.write_text("FUNIX_RELEASE=8e801e9b0a8f\n", encoding="utf-8")
            with self.assertRaises(VALIDATOR.ValidationError):
                VALIDATOR.release_revision(path, "FUNIX_RELEASE")

    def test_credentials_file_must_be_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "login.txt"
            path.write_text("Usuario: homologacao\nSenha: sintética\n", encoding="utf-8")
            path.chmod(0o600)
            self.assertEqual(
                VALIDATOR.basic_credentials(path), ("homologacao", "sintética")
            )
            path.chmod(0o640)
            with self.assertRaisesRegex(VALIDATOR.ValidationError, "grupo/outros"):
                VALIDATOR.basic_credentials(path)

    def test_api_contract_is_checked_separately_from_revision(self):
        with self.assertRaisesRegex(VALIDATOR.ValidationError, "contrato de prontidao"):
            VALIDATOR.validate_api_contract(
                {"status": "ok", "revision": REVISION, "source": "app", "storage": "sqlite"}
            )


if __name__ == "__main__":
    unittest.main()
