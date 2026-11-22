"""Offline integration rehearsal of the Cilia gate, pinned files and coordinator.

Uses a synthetic Docker adapter; does not contact Docker daemon, VPS, n8n or
external services. Real Docker validation is a SEPARATE deployment gate.
"""
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


plan = load("hml-cilia-plan")
txn = load("hml-cilia-transaction")
adapter_mod = load("hml-cilia-docker-adapter")
REV = "5" * 40
IMAGES = {"api": "sha256:" + "1" * 64,
          "web": "sha256:" + "2" * 64,
          "gateway": "sha256:" + "3" * 64}


def baseline():
    return {"name": "funix-hml", "services": {
        "api": {"image": IMAGES["api"], "environment": {
            "FUNIX_REVISION": REV, "FUNIX_OPERATOR_PASSWORD": "PRIVATE_DO_NOT_LOG"}},
        "web": {"image": IMAGES["web"], "environment": {}},
        "gateway": {"image": IMAGES["gateway"], "environment": {}},
    }}


class SyntheticDocker:
    def __init__(self, state, database):
        self.state = state
        self.database = database
        self.original = baseline()
        self.contract = plan.digest(self.original)
        self.operation_directory = state
        self.restricted = False
        self.reopen_count = 0
        self.api_recreate_count = 0
        self.fail_api_once = False

    def configuration(self):
        value = copy.deepcopy(self.original)
        file = self.state / "cilia-flags.json"
        if file.exists():
            obj = json.loads(file.read_text())
            value["services"]["api"]["environment"].update(
                obj["services"]["api"]["environment"])
        return value

    def containers(self):
        return [{"Image": IMAGES[role], "Config": {"Labels": {
            "com.docker.compose.service": role}}} for role in ("api", "web", "gateway")]

    def preflight(self, release):
        assert release == dict(IMAGES, revision=REV)
        assert not self.restricted
        return release

    def normal_mounts(self):
        return {}

    def enter_maintenance(self):
        self.restricted = True

    def gate_args(self):
        return ["docker", "compose", "-f", "synthetic/maintenance.yaml"]

    def run(self, arguments):
        assert arguments[0] == "docker"
        assert "gateway" in arguments or "api" in arguments
        if "gateway" in arguments:
            self.restricted = True
        if "api" in arguments:
            self.api_recreate_count += 1
            if self.fail_api_once:
                self.fail_api_once = False
                raise RuntimeError("injected API recreate failure")

    def assert_gateway_mounts(self, *, restricted):
        if self.restricted != restricted:
            raise ValueError("gateway mode differs")

    def check_live_isolation(self, release, *, restricted):
        assert release == dict(IMAGES, revision=REV)
        assert self.restricted is restricted
        assert plan.mode(self.configuration()) in (plan.OFF, plan.PREVIEW_ONLY)

    def validate(self, release):
        assert self.restricted
        assert release == dict(IMAGES, revision=REV)

    def open_access(self, release):
        assert release == dict(IMAGES, revision=REV)
        self.restricted = False
        self.reopen_count += 1


class CiliaDockerAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "updater"
        self.state.mkdir(mode=0o700)
        self.op = self.state / "op-cilia-integrated"
        self.op.mkdir(mode=0o700)
        prior = self.state / "op-prior"
        prior.mkdir(mode=0o700)
        journal = prior / "operation.json"
        journal.write_text(json.dumps({"phase": "accepted"}))
        (self.state / "active.json").write_text(json.dumps({"journal": str(journal)}))
        self.db = Path(self.tmp.name) / "funix.sqlite"
        with sqlite3.connect(self.db) as db:
            for table in ("schema_migrations", "atendimentos", "scenarios", "budget_versions"):
                if table == "schema_migrations":
                    db.execute("CREATE TABLE schema_migrations (version INTEGER)")
                    db.execute("INSERT INTO schema_migrations VALUES (1)")
                else:
                    db.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)")
        self.fake = SyntheticDocker(self.state, self.db)
        (self.state / "contract.sha256").write_text(self.fake.contract + "\n")
        self.adapter = adapter_mod.CiliaDockerAdapter(self.fake, self.state, self.op)
        self.transaction = txn.Transaction(self.state, self.op, self.adapter)

    def do_apply(self):
        return self.transaction.apply(plan.PREVIEW_ONLY, self.fake.contract, REV, authorized=True)

    def test_off_preview_acceptance_preserves_db_and_gateway(self):
        old_db = self.db.read_bytes()
        result = self.do_apply()
        self.assertEqual(result["to"], plan.PREVIEW_ONLY)
        self.assertEqual(plan.mode(self.fake.configuration()), plan.PREVIEW_ONLY)
        self.assertEqual(self.fake.api_recreate_count, 1)
        self.assertFalse(self.fake.restricted)
        self.assertEqual(self.db.read_bytes(), old_db)
        self.assertTrue((self.op / "cilia-db-backup.sqlite").exists())
        self.assertEqual((self.state / "contract.sha256").read_text().strip(),
                         result["new_contract_sha256"])

    def test_crash_after_pin_recovered_without_db_restore(self):
        self.fake.fail_api_once = True
        old_db = self.db.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "injected API recreate"):
            self.do_apply()
        self.assertTrue(self.fake.restricted)
        self.assertEqual(plan.mode(self.fake.configuration()), plan.PREVIEW_ONLY)
        # Recovery from a distinct adapter instance must use the journal
        # and on-disk store rather than any preflight fields in memory.
        reopened = adapter_mod.CiliaDockerAdapter(self.fake, self.state, self.op)
        repair = txn.Transaction(self.state, self.op, reopened)
        self.assertEqual(repair.recover(authorized=True), "reverted")
        self.assertEqual(plan.mode(self.fake.configuration()), plan.OFF)
        self.assertFalse(self.fake.restricted)
        self.assertEqual(self.db.read_bytes(), old_db)

    def test_write_mode_cannot_start(self):
        with self.assertRaisesRegex(ValueError, "unsupported target"):
            self.transaction.apply("WRITE", self.fake.contract, REV, authorized=True)
        self.assertFalse(self.fake.restricted)


if __name__ == "__main__":
    unittest.main()
