"""Hosted GitHub runner only: real Docker/Nginx, synthetic TLS edge and SQLite.

No real hostnames are contacted; the HTTPS client retains the HML hostname for
SNI/verification but connects only to the loopback synthetic edge.
"""
import base64
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import ssl
import subprocess
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
OLD, NEW = "a" * 40, "b" * 40


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(*args):
    return subprocess.check_output(args, text=True, timeout=120).strip()


# Actual HTTP upstreams; the candidate changes SQLite during startup.
# No application or production data is imported.
UPSTREAM = """
import json, os, sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
role = os.environ["SYNTHETIC_ROLE"]
revision = os.environ["FUNIX_REVISION"]
if role == "api" and revision == "b"*40:
    with sqlite3.connect("/data/funix.sqlite") as db:
        db.execute("UPDATE atendimentos SET value='candidate migration'")
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"revision":revision,"status":"ready"}).encode())
    def do_POST(self):
        if role == "api":
            with sqlite3.connect("/data/funix.sqlite") as db:
                db.execute("UPDATE atendimentos SET value='unexpected user write'")
        self.send_response(200)
        self.end_headers()
    def log_message(self,*args):
        pass
ThreadingHTTPServer(("0.0.0.0",8787 if role=="api" else 8080),Handler).serve_forever()
"""


def main():
    if (os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or os.geteuid() != 0):
        raise RuntimeError("hosted disposable runner with root required")
    if run("docker", "ps", "-aq") or run("docker", "network", "ls", "--filter",
                                        "name=^traefik_default$", "-q"):
        raise RuntimeError("rehearsal requires unused Docker daemon")
    etc = Path("/etc/funix-hml")
    if etc.exists():
        raise RuntimeError("existing HML configuration; refusing rehearsal")
    adapter_module = load("hml-docker-maintenance")
    transaction = load("hml-update-transaction")
    updater = load("hml-update")
    api_old = run("docker", "image", "inspect", "python:3.12-alpine", "--format", "{{.Id}}")
    gateway = run("docker", "image", "inspect", "nginx:alpine", "--format", "{{.Id}}")
    container = run("docker", "create", api_old, "python", "-c", "pass")
    try:
        api_new = run("docker", "commit", "--change", "LABEL synthetic.revision=" + NEW, container)
    finally:
        run("docker", "rm", container)
    # Test actual fixture under fixed HML paths only on the disposable runner.
    etc.mkdir(mode=0o700)
    try:
        with tempfile.TemporaryDirectory(prefix="funix-hml-maintenance-ci-") as directory:
            root = Path(directory)
            state = root / "state"
            state.mkdir(mode=0o700)
            data = root / "data"
            data.mkdir(mode=0o700)
            database = data / "funix.sqlite"
            with sqlite3.connect(database) as db:
                db.executescript("CREATE TABLE schema_migrations(version INTEGER);"
                                 "INSERT INTO schema_migrations VALUES(1);"
                                 "CREATE TABLE atendimentos(value TEXT);"
                                 "INSERT INTO atendimentos VALUES('original');"
                                 "CREATE TABLE scenarios(id INTEGER);"
                                 "CREATE TABLE budget_versions(id INTEGER);")
            database.chmod(0o600)
            normal_login = root / "normal.json"
            password = secrets.token_urlsafe(32)
            normal_login.write_text(json.dumps({"username":"synthetic-normal","password":password}))
            normal_login.chmod(0o600)
            salt = secrets.token_bytes(16)
            record = "synthetic-normal:{SSHA}" + base64.b64encode(
                hashlib.sha1(password.encode() + salt).digest() + salt).decode() + "\n"
            auth = etc / "gateway.htpasswd"
            auth.write_text(record)
            os.chown(auth, 0, 101)
            auth.chmod(0o640)
            nginx = etc / "gateway-nginx.conf"
            # Normal gateway allows API posts (the maintenance gateway must not).
            normal = adapter_module.gateway_config()
            normal = normal[:normal.index("server {")] + """
server {
 listen 8080;
 auth_basic "synthetic normal";
 auth_basic_user_file /etc/nginx/hml.htpasswd;
 location /api/ { proxy_pass http://funix-hml-api-1:8787; }
 location / { proxy_pass http://funix-hml-web-1:8080; }
}
}
"""
            nginx.write_text(normal)
            nginx.chmod(0o644)
            before = {file: file.read_bytes() for file in (nginx, auth)}
            services = {}
            for role in ("api", "web"):
                port = 8787 if role == "api" else 8080
                services[role] = {
                    "image": api_old, "read_only": True, "cap_drop": ["ALL"],
                    "security_opt": ["no-new-privileges:true"],
                    "command": ["python", "-c", UPSTREAM.replace(
                        'revision = os.environ["FUNIX_REVISION"]',
                        'revision = os.environ["FUNIX_REVISION"]' if role == "api"
                        else 'revision = os.environ.get("FUNIX_REVISION", "' + OLD + '")')],
                    "environment": {"SYNTHETIC_ROLE": role, "FUNIX_REVISION": OLD},
                    "networks": ["privada"], "tmpfs": ["/tmp"],
                    "healthcheck": {"test": ["CMD","python","-c",
                        "import urllib.request; urllib.request.urlopen('http://127.0.0.1:" +
                        str(port) + "/healthz',timeout=1).read()"], "interval":"1s",
                        "timeout":"2s","retries":10},
                }
            # Web revision belongs to its image, as with the real build.
            # Use a separate Web image with the revision baked into the command's environment.
            web_container = run("docker","create",api_old,"python","-c","pass")
            try:
                web_new = run("docker","commit","--change","ENV SYNTHETIC_WEB_REVISION="+NEW,web_container)
            finally:
                run("docker","rm",web_container)
            services["web"]["command"] = ["python","-c", UPSTREAM.replace(
                'revision = os.environ["FUNIX_REVISION"]',
                'revision = os.environ.get("SYNTHETIC_WEB_REVISION","' + OLD + '")')]
            services["api"]["volumes"] = [{"type":"bind","source":str(data),"target":"/data",
                                           "bind":{"create_host_path":False}}]
            services["gateway"] = {
                "image":gateway, "read_only":True, "user":"101:101",
                "cap_drop":["ALL"], "security_opt":["no-new-privileges:true"],
                "entrypoint":["nginx","-g","daemon off;"], "command":[],
                "networks":["privada","edge"], "tmpfs":["/tmp"],
                "volumes":[{"type":"bind","source":str(file),"target":target,"read_only":True,
                            "bind":{"create_host_path":False}} for file,target in (
                                (nginx,"/etc/nginx/nginx.conf"),(auth,"/etc/nginx/hml.htpasswd"))],
                "healthcheck":{"test":["CMD-SHELL",
                    "wget -S -O /dev/null http://127.0.0.1:8080/healthz 2>&1 | grep -q ' 401 '"],
                    "interval":"1s","timeout":"2s","retries":15},
            }
            compose = root / "compose.json"
            compose.write_text(json.dumps({"services":services,"networks":{
                "privada":{"name":"funix-hml_privada","internal":True},
                "edge":{"name":"traefik_default"}}}))
            base = ["docker","compose","-p","funix-hml","-f",str(compose)]
            cert, key = root / "cert.pem", root / "key.pem"
            subprocess.run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-days","1",
                            "-subj","/CN=hml.funix.com.br","-addext","subjectAltName=DNS:hml.funix.com.br",
                            "-keyout",str(key),"-out",str(cert)],check=True,capture_output=True)

            class Edge(BaseHTTPRequestHandler):
                def forward(self):
                    # Resolve the real gateway's current Docker IP on every request.
                    ip = run("docker","inspect","--format",
                             '{{(index .NetworkSettings.Networks "traefik_default").IPAddress}}',
                             "funix-hml-gateway-1")
                    connection = http.client.HTTPConnection(ip,8080,timeout=5)
                    try:
                        headers = {"Host":"hml.funix.com.br"}
                        if self.headers.get("Authorization"):
                            headers["Authorization"] = self.headers["Authorization"]
                        connection.request(self.command,self.path,headers=headers)
                        result = connection.getresponse()
                        body = result.read(100001)
                        self.send_response(result.status)
                        if result.getheader("WWW-Authenticate"):
                            self.send_header("WWW-Authenticate",result.getheader("WWW-Authenticate"))
                        self.end_headers()
                        if self.command != "HEAD":
                            self.wfile.write(body)
                    finally:
                        connection.close()
                do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = do_OPTIONS = forward
                def log_message(self,*args):
                    pass

            edge = ThreadingHTTPServer(("127.0.0.1",0),Edge)
            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(cert,key)
            edge.socket = server_context.wrap_socket(edge.socket,server_side=True)
            thread = threading.Thread(target=edge.serve_forever,daemon=True)
            thread.start()
            trust = ssl.create_default_context(cafile=str(cert))
            original = socket.create_connection
            def connect(address,*args,**kwargs):
                if address[0] == "hml.funix.com.br":
                    address = ("127.0.0.1",edge.server_port)
                return original(address,*args,**kwargs)

            try:
                run(*base,"up","-d","--pull","never")
                contract = json.loads(run(*base,"config","--format","json"))
                def restricted(release, credentials):
                    updater.validator(credentials,normal_credentials=normal_login)(release)
                    with sqlite3.connect(database) as db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone()[0] != "unexpected user write"
                adapter = adapter_module.MaintenanceDockerAdapter(
                    compose=compose,contract=contract,database=database,state=state,
                    validator=updater.validator(normal_login),restricted_validator=restricted)
                previous = dict(api=api_old,web=api_old,gateway=gateway,revision=OLD)
                candidate = dict(api=api_new,web=web_new,gateway=gateway,revision=NEW)
                operation = transaction.Transaction(root/"operation",adapter,
                                                    project_state=state,maintenance=True)
                with patch.object(socket,"create_connection",side_effect=connect), \
                        patch.object(updater.ssl,"create_default_context",return_value=trust):
                    operation.update(candidate,authorized=True)
                    assert json.loads(operation.journal.read_text())["phase"] == "accepted"
                    adapter.assert_installed(candidate)
                    with sqlite3.connect(database) as db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("candidate migration",)
                    operation.rollback(authorized=True,discard_post_update_data=True)
                    adapter.assert_installed(previous)
                    assert json.loads(operation.journal.read_text())["phase"] == "restored"
                    with sqlite3.connect(database) as db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("original",)
                assert all(file.read_bytes()==content for file,content in before.items())
                print("HML_DOCKER_MAINTENANCE_TLS_ROLLBACK_OK")
            finally:
                edge.shutdown()
                edge.server_close()
                thread.join()
                subprocess.run(base+["rm","--stop","--force"],check=True)
    finally:
        shutil.rmtree(etc)


if __name__ == "__main__":
    main()
