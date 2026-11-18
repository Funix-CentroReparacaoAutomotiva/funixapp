"""Maintenance coordinator contract tests, synthetic adapter + real SQLite."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "transaction", Path(__file__).resolve().parents[1] / "hml-update-transaction.py")
transaction = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transaction)


class SimulatedInterruption(BaseException):
    pass


class Adapter:
    def __init__(self, database):
        self.database = database
        self.release = "old"
        self.restricted = False
        self.stopped = False
        self.fail_validation = False
        self.interrupt_validation = False
        self.fail_open = False
        self.restore_calls = 0
        self.journal = None

    def preflight(self, candidate):
        return self.release

    def enter_maintenance(self):
        self.restricted = True

    def quiesce(self):
        assert self.restricted
        self.stopped = True

    def install(self, release):
        assert self.restricted and self.stopped
        self.release = release
        self.stopped = False
        if release == "new":
            self.write("migrated")

    def validate(self, release):
        assert self.restricted
        assert release == self.release
        if release == "new":
            if self.interrupt_validation:
                raise SimulatedInterruption()
            if self.fail_validation:
                raise RuntimeError("validation failed")

    def assert_installed(self, release):
        if release != self.release:
            raise RuntimeError("wrong installed release")

    def open_access(self, release):
        assert self.release == release
        record = json.loads(self.journal.read_text())
        assert record["phase"] in ("accepted_pending_open", "restored_pending_open")
        self.restricted = False
        if self.fail_open:
            # Simulate interruption after normal access returned.
            self.write("later user data")
            raise RuntimeError("opening interrupted")

    def restore_database(self, source):
        assert self.restricted and self.stopped
        self.restore_calls += 1
        temporary = self.database.with_suffix(".new")
        temporary.write_bytes(source.read_bytes())
        os.replace(temporary, self.database)

    def write(self, value):
        with sqlite3.connect(self.database) as db:
            db.execute("UPDATE atendimentos SET value=?", (value,))


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.database = self.root / "funix.sqlite"
        with sqlite3.connect(self.database) as db:
            db.executescript(
                "CREATE TABLE schema_migrations(version INTEGER);"
                "INSERT INTO schema_migrations VALUES(1);"
                "CREATE TABLE atendimentos(value TEXT);"
                "INSERT INTO atendimentos VALUES('original');"
                "CREATE TABLE scenarios(id INTEGER);"
                "CREATE TABLE budget_versions(id INTEGER);")
        self.adapter = Adapter(self.database)
        self.operation = self.rebuild()

    def rebuild(self):
        op = transaction.Transaction(self.root / "operation", self.adapter,
                                     project_state=self.root / "state", maintenance=True)
        self.adapter.journal = op.journal
        return op

    def phase(self):
        return json.loads(self.operation.journal.read_text())["phase"]

    def value(self):
        with sqlite3.connect(self.database) as db:
            return db.execute("SELECT value FROM atendimentos").fetchone()[0]

    def test_accept_before_open(self):
        self.operation.update("new", authorized=True)
        self.assertEqual(self.phase(), "accepted")
        self.assertFalse(self.adapter.restricted)
        self.assertEqual(self.value(), "migrated")
        self.assertEqual(self.adapter.restore_calls, 0)

    def test_open_failure_never_reverts_accepted_database(self):
        self.adapter.fail_open = True
        with self.assertRaisesRegex(RuntimeError, "opening"):
            self.operation.update("new", authorized=True)
        self.assertEqual(self.phase(), "accepted_pending_open")
        self.assertEqual(self.value(), "later user data")
        self.assertEqual(self.adapter.restore_calls, 0)
        other = transaction.Transaction(self.root / "other", self.adapter,
                                        project_state=self.root / "state", maintenance=True)
        with self.assertRaisesRegex(transaction.safety.Blocked, "pending"):
            other.update("new", authorized=True)
        self.adapter.fail_open = False
        self.rebuild().recover(authorized=True)
        self.assertEqual(self.phase(), "accepted")
        self.assertEqual(self.value(), "later user data")
        self.assertEqual(self.adapter.restore_calls, 0)

    def test_failed_validation_restores_before_open(self):
        self.adapter.fail_validation = True
        with self.assertRaisesRegex(RuntimeError, "validation"):
            self.operation.update("new", authorized=True)
        self.assertEqual(self.phase(), "restored")
        self.assertEqual(self.value(), "original")
        self.assertFalse(self.adapter.restricted)
        self.assertEqual(self.adapter.restore_calls, 1)

    def test_interruption_before_acceptance_restores(self):
        self.adapter.interrupt_validation = True
        with self.assertRaises(SimulatedInterruption):
            self.operation.update("new", authorized=True)
        self.assertEqual(self.phase(), "installing")
        self.assertTrue(self.adapter.restricted)
        self.rebuild().recover(authorized=True)
        self.assertEqual(self.phase(), "restored")
        self.assertEqual(self.value(), "original")

    def test_rollback_and_open_failure_preserve_later_data(self):
        self.operation.update("new", authorized=True)
        self.adapter.write("before rollback")
        self.adapter.fail_open = True
        with self.assertRaisesRegex(RuntimeError, "opening"):
            self.operation.rollback(authorized=True, discard_post_update_data=True)
        self.assertEqual(self.phase(), "restored_pending_open")
        self.assertEqual(self.adapter.restore_calls, 1)
        with sqlite3.connect(self.operation.root / "post-update.sqlite") as db:
            self.assertEqual(db.execute("SELECT value FROM atendimentos").fetchone()[0],
                             "before rollback")
        self.adapter.fail_open = False
        self.rebuild().recover(authorized=True)
        self.assertEqual(self.phase(), "restored")
        self.assertEqual(self.value(), "later user data")
        self.assertEqual(self.adapter.restore_calls, 1)

    def test_mode_mismatch_and_missing_hooks_block(self):
        self.adapter.fail_open = True
        with self.assertRaisesRegex(RuntimeError, "opening"):
            self.operation.update("new", authorized=True)
        wrong_mode = transaction.Transaction(self.operation.root, self.adapter,
                                             project_state=self.root / "state")
        with self.assertRaisesRegex(transaction.safety.Blocked, "mode mismatch"):
            wrong_mode.recover(authorized=True)
        with self.assertRaisesRegex(transaction.safety.Blocked, "contract"):
            transaction.Transaction(self.root / "no-hooks", object(),
                                    project_state=self.root / "state", maintenance=True)

    def test_pending_open_wrong_release_blocks(self):
        self.adapter.fail_open = True
        with self.assertRaisesRegex(RuntimeError, "opening"):
            self.operation.update("new", authorized=True)
        self.adapter.release = "unexpected"
        with self.assertRaisesRegex(RuntimeError, "wrong installed"):
            self.rebuild().recover(authorized=True)
        self.assertEqual(self.phase(), "accepted_pending_open")
        self.assertEqual(self.adapter.restore_calls, 0)
