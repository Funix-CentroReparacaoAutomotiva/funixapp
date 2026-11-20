"""Docker Compose adapter for a reviewed, pinned HML configuration.

The caller supplies an independently reviewed normalized Compose contract.
Only image IDs may differ between releases; gateway remains pinned.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


def contract_digest(value):
    """Pin the normalized Compose without persisting a second copy of its secrets."""
    value = json.loads(json.dumps(value))
    if value.get("name") != "funix-hml" or set(value.get("services", {})) != {"api", "web", "gateway"}:
        raise ValueError("unexpected Compose project or services")
    for role, service in value["services"].items():
        service.pop("image", None)
        if role == "api":
            service.get("environment", {}).pop("FUNIX_REVISION", None)
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class DockerAdapter:
    def __init__(self, *, compose, contract, database, state, validator, env_file=None):
        files = compose if isinstance(compose, list) else [compose]
        self.compose = Path(files[0]).resolve(strict=True)
        self.contract = contract
        self.database = Path(database).resolve(strict=True)
        self.state = Path(state).resolve(strict=True)
        self.validator = validator
        self.operation_directory = self.state
        self.override = self.state / "images.json"
        self.base = ["docker", "compose", "--project-name", "funix-hml"]
        if env_file:
            self.base += ["--env-file", str(Path(env_file).resolve(strict=True))]
        for file in files:
            self.base += ["-f", str(Path(file).resolve(strict=True))]

    def run(self, arguments):
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise RuntimeError("HML Docker command failed")
        return result.stdout

    def configuration(self):
        return json.loads(self.run(self.release_args() + ["config", "--format", "json"]))

    def release_args(self):
        return self.base + (["-f", str(self.override)] if self.override.exists() else [])

    def containers(self):
        ids = self.run(self.base + ["ps", "--all", "--quiet"]).split()
        records = json.loads(self.run(["docker", "inspect", *ids])) if ids else []
        for item in records:
            labels = item["Config"].get("Labels", {})
            if (labels.get("com.docker.compose.project") != "funix-hml"
                    or labels.get("com.docker.compose.service") not in ("api", "web", "gateway")):
                raise ValueError("out-of-scope Docker resource")
        return records

    def check_release(self, release):
        import re
        if set(release) != {"api", "web", "gateway", "revision"}:
            raise ValueError("invalid release")
        if not re.fullmatch(r"[a-f0-9]{40}", release["revision"]):
            raise ValueError("invalid revision")
        for role in ("api", "web", "gateway"):
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", release[role]):
                raise ValueError("image must be pinned by ID")
            self.run(["docker", "image", "inspect", release[role]])

    def assert_installed(self, release):
        records = self.containers()
        actual = {item["Config"]["Labels"]["com.docker.compose.service"]: item["Image"] for item in records}
        if any(actual.get(role) != release[role] for role in ("api", "web", "gateway")):
            raise ValueError("installed release differs from operation")
        environment = self.configuration()["services"]["api"].get("environment", {})
        if environment.get("FUNIX_REVISION") != release["revision"]:
            raise ValueError("installed revision differs from operation")

    def assert_contract(self):
        config = self.configuration()
        expected = self.contract if isinstance(self.contract, str) else contract_digest(self.contract)
        if contract_digest(config) != expected:
            raise ValueError("Compose differs from reviewed contract")
        return config

    def preflight(self, candidate):
        self.check_release(candidate)
        config = self.assert_contract()
        if set(config["services"]) != {"api", "web", "gateway"}:
            raise ValueError("unexpected service set")
        for role, service in config["services"].items():
            if (service.get("privileged") or service.get("ports")
                    or service.get("network_mode") or not service.get("read_only")
                    or service.get("devices") or service.get("cap_add")):
                raise ValueError("unsafe service")
            expected = {"funix-hml_privada"}
            if role == "gateway":
                expected.add("traefik_default")
            physical = {config["networks"][name]["name"] for name in service.get("networks", {})}
            if physical != expected:
                raise ValueError("unexpected networks")
            for mount in service.get("volumes", []):
                if (mount.get("type") == "tmpfs" and role in ("api", "web")
                        and mount.get("target") == "/tmp" and not mount.get("source")):
                    continue
                source = Path(mount.get("source", ""))
                if mount.get("type") != "bind" or not source.is_absolute() or source.resolve() != source:
                    raise ValueError("unsupported or noncanonical mount")
                data = role == "api" and source == self.database.parent and mount.get("target") == "/data"
                configuration = (source.is_relative_to("/etc/funix-hml") and mount.get("read_only") is True)
                if not (data or configuration):
                    raise ValueError("mount outside HML policy")
            for key, value in service.get("environment", {}).items():
                if key.endswith(("_ENABLED", "_ENABLE")) and str(value).lower() not in ("false", "0", ""):
                    # Only the non-persistent Cilia read/compare preview is allowed.
                    # The isolation validator separately rejects Cilia write and any
                    # unrelated/unknown FUNIX flag, even if introduced to Compose.
                    if role != "api" or key != "FUNIX_CILIA_PREVIEW_ENABLED" or value != "true":
                        raise ValueError("external integration flag enabled")
        records = self.containers()
        previous = {item["Config"]["Labels"]["com.docker.compose.service"]: item["Image"]
                    for item in records}
        if set(previous) != {"api", "web", "gateway"} or len(records) != 3:
            raise ValueError("incomplete or duplicated HML")
        if candidate["gateway"] != previous["gateway"]:
            raise ValueError("gateway image must remain stable")
        previous["revision"] = config["services"]["api"]["environment"]["FUNIX_REVISION"]
        if shutil.disk_usage(self.database.parent).free < self.database.stat().st_size * 4 + 64 * 1024**2:
            raise ValueError("insufficient backup space")
        return previous

    def quiesce(self):
        self.containers()
        self.run(self.base + ["stop", "gateway", "api", "web"])
        if any(item["State"]["Running"] for item in self.containers()):
            raise ValueError("HML containers still running")
        # Reject another Docker container sharing the database directory.
        ids = self.run(["docker", "ps", "--quiet"]).split()
        if ids:
            for item in json.loads(self.run(["docker", "inspect", *ids])):
                for mount in item.get("Mounts", []):
                    source = Path(mount.get("Source", "/nonexistent"))
                    if source == self.database.parent or source == self.database:
                        raise ValueError("another container can write HML database")

    def write_release(self, release):
        self.check_release(release)
        data = {"services": {role: {"image": release[role]} for role in ("api", "web", "gateway")}}
        data["services"]["api"]["environment"] = {"FUNIX_REVISION": release["revision"]}
        temporary = self.state / "images.new"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.override)
        fd = os.open(self.state, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def install(self, release):
        self.write_release(release)
        self.run(self.release_args() + ["up", "--detach", "--no-build",
                                        "--pull", "never", "--no-deps", "api", "web", "gateway"])

    def validate(self, release):
        for _ in range(30):
            records = self.containers()
            if len(records) == 3 and all(item["State"].get("Health", {}).get("Status") == "healthy"
                                         for item in records):
                self.validator(release)
                return
            time.sleep(1)
        raise ValueError("HML health deadline exceeded")

    def restore_database(self, staged):
        self.quiesce()
        metadata = self.database.stat()
        failed = self.operation_directory / "failed-database"
        failed.mkdir(mode=0o700, exist_ok=True)
        # Preserve failed database and auxiliary files, idempotently on recovery.
        for suffix in ("", "-wal", "-shm", "-journal"):
            source = Path(str(self.database) + suffix)
            target = failed / ("funix.sqlite" + suffix)
            if source.exists() and not target.exists():
                shutil.copy2(source, target)
            if suffix and source.exists():
                source.unlink()
        temporary = self.database.with_name("funix.restore-new")
        with staged.open("rb") as inp, temporary.open("wb") as out:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.database)
