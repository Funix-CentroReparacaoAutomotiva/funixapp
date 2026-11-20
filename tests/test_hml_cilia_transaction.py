"""Offline HML Cilia transaction tests with an inert in-memory adapter.

Never contacts Docker, n8n or the HML host.
"""
import copy
import fcntl
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parents[1] / "deploy"


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), DEPLOY / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


planner = load("hml-cilia-plan")
coordinator = load("hml-cilia-transaction")
REV = "5" * 40


def base():
    return {"name": "funix-hml", "services": {
        "api": {"image": "sha256:api", "environment": {
            "FUNIX_REVISION": REV, "FUNIX_OPERATOR_PASSWORD": "PRIVATE_TOKEN_NEVER_LOG"}},
        "web": {"image": "sha256:web", "environment": {}},
        "gateway": {"image": "sha256:gateway", "environment": {}},
    }}


class FakeAdapter:
    def __init__(self):
        self.config = base()
        self.original = copy.deepcopy(self.config)
        self.maintenance = False
        self.opened = False
        self.failure = None
        self.switches = 0

    def observe(self):
        return copy.deepcopy(self.config)

    def assert_safe(self, before, revision):
        if before["services"]["api"]["environment"]["FUNIX_REVISION"] != revision:
            raise ValueError("revision differs")

    def backup(self, before, plan):
        self.original = copy.deepcopy(before)
        return "snapshot-001"

    def enter_maintenance(self):
        self.maintenance = True
        self.opened = False

    def switch_to(self, p, backup_ref):
        if not self.maintenance or backup_ref != "snapshot-001":
            raise RuntimeError("unsafe switch")
        self.switches += 1
        self.config = planner.desired_compose(self.original, p["to"])
        if self.failure == "after_switch":
            raise RuntimeError("injected crash")

    def validate(self, p):
        if planner.digest(self.config) != p["new_contract_sha256"]:
            raise RuntimeError("unexpected live config")
        if planner.mode(self.config) != p["to"]:
            raise RuntimeError("unexpected live flags")

    def restore(self, p, backup_ref):
        if not self.maintenance or backup_ref != "snapshot-001":
            raise RuntimeError("unsafe restore")
        self.config = copy.deepcopy(self.original)

    def open_access(self, p):
        self.validate(p)
        if self.failure == "reopen":
            raise RuntimeError("injected reopen failure")
        self.opened = True


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "updater"
        self.state.mkdir(mode=0o700)
        self.op = self.state / "op-cilia-test"
        self.op.mkdir(mode=0o700)
        prior_dir = self.state / "op-prior"
        prior_dir.mkdir(mode=0o700)
        journal = prior_dir / "operation.json"
        journal.write_text(json.dumps({"phase": "accepted"}))
        (self.state / "active.json").write_text(json.dumps({"journal": str(journal)}))
        self.fake = FakeAdapter()
        self.tx = coordinator.Transaction(self.state, self.op, self.fake)

    def tearDown(self):
        self.tmp.cleanup()

    def apply(self, target=planner.PREVIEW_ONLY):
        return self.tx.apply(target, planner.digest(self.fake.config), REV, authorized=True)

    def test_normal_transition_and_no_secrets_in_journal(self):
        self.apply()
        self.assertTrue(self.fake.opened)
        self.assertEqual(planner.mode(self.fake.config), planner.PREVIEW_ONLY)
        record = (self.op / "cilia-transaction.json").read_text()
        self.assertIn('"phase": "accepted"', record)
        self.assertNotIn("PRIVATE_TOKEN_NEVER_LOG", record)
        self.assertEqual(json.loads((self.state / "active.json").read_text())["journal"],
                         str(self.state / "op-prior" / "operation.json"))

    def test_write_mode_is_unavailable(self):
        with self.assertRaisesRegex(ValueError, "unsupported target"):
            self.apply("WRITE")
        self.assertFalse(self.fake.maintenance)
        self.assertFalse((self.op / "cilia-transaction.json").exists())

    def test_interrupted_switch_is_not_auto_retried_and_can_recover(self):
        self.fake.failure = "after_switch"
        with self.assertRaisesRegex(RuntimeError, "injected crash"):
            self.apply()
        self.assertFalse(self.fake.opened)
        self.assertEqual(self.fake.switches, 1)
        with self.assertRaisesRegex(ValueError, "operation already exists"):
            self.apply()
        self.fake.failure = None
        self.assertEqual(self.tx.recover(authorized=True), "reverted")
        self.assertEqual(planner.mode(self.fake.config), planner.OFF)
        self.assertTrue(self.fake.opened)
        self.assertEqual(self.fake.switches, 1)

    def test_accepted_pending_open_is_not_rolled_back(self):
        self.fake.failure = "reopen"
        with self.assertRaisesRegex(RuntimeError, "injected reopen failure"):
            self.apply()
        self.assertEqual(planner.mode(self.fake.config), planner.PREVIEW_ONLY)
        self.fake.failure = None
        self.assertEqual(self.tx.recover(authorized=True), "accepted")
        self.assertTrue(self.fake.opened)
        self.assertEqual(planner.mode(self.fake.config), planner.PREVIEW_ONLY)

    def test_updater_pending_recovery_blocks_transition(self):
        journal = self.state / "op-prior" / "operation.json"
        journal.write_text(json.dumps({"phase": "installing"}))
        with self.assertRaisesRegex(ValueError, "updater recovery pending"):
            self.apply()
        self.assertFalse(self.fake.maintenance)

    def test_global_lock_is_mutually_exclusive(self):
        lock = self.state / "lock"
        with lock.open("w+") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.apply()
        self.assertFalse(self.fake.maintenance)

    def test_wrong_revision_or_pin_rejected_before_mutation(self):
        with self.assertRaisesRegex(ValueError, "contract digest differs"):
            self.tx.apply(planner.PREVIEW_ONLY, "0" * 64, REV, authorized=True)
        self.assertFalse(self.fake.maintenance)

    def test_recovery_requires_explicit_authorization(self):
        with self.assertRaisesRegex(ValueError, "explicit recovery authorization required"):
            self.tx.recover()
        self.assertFalse(self.fake.maintenance)


if __name__ == "__main__":
    unittest.main()
