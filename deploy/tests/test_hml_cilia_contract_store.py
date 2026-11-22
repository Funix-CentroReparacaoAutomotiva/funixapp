"""Offline tests for staged Cilia-only HML files and verified pin commit."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), DEPLOY / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


store = load("hml-cilia-contract-store")
planner = load("hml-cilia-plan")
REV = "5" * 40


def baseline():
    return {"name": "funix-hml", "services": {
        "api": {"image": "sha256:api", "environment": {
            "FUNIX_REVISION": REV, "FUNIX_OPERATOR_PASSWORD": "PRIVATE_NEVER_LOG"}},
        "web": {"image": "sha256:web", "environment": {}},
        "gateway": {"image": "sha256:gateway", "environment": {}},
    }}


class ContractStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "updater"
        self.state.mkdir(mode=0o700)
        self.op = self.state / "op-cilia-synthetic"
        self.op.mkdir(mode=0o700)
        self.original = baseline()
        self.old = planner.digest(self.original)
        self.plan = planner.plan(self.original, planner.PREVIEW_ONLY, self.old, REV)
        self.new = self.plan["new_contract_sha256"]
        (self.state / store.PIN_NAME).write_bytes((self.old + "\n").encode())
        self.unit = store.Store(self.state, self.op)

    def stage_and_commit(self):
        self.unit.prepare(self.old)
        self.unit.stage_override(store.SNAPSHOT_NAME, self.old, True)
        self.assertEqual(self.unit.observe(), (self.old, store.override_bytes(True)),
                         "old pin must remain until independent Compose verification")
        self.unit.commit_pin(store.SNAPSHOT_NAME, self.plan, self.original,
                             planner.desired_compose(self.original, planner.PREVIEW_ONLY))

    def test_off_to_preview_and_recovery(self):
        self.stage_and_commit()
        self.assertEqual(self.unit.observe(), (self.new, store.override_bytes(True)))
        self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)
        self.assertEqual(self.unit.observe(), (self.old, None))
        self.assertFalse(self.unit.override.exists())

    def test_prior_off_override_restored_exact(self):
        old_override = store.override_bytes(False)
        self.unit.override.write_bytes(old_override)
        self.stage_and_commit()
        self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)
        self.assertEqual(self.unit.observe(), (self.old, old_override))

    def test_crash_after_stage_before_pin_recovers(self):
        self.unit.prepare(self.old)
        self.unit.stage_override(store.SNAPSHOT_NAME, self.old, True)
        self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)
        self.assertEqual(self.unit.observe(), (self.old, None))

    def test_crash_after_pin_is_idempotently_restored(self):
        self.stage_and_commit()
        self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)
        self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)
        self.assertEqual(self.unit.observe(), (self.old, None))

    def test_rendered_compose_mismatch_blocks_pin(self):
        self.unit.prepare(self.old)
        self.unit.stage_override(store.SNAPSHOT_NAME, self.old, True)
        observed = planner.desired_compose(self.original, planner.PREVIEW_ONLY)
        observed["services"]["web"]["environment"]["EXTERNAL_URL"] = "example.invalid"
        with self.assertRaisesRegex(ValueError, "normalized Compose mismatch"):
            self.unit.commit_pin(store.SNAPSHOT_NAME, self.plan, self.original, observed)
        self.assertEqual(self.unit.observe()[0], self.old)

    def test_write_true_and_extra_service_fields_rejected(self):
        for obj in [
            {"services": {"api": {"environment": {
                store.PREVIEW: "true", store.WRITE: "true"}}}},
            {"services": {"api": {"environment": {
                store.PREVIEW: "true", store.WRITE: "false", "OTHER": "1"}}}},
            {"services": {"web": {"environment": {
                store.PREVIEW: "true", store.WRITE: "false"}}}},
        ]:
            with self.subTest(obj=obj), self.assertRaises(ValueError):
                store.validate_override(json.dumps(obj).encode())

    def test_unknown_overlay_not_restored_over(self):
        self.unit.prepare(self.old)
        self.unit.override.write_bytes(store.override_bytes(False))
        with self.assertRaisesRegex(ValueError, "unknown current override"):
            self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)

    def test_unknown_pin_not_restored_over(self):
        self.unit.prepare(self.old)
        self.unit.pin.write_bytes(("c" * 64 + "\n").encode())
        with self.assertRaisesRegex(ValueError, "unknown current contract"):
            self.unit.restore(store.SNAPSHOT_NAME, self.old, self.new, True)

    def test_snapshot_is_once_only(self):
        self.unit.prepare(self.old)
        with self.assertRaisesRegex(ValueError, "existing snapshot"):
            self.unit.prepare(self.old)

    def test_symlink_rejected(self):
        self.unit.prepare(self.old)
        self.unit.override.symlink_to(self.unit.pin)
        with self.assertRaises(ValueError):
            self.unit.stage_override(store.SNAPSHOT_NAME, self.old, True)

    def test_wrong_existing_pin_rejected(self):
        with self.assertRaisesRegex(ValueError, "pinned contract drift"):
            self.unit.prepare("a" * 64)

    def test_backup_has_no_credentials(self):
        self.unit.prepare(self.old)
        snapshot = self.unit.snapshot.read_text()
        self.assertEqual(json.loads(snapshot)["schema"], "funix-hml-cilia-files/1")
        self.assertNotIn("PRIVATE_NEVER_LOG", snapshot)


if __name__ == "__main__":
    unittest.main()
