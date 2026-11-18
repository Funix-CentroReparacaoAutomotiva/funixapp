"""Experimental Docker maintenance adapter. Not wired to the real CLI.

The coordinator owns the global lock and durable acceptance. No method below
may be called independently on an installed environment.
"""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load("hml-docker-adapter")
guard = load("hml-writer-guard")
maintenance = load("hml-maintenance")


def private_file(path, content, mode=0o600, gid=None):
    """Atomic replacement in a trusted private operation directory."""
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            if gid is not None:
                os.fchown(stream.fileno(), -1, gid)
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def gateway_config():
    return """worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 512; }
http {
    server_tokens off;
    access_log off;
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;
""" + maintenance.server_config() + "}\n"


TARGETS = {
    "/etc/nginx/nginx.conf": "gateway-nginx.conf",
    "/etc/nginx/hml.htpasswd": "gateway.htpasswd",
}


def mount_pairs(service):
    pairs = {}
    for mount in service.get("volumes", []):
        target = mount.get("target")
        if target in pairs:
            raise ValueError("duplicate gateway mount")
        if mount.get("type") == "tmpfs" and target == "/tmp" and not mount.get("source"):
            continue
        if (target not in TARGETS or mount.get("type") != "bind"
                or mount.get("read_only") is not True):
            raise ValueError("unexpected gateway mount")
        pairs[target] = mount.get("source")
    if set(pairs) != set(TARGETS):
        raise ValueError("incomplete gateway configuration mounts")
    return pairs


class MaintenanceDockerAdapter(base.DockerAdapter):
    def __init__(self, *, restricted_validator, **kwargs):
        super().__init__(**kwargs)
        if not callable(restricted_validator) or not callable(self.validator):
            raise ValueError("both gateway validators are required")
        self.restricted_validator = restricted_validator

    def operation_path(self):
        path = self.operation_directory
        info = path.lstat()
        if (path == self.state or path.resolve(strict=True) != path
                or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o700
                or guard.overlaps(path, self.database.parent)):
            raise ValueError("unsafe maintenance directory")
        return path

    def gate_path(self):
        return self.operation_path() / "maintenance.json"

    def gate_args(self):
        gate = self.gate_path()
        if not gate.is_file() or gate.is_symlink():
            raise ValueError("maintenance override missing")
        return self.release_args() + ["-f", str(gate)]

    def normal_mounts(self):
        pairs = mount_pairs(self.configuration()["services"]["gateway"])
        for target, filename in TARGETS.items():
            path = Path(pairs[target])
            # The reviewed installed HML paths are fixed. Do not substitute
            # arbitrary configuration or touch original bytes.
            if path != Path("/etc/funix-hml") / filename:
                raise ValueError("unexpected normal gateway path")
            info = path.lstat()
            if (path.resolve(strict=True) != path or not stat.S_ISREG(info.st_mode)
                    or info.st_nlink != 1 or info.st_uid != 0 or info.st_mode & 0o022):
                raise ValueError("unsafe normal gateway file")
        return pairs

    def preflight(self, candidate):
        previous = super().preflight(candidate)
        self.normal_mounts()
        return previous

    def stop_gateway(self):
        self.containers()
        self.run(self.release_args() + ["stop", "gateway"])
        if any(item["State"]["Running"] for item in self.containers()
               if item["Config"]["Labels"]["com.docker.compose.service"] == "gateway"):
            raise ValueError("gateway still running")

    def enter_maintenance(self):
        # Even after a crash, never change gate material while a gateway runs.
        self.stop_gateway()
        pairs = self.normal_mounts()
        root = self.operation_path()
        auth = Path(pairs["/etc/nginx/hml.htpasswd"]).stat()
        login, record = maintenance.new_credential()
        private_file(root / "maintenance-login.json", json.dumps(login))
        private_file(root / "maintenance-nginx.conf", gateway_config(), 0o644)
        private_file(root / "maintenance.htpasswd", record, 0o640, auth.st_gid)
        mounts = [{"type": "bind", "source": str(root / filename),
                   "target": target, "read_only": True,
                   "bind": {"create_host_path": False}}
                  for target, filename in (
                      ("/etc/nginx/nginx.conf", "maintenance-nginx.conf"),
                      ("/etc/nginx/hml.htpasswd", "maintenance.htpasswd"))]
        private_file(self.gate_path(), json.dumps({"services": {"gateway": {"volumes": mounts}}}))
        self.verify_gate_configuration()

    def verify_gate_configuration(self):
        original = self.configuration()
        rendered = json.loads(self.run(self.gate_args() + ["config", "--format", "json"]))
        root = self.operation_path()
        expected = {"/etc/nginx/nginx.conf": str(root / "maintenance-nginx.conf"),
                    "/etc/nginx/hml.htpasswd": str(root / "maintenance.htpasswd")}
        if mount_pairs(rendered["services"]["gateway"]) != expected:
            raise ValueError("maintenance mounts differ")
        # Compare all other effective configuration including labels, networks,
        # image, command, healthcheck and API/Web configuration.
        for config in (original, rendered):
            service = config["services"]["gateway"]
            service["volumes"] = [
                volume for volume in service.get("volumes", [])
                if volume.get("target") not in TARGETS]
        if original != rendered:
            raise ValueError("maintenance changed unrelated Compose configuration")

    def quiesce(self):
        super().quiesce()
        # Also reject parent/subdirectory binds, even read-only. A trusted
        # operator must exclude concurrent administrative operations.
        ids = self.run(["docker", "ps", "--quiet"]).split()
        if ids:
            for item in json.loads(self.run(["docker", "inspect", *ids])):
                for mount in item.get("Mounts", []):
                    source = mount.get("Source")
                    if source and guard.overlaps(source, self.database.parent):
                        raise ValueError("overlapping external container mount")
        guard.assert_quiescent(self.database.parent)

    def install(self, release):
        self.stop_gateway()
        self.write_release(release)
        self.verify_gate_configuration()
        self.run(self.gate_args() + ["up", "--detach", "--no-build", "--pull", "never",
                                    "--no-deps", "api", "web"])
        self.run(self.gate_args() + ["up", "--detach", "--no-build", "--pull", "never",
                                    "--no-deps", "--force-recreate", "gateway"])
        self.assert_installed(release)
        self.assert_gateway_mounts(restricted=True)

    def assert_gateway_mounts(self, *, restricted):
        gateways = [item for item in self.containers()
                    if item["Config"]["Labels"]["com.docker.compose.service"] == "gateway"]
        if len(gateways) != 1:
            raise ValueError("gateway missing or duplicated")
        root = self.operation_path()
        expected = ({"/etc/nginx/nginx.conf": str(root / "maintenance-nginx.conf"),
                     "/etc/nginx/hml.htpasswd": str(root / "maintenance.htpasswd")}
                    if restricted else self.normal_mounts())
        mounts = [mount for mount in gateways[0].get("Mounts", [])
                  if mount.get("Type") != "tmpfs"]
        actual = {mount["Destination"]: mount["Source"] for mount in mounts
                  if mount.get("Type") == "bind" and mount.get("RW") is False}
        if len(mounts) != len(expected) or actual != expected:
            raise ValueError("live gateway mounts differ from expected mode")

    def validate(self, release):
        self.assert_installed(release)
        self.assert_gateway_mounts(restricted=True)
        original = self.validator
        try:
            self.validator = lambda value: self.restricted_validator(
                value, self.operation_path() / "maintenance-login.json")
            super().validate(release)
        finally:
            self.validator = original

    def open_access(self, release):
        # Coordinator only calls after durable accepted/restored_pending_open.
        # Recreate normal gateway from original mounts; never modify API or DB.
        self.assert_installed(release)
        self.stop_gateway()
        try:
            self.normal_mounts()
            self.run(self.release_args() + ["up", "--detach", "--no-build", "--pull", "never",
                                           "--no-deps", "--force-recreate", "gateway"])
            self.assert_installed(release)
            self.assert_gateway_mounts(restricted=False)
            super().validate(release)
        except BaseException:
            self.stop_gateway()
            raise
