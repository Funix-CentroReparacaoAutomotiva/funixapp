"""Explicit local Docker rehearsal, never invoked on a VPS or by unit discovery."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    adapter_module = load("hml-docker-adapter")
    transaction = load("hml-update-transaction")
    def run(*args):
        return subprocess.check_output(args, text=True)
    # Dedicated empty local daemon is required; never adopt existing resources.
    if run("docker", "ps", "-aq").strip():
        raise RuntimeError("rehearsal requires empty local daemon")
    image = json.loads(run("docker", "image", "inspect", "python:3.12-alpine"))[0]["Id"]
    variants = []
    for revision in ("b" * 40, "c" * 40):
        container = run("docker", "create", image, "python", "-c", "pass").strip()
        try:
            variants.append(run("docker", "commit", "--change",
                                "LABEL org.opencontainers.image.revision=" + revision, container).strip())
        finally:
            run("docker", "rm", container)
    with tempfile.TemporaryDirectory(prefix="funix-hml-synthetic-") as directory:
        root = Path(directory)
        os.chmod(root, 0o700)
        database = root / "funix.sqlite"
        with sqlite3.connect(database) as db:
            db.executescript("CREATE TABLE schema_migrations(version INTEGER); INSERT INTO schema_migrations VALUES(1);"
                             "CREATE TABLE atendimentos(value TEXT); INSERT INTO atendimentos VALUES('original');"
                             "CREATE TABLE scenarios(id INTEGER); CREATE TABLE budget_versions(id INTEGER);")
        services = {}
        for role in ("api", "web", "gateway"):
            services[role] = dict(image=image, read_only=True,
                command=["python", "-c", "import time; time.sleep(3600)"],
                healthcheck={"test": ["CMD", "python", "-c", "pass"], "interval": "1s"},
                networks=["funix-hml_privada"] + (["traefik_default"] if role == "gateway" else []))
        services["api"].update(environment={"FUNIX_REVISION": "a" * 40},
                                volumes=[f"{root}:/data"])
        compose = root / "compose.json"
        compose.write_text(json.dumps({"services": services, "networks": {
            "funix-hml_privada": {"name": "funix-hml_privada", "internal": True},
            "traefik_default": {"name": "traefik_default", "internal": True}}}))
        base = ["docker", "compose", "-p", "funix-hml", "-f", str(compose)]
        try:
            run(*base, "up", "-d", "--pull", "never")
            contract = json.loads(run(*base, "config", "--format", "json"))
            adapter = adapter_module.DockerAdapter(compose=compose, contract=contract,
                database=database, state=root, validator=lambda release: None)
            operation = transaction.Transaction(root / "operation", adapter, project_state=root / "state")
            candidate = dict(api=variants[0], web=variants[0], gateway=image, revision="b" * 40)
            operation.update(candidate, authorized=True)
            second = transaction.Transaction(root / "second", adapter, project_state=root / "state")
            next_candidate = dict(api=variants[1], web=variants[1], gateway=image, revision="c" * 40)
            second.update(next_candidate, authorized=True)
            assert json.loads(second.journal.read_text())["previous"]["revision"] == "b" * 40
            second.rollback(authorized=True, discard_post_update_data=True)
            # Incompatible data migration, executed inside the candidate API.
            run(*base, "exec", "-T", "api", "python", "-c",
                "import sqlite3; c=sqlite3.connect('/data/funix.sqlite'); c.execute(\"UPDATE atendimentos SET value='migrated'\"); c.commit()")
            operation.rollback(authorized=True, discard_post_update_data=True)
            with sqlite3.connect(database) as db:
                assert db.execute("SELECT value FROM atendimentos").fetchone() == ("original",)
            interrupted = transaction.Transaction(root / "interrupted", adapter,
                                                  project_state=root / "state")
            previous = adapter.preflight(candidate)
            adapter.quiesce()
            digest = transaction.safety.snapshot(database, interrupted.root / "backup.sqlite")
            interrupted.save(dict(schema=1, project="funix-hml", phase="installing",
                                  previous=previous, candidate=candidate, backup_sha256=digest))
            adapter.install(candidate)
            # Reconstruct coordinator as after process termination, using persisted journal.
            resumed = transaction.Transaction(interrupted.root, adapter, project_state=root / "state")
            resumed.recover(authorized=True)
            assert json.loads(resumed.journal.read_text())["phase"] == "restored"
            print("DOCKER_SYNTHETIC_UPDATE_ROLLBACK_OK")
        finally:
            subprocess.run(base + ["rm", "--stop", "--force"], check=True)


if __name__ == "__main__":
    main()
