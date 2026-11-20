"""New synthetic regressions for recovered #274 sources; never install services."""
import hashlib
import importlib.util
import json
from pathlib import Path
import time
import tempfile
import contextlib
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

ctl = load(ROOT / "remote-hml/rootctl.py")
prep = load(ROOT / "remote-hml/control.py")
official = load(ROOT / "hml-official-update.py")


class MtlsSourcesTest(unittest.TestCase):
    def test_recovered_modules_match_supplied_manifest(self):
        recovered = ROOT / "remote-hml/recovered"
        manifest = json.loads((recovered / "manifest.json").read_text())
        for original, name in (("ops/rootctl.py", "rootctl.py"), ("ops/transport.py", "transport.py"),
                               ("prepare/control.py", "control.py")):
            content = (recovered / name).read_bytes()
            self.assertEqual(len(content), manifest["files"][original]["bytes"])
            self.assertEqual(hashlib.sha256(content).hexdigest(), manifest["files"][original]["sha256"])
    def ticket(self):
        preview = dict(action="update", scope="funix-hml", operation="op-test",
                       revision="a" * 40, sha256="b" * 64)
        now = int(time.time())
        return dict(schema=ctl.SCHEMA, ticket_id="c" * 32, issued_at=now,
                    expires_at=now+1200, preview=preview, preview_sha256=ctl.hash_obj(preview))

    def test_ticket_binds_preview_and_lifetime(self):
        ticket = self.ticket()
        ctl.ticket_valid(ticket)
        ticket["preview"]["revision"] = "d" * 40
        with self.assertRaises(ctl.Blocked):
            ctl.ticket_valid(ticket)
        ticket = self.ticket()
        ticket["expires_at"] += 1
        with self.assertRaises(ctl.Blocked):
            ctl.ticket_valid(ticket)

    def test_request_rejects_arbitrary_commands_duplicates_and_scope(self):
        request = ctl.request_of(self.ticket())
        self.assertEqual(ctl.parse_request(json.dumps(request).encode()), request)
        for body in (b'{"action":"update","action":"shell"}', b'{}', b'x'*4097,
                     json.dumps(dict(request, operation="../../production")).encode(),
                     json.dumps(dict(request, command="id")).encode()):
            with self.assertRaises(ctl.Blocked):
                ctl.parse_request(body)

    def test_prepared_bridge_preserves_official_transaction(self):
        identity = {"revision":"a"*40}
        config = {"identity": identity, "candidate": {"revision":"a"*40}}
        updater = Mock()
        op = Path("/var/lib/funix-hml/updater/op-test")
        official.execute_prepared(op, config, identity, authorize_operation=op.name,
                                  authorize_revision=identity["revision"], official_updater=updater)
        updater.execute_operation.assert_called_once_with("update", config, op, authorized=True)
        updater.reset_mock()
        with self.assertRaises(ValueError):
            official.execute_prepared(op, config, identity, authorize_operation="op-other",
                                      authorize_revision=identity["revision"], official_updater=updater)
        updater.execute_operation.assert_not_called()

    def test_release_pins_include_coordinator_and_exact_control(self):
        for name, expected in prep.FILES.items():
            content = (ROOT / (name + ".py")).read_bytes()
            self.assertEqual(hashlib.sha1(("blob " + str(len(content)) + "\0").encode()+content).hexdigest(), expected)
        self.assertIn("hml-official-update", prep.FILES)
        self.assertEqual(hashlib.sha256((ROOT / "remote-hml/control.py").read_bytes()).hexdigest(), ctl.PREP_SHA)
        self.assertNotIn("u.validator=", (ROOT / "remote-hml/control.py").read_text())

    def test_mtls_rejects_origin_and_fingerprint(self):
        transport = load(ROOT / "remote-hml/transport.py")
        for origin, cert in (("192.0.2.2", b"expected"), ("192.0.2.1", b"other")):
            server = object.__new__(transport.Server)
            server.source = "192.0.2.1"
            server.fp = hashlib.sha256(b"expected").hexdigest()
            server.ctx = Mock()
            server.ctx.wrap_socket.return_value.getpeercert.return_value = cert
            with patch.object(transport.HTTPServer, "get_request", return_value=(Mock(), (origin,1234))):
                with self.assertRaises(OSError):
                    server.get_request()

    def test_dispatch_without_approval_never_starts_worker(self):
        import contextlib
        with patch.object(ctl,"locked",return_value=contextlib.nullcontext()), \
             patch.object(ctl,"require_idle"), patch.object(ctl,"armed_ticket",return_value=None), \
             patch.object(ctl.subprocess,"run") as run:
            with self.assertRaises(ctl.Blocked):
                ctl.dispatch(json.dumps(ctl.request_of(self.ticket())).encode())
            run.assert_not_called()

    def test_expired_and_consumed_approvals_cannot_dispatch_again(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "requests").mkdir(mode=0o700)
            ticket = self.ticket()
            with patch.object(ctl,"ROOT",root), \
                 patch.object(ctl,"private_file",side_effect=lambda path: Path(path)), \
                 patch.object(ctl,"locked",side_effect=contextlib.nullcontext), \
                 patch.object(ctl,"require_idle"), \
                 patch.object(ctl.subprocess,"run",return_value=Mock(returncode=0,stdout="inactive")) as run:
                expired = dict(ticket, issued_at=int(time.time())-1300, expires_at=int(time.time())-100)
                (root / "armed.json").write_text(json.dumps(expired))
                with self.assertRaises(ctl.Blocked):
                    ctl.dispatch(json.dumps(ctl.request_of(expired)).encode())
                run.assert_not_called()
                (root / "armed.json").write_text(json.dumps(ticket))
                result = ctl.dispatch(json.dumps(ctl.request_of(ticket)).encode())
                self.assertEqual(result["status"], "queued")
                self.assertFalse((root / "armed.json").exists())
                self.assertTrue((root / "requests" / ticket["ticket_id"] / "ticket.json").exists())
                previous_calls = run.call_count
                with self.assertRaises(ctl.Blocked):
                    ctl.dispatch(json.dumps(ctl.request_of(ticket)).encode())
                self.assertEqual(run.call_count, previous_calls)
