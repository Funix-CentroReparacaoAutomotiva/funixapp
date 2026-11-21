import importlib.util
import json
import os
from pathlib import Path
import signal
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('migrate', ROOT/'remote-hml/migrate.py')
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class MigrationTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.operation = root/'migration'
        self.target = root/'installed.py'
        self.target.write_bytes(b'old code')
        self.target.chmod(0o644)
        self.additional = root/'added.py'
        self.source = root/'new.py'
        self.source.write_bytes(b'new code')
        self.mapping = {self.target:self.source, self.additional:self.source}
        self.approval = {'old':migration.inventory(self.mapping),
                         'new':{str(t):migration.digest(s) for t,s in self.mapping.items()}}
        self.gate = root/'transport.d'/'migration.conf'
        self.transport = 'active'
        self.trial = False
        self.fail_start = False
        self.untouched = root/'credentials'
        self.untouched.write_bytes(b'synthetic-private-state')
        self.addCleanup(patch.stopall)
        patch.object(migration,'GATE',self.gate).start()
        patch.object(migration,'command',side_effect=self.command).start()
        self.expected = {'journal':{'phase':'accepted'}, 'last_request':None}

    def command(self, *args):
        if args[0] == 'systemd-run':
            self.trial = True
            return ''
        if args[1] == 'list-units':
            return migration.TRIAL if self.trial else ''
        if args[1] == 'stop':
            if args[-1] == migration.TRIAL:
                self.trial = False
            else:
                self.transport = 'inactive'
        if args[1] == 'start':
            if self.fail_start:
                raise TimeoutError('synthetic start timeout')
            if not (self.operation/'hold').exists():
                self.transport = 'active'
        if args[1] == 'show':
            if args[-1] == migration.TRIAL:
                return '1'*32 if 'InvocationID' in args else 'active' if self.trial else 'inactive'
            return self.transport
        return ''

    def validate(self):
        self.assertEqual(self.untouched.read_bytes(), b'synthetic-private-state')

    def start(self):
        return migration.begin(self.mapping,self.operation,self.approval,self.validate)

    def recovery(self):
        return migration.recover(self.mapping,self.operation,self.validate)

    def record(self):
        return migration.current_record(self.mapping,self.operation)

    def probe(self):
        migration.open_probe(self.mapping,self.operation,self.expected)
        return dict(self.expected, migration_probe=self.record()['probe']['challenge'],
                    armed=None, scope='funix-hml', schema='funix-hml-ops/1', status='ok')

    def accept(self, response):
        return migration.accept(self.mapping,self.operation,response,self.expected,self.validate)

    def rollback_approval(self):
        return {key:self.record()[key] for key in ('id','old','new')}

    def assert_held(self):
        self.assertTrue((self.operation/'hold').is_file())
        self.assertEqual(self.gate.read_bytes(), migration.gate_content(self.operation))
        self.assertEqual(self.transport,'inactive')

    def test_accept_requires_live_bound_get_and_is_explicitly_reversible(self):
        self.assertEqual(self.start(),'awaiting_probe')
        self.assert_held()
        with self.assertRaises(ValueError):
            self.start()
        response = self.probe()
        with self.assertRaisesRegex(ValueError,'invalid mTLS'):
            self.accept(dict(response,migration_probe='old challenge'))
        self.assertFalse(self.trial)
        self.assert_held()
        response = self.probe()
        self.trial = False  # Runtime limit elapsed or connection timed out.
        with self.assertRaisesRegex(ValueError,'invalid mTLS'):
            self.accept(response)
        self.assert_held()
        self.assertEqual(self.accept(self.probe()),'accepted')
        self.assertEqual(self.recovery(),'accepted')
        self.assertEqual(self.target.read_bytes(),b'new code')
        with self.assertRaisesRegex(ValueError,'approval mismatch'):
            migration.rollback(self.mapping,self.operation,self.approval,self.expected,self.validate)
        approval = self.rollback_approval()
        self.assertEqual(migration.rollback(self.mapping,self.operation,approval,self.expected,self.validate),'restored')
        self.assertEqual(self.recovery(),'restored')
        self.assertEqual(self.target.read_bytes(),b'old code')
        self.assertEqual(self.target.stat().st_mode & 0o777,0o644)
        self.assertFalse(self.additional.exists())
        with self.assertRaisesRegex(ValueError,'restoration phase'):
            migration.rollback(self.mapping,self.operation,approval,self.expected,self.validate)

    def test_start_timeout_keeps_validated_code_held(self):
        self.start()
        evidence = self.probe()
        self.fail_start = True
        with self.assertRaises(TimeoutError):
            self.accept(evidence)
        self.assert_held()
        self.assertEqual(self.record()['phase'],'accepted')
        self.fail_start = False
        self.assertEqual(self.recovery(),'accepted')
        self.assertFalse((self.operation/'hold').exists())

    def test_drift_and_backup_damage_prevent_restoration_writes(self):
        self.start()
        self.assertEqual(self.accept(self.probe()),'accepted')
        self.target.write_bytes(b'changed later')
        approval = self.rollback_approval()
        with self.assertRaisesRegex(ValueError,'installed code drift'):
            migration.rollback(self.mapping,self.operation,approval,self.expected,self.validate)
        self.assert_held()
        self.assertEqual(self.target.read_bytes(),b'changed later')
        self.target.write_bytes(b'new code')
        migration.backup_path(self.operation,self.target).write_bytes(b'corrupt backup')
        with self.assertRaisesRegex(ValueError,'backup digest'):
            migration.rollback(self.mapping,self.operation,approval,self.expected,self.validate)
        self.assertEqual(self.target.read_bytes(),b'new code')
        self.assertTrue(self.additional.exists())

    def test_prejournal_sigkill_and_residual_temporary(self):
        original = os.replace
        pid = os.fork()
        if pid == 0:
            def terminate(source,target):
                if Path(target).name == 'journal.json':
                    os.kill(os.getpid(),signal.SIGKILL)
                original(source,target)
            with patch.object(os,'replace',side_effect=terminate):
                self.start()
            os._exit(3)
        _, status = os.waitpid(pid,0)
        self.assertEqual(os.waitstatus_to_exitcode(status),-signal.SIGKILL)
        self.assertEqual(len(list(self.operation.glob('journal.json.*.new'))),1)
        self.assertEqual(self.recovery(),'abandoned_staging')
        self.assertTrue(list(self.operation.parent.glob('migration-abandoned-*')))
        self.assertEqual(self.target.read_bytes(),b'old code')
        self.assertEqual(self.start(),'awaiting_probe')

    def test_sigkill_after_first_replacement_and_during_restoring_journal(self):
        original_replace = migration.replace_code
        pid = os.fork()
        if pid == 0:
            def terminate(*args):
                original_replace(*args)
                os.kill(os.getpid(),signal.SIGKILL)
            with patch.object(migration,'replace_code',side_effect=terminate):
                self.start()
            os._exit(3)
        _, status = os.waitpid(pid,0)
        self.assertEqual(os.waitstatus_to_exitcode(status),-signal.SIGKILL)
        self.assertTrue((self.operation/'hold').exists())
        self.assertEqual(self.record()['phase'],'installing')
        self.assertEqual(self.target.read_bytes(),b'new code')
        self.assertFalse(self.additional.exists())
        original = os.replace
        pid = os.fork()
        if pid == 0:
            def terminate(source,target):
                if Path(target).name == 'journal.json':
                    os.kill(os.getpid(),signal.SIGKILL)
                original(source,target)
            with patch.object(os,'replace',side_effect=terminate):
                self.recovery()
            os._exit(3)
        _, status = os.waitpid(pid,0)
        self.assertEqual(os.waitstatus_to_exitcode(status),-signal.SIGKILL)
        (self.operation/'journal.json.new').write_bytes(b'partial historical temporary')
        self.assertEqual(self.recovery(),'restored')
        self.assertEqual(self.recovery(),'restored')
        self.assertEqual(self.target.read_bytes(),b'old code')
        self.assertTrue((self.operation/'journal.json.new').is_file())

    def test_sigkill_while_installing_gate_and_after_journal_rename(self):
        original = migration.sync_directory
        pid = os.fork()
        if pid == 0:
            def terminate(path):
                if path == self.gate.parent and self.gate.exists():
                    os.kill(os.getpid(),signal.SIGKILL)
                original(path)
            with patch.object(migration,'sync_directory',side_effect=terminate):
                self.start()
            os._exit(3)
        _, status = os.waitpid(pid,0)
        self.assertEqual(os.waitstatus_to_exitcode(status),-signal.SIGKILL)
        self.assertEqual(self.record()['phase'],'prepared')
        self.assertEqual(self.target.read_bytes(),b'old code')
        pid = os.fork()
        if pid == 0:
            def terminate(path):
                if path == self.operation and self.record()['phase'] == 'restored':
                    os.kill(os.getpid(),signal.SIGKILL)
                original(path)
            with patch.object(migration,'sync_directory',side_effect=terminate):
                self.recovery()
            os._exit(3)
        _, status = os.waitpid(pid,0)
        self.assertEqual(os.waitstatus_to_exitcode(status),-signal.SIGKILL)
        self.assertEqual(self.recovery(),'restored')
        self.assertFalse((self.operation/'hold').exists())

    def test_ordinary_failure_restores_old_code(self):
        def validate():
            if self.target.read_bytes() == b'new code':
                raise ValueError('synthetic validation error')
        self.assertEqual(migration.begin(self.mapping,self.operation,self.approval,validate),'restored')
        self.assertEqual(self.target.read_bytes(),b'old code')
        self.assertFalse(self.additional.exists())


if __name__ == '__main__':
    unittest.main()
