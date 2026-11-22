"""Cross-transaction guard: updater cannot ignore unresolved Cilia config operations."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hml_update_transaction_guard", ROOT / "hml-update-transaction.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CiliaUpdaterGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.op = self.state / "op-cilia-example"
        self.op.mkdir(mode=0o700)
        self.journal = self.op / "cilia-transaction.json"
        self.pointer = self.state / "cilia-active.json"

    def write(self, phase):
        self.journal.write_text(json.dumps({"schema": "funix-hml-cilia-tx/1",
                                            "scope": "funix-hml", "phase": phase}))
        self.pointer.write_text(json.dumps({"journal": str(self.journal)}))

    def test_absent_pointer_keeps_legacy_updater_compatible(self):
        module.require_cilia_settled(self.state)

    def test_terminal_cilia_operations_do_not_block_updates(self):
        for phase in ("accepted", "reverted"):
            with self.subTest(phase=phase):
                self.write(phase)
                module.require_cilia_settled(self.state)

    def test_pending_operation_blocks_updater_and_rollback(self):
        for phase in ("prepared", "protected", "switching", "validating",
                      "reverting", "accepted_pending_open", "reverted_pending_open"):
            with self.subTest(phase=phase):
                self.write(phase)
                with self.assertRaisesRegex(ValueError, "requires recovery"):
                    module.require_cilia_settled(self.state)

    def test_untrusted_pointer_fails_closed(self):
        self.pointer.write_text(json.dumps({"journal": "/tmp/malicious.json"}))
        with self.assertRaises(ValueError):
            module.require_cilia_settled(self.state)

    def test_untrusted_or_missing_journal_fails_closed(self):
        self.pointer.write_text(json.dumps({"journal": str(self.journal)}))
        with self.assertRaises((ValueError, FileNotFoundError)):
            module.require_cilia_settled(self.state)
        self.journal.write_text(json.dumps({"schema": "unexpected", "phase": "accepted"}))
        with self.assertRaises(ValueError):
            module.require_cilia_settled(self.state)


if __name__ == "__main__":
    unittest.main()
