"""Offline file primitives for a pinned, Cilia-only HML Compose override.

Not a standalone deployer: no CLI, Docker, privileges, network, or gateway
operations. Caller MUST hold the shared updater lock, verify the existing
Compose/runtime, gate public access, authorize the exact transition, then
verify both the new normalized Compose and live API. Do not invoke this module
directly on a server.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile


OVERRIDE_NAME = "cilia-flags.json"
PIN_NAME = "contract.sha256"
SNAPSHOT_NAME = "cilia-files-backup.json"
PREVIEW = "FUNIX_CILIA_PREVIEW_ENABLED"
WRITE = "FUNIX_CILIA_WRITE_ENABLED"


def require(ok, reason):
    if not ok:
        raise ValueError("HML Cilia store: " + reason)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical_directory(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path,
            "noncanonical directory")
    meta = path.lstat()
    require(stat.S_ISDIR(meta.st_mode) and stat.S_IMODE(meta.st_mode) == 0o700
            and meta.st_uid == os.geteuid(), "directory not private")
    return path


def existing_file(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("HML Cilia store: symlink prohibited")
    if not path.exists():
        return None
    meta = path.lstat()
    require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1
            and meta.st_uid == os.geteuid()
            and not (stat.S_IMODE(meta.st_mode) & 0o022), "untrusted file")
    return path.read_bytes()


def atomic_replace(path, contents):
    """Same-directory fsync + rename; no fixed temp name or followable target."""
    path = Path(path)
    existing_file(path)
    fd, temp = tempfile.mkstemp(prefix=".cilia-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            os.fchmod(out.fileno(), 0o600)
            out.write(contents)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
        dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        Path(temp).unlink(missing_ok=True)


def validate_override(raw):
    """Only the API two-flag shape is permitted in the optional override."""
    if raw is None:
        return None
    require(len(raw) <= 2048, "override too large")
    def unique(pairs):
        out = {}
        for key, value in pairs:
            require(key not in out, "duplicate override key")
            out[key] = value
        return out
    try:
        data = json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("HML Cilia store: invalid override JSON") from exc
    require(isinstance(data, dict) and set(data) == {"services"}, "override scope differs")
    services = data["services"]
    require(isinstance(services, dict) and set(services) == {"api"}, "override service differs")
    api = services["api"]
    require(isinstance(api, dict) and set(api) == {"environment"}, "override API differs")
    env = api["environment"]
    require(isinstance(env, dict) and set(env) == {PREVIEW, WRITE}
            and env[PREVIEW] in ("true", "false") and env[WRITE] == "false",
            "override flags differ")
    return env


def override_bytes(preview):
    require(type(preview) is bool, "invalid preview request")
    return (json.dumps({"services": {"api": {"environment": {
        PREVIEW: "true" if preview else "false", WRITE: "false"
    }}}}, sort_keys=True, separators=(",", ":")) + "\n").encode()


def check_hash(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value),
            "invalid SHA-256")


class Store:
    """File half of a transaction, without any Docker or updater side effects."""

    def __init__(self, state, operation):
        self.state = canonical_directory(state)
        self.operation = canonical_directory(operation)
        require(self.operation.parent == self.state
                and self.operation.name.startswith("op-cilia-"), "operation scope differs")
        self.pin = self.state / PIN_NAME
        self.override = self.state / OVERRIDE_NAME
        self.snapshot = self.operation / SNAPSHOT_NAME

    def observe(self):
        pin = existing_file(self.pin)
        require(pin is not None and len(pin) == 65 and pin.endswith(b"\n"),
                "missing canonical pinned contract")
        current = pin[:-1].decode("ascii")
        check_hash(current)
        override = existing_file(self.override)
        validate_override(override)
        return current, override

    def prepare(self, old_digest):
        """Persist exact prior file state before any mutation; never overwrite."""
        check_hash(old_digest)
        require(not self.snapshot.exists() and not self.snapshot.is_symlink(),
                "existing snapshot")
        pin, override = self.observe()
        require(pin == old_digest, "pinned contract drift")
        record = {
            "schema": "funix-hml-cilia-files/1",
            "old_contract_sha256": pin,
            "override_present": override is not None,
            "override_sha256": digest(override) if override is not None else None,
            "override_hex": override.hex() if override is not None else None,
        }
        # The only backed-up user data here is a fixed two-flag JSON, no Compose
        # environment dump, passwords, or third-party credentials.
        fd = os.open(self.snapshot, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as file:
            file.write((json.dumps(record, sort_keys=True) + "\n").encode())
            file.flush()
            os.fsync(file.fileno())
        dfd = os.open(self.operation, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
        return SNAPSHOT_NAME

    def _snapshot(self, name):
        require(name == SNAPSHOT_NAME, "unexpected snapshot")
        raw = existing_file(self.snapshot)
        require(raw is not None and len(raw) <= 8192, "snapshot missing or too large")
        data = json.loads(raw)
        require(isinstance(data, dict)
                and set(data) == {"schema", "old_contract_sha256",
                                  "override_present", "override_sha256", "override_hex"}
                and data["schema"] == "funix-hml-cilia-files/1"
                and type(data["override_present"]) is bool, "invalid snapshot")
        check_hash(data["old_contract_sha256"])
        if data["override_present"]:
            require(isinstance(data["override_hex"], str), "missing override backup")
            previous = bytes.fromhex(data["override_hex"])
            validate_override(previous)
            require(digest(previous) == data["override_sha256"], "backup checksum differs")
        else:
            require(data["override_hex"] is None and data["override_sha256"] is None,
                    "unexpected backup")
            previous = None
        return data, previous

    def stage_override(self, name, old_digest, preview):
        """Persist only the preview overlay; pin remains unchanged until verified.

        Caller must keep HML in the restricted maintenance gate and render the
        effective Docker Compose with this staged override before committing.
        """
        check_hash(old_digest)
        data, old_override = self._snapshot(name)
        require(data["old_contract_sha256"] == old_digest, "snapshot pin mismatch")
        pin, current_override = self.observe()
        require(pin == old_digest and current_override == old_override,
                "pre-transition files differ")
        atomic_replace(self.override, override_bytes(preview))

    def commit_pin(self, name, plan_record, original, observed):
        """Accept a new pin only after independently verifying full Compose delta.

        The caller must get 'observed' from Docker Compose using the staged
        override, not copy or reconstruct it from the plan itself. This method
        intentionally does not invoke Docker or take authority to deploy.
        """
        data, previous = self._snapshot(name)
        require(plan_record["old_contract_sha256"] == data["old_contract_sha256"],
                "snapshot pin mismatch")
        pinned, staged = self.observe()
        require(pinned == data["old_contract_sha256"]
                and staged == override_bytes(plan_record["to"] == "PREVIEW_ONLY"),
                "staged flags or pinned contract differ")
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "hml_cilia_plan_store", Path(__file__).with_name("hml-cilia-plan.py"))
        planner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(planner)
        planner.verify_applied(plan_record, original, observed)
        atomic_replace(self.pin, (plan_record["new_contract_sha256"] + "\\n").encode())
        require(self.observe()[0] == plan_record["new_contract_sha256"],
                "accepted contract pin differs")

    def restore(self, name, old_digest, new_digest, preview):
        """Restore original bytes, including an absent override, idempotently.

        Reject unknown config states rather than replacing arbitrary changes.
        Only to be called after the maintenance gateway has been verified active.
        """
        data, previous = self._snapshot(name)
        require(data["old_contract_sha256"] == old_digest, "snapshot mismatch")
        pin, current_override = self.observe()
        wanted = override_bytes(preview)
        require(pin in (old_digest, new_digest), "unknown current contract")
        require(current_override in (previous, wanted), "unknown current override")
        if previous is None:
            if self.override.exists() or self.override.is_symlink():
                require(not self.override.is_symlink(), "unsafe override")
                self.override.unlink()
                dfd = os.open(self.state, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(dfd)
                finally:
                    os.close(dfd)
        else:
            atomic_replace(self.override, previous)
        atomic_replace(self.pin, (old_digest + "\n").encode())
        restored_pin, restored_override = self.observe()
        require((restored_pin, restored_override) == (old_digest, previous),
                "restoration differs")
