import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "adapter", Path(__file__).resolve().parents[1] / "hml-docker-maintenance.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class MaintenanceAdapterTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        db = self.data / "funix.sqlite"
        db.touch()
        state = self.root / "state"
        state.mkdir()
        compose = self.root / "compose.json"
        compose.write_text("{}")
        self.normal_validator = Mock()
        self.restricted_validator = Mock()
        self.a = adapter.MaintenanceDockerAdapter(
            compose=compose, contract={}, database=db, state=state,
            validator=self.normal_validator, restricted_validator=self.restricted_validator)
        self.a.operation_directory = self.root / "operation"
        self.a.operation_directory.mkdir(mode=0o700)
        self.a.run = Mock()
        self.a.containers = Mock(return_value=[])
        self.a.normal_mounts = Mock(return_value={
            "/etc/nginx/nginx.conf": str(compose),
            "/etc/nginx/hml.htpasswd": str(compose)})
        self.a.verify_gate_configuration = Mock()
        self.a.assert_installed = Mock()
        self.a.assert_gateway_mounts = Mock()
        self.a.write_release = Mock()
        self.a.check_live_isolation = Mock()

    def test_enter_stops_gateway_then_writes_separate_mounts(self):
        self.a.enter_maintenance()
        root = self.a.operation_directory
        self.assertEqual(self.a.run.call_args_list[0].args[0][-2:], ["stop", "gateway"])
        login = json.loads((root / "maintenance-login.json").read_text())
        self.assertEqual(login["username"], "funix-maintenance")
        self.assertEqual((root / "maintenance-login.json").stat().st_mode & 0o777, 0o600)
        self.assertNotIn(login["password"], (root / "maintenance.htpasswd").read_text())
        mounts = json.loads(self.a.gate_path().read_text())["services"]["gateway"]["volumes"]
        self.assertEqual({m["target"] for m in mounts}, set(adapter.TARGETS))
        self.assertTrue(all(m["read_only"] and not m["bind"]["create_host_path"] for m in mounts))
        self.assertEqual((self.root / "compose.json").read_text(), "{}")
        self.a.verify_gate_configuration.assert_called_once()

    def test_install_never_starts_normal_gateway(self):
        self.a.enter_maintenance()
        self.a.run.reset_mock()
        self.a.install("candidate")
        calls = [call.args[0] for call in self.a.run.call_args_list]
        starts = [call for call in calls if "up" in call]
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[0][-2:], ["api", "web"])
        self.assertEqual(starts[1][-1], "gateway")
        for call in starts:
            self.assertIn(str(self.a.gate_path()), call)
            self.assertIn("--no-build", call)
            self.assertIn("never", call)
        self.a.assert_gateway_mounts.assert_called_with(restricted=True)

    def test_open_recreates_only_gateway_and_uses_normal_validator(self):
        self.a.enter_maintenance()
        self.a.run.reset_mock()
        with patch.object(adapter.base.DockerAdapter, "validate", lambda a, release: a.validator(release)):
            self.a.open_access("candidate")
        starts = [call.args[0] for call in self.a.run.call_args_list if "up" in call.args[0]]
        self.assertEqual(len(starts), 1)
        self.assertEqual(starts[0][-1], "gateway")
        self.assertNotIn(str(self.a.gate_path()), starts[0])
        self.normal_validator.assert_called_once_with("candidate")
        self.a.assert_gateway_mounts.assert_called_with(restricted=False)

    def test_normal_validation_failure_stops_gateway(self):
        self.a.enter_maintenance()
        self.normal_validator.side_effect = ValueError("bad normal validation")
        self.a.run.reset_mock()
        with patch.object(adapter.base.DockerAdapter, "validate", lambda a, release: a.validator(release)):
            with self.assertRaisesRegex(ValueError, "bad normal"):
                self.a.open_access("candidate")
        self.assertEqual(self.a.run.call_args.args[0][-2:], ["stop", "gateway"])

    def test_validate_uses_private_gate_credential_only(self):
        self.a.enter_maintenance()
        with patch.object(adapter.base.DockerAdapter, "validate", lambda a, release: a.validator(release)):
            self.a.validate("candidate")
        self.restricted_validator.assert_called_once_with(
            "candidate", self.a.operation_directory / "maintenance-login.json")
        self.normal_validator.assert_not_called()
        self.assertEqual(self.a.validator, self.normal_validator)

    def test_guard_blocks_before_any_backup(self):
        self.a.run.return_value = ""
        with patch.object(adapter.base.DockerAdapter, "quiesce"), \
                patch.object(adapter.guard, "assert_quiescent", side_effect=ValueError("writer")):
            with self.assertRaisesRegex(ValueError, "writer"):
                self.a.quiesce()

    def test_parent_mount_blocks_even_if_not_exact_database_directory(self):
        self.a.run.side_effect = ["other-id", json.dumps([{"Mounts": [{"Source": str(self.root)}]}])]
        with patch.object(adapter.base.DockerAdapter, "quiesce"), \
                patch.object(adapter.guard, "assert_quiescent") as scan:
            with self.assertRaisesRegex(ValueError, "overlapping"):
                self.a.quiesce()
            scan.assert_not_called()
