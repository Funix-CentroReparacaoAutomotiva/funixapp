"""Hosted GitHub runner only: real Docker/Nginx, synthetic TLS edge and SQLite.

No real hostnames are contacted; the HTTPS client retains the HML hostname for
SNI/verification but connects only to the loopback synthetic edge.
"""
import base64
from contextlib import closing
import hashlib
import gzip
import zipfile
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
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
OLD, NEW = "a" * 40, "b" * 40


class SimulatedInterruption(BaseException):
    """Bypass automatic rollback; leave actual Docker state and journal intact."""


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
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
role = os.environ["SYNTHETIC_ROLE"]
revision = os.environ["FUNIX_REVISION"]
if role == "api" and revision == "b"*40:
    with closing(sqlite3.connect("/data/funix.sqlite")) as db, db:
        db.execute("UPDATE atendimentos SET value='candidate migration'")
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"revision":revision,"status":"ready"}).encode())
    def do_POST(self):
        if role == "api":
            with closing(sqlite3.connect("/data/funix.sqlite")) as db, db:
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
        api_new = run("docker", "commit", "--change", "LABEL org.opencontainers.image.revision=" + NEW, container)
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
            with closing(sqlite3.connect(database)) as db, db:
                db.executescript("CREATE TABLE schema_migrations(version INTEGER);"
                                 "INSERT INTO schema_migrations VALUES(1);"
                                 "CREATE TABLE atendimentos(value TEXT);"
                                 "INSERT INTO atendimentos VALUES('original');"
                                 "CREATE TABLE scenarios(id INTEGER);"
                                 "CREATE TABLE budget_versions(id INTEGER);")
            database.chmod(0o600)
            # Prove that a real open SQLite connection blocks the guard, then
            # close it and let the adapter run the full host scan unchanged.
            with closing(sqlite3.connect(database)) as opened:
                opened.execute("SELECT value FROM atendimentos").fetchone()
                try:
                    adapter_module.guard.assert_quiescent(data)
                except adapter_module.guard.WriterGuardError as exc:
                    if str(exc) != "database handle open":
                        raise
                else:
                    raise AssertionError("host writer guard accepted open SQLite handle")
            adapter_module.guard.assert_quiescent(data)
            print("HML_HOST_WRITER_GUARD_OK", flush=True)
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
                    "environment": {"SYNTHETIC_ROLE": role},
                    "labels": {"traefik.enable": "false"},
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
                web_new = run("docker","commit","--change","ENV SYNTHETIC_WEB_REVISION="+NEW,
                              "--change","LABEL org.opencontainers.image.revision="+NEW,web_container)
            finally:
                run("docker","rm",web_container)
            services["web"]["command"] = ["python","-c", UPSTREAM.replace(
                'revision = os.environ["FUNIX_REVISION"]',
                'revision = os.environ.get("SYNTHETIC_WEB_REVISION","' + OLD + '")')]
            services["api"]["environment"].update(adapter_module.isolation.FIXED)
            services["api"]["environment"].update({
                key: "false" for key in adapter_module.isolation.FLAGS})
            services["api"]["environment"].update({
                "FUNIX_REVISION": OLD, "FUNIX_OPERATOR_PASSWORD": secrets.token_urlsafe(24)})
            services["api"]["volumes"] = [{"type":"bind","source":str(data),"target":"/data",
                                           "bind":{"create_host_path":False}}]
            services["gateway"] = {
                "image":gateway, "read_only":True, "user":"101:101",
                "labels": adapter_module.isolation.LABELS,
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

            # Deterministic TLS edge unavailability immediately after the
            # maintenance gateway is recreated. Real TLS, auth, Docker, and
            # the post-recovery release validation still run unchanged.
            edge_faults = []
            edge_fault_lock = threading.Lock()
            edge_fault_count = [0]

            class Edge(BaseHTTPRequestHandler):
                def forward(self):
                    with edge_fault_lock:
                        fault = edge_faults.pop(0) if edge_faults else None
                        if fault is not None:
                            edge_fault_count[0] += 1
                    if fault is not None:
                        self.send_response(fault)
                        self.end_headers()
                        return
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
                    with edge_fault_lock:
                        assert not edge_faults, "unconsumed prior TLS edge faults"
                        edge_faults.extend((502, 503, 504))
                    # The first requests in each real restricted gateway
                    # validation see transient TLS-edge 502/503/504 responses,
                    # then reach the actual gateway via Docker.
                    updater.validator(credentials,normal_credentials=normal_login)(release)
                    with edge_fault_lock:
                        assert not edge_faults, "TLS edge never converged"
                    with closing(sqlite3.connect(database)) as db, db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone()[0] != "unexpected user write"
                def fresh_adapter():
                    return adapter_module.MaintenanceDockerAdapter(
                        compose=compose,contract=contract,database=database,state=state,
                        validator=updater.validator(normal_login),restricted_validator=restricted)
                adapter = fresh_adapter()
                previous = dict(api=api_old,web=api_old,gateway=gateway,revision=OLD)
                candidate = dict(api=api_new,web=web_new,gateway=gateway,revision=NEW)
                # Check actual Docker isolation before any update. Wait only for
                # initial synthetic container startup; no weakening of policy.
                adapter.preflight(candidate)
                print("HML_LIVE_ISOLATION_OK", flush=True)
                # Exercise the exact candidate transport and shared CLI entry point.
                # Only GitHub's API response is synthetic; Docker save/load, hashing,
                # ZIP parsing, manifest verification, transactions and HTTPS are real.
                artifact = root / "artifact.zip"
                archive = root / "images.tar.gz"
                images = {}
                for role in ("api", "web"):
                    tag = f"funix-hml-{role}:{NEW}"
                    run("docker", "tag", candidate[role], tag)
                    images[role] = {"tag": tag, "image_id": candidate[role]}
                raw = root / "images.tar"
                run("docker", "save", "-o", str(raw), *(i["tag"] for i in images.values()))
                with raw.open("rb") as source, gzip.open(archive, "wb", compresslevel=1) as target:
                    shutil.copyfileobj(source, target)
                raw.unlink()
                with archive.open("rb") as source:
                    archive_hash = hashlib.file_digest(source, "sha256").hexdigest()
                manifest = {"schema": 1, "purpose": "hml-candidate-only",
                            "revision": NEW, "pr": 262, "run_id": "123", "run_attempt": "1",
                            "archive_sha256": archive_hash, "images": images}
                with zipfile.ZipFile(artifact, "w") as bundle:
                    bundle.writestr("manifest.json", json.dumps(manifest))
                    bundle.write(archive, "images.tar.gz")
                artifact.chmod(0o600)
                with artifact.open("rb") as source:
                    zip_digest = "sha256:" + hashlib.file_digest(source, "sha256").hexdigest()
                identity = {"artifact_id": 456, "run_id": 123, "attempt": 1,
                            "revision": NEW, "pr": 262}
                config = {"compose": str(compose), "contract": contract, "database": str(database),
                          "state": str(state), "credentials": str(normal_login),
                          "candidate": candidate, "identity": identity, "artifact_zip": str(artifact)}
                provenance = load("hml-artifact-provenance")
                def fake_api(path):
                    repo = provenance.REPO
                    responses = {
                        "actions/runs/123/attempts/1": {
                            "id":123,"run_attempt":1,"event":"workflow_dispatch","head_branch":"main",
                            "path":provenance.WORKFLOW,"status":"completed","conclusion":"success",
                            "repository":{"full_name":repo}},
                        "actions/artifacts/456": {
                            "expired":False,"name":f"funix-hml-{NEW}-1",
                            "workflow_run":{"id":123},"digest":zip_digest},
                        "pulls/262":{"head":{"sha":NEW,"repo":{"full_name":repo}},
                                     "base":{"ref":"main"}}}
                    return responses[path]
                verify_real = provenance.verify
                def verify_local(archive_path, **kwargs):
                    return verify_real(archive_path, **kwargs, query=fake_api)
                original_load = updater.load
                def load_for_rehearsal(name):
                    if name == "hml-artifact-provenance":
                        return provenance
                    return original_load(name)
                with patch.object(socket,"create_connection",side_effect=connect), \
                        patch.object(updater.ssl,"create_default_context",return_value=trust), \
                        patch.object(provenance,"verify",side_effect=verify_local), \
                        patch.object(updater,"load",side_effect=load_for_rehearsal):
                    # A preflight must work before any candidate is loaded.
                    # Compose start does not wait for the initial Docker healthcheck.
                    deadline = time.monotonic() + 30
                    while True:
                        records = adapter.containers()
                        if len(records) == 3 and all(
                                row['State'].get('Health', {}).get('Status') == 'healthy'
                                for row in records):
                            break
                        if time.monotonic() >= deadline:
                            raise AssertionError('synthetic installation health deadline')
                        time.sleep(.2)
                    assert updater.installed_preflight(updater.make_adapter(config)) == previous
                    wrong = dict(config, candidate=dict(candidate, revision=OLD))
                    try:
                        updater.prepare_candidate(wrong, adapter, load("hml-update-safety"))
                    except ValueError:
                        pass
                    else:
                        raise AssertionError("mismatched candidate revision accepted")
                    # Drop tags and images before load, verifying use of the archive.
                    for image in images.values():
                        run("docker", "image", "rm", image["tag"])
                        check = subprocess.run(["docker", "image", "inspect", image["image_id"]],
                                               capture_output=True)
                        if check.returncode == 0:
                            run("docker", "image", "rm", image["image_id"])
                    official = load("hml-official-update")
                    official.updater = updater
                    op = state / "op-123-1-prep-456"
                    def prepare_local(operation, config_path, requested):
                        assert requested == identity
                        updater.prepare_candidate(config, adapter, load("hml-update-safety"), load_images=False)
                        config_path.write_text(json.dumps(config))
                        config_path.chmod(0o600)
                    # Only host path/bootstrap binding is replaced for the disposable
                    # runner. Package validation, lock, preflight and update are real.
                    with patch.object(updater, "STATE", state), \
                         patch.object(updater, "host_scope"), \
                         patch.object(updater, "check_config"), \
                         patch.object(updater, "prepare_operation", side_effect=prepare_local):
                        from hml_remote_chain import run_chain
                        remote_case=os.environ.get('HML_REMOTE_CASE','accepted')
                        run_chain(updater,config,previous,op,root,identity,fake_api,remote_case)
                    if remote_case!='accepted':
                        fresh_adapter().assert_installed(previous)
                        assert json.loads((op/'operation.json').read_text())['phase']=='restored'
                        with closing(sqlite3.connect(database)) as db:
                            assert db.execute('SELECT value FROM atendimentos').fetchone()==('original',)
                        assert all(file.read_bytes()==content for file,content in before.items())
                        print('HML_REMOTE_FAILURE_DATA_PRESERVED_OK',flush=True)
                        assert edge_fault_count[0] >= 3, "TLS edge injection did not run"
                        print('HML_EDGE_TRANSIENT_GATEWAY_CONVERGENCE_OK',flush=True)
                        return
                    operation = transaction.Transaction(op, fresh_adapter(), project_state=state, maintenance=True)
                    print("HML_OFFICIAL_COORDINATOR_OK", flush=True)
                    print("HML_ARTIFACT_MAINTENANCE_ENTRYPOINT_OK", flush=True)
                    print("HML_MAINTENANCE_UPDATE_OK", flush=True)
                    assert json.loads(operation.journal.read_text())["phase"] == "accepted"
                    adapter.assert_installed(candidate)
                    with closing(sqlite3.connect(database)) as db, db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("candidate migration",)
                    operation = updater.execute_operation("rollback", config, op,
                                                          authorized=True, discard_post_update_data=True)
                    print("HML_MAINTENANCE_ROLLBACK_OK", flush=True)
                    adapter.assert_installed(previous)
                    assert json.loads(operation.journal.read_text())["phase"] == "restored"
                    with closing(sqlite3.connect(database)) as db, db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("original",)
                    # Interrupt after real restricted validation but before
                    # durable acceptance. No automatic restore on BaseException.
                    interrupted_adapter = fresh_adapter()
                    interrupted = transaction.Transaction(root/"interrupted",interrupted_adapter,
                                                           project_state=state,maintenance=True)
                    validate_real = interrupted_adapter.validate
                    def interrupt_before_accept(release):
                        validate_real(release)
                        raise SimulatedInterruption("before acceptance")
                    with patch.object(interrupted_adapter,"validate",side_effect=interrupt_before_accept):
                        try:
                            interrupted.update(candidate,authorized=True)
                        except SimulatedInterruption:
                            pass
                        else:
                            raise AssertionError("pre-accept interruption not injected")
                    assert json.loads(interrupted.journal.read_text())["phase"] == "installing"
                    interrupted_adapter.assert_gateway_mounts(restricted=True)
                    recovered = transaction.Transaction(interrupted.root,fresh_adapter(),
                                                         project_state=state,maintenance=True)
                    recovered.recover(authorized=True)
                    assert json.loads(recovered.journal.read_text())["phase"] == "restored"
                    with closing(sqlite3.connect(database)) as db, db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("original",)
                    print("HML_PRE_ACCEPT_RECOVERY_OK", flush=True)

                    # Interrupt after durable acceptance and actual normal
                    # gateway reopening. A real POST makes a synthetic later
                    # write; recovery must reopen, never restore old data.
                    opening_adapter = fresh_adapter()
                    opening = transaction.Transaction(root/"opening",opening_adapter,
                                                       project_state=state,maintenance=True)
                    open_real = opening_adapter.open_access
                    def interrupt_after_open(release):
                        open_real(release)
                        connection = http.client.HTTPSConnection("hml.funix.com.br",timeout=10,
                                                                  context=trust)
                        try:
                            connection.request("POST","/api/ready",headers={
                                "Authorization":updater.read_login(normal_login)})
                            response = connection.getresponse()
                            assert response.status == 200
                            response.read()
                        finally:
                            connection.close()
                        raise SimulatedInterruption("after normal access")
                    with patch.object(opening_adapter,"open_access",side_effect=interrupt_after_open):
                        try:
                            opening.update(candidate,authorized=True)
                        except SimulatedInterruption:
                            pass
                        else:
                            raise AssertionError("post-accept interruption not injected")
                    assert json.loads(opening.journal.read_text())["phase"] == "accepted_pending_open"
                    opening_adapter.assert_gateway_mounts(restricted=False)
                    with closing(sqlite3.connect(database)) as db, db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("unexpected user write",)
                    resumed = transaction.Transaction(opening.root,fresh_adapter(),
                                                       project_state=state,maintenance=True)
                    resumed.recover(authorized=True)
                    assert json.loads(resumed.journal.read_text())["phase"] == "accepted"
                    resumed.adapter.assert_installed(candidate)
                    with closing(sqlite3.connect(database)) as db, db:
                        assert db.execute("SELECT value FROM atendimentos").fetchone() == ("unexpected user write",)
                    print("HML_POST_ACCEPT_RECOVERY_PRESERVES_WRITES_OK", flush=True)
                assert all(file.read_bytes()==content for file,content in before.items())
                assert edge_fault_count[0] >= 3, "TLS edge injection did not run"
                print('HML_EDGE_TRANSIENT_GATEWAY_CONVERGENCE_OK',flush=True)
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
