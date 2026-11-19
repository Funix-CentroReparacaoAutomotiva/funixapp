#!/usr/bin/env python3
"""Controlled HML CLI. Configuration is a private, independently reviewed JSON file."""
import argparse
import base64
import http.client
import importlib.util
import json
import os
from pathlib import Path
import ssl
import tempfile
import re
import shutil
import stat
import subprocess
import zipfile
import time
import sys


# Scope of the real operator entrypoint, recorded by the approved audit.
STATE = Path("/var/lib/funix-hml/updater")
DATABASE = Path("/var/lib/funix-hml/app-data/funix.sqlite")
COMPOSE = ["/opt/funix-hml/compose.yaml", "/opt/funix-hml/gateway.compose.yaml"]
RELEASE_ENV = "/opt/funix-hml/release.env"
CREDENTIALS = "/etc/funix-hml/gateway-login-temporario.txt"
GATEWAY_HASH = "9b66a5f1f87188defc3334201123ace9fe992de0aafaadca3a73831145f7b068"
INITIAL_REVISION = "8e801e9b0a8fc1fe5feec40d533d9e639e8b013b"
INITIAL_GATEWAY = "sha256:1d4bb63430ffa684179547f9b14656ffe7ccb10d2a7f3776befc1f6b40012c5e"


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_login(credentials):
    content = Path(credentials).read_text()
    if content.lstrip().startswith("{"):
        login = json.loads(content)
    else:
        fields = dict(line.split(": ", 1) for line in content.splitlines() if ": " in line)
        login = {"username": fields["Usuario"], "password": fields["Senha"]}
    if not all(isinstance(login.get(key), str) and login[key] for key in ("username", "password")):
        raise ValueError("invalid login")
    return "Basic " + base64.b64encode((login["username"] + ":" + login["password"]).encode()).decode()


def validator(credentials, *, normal_credentials=None):
    """Strict HTTPS; in maintenance also reject normal login and unsafe requests."""
    deadline = None
    class TransientHttpsError(Exception):
        pass
    def once(release):
        token = read_login(credentials)
        normal = read_login(normal_credentials) if normal_credentials is not None else None
        if normal == token:
            raise ValueError("maintenance credential matches normal login")

        def request(method, endpoint, auth, expected):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("HTTPS validation deadline")
            connection = http.client.HTTPSConnection("hml.funix.com.br", timeout=min(5, remaining),
                                                     context=ssl.create_default_context())
            try:
                connection.request(method, endpoint, headers={"Authorization": auth} if auth else {})
                response = connection.getresponse()
                body = response.read(100001)
                if expected == 200 and response.status in (502, 503, 504):
                    raise TransientHttpsError()
                if response.status != expected or len(body) > 100000:
                    raise ValueError("HTTPS/authentication contract failed")
                if expected == 401 and not response.getheader("WWW-Authenticate", "").lower().startswith("basic "):
                    raise ValueError("Basic challenge missing")
                if expected == 200 and endpoint in ("/api/ready", "/release.json"):
                    data = json.loads(body)
                    if data.get("revision") != release["revision"]:
                        raise ValueError("application revision mismatch")
                    if endpoint == "/api/ready" and data.get("status") != "ready":
                        raise ValueError("API not ready")
            finally:
                connection.close()

        for endpoint in ("/", "/api/ready", "/release.json", "/healthz"):
            request("GET", endpoint, None, 401)
            request("GET", endpoint, "Basic " + base64.b64encode(b"invalid:invalid").decode(), 401)
            if normal is not None:
                request("GET", endpoint, normal, 401)
            request("GET", endpoint, token, 200)
        if normal is not None:
            for method in ("POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
                request(method, "/api/ready", token, 503)
            for endpoint in ("/api/session", "/api/atendimentos", "/api/ready?probe=1"):
                request("GET", endpoint, token, 503)
    def validate(release):
        nonlocal deadline
        deadline = time.monotonic() + 60
        for attempt in range(1, 4):
            try:
                once(release)
                return
            except ssl.SSLError:
                print(f"HTTPS attempt={attempt} category=tls-security retry=false", file=sys.stderr)
                raise
            except (OSError, http.client.RemoteDisconnected, http.client.IncompleteRead, TransientHttpsError):
                retry = attempt < 3 and time.monotonic() + 1 < deadline
                print(f"HTTPS attempt={attempt} category=transient retry={str(retry).lower()}", file=sys.stderr)
                if not retry:
                    raise ValueError("HTTPS transient attempts exhausted") from None
                time.sleep(1)
            except (ValueError, http.client.HTTPException):
                print(f"HTTPS attempt={attempt} category=contract retry=false", file=sys.stderr)
                raise
    return validate

def make_adapter(config):
    """Single adapter construction path for the CLI and isolated integration test."""
    safety = load("hml-update-safety")
    credentials = safety.regular(Path(config["credentials"]))
    info = credentials.stat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("credentials must be private")
    return load("hml-docker-maintenance").MaintenanceDockerAdapter(
        compose=config["compose"], contract=config["contract"], database=config["database"],
        state=config["state"], validator=validator(credentials), env_file=config.get("release_env"),
        restricted_validator=lambda release, temporary: validator(
            temporary, normal_credentials=credentials)(release))


def installed_preflight(adapter):
    """Use the running release, not a not-yet-loaded candidate."""
    records = adapter.containers()
    current = {item["Config"]["Labels"]["com.docker.compose.service"]: item["Image"]
               for item in records}
    current["revision"] = adapter.configuration()["services"]["api"]["environment"]["FUNIX_REVISION"]
    previous = adapter.preflight(current)
    if previous != current or len(records) != 3 or any(
            item["State"].get("Health", {}).get("Status") != "healthy" for item in records):
        raise ValueError("installed release not healthy")
    adapter.validator(previous)
    return previous


def execute_operation(action, config, operation, *, authorized=False,
                      discard_post_update_data=False):
    """Shared maintenance entrypoint; caller owns operator path validation."""
    if authorized is not True or action not in ("update", "recover", "rollback"):
        raise ValueError("explicit maintenance authorization required")
    if action == "rollback" and discard_post_update_data is not True:
        raise ValueError("explicit post-update data loss acknowledgement required")
    adapter = make_adapter(config)
    adapter.assert_contract()
    transaction = load("hml-update-transaction").Transaction(
        operation, adapter, project_state=config["state"], maintenance=True)
    if action == "recover":
        transaction.recover(authorized=True)
    elif action == "rollback":
        transaction.rollback(authorized=True, discard_post_update_data=True)
    else:
        transaction.update(config["candidate"], authorized=True,
                           prepare=lambda: checked_update_package(config, adapter))
    return transaction


def checked_update_package(config, adapter):
    current = installed_preflight(adapter)
    if config["candidate"]["gateway"] != current["gateway"]:
        raise ValueError("stable gateway differs")
    prepare_candidate(config, adapter, load("hml-update-safety"))


def private_directory(path):
    path = Path(path)
    info = path.lstat()
    if (not path.is_absolute() or path.resolve(strict=True) != path
            or not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("directory must be root-owned and private")
    return path


def root_file(path, *, private=True):
    path = load("hml-update-safety").regular(Path(path))
    info = path.stat()
    if info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise ValueError("unsafe root file")
    return path


def host_scope(operation, config_path):
    """No arbitrary input paths, target project, Docker host or credential store."""
    if os.geteuid() != 0:
        raise ValueError("local administrator required")
    # Do not let environment variables redirect Docker/Compose to another daemon
    # or change its project/context/env-file selection.
    if any(key.startswith(("DOCKER_", "COMPOSE_")) for key in os.environ):
        raise ValueError("Docker/Compose environment override present")
    if subprocess.check_output(["docker", "context", "show"], text=True, timeout=15).strip() != "default":
        raise ValueError("default local Docker context required")
    endpoint = json.loads(subprocess.check_output(
        ["docker", "context", "inspect", "default"], text=True, timeout=15))
    if len(endpoint) != 1 or endpoint[0]["Endpoints"]["docker"]["Host"] != "unix:///var/run/docker.sock":
        raise ValueError("local Docker socket required")
    private_directory(STATE)
    operation = private_directory(operation)
    if operation.parent != STATE or not re.fullmatch(r"op-[A-Za-z0-9_-]{1,80}", operation.name):
        raise ValueError("operation outside HML updater")
    if config_path != operation / "config.json":
        raise ValueError("configuration outside operation")
    for path in COMPOSE:
        root_file(path, private=False)
    root_file(RELEASE_ENV)
    root_file(CREDENTIALS)
    load("hml-update-safety").regular(DATABASE)
    if load("hml-update-safety").sha256(Path(COMPOSE[1])) != GATEWAY_HASH:
        raise ValueError("gateway configuration changed; review required")
    return operation


def fixed_config(operation):
    return {"state": str(STATE), "database": str(DATABASE), "compose": COMPOSE,
            "release_env": RELEASE_ENV, "credentials": CREDENTIALS,
            "artifact_zip": str(operation / "candidate.zip")}


def check_config(config, operation):
    for key, value in fixed_config(operation).items():
        if config.get(key) != value:
            raise ValueError("configuration outside HML scope")
    if root_file(STATE / "contract.sha256").read_text().strip() != config.get("contract"):
        raise ValueError("pinned contract mismatch")
    if config.get("candidate", {}).get("gateway") != INITIAL_GATEWAY:
        raise ValueError("unexpected stable gateway")


def save_new(path, value):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    load("hml-update-safety").durable(path)


def prepare_operation(operation, config_path, identity):
    """Validate real ZIP/provenance and installed HML without loading or starting images."""
    if config_path.exists() or config_path.is_symlink() or (operation / "operation.json").exists():
        raise ValueError("prepare requires a fresh operation")
    safety = load("hml-update-safety")
    config = fixed_config(operation)
    archive = root_file(config["artifact_zip"])
    if any(type(identity.get(key)) is not int or identity[key] <= 0
           for key in ("artifact_id", "run_id", "attempt", "pr")) or not re.fullmatch(
               r"[a-f0-9]{40}", identity.get("revision") or ""):
        raise ValueError("invalid artifact identity")
    # Do not parse artifact contents until authenticated against GitHub.
    load("hml-artifact-provenance").verify(archive, **identity)
    base = ["docker", "compose", "--project-name", "funix-hml", "--env-file", RELEASE_ENV]
    for path in COMPOSE:
        base += ["-f", path]
    override = STATE / "images.json"
    if override.exists() or override.is_symlink():
        base += ["-f", str(root_file(override))]
    rendered = json.loads(subprocess.check_output(base + ["config", "--format", "json"],
                                                 text=True, timeout=45))
    digest = load("hml-docker-adapter").contract_digest(rendered)
    pin = STATE / "contract.sha256"
    if pin.exists() or pin.is_symlink():
        if root_file(pin).read_text().strip() != digest:
            raise ValueError("Compose differs from pinned HML contract")
    elif override.exists() or rendered["services"]["api"]["environment"].get("FUNIX_REVISION") != INITIAL_REVISION:
        raise ValueError("initial audited release changed; review required")
    config.update(contract=digest, identity=identity)
    adapter = make_adapter(config)
    current = installed_preflight(adapter)
    if current["gateway"] != INITIAL_GATEWAY:
        raise ValueError("stable audited gateway changed")
    with zipfile.ZipFile(archive) as bundle:
        info = bundle.getinfo("manifest.json")
        if info.file_size > 16384:
            raise ValueError("manifest too large")
        manifest = json.loads(bundle.read(info))
    config["candidate"] = {"revision": identity["revision"], "gateway": current["gateway"],
                           **{role: manifest["images"][role]["image_id"] for role in ("api", "web")}}
    prepare_candidate(config, adapter, safety, load_images=False)
    if not pin.exists():
        save_new(pin, digest + "\n")
    save_new(config_path, json.dumps(config, indent=2) + "\n")
    print("PREPARED_OK: artifact verified; no Docker images loaded or services changed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "preflight", "update", "recover", "rollback"))
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--operation", type=Path, required=True)
    parser.add_argument("--authorize", action="store_true")
    parser.add_argument("--discard-post-update-data", action="store_true")
    parser.add_argument("--artifact-id", type=int)
    parser.add_argument("--run-id", type=int)
    parser.add_argument("--attempt", type=int)
    parser.add_argument("--revision")
    parser.add_argument("--pr", type=int)
    args = parser.parse_args()
    if args.action in ("update", "recover", "rollback") and not args.authorize:
        raise ValueError("explicit maintenance authorization required")
    operation = host_scope(args.operation, args.config)
    if args.action == "prepare":
        prepare_operation(operation, args.config, {
            key: getattr(args, key) for key in ("artifact_id", "run_id", "attempt", "revision", "pr")})
        return
    config = json.loads(root_file(args.config).read_text())
    check_config(config, operation)
    if args.action == "preflight":
        installed_preflight(make_adapter(config))
        print("PREFLIGHT_OK")
        return
    transaction = execute_operation(args.action, config, operation, authorized=args.authorize,
                                    discard_post_update_data=args.discard_post_update_data)
    phase = json.loads(root_file(transaction.journal).read_text())["phase"]
    if phase not in ("accepted", "restored"):
        raise ValueError("operation incomplete; recovery required")
    print("HML_OPERATION_OK:", phase)


def prepare_candidate(config, adapter, safety, *, load_images=True):
        archive = safety.regular(Path(config["artifact_zip"]))
        identity = config["identity"]
        if archive.stat().st_uid != os.geteuid() or archive.stat().st_mode & 0o077:
            raise ValueError("artifact must be private")
        if config["candidate"]["revision"] != identity["revision"]:
            raise ValueError("candidate revision differs from artifact identity")
        load("hml-artifact-provenance").verify(archive, **identity)
        with tempfile.TemporaryDirectory(dir=config["state"], prefix="candidate-") as directory:
            with zipfile.ZipFile(archive) as bundle:
                if sorted(bundle.namelist()) != ["images.tar.gz", "manifest.json"]:
                    raise ValueError("unexpected artifact contents")
                entries = bundle.infolist()
                if (sum(e.file_size for e in entries) > 20 * 1024**3
                        or shutil.disk_usage(directory).free < sum(e.file_size for e in entries) + 64 * 1024**2
                        or bundle.getinfo("manifest.json").file_size > 16384):
                    raise ValueError("artifact too large or insufficient space")
                for entry in entries:
                    if entry.is_dir() or entry.file_size > 20 * 1024**3:
                        raise ValueError("invalid artifact entry")
                    with bundle.open(entry) as source, (Path(directory) / entry.filename).open("xb") as target:
                        shutil.copyfileobj(source, target)
            manifest = safety.verify_candidate(Path(directory), revision=identity["revision"],
                pr=identity["pr"], run_id=str(identity["run_id"]), run_attempt=str(identity["attempt"]))
            safety.verify_image_archive(Path(directory) / "images.tar.gz", manifest)
            # Validate the complete API/Web binding before any Docker mutation.
            for role, image in manifest["images"].items():
                if config["candidate"][role] != image["image_id"]:
                    raise ValueError("release differs from authenticated manifest")
            # Refuse to change any existing tag, including previously loaded HML tags.
            for image in manifest["images"].values():
                found = subprocess.run(["docker", "image", "inspect", image["tag"]], capture_output=True)
                if found.returncode == 0:
                    load("hml-image-identity").verify_local_image(
                        image["tag"], image["image_id"], directory=config["state"])
            if not load_images:
                return
            adapter.run(["docker", "load", "--input", str(Path(directory) / "images.tar.gz")])
            for role, image in manifest["images"].items():
                config["candidate"][role] = load("hml-image-identity").verify_local_image(
                    image["tag"], image["image_id"], directory=config["state"])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("BLOCKED: HML operation failed; inspect private journal before retry")
