import base64
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location(
    "maintenance", Path(__file__).resolve().parents[1] / "hml-maintenance.py")
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


def authorization(login):
    return "Basic " + base64.b64encode(
        (login["username"] + ":" + login["password"]).encode()).decode()


class PolicyTest(unittest.TestCase):
    def test_unique_credentials(self):
        one, record = maintenance.new_credential()
        two, other = maintenance.new_credential()
        self.assertNotEqual(one, two)
        self.assertNotEqual(record, other)
        self.assertNotIn(one["password"], record)
        self.assertEqual(one["username"], maintenance.USERNAME)


@unittest.skipUnless(shutil.which("nginx"), "local Nginx required")
class NginxTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        root = Path(cls.tmp.name)
        cls.requests = []

        class Backend(BaseHTTPRequestHandler):
            def do_GET(self):
                cls.requests.append((self.path, dict(self.headers)))
                self.send_response(200)
                self.send_header("Set-Cookie", "secret=synthetic")
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, *_):
                pass

        backend = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
        cls.addClassCleanup(backend.server_close)
        thread = threading.Thread(target=backend.serve_forever, daemon=True)
        thread.start()
        cls.addClassCleanup(backend.shutdown)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.login, record = maintenance.new_credential()
        auth = root / "htpasswd"
        auth.write_text(record)
        auth.chmod(0o600)
        block = maintenance.server_config().replace("listen 8080;", f"listen 127.0.0.1:{cls.port};")
        block = block.replace("/etc/nginx/hml.htpasswd", str(auth))
        for upstream in set(maintenance.ROUTES.values()):
            block = block.replace(upstream, f"http://127.0.0.1:{backend.server_port}")
        config = root / "nginx.conf"
        config.write_text(f"daemon off; master_process off; pid {root}/nginx.pid;\n"
                          "error_log stderr warn; events {}\nhttp {\n"
                          f"client_body_temp_path {root}/body; proxy_temp_path {root}/proxy;\n"
                          f"fastcgi_temp_path {root}/fastcgi; uwsgi_temp_path {root}/uwsgi; scgi_temp_path {root}/scgi;\n"
                          + block + "}\n")
        subprocess.run(["nginx", "-t", "-p", str(root), "-c", str(config)],
                       check=True, capture_output=True)
        process = subprocess.Popen(["nginx", "-p", str(root), "-c", str(config)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def stop():
            process.terminate()
            process.wait(timeout=5)
        cls.addClassCleanup(stop)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("Nginx exited")
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=.1):
                    break
            except OSError:
                time.sleep(.04)
        else:
            raise RuntimeError("Nginx did not start")

    def request(self, method, path, login=None, extra=None, body=None):
        headers = dict(extra or {})
        if login:
            headers["Authorization"] = authorization(login)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            result = response.status, dict(response.getheaders())
            response.read()
            return result
        finally:
            conn.close()

    def test_diagnostics_require_maintenance_credentials(self):
        old = {"username": "homologacao", "password": "synthetic-old"}
        for path in maintenance.ROUTES:
            for login in (None, old, {"username": maintenance.USERNAME, "password": "wrong"}):
                with self.subTest(path=path, login=bool(login)):
                    status, headers = self.request("GET", path, login)
                    self.assertEqual(status, 401)
                    self.assertTrue(headers["WWW-Authenticate"].startswith("Basic "))
            status, _ = self.request("GET", path, self.login)
            self.assertEqual(status, 200)

    def test_writes_and_other_paths_rejected_before_upstream(self):
        before = len(self.requests)
        for method in ("POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
            for path in maintenance.ROUTES:
                self.assertEqual(self.request(method, path, self.login)[0], 503)
        for path in ("/api/session", "/api/atendimentos", "/api/ready?x=1", "/api/%72eady", "/api/../", "//healthz"):
            self.assertEqual(self.request("GET", path, self.login)[0], 503)
        self.assertEqual(len(self.requests), before)

    def test_diagnostic_does_not_forward_credentials_or_payload(self):
        status, headers = self.request("GET", "/api/ready", self.login,
                                      {"Cookie": "session=synthetic", "X-HTTP-Method-Override": "POST"}, b"body")
        self.assertEqual(status, 200)
        path, sent = self.requests[-1]
        self.assertEqual(path, "/api/ready")
        for name in ("Cookie", "Authorization", "X-HTTP-Method-Override", "Content-Length"):
            self.assertNotIn(name, sent)
        self.assertNotIn("Set-Cookie", headers)


if __name__ == "__main__":
    unittest.main()
