import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
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
        return migration.recover(self.mapping,self.operation,self.expected,self.validate)

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

    def test_restored_release_and_pending_block(self):
        spec = importlib.util.spec_from_file_location('control', ROOT/'remote-hml/control.py')
        control = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(control)
        old = {'revision':'a'*40}
        new = {'revision':'b'*40}
        record = dict(schema=1, project='funix-hml', previous=old, candidate=new)
        self.assertEqual(control.installed_from_journal(dict(record,phase='accepted')),new)
        self.assertEqual(control.installed_from_journal(dict(record,phase='restored')),old)
        with self.assertRaises(control.Blocked):
            control.installed_from_journal(dict(record,phase='installing'))

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
        with self.assertRaisesRegex(ValueError,'invalid mTLS'):
            self.accept(dict(response,journal={'phase':'restored'}))
        self.assert_held()
        response = self.probe()
        self.trial = False  # Runtime limit elapsed or connection timed out.
        with self.assertRaisesRegex(ValueError,'invalid mTLS'):
            self.accept(response)
        self.assert_held()
        accepted_proof = self.probe()
        self.assertEqual(self.accept(accepted_proof),'accepted')
        with self.assertRaisesRegex(ValueError,'accept phase'):
            self.accept(accepted_proof)
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

    def test_recovery_reopens_after_interruption_between_release_and_start(self):
        self.start()
        proof = self.probe()
        original = migration.command
        def interrupt(*args):
            if args[1] == 'start':
                raise KeyboardInterrupt
            return original(*args)
        with patch.object(migration,'command',side_effect=interrupt), self.assertRaises(KeyboardInterrupt):
            self.accept(proof)
        self.assertEqual(self.record()['phase'],'accepted')
        self.assertFalse((self.operation/'hold').exists())
        self.assertEqual(self.transport,'inactive')
        self.assertEqual(self.recovery(),'accepted')
        self.assertEqual(self.transport,'active')

    def test_accepted_recovery_rejects_journal_and_result_drift_after_start_failure(self):
        self.start()
        evidence = self.probe()
        self.fail_start = True
        with self.assertRaises(TimeoutError):
            self.accept(evidence)
        self.fail_start = False
        for drift in (dict(self.expected,journal={'phase':'restored'}),
                      dict(self.expected,last_request={'status':'accepted'})):
            with self.subTest(drift=drift):
                with self.assertRaisesRegex(ValueError,'operational state changed'):
                    migration.recover(self.mapping,self.operation,drift,self.validate)
                self.assert_held()
                self.assertEqual(self.record()['phase'],'accepted')
        self.assertEqual(self.recovery(),'accepted')

    def test_accepted_drift_reinstalls_hold_when_interrupted_after_release(self):
        self.start()
        evidence = self.probe()
        original = migration.command
        def interrupt(*args):
            if args[1] == 'start':
                raise KeyboardInterrupt
            return original(*args)
        with patch.object(migration,'command',side_effect=interrupt), self.assertRaises(KeyboardInterrupt):
            self.accept(evidence)
        self.assertFalse((self.operation/'hold').exists())
        self.expected = dict(self.expected,journal={'phase':'restored'})
        with self.assertRaisesRegex(ValueError,'operational state changed'):
            self.recovery()
        self.assert_held()

    def test_restored_recovery_without_probe_allows_state_change(self):
        self.start()
        self.expected = dict(self.expected,journal={'phase':'restored'})
        self.assertEqual(self.recovery(),'restored')
        self.assertEqual(self.recovery(),'restored')

    def test_restored_after_rollback_rejects_drift_during_reopening(self):
        self.start()
        self.assertEqual(self.accept(self.probe()),'accepted')
        approval = self.rollback_approval()
        self.fail_start = True
        with self.assertRaises(TimeoutError):
            migration.rollback(self.mapping,self.operation,approval,self.expected,self.validate)
        self.fail_start = False
        self.assertEqual(self.record()['phase'],'restored')
        drift = dict(self.expected,last_request={'status':'accepted'})
        with self.assertRaisesRegex(ValueError,'operational state changed'):
            migration.recover(self.mapping,self.operation,drift,self.validate)
        self.assert_held()
        self.assertEqual(self.target.read_bytes(),b'old code')
        self.assertFalse(self.additional.exists())
        self.assertEqual(self.recovery(),'restored')

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

    def assert_inventory(self, data):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            migration.execute('inventory',False)
        self.assertEqual(json.loads(output.getvalue()),data)

    def execute(self, action, proof=None):
        stdin = io.TextIOWrapper(io.BytesIO(json.dumps(proof).encode()))
        with patch('sys.stdin',stdin), contextlib.redirect_stdout(io.StringIO()) as output:
            migration.execute(action,True)
        return json.loads(output.getvalue())

    def prepare_cli(self):
        state = self.operation.parent
        self.updater = state/'updater'
        self.updater.mkdir(mode=0o700)
        self.retry = state/'migration-retry'
        self.retry_approval = state/'migration-approval-retry.json'
        self.retry_rollback_approval = state/'migration-rollback-approval-retry.json'
        patch.multiple(migration,STATE=state,UPDATER=self.updater,SELECTION=self.additional).start()
        patch.object(migration,'locks',side_effect=contextlib.nullcontext).start()
        patch.object(migration,'idle',return_value=self.expected).start()
        patch.object(migration,'targets',return_value=self.mapping).start()
        patch.object(migration,'source_integrity',return_value=self.approval['new']).start()

    def legacy_restored(self, phase='restored'):
        legacy_absent = self.operation.parent/'originally-absent.py'
        self.mapping[legacy_absent] = self.source
        absent = str(legacy_absent)
        self.approval['old'][absent] = None
        self.approval['new'][absent] = migration.digest(self.source)
        self.operation.mkdir(mode=0o700)
        legacy_source = self.operation.parent/'historical-crlf.py'
        legacy_source.write_bytes(b'old candidate\r\n')
        record = {'schema':1, 'phase':phase, 'transport_active':True,
                  'old':{str(self.target):migration.digest(self.target), absent:None},
                  'new':{str(self.target):migration.digest(legacy_source), absent:migration.digest(self.source)},
                  'modes':{str(self.target):0o644, absent:0o600}}
        saved = migration.backup_path(self.operation,self.target)
        migration.durable_bytes(saved,self.target.read_bytes())
        for target, source in ((self.target,legacy_source),(legacy_absent,self.source)):
            saved = migration.backup_path(self.operation,target)
            migration.durable_bytes(saved.with_name('new-'+saved.name),source.read_bytes())
        journal = self.operation/'journal.json'
        migration.durable_json(journal,record)
        approval = dict(self.approval,prior_journal_sha256=migration.digest(journal))
        migration.durable_json(self.retry_approval,approval)
        return record, approval

    def historical_bytes(self):
        return {p.name:p.read_bytes() for p in self.operation.iterdir()}

    def test_cli_initial_applies_only_without_either_transaction(self):
        self.prepare_cli()
        self.assert_inventory(self.approval)
        migration.durable_json(migration.STATE/'migration-approval.json',self.approval)
        self.assertEqual(self.execute('apply'),{'scope':'funix-hml','migration':'awaiting_probe','attempt':'original'})
        self.assertEqual(self.execute('recover')['migration'],'restored')
        self.assertFalse(self.retry.exists())

    def test_cli_retry_has_its_own_gate_proof_approval_and_rollback(self):
        self.prepare_cli()
        original, approval = self.legacy_restored()
        history = self.historical_bytes()
        self.assert_inventory(dict(self.approval,migration={key:original[key] for key in
                                    ('schema','phase','old','new')} | {'journal_sha256':approval['prior_journal_sha256']}))
        with self.assertRaisesRegex(ValueError,'existing migration'):
            self.execute('apply')
        migration.durable_json(self.retry_approval,self.approval)
        with self.assertRaisesRegex(ValueError,'approval mismatch'):
            self.execute('retry-restored')
        self.assertFalse(self.retry.exists())
        migration.durable_json(self.retry_approval,approval)
        self.assertEqual(self.execute('retry-restored')['migration'],'awaiting_probe')
        self.assertEqual(self.gate.read_bytes(),migration.gate_content(self.retry))
        self.assertEqual(self.execute('probe-retry')['migration'],'probing')
        challenge = migration.current_record(self.mapping,self.retry)['probe']['challenge']
        with self.assertRaisesRegex(ValueError,'explicit retry'):
            self.execute('accept')
        self.assertTrue(self.trial)
        proof = dict(self.expected,migration_probe=challenge,armed=None,
                     scope='funix-hml',schema='funix-hml-ops/1',status='ok')
        self.assertEqual(self.execute('accept-retry',proof)['migration'],'accepted')
        with self.assertRaisesRegex(ValueError,'accept phase'):
            self.execute('accept-retry',proof)
        record = migration.current_record(self.mapping,self.retry)
        rollback = {key:record[key] for key in ('id','old','new')}
        migration.durable_json(self.retry_rollback_approval,rollback)
        with self.assertRaisesRegex(ValueError,'approval mismatch'):
            self.execute('rollback-retry')
        migration.durable_json(self.retry_rollback_approval,dict(rollback,prior_journal_sha256=approval['prior_journal_sha256']))
        self.assertEqual(self.execute('rollback-retry')['migration'],'restored')
        self.assertEqual(migration.inventory(self.mapping),self.approval['old'])
        self.assertEqual(self.historical_bytes(),history)

    def test_retry_blocks_nonrestored_legacy_and_drift_before_writes(self):
        self.prepare_cli()
        original, _ = self.legacy_restored('accepted')
        journal = self.operation/'journal.json'
        for phase in ('accepted','installing','restoring'):
            with self.subTest(phase=phase):
                migration.durable_json(journal,dict(original,phase=phase))
                with self.assertRaisesRegex(ValueError,'not safely restored'):
                    self.execute('retry-restored')
        migration.durable_json(journal,dict(original,phase='restored'))
        self.additional.write_bytes(b'unexpected selection')
        with self.assertRaisesRegex(ValueError,'installed code drift'):
            self.execute('retry-restored')
        self.additional.unlink()
        self.target.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'installed mode drift'):
            self.execute('retry-restored')
        self.target.chmod(0o644)
        migration.backup_path(self.operation,self.target).write_bytes(b'corrupt prior backup')
        with self.assertRaisesRegex(ValueError,'prior backup differs'):
            self.execute('retry-restored')
        self.assertFalse(self.retry.exists())
        self.assertFalse(self.gate.exists())

    def test_retry_recovery_checks_history_and_handles_a_partial_replacement(self):
        self.prepare_cli()
        self.legacy_restored()
        history = self.historical_bytes()
        replace = migration.replace_code

        def interrupt(*args):
            replace(*args)
            raise KeyboardInterrupt

        with patch.object(migration,'replace_code',side_effect=interrupt), self.assertRaises(KeyboardInterrupt):
            self.execute('retry-restored')
        self.assertEqual(self.target.read_bytes(),b'new code')
        self.assertFalse(self.additional.exists())
        with self.assertRaisesRegex(ValueError,'explicit retry'):
            self.execute('recover')
        journal = self.operation/'journal.json'
        journal.write_bytes(history['journal.json']+b'\n')
        with self.assertRaisesRegex(ValueError,'history binding changed'):
            self.execute('recover-retry')
        self.assertTrue((self.retry/'hold').exists())
        journal.write_bytes(history['journal.json'])
        self.retry_approval.unlink()
        self.assertEqual(self.execute('recover-retry')['migration'],'restored')
        self.assertEqual(migration.inventory(self.mapping),self.approval['old'])
        self.assertEqual(self.historical_bytes(),history)

    def test_recover_retry_preserves_original_and_archives_prejournal_staging(self):
        self.prepare_cli()
        self.legacy_restored()
        history = self.historical_bytes()
        self.retry.mkdir(mode=0o700)
        (self.retry/'journal.json.tmp.new').write_text('interrupted')
        self.assertEqual(self.execute('recover-retry')['migration'],'abandoned_staging')
        archive, = self.retry.parent.glob('migration-retry-abandoned-*')
        self.assertEqual((archive/'journal.json.tmp.new').read_text(),'interrupted')
        self.assertEqual(self.historical_bytes(),history)
        self.assertFalse(self.gate.exists())

    def test_candidate_pins_reject_crlf_and_divergent_lf_sources(self):
        package = self.operation.parent/'deploy'/'remote-hml'
        package.mkdir(parents=True)
        pins = migration.pins()
        for name in ('rootctl.py','control.py','transport.py'):
            shutil.copyfile(ROOT/'remote-hml'/name,package/name)
        for name in pins:
            shutil.copyfile(ROOT/(name+'.py'),package.parent/(name+'.py'))
        with patch.object(migration,'PACKAGE',package):
            mapping = migration.targets()
            self.assertEqual(len(migration.source_integrity(mapping)),15)
            for path,pattern in ((package.parent/'hml-selection.py','official module pin'),
                                 (package/'control.py','prepare controller pin')):
                data = path.read_bytes()
                path.write_bytes(data+b'\n')
                with self.assertRaisesRegex(ValueError,pattern):
                    migration.source_integrity(mapping)
                path.write_bytes(data.replace(b'\n',b'\r\n'))
                with self.assertRaisesRegex(ValueError,'CRLF'):
                    migration.source_integrity(mapping)
                path.write_bytes(data)


if __name__ == '__main__':
    unittest.main()
