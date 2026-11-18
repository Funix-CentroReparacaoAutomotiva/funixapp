"""CLI boundary regression: no live Docker, filesystem or credential access."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("updater", ROOT / "hml-update.py")
up = importlib.util.module_from_spec(spec)
spec.loader.exec_module(up)
spec = importlib.util.spec_from_file_location("adapter", ROOT / "hml-docker-adapter.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class CliTest(unittest.TestCase):
    def test_no_authorization_rejects_before_host_access(self):
        for action in ("update", "recover", "rollback"):
            with self.subTest(action=action), patch.object(sys, "argv", [
                "hml-update.py", action, "--operation", "/ignored", "--config", "/ignored/config.json"
            ]), patch.object(up, "host_scope") as scope, self.assertRaisesRegex(ValueError, "authorization"):
                up.main()
            scope.assert_not_called()

    def test_authorized_dispatch_preserves_rollback_ack(self):
        op = Path("/var/lib/funix-hml/updater/op-test")
        conf = op / "config.json"
        for action in ("update", "recover", "rollback"):
            args = ["hml-update.py", action, "--operation", str(op), "--config", str(conf), "--authorize"]
            if action == "rollback":
                args += ["--discard-post-update-data"]
            config = {"candidate": {}}
            file = Mock()
            file.read_text.side_effect = ['{"candidate":{}}', '{"phase":"accepted"}']
            with self.subTest(action=action), patch.object(sys, "argv", args), \
                 patch.object(up, "host_scope", return_value=op), \
                 patch.object(up, "root_file", return_value=file), \
                 patch.object(up, "check_config") as check, \
                 patch.object(up, "execute_operation", return_value=Mock(journal=op/"operation.json")) as execute:
                up.main()
                check.assert_called_once_with(config, op)
                execute.assert_called_once_with(action, config, op, authorized=True,
                                                discard_post_update_data=(action == "rollback"))

    def test_prepare_dispatch_never_executes_transaction(self):
        op = Path("/var/lib/funix-hml/updater/op-test")
        conf = op / "config.json"
        rev = "a" * 40
        with patch.object(sys, "argv", ["hml-update.py","prepare","--operation",str(op),
                                       "--config",str(conf),"--artifact-id","1","--run-id","2",
                                       "--attempt","1","--revision",rev,"--pr","3"]), \
             patch.object(up, "host_scope", return_value=op), \
             patch.object(up, "execute_operation") as execute, \
             patch.object(up, "prepare_operation") as prepare:
            up.main()
            prepare.assert_called_once_with(op, conf, {"artifact_id":1,"run_id":2,
                                            "attempt":1,"revision":rev,"pr":3})
            execute.assert_not_called()

    def test_wrong_database_or_gateway_is_rejected(self):
        op = Path("/var/lib/funix-hml/updater/op-test")
        config = up.fixed_config(op)
        config["database"] = "/var/lib/funix/app-data/funix.sqlite"
        with self.assertRaisesRegex(ValueError, "scope"):
            up.check_config(config, op)
        config = up.fixed_config(op)
        config.update(contract="pinned", candidate={"gateway":"unexpected"})
        file = Mock()
        file.read_text.return_value = "pinned"
        with patch.object(up, "root_file", return_value=file), self.assertRaisesRegex(ValueError, "gateway"):
            up.check_config(config, op)

    def test_contract_ignores_only_release_images_and_revision(self):
        c = {"name":"funix-hml","services": {
            "api":{"image":"old", "environment":{"FUNIX_REVISION":"a","FUNIX_OPERATOR_PASSWORD":"synthetic"}},
            "web":{"image":"old"}, "gateway":{"image":"stable"}}}
        first = adapter.contract_digest(c)
        c["services"]["api"]["image"] = "new"
        c["services"]["api"]["environment"]["FUNIX_REVISION"] = "b"
        self.assertEqual(first, adapter.contract_digest(c))
        c["services"]["api"]["environment"]["FUNIX_OPERATOR_PASSWORD"] = "changed"
        self.assertNotEqual(first, adapter.contract_digest(c))

    def test_contract_refuses_other_project(self):
        with self.assertRaisesRegex(ValueError,"project"):
            adapter.contract_digest({"name":"funixapp","services":{}})
