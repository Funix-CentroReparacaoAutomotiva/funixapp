import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

SPEC = importlib.util.spec_from_file_location("official", Path(__file__).resolve().parents[1] / "hml-official-update.py")
official = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(official)


class OfficialUpdateTest(unittest.TestCase):
    def test_pending_and_concurrent_operations_never_prepare(self):
        for pending in (True, False):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                operation = root / "op-test"
                operation.mkdir(mode=0o700)
                other = root / "op-other"
                other.mkdir(mode=0o700)
                (other / "operation.json").write_text('{"phase":"installing"}')
                (root / "active.json").write_text(json.dumps({"journal": str(other / "operation.json")}))
                identity = dict(revision="b" * 40, artifact_id=1, run_id=2, attempt=1, pr=3)
                transaction = official.updater.load("hml-update-transaction").Transaction(operation, None, project_state=root)
                from contextlib import nullcontext
                with patch.object(official.updater, "STATE", root), \
                     patch.object(official.updater, "host_scope"), \
                     patch.object(official.updater, "root_file", side_effect=lambda path: Path(path)), \
                     patch.object(official.updater, "prepare_operation") as prepare, \
                     (nullcontext() if pending else transaction.locked()):
                    report = official.coordinate("op-test", identity, authorize_operation="op-test",
                                                 authorize_revision=identity["revision"])
                    prepare.assert_not_called()
                    self.assertEqual(report["result"], "pending_recovery" if pending else "rejected")

    def test_exact_authorization_before_host_access(self):
        with patch.object(official.updater, "host_scope") as host:
            with self.assertRaises(ValueError):
                official.coordinate("op-test", {"revision": "a" * 40},
                                    authorize_operation="op-other", authorize_revision="a" * 40)
            host.assert_not_called()

    def test_results_and_sanitization(self):
        for phase in ("accepted", "restored", "installing", None, "artifact_failure", "preflight_failure"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                operation = root / "op-test"
                operation.mkdir(mode=0o700)
                identity = dict(revision="b" * 40, artifact_id=1, run_id=2, attempt=1, pr=3)
                def prepare(*args):
                    if phase == "artifact_failure":
                        raise ValueError("NEVER_PRINT")
                    (operation / "config.json").write_text('{}')
                def preflight(*args):
                    if phase == "preflight_failure":
                        raise ValueError("NEVER_PRINT")
                    return {"revision": "a" * 40}
                def execute(*args, **kwargs):
                    if phase:
                        (operation / "operation.json").write_text(json.dumps({"phase": phase,
                            "previous": {"revision": "a" * 40}, "secret": "NEVER_PRINT"}))
                    if phase != "accepted":
                        raise ValueError("NEVER_PRINT")
                with patch.object(official.updater, "STATE", root), \
                     patch.object(official.updater, "host_scope"), \
                     patch.object(official.updater, "root_file", side_effect=lambda path: Path(path)), \
                     patch.object(official.updater, "prepare_operation", side_effect=prepare), \
                     patch.object(official.updater, "check_config"), \
                     patch.object(official.updater, "make_adapter"), \
                     patch.object(official.updater, "installed_preflight", side_effect=preflight), \
                     patch.object(official.updater, "execute_operation", side_effect=execute):
                    result = official.coordinate("op-test", identity, authorize_operation="op-test",
                                                 authorize_revision=identity["revision"])
                expected = {"accepted": "accepted", "restored": "rejected_restored",
                            "installing": "pending_recovery", None: "rejected",
                            "artifact_failure": "rejected", "preflight_failure": "rejected"}[phase]
                self.assertEqual(result["result"], expected)
                self.assertNotIn("NEVER_PRINT", json.dumps(result))
