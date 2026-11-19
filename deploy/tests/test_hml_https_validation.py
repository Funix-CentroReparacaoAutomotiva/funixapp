"""Real TLS/HTTP integration using a private synthetic trust anchor."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import io
import http.client
from pathlib import Path
import ssl
import socket
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch, MagicMock

SPEC = importlib.util.spec_from_file_location("updater", Path(__file__).resolve().parents[1] / "hml-update.py")
updater = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(updater)


class HttpsValidationTest(unittest.TestCase):
    def exercise_responses(self, *, truncate=0, bad_status=False, expire=False, chunked=False, maintenance=False):
        calls = []
        clock = [0]
        class Socket:
            def __init__(self, data):
                self.data = data
            def makefile(self, *args):
                return io.BytesIO(self.data)
        def connection(*args, **kwargs):
            client = MagicMock()
            def request(method, endpoint, headers):
                calls.append((method, endpoint, headers))
            client.request.side_effect = request
            def response():
                method, endpoint, headers = calls[-1]
                authenticated = headers.get("Authorization") == "Basic synthetic"
                status = 200 if authenticated else 401
                if maintenance and (method != "GET" or endpoint not in ("/", "/api/ready", "/release.json", "/healthz")):
                    status = 503 if maintenance == "secure" else 200
                if bad_status:
                    status = 200
                body = json.dumps({"revision": "a" * 40, "status": "ready"}).encode()
                truncated = endpoint == "/" and authenticated and sum(
                    e == "/" and h.get("Authorization") == "Basic synthetic" for _, e, h in calls) <= truncate
                head = f"HTTP/1.1 {status} Synthetic\r\nWWW-Authenticate: Basic realm=synthetic\r\n".encode()
                if chunked:
                    wire = head + b"Transfer-Encoding: chunked\r\n\r\n" + hex(len(body))[2:].encode() + b"\r\n" + body + b"\r\n0\r\n\r\n"
                else:
                    wire = head + f"Content-Length: {len(body)}\r\n\r\n".encode() + (b"x" if truncated else body)
                result = http.client.HTTPResponse(Socket(wire), method=method)
                result.begin()
                if expire:
                    original = result.read1
                    def read(*args):
                        value = original(*args)
                        if expire is True or not value:
                            clock[0] = 61
                        return value
                    result.read1 = read
                return result
            client.getresponse.side_effect = response
            return client
        with patch.object(updater, "read_login", side_effect=lambda path: "Basic normal" if path == "normal" else "Basic synthetic"), \
             patch.object(updater.http.client, "HTTPSConnection", side_effect=connection), \
             patch.object(updater.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(updater.time, "sleep") as sleep:
            validate = updater.validator("temporary", normal_credentials="normal" if maintenance else None)
            if truncate >= 3 or bad_status or expire or maintenance is True:
                with self.assertRaises(ValueError):
                    validate({"revision": "a" * 40})
            else:
                validate({"revision": "a" * 40})
            return calls, sleep.call_count

    def test_real_content_length_truncation_retries_then_succeeds(self):
        _, sleeps = self.exercise_responses(truncate=1)
        self.assertEqual(sleeps, 1)

    def test_persistent_truncation_exhausts_attempts(self):
        _, sleeps = self.exercise_responses(truncate=3)
        self.assertEqual(sleeps, 2)

    def test_auth_violation_precedes_body_read_and_never_retries(self):
        calls, sleeps = self.exercise_responses(bad_status=True, truncate=3)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, 0)

    def test_maintenance_write_violation_never_retries(self):
        calls, sleeps = self.exercise_responses(maintenance=True)
        self.assertEqual(calls[-1][0], "POST")
        self.assertEqual(sleeps, 0)

    def test_deadline_expired_during_read_cannot_accept(self):
        calls, sleeps = self.exercise_responses(expire=True)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, 0)

    def test_deadline_expired_on_final_eof_cannot_accept(self):
        calls, sleeps = self.exercise_responses(expire="eof")
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, 0)

    def test_chunked_responses_remain_supported(self):
        _, sleeps = self.exercise_responses(chunked=True)
        self.assertEqual(sleeps, 0)

    def test_head_with_content_length_is_correctly_bodyless(self):
        calls, sleeps = self.exercise_responses(maintenance="secure")
        self.assertTrue(any(method == "HEAD" for method, _, _ in calls))
        self.assertEqual(sleeps, 0)

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
