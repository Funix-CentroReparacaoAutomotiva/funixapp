"""Durable HML update coordinator; Docker policy belongs to the adapter.

The adapter must enforce project isolation and quiescence. Before acceptance,
recovery restores the previous release. After a durable acceptance in maintenance
mode, recovery only completes reopening access; it must never restore old data.
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
    def __init__(self, directory, adapter, *, project_state=None, maintenance=False):
        self.root = Path(directory)
        safety.require(self.root.is_absolute() and self.root.resolve() == self.root,
                       "noncanonical journal directory")
        self.root.mkdir(mode=0o700, exist_ok=True)
        safety.require(self.root.stat().st_mode & 0o777 == 0o700,
                       "journal directory must be private")
        self.adapter = adapter
        self.maintenance = maintenance
        if maintenance:
            for hook in ("enter_maintenance", "open_access", "assert_installed"):
                safety.require(callable(getattr(adapter, hook, None)),
                               "maintenance adapter contract incomplete")
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

    def check_mode(self, record):
        safety.require(record.get("maintenance", False) is self.maintenance,
                       "operation maintenance mode mismatch")

    def check_active(self):
        pointer = json.loads(safety.regular(self.project_state / "active.json").read_text())
        safety.require(pointer.get("journal") == str(self.journal),
                       "operation is not the current project operation")

    def enter_gate(self):
        # The adapter must make this idempotent, stop the public gateway
        # before switching files, and start only the restricted gateway
        # during install/validate. A failure must not expose the candidate.
        if self.maintenance:
            self.adapter.enter_maintenance()

    def finish(self, record, final, release):
        if self.maintenance:
            record["phase"] = final + "_pending_open"
            self.save(record)
            self.reopen(record, final, release)
        else:
            record["phase"] = final
            self.save(record)

    def reopen(self, record, final, release):
        # DO NOT catch a reopening failure and restore the pre-update DB:
        # common access may already have been reopened before the failure.
        self.adapter.assert_installed(release)
        self.adapter.open_access(release)
        record["phase"] = final
        self.save(record)

    def update(self, candidate, *, authorized=False, prepare=None):
        safety.require(authorized is True, "explicit update authorization required")
        with self.locked():
            active = self.project_state / "active.json"
            if active.exists():
                pending = json.loads(safety.regular(active).read_text())
                phase = json.loads(safety.regular(Path(pending["journal"])).read_text())["phase"]
                safety.require(phase in ("accepted", "restored"), "project has pending recovery")
            if self.journal.exists():
                old = json.loads(safety.regular(self.journal).read_text())
                safety.require(old["phase"] in ("accepted", "restored"),
                               "interrupted operation requires recovery")
                raise safety.Blocked("use a new private operation directory")
            if prepare is not None:
                prepare()
            previous = self.adapter.preflight(candidate)
            if hasattr(self.adapter, "operation_directory"):
                self.adapter.operation_directory = self.root
            record = {"schema": 1, "project": "funix-hml", "phase": "prepared",
                      "previous": previous, "candidate": candidate}
            if self.maintenance:
                record["maintenance"] = True
            self.save(record)
            temporary = self.project_state / "active.new"
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump({"journal": str(self.journal)}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, active)
            safety.durable(active)
            try:
                # Persist intent before every potentially interrupted mutation.
                record["phase"] = "quiescing"
                self.save(record)
                self.enter_gate()
                self.adapter.quiesce()
                digest = safety.snapshot(self.adapter.database, self.root / "backup.sqlite")
                record.update(backup_sha256=digest, phase="installing")
                self.save(record)
                self.adapter.install(candidate)
                self.adapter.validate(candidate)
            except Exception:
                self.restore(record)
                raise
            # Acceptance and reopening are outside the automatic rollback catch.
            self.finish(record, "accepted", candidate)

    def recover(self, *, authorized=False):
        safety.require(authorized is True, "explicit recovery authorization required")
        with self.locked():
            if hasattr(self.adapter, "operation_directory"):
                self.adapter.operation_directory = self.root
            record = json.loads(safety.regular(self.journal).read_text())
            safety.require(record.get("schema") == 1 and record.get("project") == "funix-hml",
                           "invalid recovery journal")
            self.check_mode(record)
            if record["phase"] == "restored":
                return
            if self.maintenance:
                self.check_active()
                if record["phase"] == "accepted_pending_open":
                    self.reopen(record, "accepted", record["candidate"])
                    return
                if record["phase"] == "restored_pending_open":
                    self.reopen(record, "restored", record["previous"])
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
            self.check_mode(record)
            self.check_active()
            if hasattr(self.adapter, "assert_installed"):
                self.adapter.assert_installed(record["candidate"])
            if hasattr(self.adapter, "operation_directory"):
                self.adapter.operation_directory = self.root
            record["phase"] = "rollback_requested"
            self.save(record)
            self.enter_gate()
            self.adapter.quiesce()
            # Preserve later writes independently before authorizing restoration.
            digest = safety.snapshot(self.adapter.database, self.root / "post-update.sqlite")
            record["post_update_sha256"] = digest
            record["phase"] = "restoring"
            self.save(record)
            self.restore(record)

    def restore(self, record):
        self.enter_gate()
        if record["phase"] == "rollback_requested":
            self.adapter.quiesce()
            target = self.root / "post-update.sqlite"
            # A file without a committed digest may be a partial interrupted backup.
            safety.require(not target.exists() or "post_update_sha256" in record,
                           "uncommitted rollback backup requires manual inspection")
            if target.exists():
                safety.require(safety.sha256(target) == record["post_update_sha256"],
                               "rollback backup checksum mismatch")
                with safety.closing(safety.readonly(target)) as db:
                    safety.inspect(db)
            else:
                record["post_update_sha256"] = safety.snapshot(self.adapter.database, target)
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
        self.finish(record, "restored", record["previous"])
