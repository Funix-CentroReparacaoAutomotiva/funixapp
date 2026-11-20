"""Offline tests for atomic Cilia-only HML file store.

No Docker, web access, service restart or changes to actual /var/lib/funix-hml.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hml_cilia_store_test", DEPLOY / "hml-cilia-contract-store.py")
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)

OLD = "a" * 64
NEW = "b" * 64


class ContractStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.state = self.root / "updater"
        self.state.mkdir(mode=0o700)
        self.op = self.state / "op-cilia-synthetic"
        self.op.mkdir(mode=0o700)
        (self.state / store.PIN_NAME).write_bytes((OLD + "\n").encode())
        self.unit = store.Store(self.state, self.op)

    def test_off_to_preview_without_prior_override_roundtrip(self):
        self.assertEqual(self.unit.observe(), (OLD, None))
        self.assertEqual(self.unit.prepare(OLD), store.SNAPSHOT_NAME)
        self.unit.apply(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.assertEqual(self.unit.observe(), (NEW, store.override_bytes(True)))
        self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.assertEqual(self.unit.observe(), (OLD, None))
        self.assertFalse(self.unit.override.exists())

    def test_prior_off_override_restored_byte_exact(self):
        old_override = store.override_bytes(False)
        self.unit.override.write_bytes(old_override)
        self.unit.prepare(OLD)
        self.unit.apply(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.assertEqual(self.unit.observe(), (OLD, old_override))

    def test_crash_between_override_and_pin_restored(self):
        self.unit.prepare(OLD)
        store.atomic_replace(self.unit.override, store.override_bytes(True))
        self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.assertEqual(self.unit.observe(), (OLD, None))

    def test_crash_after_pin_also_restored(self):
        self.unit.prepare(OLD)
        self.unit.apply(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)
        self.assertEqual(self.unit.observe(), (OLD, None))

    def test_write_true_and_additional_compose_fields_rejected(self):
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

    def test_unknown_files_are_not_overwritten_in_restore(self):
        self.unit.prepare(OLD)
        self.unit.override.write_bytes(store.override_bytes(False))
        with self.assertRaisesRegex(ValueError, "unknown current override"):
            self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)

    def test_unknown_pin_is_not_overwritten(self):
        self.unit.prepare(OLD)
        self.unit.pin.write_bytes(("c" * 64 + "\n").encode())
        with self.assertRaisesRegex(ValueError, "unknown current contract"):
            self.unit.restore(store.SNAPSHOT_NAME, OLD, NEW, True)

    def test_cannot_take_snapshot_twice(self):
        self.unit.prepare(OLD)
        with self.assertRaisesRegex(ValueError, "existing snapshot"):
            self.unit.prepare(OLD)

    def test_untrusted_symlink_rejected(self):
        self.unit.prepare(OLD)
        self.unit.override.symlink_to(self.unit.pin)
        with self.assertRaises(ValueError):
            self.unit.apply(store.SNAPSHOT_NAME, OLD, NEW, True)

    def test_requires_exact_old_pin(self):
        with self.assertRaisesRegex(ValueError, "pinned contract drift"):
            self.unit.prepare(NEW)

    def test_snapshot_has_no_credentials(self):
        self.unit.prepare(OLD)
        text = self.unit.snapshot.read_text()
        self.assertEqual(json.loads(text)["schema"], "funix-hml-cilia-files/1")
        self.assertNotIn("PASSWORD", text)
        self.assertNotIn("PRIVATE_KEY", text)


if __name__ == "__main__":
    unittest.main()
