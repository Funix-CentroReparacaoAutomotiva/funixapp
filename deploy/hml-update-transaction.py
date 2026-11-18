"""Durable HML update coordinator; Docker policy belongs to the adapter.

The adapter must enforce project isolation and quiescence. Recovery always
rolls an interrupted operation back; it never resumes candidate execution.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "safety", Path(__file__).with_name("hml-update-safety.py"))
safety = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(safety)


class Transaction:
    def __init__(self, directory, adapter, *, project_state=None):
        self.root = Path(directory)
        safety.require(self.root.is_absolute() and self.root.resolve() == self.root,
                       "noncanonical journal directory")
        self.root.mkdir(mode=0o700, exist_ok=True)
        safety.require(self.root.stat().st_mode & 0o777 == 0o700,
                       "journal directory must be private")
        self.adapter = adapter
        self.project_state = Path(project_state or "/var/lib/funix-hml/updater")
        safety.require(self.project_state.is_absolute()
                       and self.project_state.resolve() == self.project_state,
                       "noncanonical project state")
        self.project_state.mkdir(mode=0o700, parents=True, exist_ok=True)
        safety.require(self.project_state.stat().st_mode & 0o777 == 0o700,
                       "project state must be private")
        self.journal = self.root / "operation.json"

    def save(self, record):
        temporary = self.root / "operation.new"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC |
                     os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(record, stream, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.journal)
        safety.durable(self.journal)

    def locked(self):
        fd = os.open(self.project_state / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        return os.fdopen(fd, "r+")

    def update(self, candidate, *, authorized=False):
        safety.require(authorized is True, "explicit update authorization required")
        with self.locked():
            if self.journal.exists():
                old = json.loads(safety.regular(self.journal).read_text())
                safety.require(old["phase"] in ("accepted", "restored"),
                               "interrupted operation requires recovery")
                raise safety.Blocked("use a new private operation directory")
            previous = self.adapter.preflight(candidate)
            record = {"schema": 1, "project": "funix-hml", "phase": "prepared",
                      "previous": previous, "candidate": candidate}
            self.save(record)
            try:
                # Persist intent before every potentially interrupted mutation.
                record["phase"] = "quiescing"
                self.save(record)
                self.adapter.quiesce()
                digest = safety.snapshot(self.adapter.database, self.root / "backup.sqlite")
                record.update(backup_sha256=digest, phase="installing")
                self.save(record)
                self.adapter.install(candidate)
                self.adapter.validate(candidate)
                record["phase"] = "accepted"
                self.save(record)
            except Exception:
                self.restore(record)
                raise

    def recover(self, *, authorized=False):
        safety.require(authorized is True, "explicit recovery authorization required")
        with self.locked():
            record = json.loads(safety.regular(self.journal).read_text())
            safety.require(record.get("schema") == 1 and record.get("project") == "funix-hml",
                           "invalid recovery journal")
            if record["phase"] == "restored":
                return
            safety.require(record["phase"] != "accepted",
                           "accepted update requires explicit rollback and current-data backup")
            self.restore(record)

    def rollback(self, *, authorized=False, discard_post_update_data=False):
        safety.require(authorized is True and discard_post_update_data is True,
                       "rollback requires explicit acknowledgement of post-update data loss")
        with self.locked():
            record = json.loads(safety.regular(self.journal).read_text())
            safety.require(record.get("schema") == 1 and record.get("project") == "funix-hml"
                           and record.get("phase") == "accepted", "not an accepted update")
            self.adapter.quiesce()
            # Preserve later writes independently before authorizing restoration.
            digest = safety.snapshot(self.adapter.database, self.root / "post-update.sqlite")
            record["post_update_sha256"] = digest
            record["phase"] = "restoring"
            self.save(record)
            self.restore(record)

    def restore(self, record):
        record["phase"] = "restoring"
        self.save(record)
        self.adapter.quiesce()
        if "backup_sha256" in record:
            target = self.root / "restore.sqlite"
            if target.exists():
                safety.require(safety.sha256(target) == record["backup_sha256"],
                               "existing restore file differs")
            else:
                safety.stage_restore(self.root / "backup.sqlite", target,
                                     expected_sha256=record["backup_sha256"])
            self.adapter.restore_database(target)
        self.adapter.install(record["previous"])
        self.adapter.validate(record["previous"])
        record["phase"] = "restored"
        self.save(record)
