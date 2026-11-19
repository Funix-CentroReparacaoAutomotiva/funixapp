import importlib.util
import json
from pathlib import Path
import tempfile
import os
import sys
import subprocess
import unittest
from unittest.mock import patch, Mock

SPEC = importlib.util.spec_from_file_location("official", Path(__file__).resolve().parents[1] / "hml-official-update.py")
official = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(official)


class OfficialUpdateTest(unittest.TestCase):
    def test_pending_and_concurrent_operations_never_prepare(self):
        for scenario in ("other", "same", "busy"):
            pending = scenario != "busy"
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                operation = root / "op-test"
                operation.mkdir(mode=0o700)
                other = operation if scenario == "same" else root / "op-other"
                other.mkdir(mode=0o700, exist_ok=True)
                (other / "operation.json").write_text('{"schema":1,"project":"funix-hml","phase":"installing"}')
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
                    self.assertEqual(report["result"], "pending_recovery" if pending else "busy")
                    self.assertEqual(report["recovery_operation"], other.name if pending else None)

    def test_exact_authorization_before_host_access(self):
        with patch.object(official.updater, "host_scope") as host:
            with self.assertRaises(ValueError):
                official.coordinate("op-test", {"revision": "a" * 40},
                                    authorize_operation="op-other", authorize_revision="a" * 40)
            host.assert_not_called()

    def test_results_and_sanitization(self):
        for phase in ("accepted", "restored", "installing", None, "artifact_failure", "preflight_failure", "race_pending", "race_busy"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                operation = root / "op-test"
                operation.mkdir(mode=0o700)
                identity = dict(revision="b" * 40, artifact_id=1, run_id=2, attempt=1, pr=3)
                locks = []
                def prepare(*args):
                    if phase == "artifact_failure":
                        raise ValueError("NEVER_PRINT")
                    (operation / "config.json").write_text('{}')
                def preflight(*args):
                    if phase == "preflight_failure":
                        raise ValueError("NEVER_PRINT")
                    return {"revision": "a" * 40}
                def execute(*args, **kwargs):
                    if phase == "race_busy":
                        transaction = official.updater.load("hml-update-transaction").Transaction(operation, None, project_state=root)
                        held = transaction.locked()
                        held.__enter__()
                        locks.append(held)
                        raise BlockingIOError("NEVER_PRINT")
                    if phase == "race_pending":
                        other = root / "op-other"
                        other.mkdir(mode=0o700)
                        (other / "operation.json").write_text('{"schema":1,"project":"funix-hml","phase":"installing"}')
                        (root / "active.json").write_text(json.dumps({"journal":str(other / "operation.json")}))
                        raise ValueError("NEVER_PRINT")
                    if phase:
                        (operation / "operation.json").write_text(json.dumps({"schema":1,"project":"funix-hml","phase": phase,
                            "previous": {"revision": "a" * 40}, "secret": "NEVER_PRINT"}))
                        (root / "active.json").write_text(json.dumps({"journal":str(operation / "operation.json")}))
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
                    for held in locks:
                        held.__exit__(None, None, None)
                expected = {"accepted": "accepted", "restored": "rejected_restored",
                            "installing": "pending_recovery", None: "rejected",
                            "artifact_failure": "rejected", "preflight_failure": "rejected",
                            "race_pending": "pending_recovery", "race_busy": "busy"}[phase]
                self.assertEqual(result["result"], expected)
                if phase == "race_pending":
                    self.assertEqual(result["recovery_operation"], "op-other")
                if phase == "race_busy":
                    self.assertEqual(result["recovery"], "unknown")
                self.assertNotIn("NEVER_PRINT", json.dumps(result))

    def test_invalid_pointer_or_journal_never_recommends_recovery(self):
        for target, record in (("op-other/operation.json", {"phase":"installing"}),
                               ("op-other/wrong.json", {"schema":1,"project":"funix-hml","phase":"installing"}),
                               ("op-other/operation.json", {"schema":1,"project":"other","phase":"installing"}),
                               ("op-other/operation.json", {"schema":1,"project":"funix-hml","phase":"secret"})):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "op-other").mkdir()
                (root / target).write_text(json.dumps(record))
                (root / "active.json").write_text(json.dumps({"journal":str(root / target)}))
                report = {}
                with patch.object(official.updater, "STATE", root), \
                     patch.object(official.updater, "root_file", side_effect=lambda path: Path(path)), \
                     self.assertRaises(ValueError):
                    official.pending_status(report)
                self.assertIsNone(report["recovery_operation"])

    def test_cli_suppresses_python_and_subprocess_secrets_in_both_streams(self):
        program = """
import importlib.util, os, subprocess, sys
spec=importlib.util.spec_from_file_location('official',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def coordinate(*args,**kwargs):
 print('SENSITIVE_MARKER')
 print('SENSITIVE_MARKER',file=sys.stderr)
 subprocess.run([sys.executable,'-c',"import os; os.write(1,b'SENSITIVE_MARKER\\\\n'); os.write(2,b'SENSITIVE_MARKER\\\\n')"])
 print('HTTPS attempt=1 category=transient retry=true',file=sys.stderr)
 raise ValueError('SENSITIVE_MARKER')
m.coordinate=coordinate
sys.argv=['official','--operation','op-test','--revision','a'*40,'--artifact-id','1','--run-id','2','--attempt','1','--pr','3','--authorize-operation','op-test','--authorize-revision','a'*40]
raise SystemExit(m.main())
"""
        result = subprocess.run([sys.executable, "-c", program, str(Path(official.__file__))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("SENSITIVE_MARKER", result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["result"], "rejected")
        self.assertIn("category=transient", result.stderr)
