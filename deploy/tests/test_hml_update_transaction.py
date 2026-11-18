import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "transaction", Path(__file__).resolve().parents[1] / "hml-update-transaction.py")
transaction = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transaction)


class Adapter:
    def __init__(self, database, fail=False):
        self.database = database
        self.release = "old"
        self.fail = fail
        self.stopped = False

    def preflight(self, candidate):
        return self.release

    def quiesce(self):
        self.stopped = True

    def install(self, release):
        self.release = release
        self.stopped = False
        if release == "new":
            with sqlite3.connect(self.database) as db:
                db.execute("UPDATE atendimentos SET value='migrated'")

    def validate(self, release):
        if self.fail and release == "new":
            raise RuntimeError("synthetic health failure")

    def restore_database(self, source):
        assert self.stopped
        temporary = self.database.with_suffix(".restore")
        temporary.write_bytes(source.read_bytes())
        os.replace(temporary, self.database)


class TransactionTest(unittest.TestCase):
    def test_accept_rollback_and_recover_interrupted_restore(self):
        for failure in (False, True):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                database = root / "synthetic.sqlite"
                with sqlite3.connect(database) as db:
                    db.executescript("CREATE TABLE schema_migrations(version INTEGER);"
                                     "INSERT INTO schema_migrations VALUES(1);"
                                     "CREATE TABLE atendimentos(value TEXT);"
                                     "INSERT INTO atendimentos VALUES('original');"
                                     "CREATE TABLE scenarios(id INTEGER);"
                                     "CREATE TABLE budget_versions(id INTEGER);")
                adapter = Adapter(database, failure)
                operation = transaction.Transaction(root / "operation", adapter)
                if failure:
                    with self.assertRaisesRegex(RuntimeError, "health"):
                        operation.update("new", authorized=True)
                else:
                    operation.update("new", authorized=True)
                    self.assertEqual(adapter.release, "new")
                    # Simulate restart after accepted update, request rollback.
                    record = json.loads(operation.journal.read_text())
                    record["phase"] = "restoring"
                    operation.save(record)
                    operation.recover(authorized=True)
                self.assertEqual(adapter.release, "old")
                with sqlite3.connect(database) as db:
                    self.assertEqual(db.execute("SELECT value FROM atendimentos").fetchone(),
                                     ("original",))
                operation.recover(authorized=True)

    def test_authorization_and_concurrent_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            operation = transaction.Transaction(Path(directory) / "operation", None)
            with self.assertRaises(transaction.safety.Blocked):
                operation.update("new")
            with operation.locked():
                with self.assertRaises(BlockingIOError):
                    operation.recover(authorized=True)
