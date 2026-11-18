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
    if config_path.stat().st_mode & 0o077:
        raise ValueError("configuration must be private")
    config = json.loads(config_path.read_text())
    credentials = safety.regular(Path(config["credentials"]))
    if credentials.stat().st_mode & 0o077:
        raise ValueError("credentials must be private")
    adapter = load("hml-docker-adapter").DockerAdapter(
        compose=config["compose"], contract=config["contract"], database=config["database"],
        state=config["state"], validator=validator(credentials), env_file=config.get("release_env"))
    if args.action == "preflight":
        adapter.preflight(config["candidate"])
        print("PREFLIGHT_OK")
        return
    if not args.authorize:
        raise ValueError("explicit authorization required")
    if args.action in ("update", "recover", "rollback"):
        raise ValueError("mutations blocked pending integrated maintenance validation")
    transaction = load("hml-update-transaction").Transaction(
        args.operation, adapter, project_state=config["state"])
    if args.action == "recover":
        transaction.recover(authorized=True)
    elif args.action == "rollback":
        transaction.rollback(authorized=True, discard_post_update_data=args.discard_post_update_data)
    else:
        transaction.update(config["candidate"], authorized=True,
                           prepare=lambda: prepare_candidate(config, adapter, safety))


def prepare_candidate(config, adapter, safety):
        archive = safety.regular(Path(config["artifact_zip"]))
        identity = config["identity"]
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
            # Refuse to change any existing tag, including previously loaded HML tags.
            for image in manifest["images"].values():
                import subprocess
                found = subprocess.run(["docker", "image", "inspect", image["tag"]], capture_output=True)
                if found.returncode == 0 and json.loads(found.stdout)[0]["Id"] != image["image_id"]:
                    raise ValueError("image tag collision")
            adapter.run(["docker", "load", "--input", str(Path(directory) / "images.tar.gz")])
            for role, image in manifest["images"].items():
                if config["candidate"][role] != image["image_id"]:
                    raise ValueError("release differs from authenticated manifest")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("BLOCKED: HML operation failed; inspect private journal before retry")
