"""Test a private staged updater can execute an interrupted HML recovery.

No VPS, network, Docker, actual controller paths, or production data.
The staged modules are checked against the same pins as the approved
controller; no source module in the checkout is replaced.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import stat
import tempfile
import unittest
from unittest.mock import patch


DEPLOY = Path(__file__).resolve().parents[1]
OFFICIAL = [
    "hml-update", "hml-update-safety", "hml-update-transaction",
    "hml-docker-adapter", "hml-docker-maintenance", "hml-maintenance",
    "hml-writer-guard", "hml-isolation", "hml-artifact-provenance",
    "hml-selection", "hml-image-identity", "hml-official-update",
]


def assignment(source, key):
    return next(ast.literal_eval(node.value) for node in ast.parse(source).body
                if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == key
                    for target in node.targets))


def git_blob(raw):
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_staged_sources(root):
    """Fail closed before importing or executing an unapproved staged module."""
    stage = root / "deploy"
    if (not stage.is_dir() or stage.is_symlink()
            or stat.S_IMODE(stage.stat().st_mode) != 0o700):
        raise ValueError("untrusted staged directory")
    ctl = stage / "remote-hml" / "control.py"
    rootctl = stage / "remote-hml" / "rootctl.py"
    for p in (ctl, rootctl):
        if p.is_symlink() or not p.is_file():
            raise ValueError("untrusted controller file")
    pins = assignment(ctl.read_bytes(), "FILES")
    if (set(pins) != set(OFFICIAL)
            or hashlib.sha256(ctl.read_bytes()).hexdigest() !=
            assignment(rootctl.read_bytes(), "PREP_SHA")):
        raise ValueError("untrusted controller pins")
    for name, pin in pins.items():
        file = stage / (name + ".py")
        if file.is_symlink() or not file.is_file():
            raise ValueError("missing staged source")
        if git_blob(file.read_bytes()) != pin:
            raise ValueError("staged source pin mismatch")
    return stage


class IsolatedRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        self.stage = self.root / "deploy"
        self.stage.mkdir(mode=0o700)
        (self.stage / "remote-hml").mkdir(mode=0o700)
        self.original_hashes = {}
        for name in OFFICIAL:
            source = DEPLOY / (name + ".py")
            target = self.stage / source.name
            shutil.copyfile(source, target)
            target.chmod(0o600)
            self.original_hashes[name] = digest(source)
        for name in ("control.py", "rootctl.py"):
            source = DEPLOY / "remote-hml" / name
            target = self.stage / "remote-hml" / name
            shutil.copyfile(source, target)
            target.chmod(0o600)

    def test_tampered_staging_is_blocked_before_import(self):
        self.assertEqual(verify_staged_sources(self.root), self.stage)
        target = self.stage / "hml-update.py"
        target.write_bytes(target.read_bytes() + b"# drift\n")
        with self.assertRaisesRegex(ValueError, "pin mismatch"):
            verify_staged_sources(self.root)

    def test_isolated_official_recover_preserves_original_sources(self):
        verified = verify_staged_sources(self.root)
        spec = importlib.util.spec_from_file_location(
            "funix_exception_staged_updater", verified / "hml-update.py")
        updater = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(updater)
        original_loader = updater.load
        isolated_transaction = original_loader("hml-update-transaction")
        self.assertEqual(Path(isolated_transaction.__file__).parent, verified)

        state = self.root / "state"
        state.mkdir(mode=0o700)
        state.chmod(0o700)
        operation = state / "op-disposable-recovery"
        operation.mkdir(mode=0o700)
        operation.chmod(0o700)
        database = self.root / "live.sqlite"
        backup = operation / "backup.sqlite"
        with sqlite3.connect(backup) as db:
            db.executescript(
                "CREATE TABLE schema_migrations(version INTEGER);"
                "INSERT INTO schema_migrations VALUES (1);"
                "CREATE TABLE atendimentos(value TEXT);"
                "INSERT INTO atendimentos VALUES ('preserved');"
                "CREATE TABLE scenarios(id INTEGER);"
                "CREATE TABLE budget_versions(id INTEGER);"
            )
        shutil.copyfile(backup, operation / "restore.sqlite")
        shutil.copyfile(backup, database)
        with sqlite3.connect(database) as db:
            db.execute("UPDATE atendimentos SET value = 'partial'")
            db.commit()
        previous = {"revision": "a" * 40, "api": "old-api"}
        candidate = {"revision": "b" * 40, "api": "candidate-api"}
        journal = operation / "operation.json"
        journal.write_text(json.dumps({
            "schema": 1, "project": "funix-hml", "maintenance": True,
            "phase": "restoring", "previous": previous, "candidate": candidate,
            "backup_sha256": digest(backup),
        }))
        (state / "active.json").write_text(json.dumps({"journal": str(journal)}))

        class SyntheticAdapter:
            def __init__(self):
                self.operation_directory = None
                self.database = database
                self.events = []
                self.installed = candidate
                self.restricted = False

            def assert_contract(self):
                self.events.append("contract")

            def enter_maintenance(self):
                self.restricted = True
                self.events.append("maintenance")

            def quiesce(self):
                assert self.restricted
                self.events.append("quiesce")

            def restore_database(self, staged):
                assert self.restricted
                shutil.copyfile(staged, self.database)
                self.events.append("restore_database")

            def install(self, release):
                assert release == previous
                self.installed = release
                self.events.append("install_previous")

            def assert_installed(self, release):
                assert self.installed == release

            def validate(self, release):
                self.assert_installed(release)
                self.events.append("validate")

            def open_access(self, release):
                self.assert_installed(release)
                self.events.append("reopen")

        adapter = SyntheticAdapter()
        config_path = operation / "config.json"
        config_path.write_text(json.dumps({"state": str(state)}))
        config_path.chmod(0o600)
        # Exercise the *real staged CLI*, not only the transaction method.
        # Only host-scope/config validation is mocked because its fixed VPS
        # paths deliberately do not exist on a disposable runner.
        with patch.object(updater, "make_adapter", return_value=adapter), \
             patch.object(updater, "load", side_effect=lambda name:
                          isolated_transaction if name == "hml-update-transaction"
                          else original_loader(name)), \
             patch.object(updater, "host_scope", return_value=operation) as host_scope, \
             patch.object(updater, "check_config") as check_config, \
             patch.object(sys, "argv", ["staged-updater", "recover", "--config",
                                       str(config_path), "--operation",
                                       str(operation), "--authorize"]):
            updater.main()
            host_scope.assert_called_once_with(operation, config_path)
            check_config.assert_called_once()

        self.assertEqual(json.loads(journal.read_text())["phase"], "restored")
        self.assertEqual(digest(database), digest(backup))
        self.assertEqual(adapter.events, [
            "contract", "maintenance", "quiesce", "restore_database",
            "install_previous", "validate", "reopen"])
        for name, value in self.original_hashes.items():
            self.assertEqual(digest(DEPLOY / (name + ".py")), value)
        self.assertEqual(verify_staged_sources(self.root), self.stage)


if __name__ == "__main__":
    unittest.main()
