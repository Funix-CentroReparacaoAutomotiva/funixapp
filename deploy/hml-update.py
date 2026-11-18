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
import zipfile


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
    def validate(release):
        token = read_login(credentials)
        normal = read_login(normal_credentials) if normal_credentials is not None else None
        if normal == token:
            raise ValueError("maintenance credential matches normal login")

        def request(method, endpoint, auth, expected):
            connection = http.client.HTTPSConnection("hml.funix.com.br", timeout=10,
                                                     context=ssl.create_default_context())
            try:
                connection.request(method, endpoint, headers={"Authorization": auth} if auth else {})
                response = connection.getresponse()
                body = response.read(100001)
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
    """Integration seam; only exercised by the disposable Docker rehearsal for now."""
    if authorized is not True or action not in ("update", "recover", "rollback"):
        raise ValueError("explicit maintenance authorization required")
    if action == "rollback" and discard_post_update_data is not True:
        raise ValueError("explicit post-update data loss acknowledgement required")
    adapter = make_adapter(config)
    transaction = load("hml-update-transaction").Transaction(
        operation, adapter, project_state=config["state"], maintenance=True)
    if action == "recover":
        transaction.recover(authorized=True)
    elif action == "rollback":
        transaction.rollback(authorized=True, discard_post_update_data=True)
    else:
        transaction.update(config["candidate"], authorized=True,
                           prepare=lambda: prepare_candidate(config, adapter,
                                                             load("hml-update-safety")))
    return transaction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "update", "recover", "rollback"))
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--operation", type=Path, required=True)
    parser.add_argument("--authorize", action="store_true")
    parser.add_argument("--discard-post-update-data", action="store_true")
    args = parser.parse_args()
    safety = load("hml-update-safety")
    config_path = safety.regular(args.config)
    if config_path.stat().st_uid != os.geteuid() or config_path.stat().st_mode & 0o077:
        raise ValueError("configuration must be private")
    config = json.loads(config_path.read_text())
    if args.action == "preflight":
        installed_preflight(make_adapter(config))
        print("PREFLIGHT_OK")
        return
    # Fail closed until the shared entry point and artifact transport are rehearsed.
    # Do not turn authorization on the command line into permission to skip validation.
    raise ValueError("mutations blocked pending integrated artifact and maintenance validation")


def prepare_candidate(config, adapter, safety):
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
                for entry in bundle.infolist():
                    if entry.file_size > 20 * 1024**3:
                        raise ValueError("artifact too large")
                    with bundle.open(entry) as source, (Path(directory) / entry.filename).open("xb") as target:
                        import shutil
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
                import subprocess
                found = subprocess.run(["docker", "image", "inspect", image["tag"]], capture_output=True)
                if found.returncode == 0 and json.loads(found.stdout)[0]["Id"] != image["image_id"]:
                    raise ValueError("image tag collision")
            adapter.run(["docker", "load", "--input", str(Path(directory) / "images.tar.gz")])
            for role, image in manifest["images"].items():
                loaded = json.loads(adapter.run(["docker", "image", "inspect", image["tag"]]))
                if len(loaded) != 1 or loaded[0]["Id"] != image["image_id"]:
                    raise ValueError("loaded image differs from authenticated manifest")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("BLOCKED: HML operation failed; inspect private journal before retry")
