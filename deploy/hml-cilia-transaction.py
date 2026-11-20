"""HML Cilia preview configuration transaction coordinator (not a host CLI).

This module is only a state machine. The trusted adapter must implement exact
HML-scoped writes, maintenance-gateway protection, and live validation. There
is deliberately NO command execution or direct write of Compose, Docker,
credentials, application database or pinned contract here.

Controller integration and authorization are REQUIRED before any live use.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat


def load_plan():
    path = Path(__file__).with_name("hml-cilia-plan.py")
    spec = importlib.util.spec_from_file_location("funix_hml_cilia_plan_tx", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(ok, message):
    if not ok:
        raise ValueError("Cilia HML transaction: " + message)


class Transaction:
    """Fail-closed gate with durable intention, explicit recovery and no auto retry.

    Adapter interface is intentionally not implemented by the current Docker
    adapter. Integrator MUST supply a reviewed implementation with privileged
    host-scope attestation and root-owned durable snapshots.
    """

    def __init__(self, state, operation, adapter):
        self.state = Path(state)
        self.operation = Path(operation)
        self.adapter = adapter
        for directory in (self.state, self.operation):
            require(directory.is_absolute() and directory.resolve(strict=True) == directory,
                    "noncanonical directory")
            info = directory.lstat()
            require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
                    and info.st_uid == os.geteuid(), "directory must be private and owned")
        require(self.operation.parent == self.state and self.operation.name.startswith("op-cilia-"),
                "out-of-scope operation")
        for name in ("observe", "assert_safe", "backup", "enter_maintenance",
                     "switch_to", "validate", "restore", "open_access"):
            require(callable(getattr(adapter, name, None)), "adapter incomplete")
        self.journal = self.operation / "cilia-transaction.json"

    def _atomic(self, path, data):
        temporary = path.with_name(path.name + ".new")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, sort_keys=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        finally:
            temporary.unlink(missing_ok=True)

    def _lock(self):
        path = self.state / "lock"  # SAME global lock as the official update transaction.
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        return os.fdopen(fd, "r+")

    def _read(self):
        require(self.journal.is_file() and not self.journal.is_symlink(), "journal missing")
        info = self.journal.lstat()
        require(info.st_uid == os.geteuid() and info.st_nlink == 1
                and not (stat.S_IMODE(info.st_mode) & 0o077), "unsafe journal")
        record = json.loads(self.journal.read_text())
        require(isinstance(record, dict)
                and record.get("schema") == "funix-hml-cilia-tx/1"
                and record.get("scope") == "funix-hml"
                and record.get("phase") in ("prepared", "protected", "switching",
                                            "validating", "reverting", "reverted",
                                            "accepted_pending_open", "reverted_pending_open",
                                            "accepted")
                and record.get("plan", {}).get("schema") == "funix-hml-cilia-plan/1",
                "invalid journal")
        return record

    def _active(self):
        path = self.state / "active.json"  # Existing updater's single active operation.
        require(path.is_file() and not path.is_symlink(), "updater active pointer missing")
        data = json.loads(path.read_text())
        linked = Path(data.get("journal", ""))
        require(linked.is_absolute() and linked.parent.parent == self.state
                and linked.parent.name.startswith("op-") and linked.name == "operation.json"
                and linked.parent != self.operation,
                "unexpected updater journal")
        op = json.loads(linked.read_text())
        require(op.get("phase") in ("accepted", "restored"),
                "updater recovery pending")
        # A Cilia transition NEVER overwrites this pointer or historical journals.

    def _phase(self, record, phase):
        record["phase"] = phase
        self._atomic(self.journal, record)

    def apply(self, target, expected_digest, expected_revision, *, authorized=False):
        require(authorized is True, "explicit authorization required")
        with self._lock():
            self._active()
            require(not self.journal.exists() and not self.journal.is_symlink(),
                    "operation already exists; recovery or new operation required")
            before = self.adapter.observe()
            self.adapter.assert_safe(before, expected_revision)
            planner = load_plan()
            plan = planner.plan(before, target, expected_digest, expected_revision)
            # An adapter must produce durable, private, independently verifiable
            # snapshots of the exact effective config and pinned contract BEFORE
            # the first mutation. Never copy Compose/env contents into journal.
            backup_ref = self.adapter.backup(before, plan)
            require(isinstance(backup_ref, str) and backup_ref and "/" not in backup_ref,
                    "invalid backup reference")
            record = {"schema": "funix-hml-cilia-tx/1", "scope": "funix-hml",
                      "phase": "prepared", "plan": plan, "backup_ref": backup_ref}
            self._phase(record, "prepared")
            # No exception handling around maintenance and reopening: after any
            # crash, caller must inspect journal and explicitly recover; never
            # automatically expose an unvalidated state.
            self.adapter.enter_maintenance()
            self._phase(record, "protected")
            self._phase(record, "switching")
            self.adapter.switch_to(plan, backup_ref)
            self._phase(record, "validating")
            observed = self.adapter.observe()
            planner.verify_applied(plan, before, observed)
            self.adapter.validate(plan)
            self._phase(record, "accepted_pending_open")
            self.adapter.open_access(plan)
            self._phase(record, "accepted")
            return plan

    def recover(self, *, authorized=False):
        require(authorized is True, "explicit recovery authorization required")
        with self._lock():
            self._active()
            record = self._read()
            phase = record["phase"]
            if phase == "reverted":
                return "reverted"
            if phase == "accepted":
                return "accepted"
            plan = record["plan"]
            if phase == "accepted_pending_open":
                # Durable acceptance is a security/availability boundary:
                # do not roll back after it, only complete safe reopening.
                self.adapter.validate(plan)
                self.adapter.open_access(plan)
                self._phase(record, "accepted")
                return "accepted"
            if phase == "reverted_pending_open":
                prior = {"revision": plan["revision"],
                         "new_contract_sha256": plan["old_contract_sha256"],
                         "to": plan["from"]}
                self.adapter.validate(prior)
                self.adapter.open_access(prior)
                self._phase(record, "reverted")
                return "reverted"
            # A prepared-only journal may predate maintenance; adapter.restore
            # must be idempotent and refuse to overwrite unknown changes.
            self.adapter.enter_maintenance()
            self._phase(record, "reverting")
            self.adapter.restore(plan, record["backup_ref"])
            self.adapter.validate({"revision": plan["revision"],
                                   "new_contract_sha256": plan["old_contract_sha256"],
                                   "to": plan["from"]})
            self._phase(record, "reverted_pending_open")
            self.adapter.open_access({"revision": plan["revision"],
                                      "new_contract_sha256": plan["old_contract_sha256"],
                                      "to": plan["from"]})
            self._phase(record, "reverted")
            return "reverted"
