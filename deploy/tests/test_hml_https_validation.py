"""Real TLS/HTTP integration using a private synthetic trust anchor."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import ssl
import socket
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("updater", Path(__file__).resolve().parents[1] / "hml-update.py")
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)


class HttpsValidationTest(unittest.TestCase):
    def test_strict_tls_auth_and_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cert, key = root / "cert.pem", root / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                            "-days", "1", "-subj", "/CN=hml.funix.com.br",
                            "-addext", "subjectAltName=DNS:hml.funix.com.br",
                            "-keyout", str(key), "-out", str(cert)],
                           check=True, capture_output=True)
            revision = "b" * 40
            token = "Basic " + base64.b64encode(b"synthetic:synthetic").decode()
            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    if self.headers.get("Authorization") != token:
                        self.send_response(401)
                        self.send_header("WWW-Authenticate", 'Basic realm="synthetic"')
                        self.end_headers()
                        return
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(json.dumps({"revision": revision, "status": "ready"}).encode())
                def log_message(self, *_):
                    pass
            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            credentials = root / "credentials"
            credentials.write_text("Usuario: synthetic\nSenha: synthetic\n")
            original = socket.create_connection
            def connection(address, *args, **kwargs):
                return original(("127.0.0.1", server.server_port), *args, **kwargs)
            try:
                with patch.object(socket, "create_connection", side_effect=connection):
                    with self.assertRaises(ssl.SSLCertVerificationError):
                        updater.validator(credentials)({"revision": revision})
                    trusted = ssl.create_default_context(cafile=str(cert))
                    with patch.object(updater.ssl, "create_default_context", return_value=trusted):
                        updater.validator(credentials)({"revision": revision})
                        attempts = 0
                        def transient(address, *args, **kwargs):
                            nonlocal attempts
                            attempts += 1
                            if attempts == 1:
                                raise TimeoutError("secret must not appear")
                            return connection(address, *args, **kwargs)
                        with patch.object(socket, "create_connection", side_effect=transient), \
                             patch.object(updater.time, "sleep") as sleep:
                            updater.validator(credentials)({"revision": revision})
                            sleep.assert_called_once_with(1)
                        with self.assertRaisesRegex(ValueError, "revision"):
                            updater.validator(credentials)({"revision": "a" * 40})
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_persistent_transport_failure_has_three_attempts(self):
        with patch.object(updater, "read_login", return_value="Basic synthetic"), \
             patch.object(updater.http.client, "HTTPSConnection", side_effect=TimeoutError("secret")) as connection, \
             patch.object(updater.time, "sleep") as sleep:
            with self.assertRaisesRegex(ValueError, "attempts exhausted"):
                updater.validator("unused")({"revision": "a" * 40})
        self.assertEqual(connection.call_count, 3)
        self.assertEqual(sleep.call_count, 2)
