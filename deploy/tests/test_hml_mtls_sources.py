"""New synthetic regressions for recovered #274 sources; never install services."""
import fcntl
import hashlib
import importlib.util
import json
import sys
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
selection = load(ROOT / "hml-selection.py")


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
        self.assertIn("hml-selection", prep.FILES)
        self.assertEqual(hashlib.sha256((ROOT / "remote-hml/control.py").read_bytes()).hexdigest(), ctl.PREP_SHA)
        self.assertNotIn("u.validator=", (ROOT / "remote-hml/control.py").read_text())

    def test_selection_pin_rejects_modified_source_before_import(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            code = base / 'official'
            code.mkdir()
            target = code / 'hml-selection.py'
            target.write_bytes((ROOT / target.name).read_bytes())
            with patch.object(prep,'BASE',base), patch.object(prep,'private_dir',side_effect=Path), \
                 patch.object(prep,'private_file',side_effect=Path):
                self.assertEqual(prep.official_module('hml-selection').MAX_SIZE, 1024**3)
                target.write_bytes(target.read_bytes()+b'\n')
                with self.assertRaisesRegex(prep.Blocked,'updater_integrity'):
                    prep.official_module('hml-selection')

    def test_approval_translation_preserves_controller_limits(self):
        identity = dict(pr=27, run_id=41, attempt=1, artifact_id=90, revision="a"*40)
        approval = dict(identity=identity, digest="b"*64, size=1024**3, installed_revision="c"*40)
        self.assertEqual(prep.selected(approval, selection),
                         dict(identity, sha256=approval["digest"], size=approval["size"]))
        for invalid in (dict(approval, size=1024**3+1), dict(approval, size=True),
                        dict(approval, identity=dict(identity, artifact_id=10**15)),
                        dict(approval, identity=dict(identity, path="/tmp/input"))):
            with self.assertRaises(prep.Blocked):
                prep.selected(invalid, selection)

    def test_preparation_receipt_is_locked_and_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory); private=state/'private'; private.mkdir()
            (state/'lock').touch()
            previous={'revision':'a'*40}
            predecessor=state/'op-predecessor'; predecessor.mkdir()
            journal=predecessor/'operation.json'
            journal.write_text(json.dumps(dict(schema=1, project='funix-hml', phase='accepted', candidate=previous)))
            (predecessor/'config.json').write_text('{}')
            (state/'active.json').write_text(json.dumps({'journal':str(journal)}))
            (private/'github.token').write_text('github_pat_'+'x'*32)
            database=state/'test.sqlite'; database.touch()
            updater=Mock(DATABASE=database)
            updater.installed_preflight.return_value=previous
            updater.prepare_operation.side_effect=lambda op, path, identity: prep.save(
                path,json.dumps({'identity':identity}).encode())
            provenance=load(ROOT/'hml-artifact-provenance.py')

            def download(approval, token, op):
                if not (op/'candidate.zip').exists():
                    prep.save(op/'candidate.zip',str(approval['identity']['artifact_id']).encode())

            with patch.object(prep,'STATE',state), patch.object(prep,'PRIVATE',private), \
                 patch.object(prep,'private_file',side_effect=Path), patch.object(prep,'private_dir',side_effect=Path), \
                 patch.object(prep,'official_module',return_value=selection), patch.object(prep,'load_updater',return_value=updater), \
                 patch.object(prep,'external_snapshot',return_value={}), patch.object(prep,'download',side_effect=download), \
                 patch.object(prep.os,'geteuid',return_value=0), patch.object(sys,'argv',['test']):
                with (state/'lock').open('r+') as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    identity=dict(pr=1,run_id=3,attempt=1,artifact_id=7,revision='b'*40)
                    approval=dict(identity=identity,digest='c'*64,size=1,installed_revision=previous['revision'])
                    (private/'approval.json').write_text(json.dumps(approval))
                    with self.assertRaises(BlockingIOError):
                        prep.prepare()
                self.assertFalse((state/'op-3-1-prep-7').exists())
                receipts=[]
                for artifact_id in (7,8):
                    identity=dict(identity,artifact_id=artifact_id,revision=str(artifact_id)*40)
                    approval=dict(approval,identity=identity,digest=hashlib.sha256(str(artifact_id).encode()).hexdigest())
                    (private/'approval.json').write_text(json.dumps(approval))
                    responses={
                        'actions/runs/3/attempts/1':dict(id=3,run_attempt=1,event='workflow_dispatch',
                            head_branch='main',path=provenance.WORKFLOW,status='completed',
                            conclusion='success',repository={'full_name':provenance.REPO}),
                        f'actions/artifacts/{artifact_id}':dict(id=artifact_id,size_in_bytes=1,
                            expired=False,name=f"funix-hml-{identity['revision']}-1",
                            workflow_run={'id':3},digest='sha256:'+approval['digest']),
                        'pulls/1':dict(head=dict(sha=identity['revision'],repo={'full_name':provenance.REPO}),
                            base={'ref':'main'}),
                    }
                    with patch.object(prep,'query',side_effect=lambda path,token:responses[path]):
                        result=prep.prepare()
                        receipt=state/result['operation']/'prepared.json'
                        receipts.append((receipt,receipt.read_bytes()))
                        before=receipt.stat()
                        self.assertEqual(prep.prepare(),result)
                        self.assertFalse(result['deploy'])
                        self.assertEqual(receipt.stat().st_ino,before.st_ino)
                        self.assertEqual(receipt.stat().st_mtime_ns,before.st_mtime_ns)
                        journal.write_text(journal.read_text()+' ')
                        with self.assertRaisesRegex(prep.Blocked,'prepared_record_changed'):
                            prep.prepare()
                        journal.write_text(journal.read_text().rstrip())
                for receipt,content in receipts:
                    self.assertEqual(receipt.read_bytes(),content)
            updater.execute_operation.assert_not_called()

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
