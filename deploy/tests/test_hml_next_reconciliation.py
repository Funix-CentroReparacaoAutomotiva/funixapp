"""Second HML controller migration keeps the first accepted journal immutable.

No VPS state is accessed. All paths, code images, systemd and proof are synthetic.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('hml_reconcile_v2', ROOT/'remote-hml/migrate.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class NextReconciliationTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        self.state = base/'ops'
        self.state.mkdir(mode=0o700)
        self.updater = base/'updater'
        self.updater.mkdir(mode=0o700)
        self.target = base/'installed-control.py'
        self.selection = base/'installed-selection.py'
        self.target.write_bytes(b'current trusted controller')
        self.selection.write_bytes(b'current trusted selection')
        self.target.chmod(0o644)
        self.selection.chmod(0o600)
        self.source_control = base/'candidate-control.py'
        self.source_control.write_bytes(b'new trusted controller')
        self.source_selection = base/'candidate-selection.py'
        self.source_selection.write_bytes(b'current trusted selection')
        self.mapping = {self.target:self.source_control, self.selection:self.source_selection}
        self.old = m.inventory(self.mapping)
        self.new = {str(dest):m.digest(src) for dest,src in self.mapping.items()}
        self.modes = {str(self.target):0o644, str(self.selection):0o600}
        self.original = self.state/'migration'
        self.retry = self.state/'migration-retry'
        self.upgrade = self.state/'migration-controller-permits'
        self.first = self.state/'migration-controller-web-adoption'
        self.next = self.state/'migration-controller-web-adoption-v2'
        self.gate = base/'transport.d'/'gate.conf'
        self.expected = {'journal':{'phase':'accepted'},'last_request':None}
        self.transport = 'active'
        self.trial = False
        self.initial_history = {}
        self._seed_history()
        patch.multiple(m,STATE=self.state,UPDATER=self.updater,GATE=self.gate,SELECTION=self.selection).start()
        patch.object(m,'locks',side_effect=contextlib.nullcontext).start()
        patch.object(m,'idle',return_value=self.expected).start()
        patch.object(m,'targets',return_value=self.mapping).start()
        # The real source-integrity verifier requires all 15 fixed host paths;
        # this isolated routing test supplies a deterministic, pinned synthetic map.
        patch.object(m,'source_integrity',return_value=self.new).start()
        patch.object(m,'command',side_effect=self.command).start()
        self.addCleanup(patch.stopall)
        self.gate.parent.mkdir(mode=0o755)
        self.gate.write_bytes(m.gate_content(self.first))

    def _seed_history(self):
        # Legacy restored transaction excludes the 15th selection destination.
        self.original.mkdir(mode=0o700)
        old = {str(self.target): self.old[str(self.target)]}
        old_modes = {str(self.target): 0o644}
        legacy = {'schema':1,'phase':'restored','transport_active':True,
                  'old':old,'new':old,'modes':old_modes}
        m.durable_json(self.original/'journal.json', legacy)
        saved = m.backup_path(self.original,self.target)
        m.durable_bytes(saved,self.target.read_bytes())
        m.durable_bytes(saved.with_name('new-'+saved.name),self.target.read_bytes())
        prior = m.digest(self.original/'journal.json')
        for name, directory in [('retry',self.retry),('upgrade',self.upgrade),('first',self.first)]:
            directory.mkdir(mode=0o700)
            record = {'schema':2,'id':{'retry':'a','upgrade':'b','first':'c'}[name]*32,
                      'phase':'accepted','transport_active':True,
                      'old':dict(self.old),'new':dict(self.old),
                      'modes':dict(self.modes),'prior_journal_sha256':prior}
            m.durable_json(directory/'journal.json',record)
            for target in self.mapping:
                saved = m.backup_path(directory,target)
                data = target.read_bytes()
                m.durable_bytes(saved,data)
                m.durable_bytes(saved.with_name('new-'+saved.name),data)
            prior=m.digest(directory/'journal.json')
            self.initial_history[name]=(directory/'journal.json').read_bytes()
        self.first_digest=prior

    def command(self,*args):
        if args[0]=='systemd-run':
            self.trial=True
            return ''
        if args[0]=='/usr/bin/python3':
            return ''  # Local pinned-loader only; bytes checked separately by the migrator.
        if args[0]!='systemctl':
            raise AssertionError(args)
        if args[1]=='list-units':
            return m.TRIAL if self.trial else ''
        if args[1]=='is-active':
            return self.transport
        if args[1]=='show':
            if args[-1]==m.TRIAL:
                return '1'*32 if 'InvocationID' in args else 'active' if self.trial else 'inactive'
            return self.transport
        if args[1]=='stop':
            if args[-1]==m.TRIAL:self.trial=False
            else:self.transport='inactive'
            return ''
        if args[1]=='start':
            if (self.next/'hold').exists(): raise AssertionError('start while held')
            self.transport='active'
            return ''
        if args[1]=='daemon-reload':
            return ''
        raise AssertionError(args)

    def call(self, action, authorized=False, response=None):
        body=io.TextIOWrapper(io.BytesIO(json.dumps(response or {}).encode()))
        with patch('sys.stdin',body),contextlib.redirect_stdout(io.StringIO()) as output:
            m.execute(action,authorized)
        return json.loads(output.getvalue())

    def _authorize(self):
        approval={'old':dict(self.old),'new':dict(self.new),
                  'prior_journal_sha256':self.first_digest}
        m.durable_json(self.state/'migration-controller-web-adoption-v2-approval.json',approval)

    def _prove(self):
        self.call('probe-reconcile-v2',True)
        record=m.current_record(self.mapping,self.next)
        return {'schema':'funix-hml-ops/1','scope':'funix-hml','status':'ok',
                'migration_probe':record['probe']['challenge'],
                'armed':None,'last_request':None,'journal':self.expected['journal']}

    def test_exact_status_and_full_accept_with_separate_journal(self):
        inventory=self.call('inventory-reconcile-v2')
        self.assertEqual(inventory, {'old':self.old,'new':self.new,'prior_journal_sha256':self.first_digest})
        self._authorize()
        result=self.call('apply-reconcile-v2',True)
        self.assertEqual(result,{'scope':'funix-hml','migration':'awaiting_probe','attempt':'reconcile_v2'})
        self.assertEqual(self.gate.read_bytes(),m.gate_content(self.next))
        self.assertTrue((self.next/'hold').exists())
        self.assertEqual(self.transport,'inactive')
        with self.assertRaisesRegex(ValueError,'explicit action'):
            self.call('apply-reconcile',True)
        proof=self._prove()
        self.assertEqual(self.call('accept-reconcile-v2',True,proof)['migration'],'accepted')
        self.assertEqual(self.transport,'active')
        self.assertFalse((self.next/'hold').exists())
        self.assertEqual(self.call('inventory-reconcile-v2')['phase'],'accepted')
        self.assertEqual(self.target.read_bytes(),b'new trusted controller')
        self.assertEqual(m.current_record(self.mapping,self.next)['prior_journal_sha256'],self.first_digest)
        for key,directory in [('retry',self.retry),('upgrade',self.upgrade),('first',self.first)]:
            self.assertEqual((directory/'journal.json').read_bytes(),self.initial_history[key])

    def test_missing_exact_approval_or_drift_refuses_before_new_journal(self):
        self._authorize()
        wrong=self.state/'migration-controller-web-adoption-v2-approval.json'
        body=json.loads(wrong.read_text())
        body['prior_journal_sha256']='0'*64
        m.durable_json(wrong,body)
        with self.assertRaisesRegex(ValueError,'previous transport condition or approval'):
            self.call('apply-reconcile-v2',True)
        self.assertFalse(self.next.exists())
        self.assertEqual(self.gate.read_bytes(),m.gate_content(self.first))
        self.assertEqual(self.transport,'active')

        self._authorize()
        self.target.write_bytes(b'unexpected local edit')
        with self.assertRaisesRegex(ValueError,'installed code drift'):
            self.call('apply-reconcile-v2',True)
        self.assertFalse(self.next.exists())

    def test_not_accepted_history_and_bad_gate_block(self):
        self._authorize()
        record=json.loads((self.first/'journal.json').read_text())
        record['phase']='probing'
        m.durable_json(self.first/'journal.json',record)
        with self.assertRaisesRegex(ValueError,'first reconciliation not accepted'):
            self.call('inventory-reconcile-v2')
        with self.assertRaisesRegex(ValueError,'first reconciliation not accepted'):
            self.call('apply-reconcile-v2',True)
        m.durable_bytes(self.first/'journal.json',self.initial_history['first'])
        self.gate.write_text('unexpected condition')
        with self.assertRaisesRegex(ValueError,'previous transport condition'):
            self.call('apply-reconcile-v2',True)
        self.assertFalse(self.next.exists())

    def test_prior_history_tampering_and_missing_dropin_block(self):
        self._authorize()
        saved = (self.first/'journal.json').read_bytes()
        old = json.loads(saved)
        old['prior_journal_sha256'] = '0'*64
        m.durable_json(self.first/'journal.json',old)
        with self.assertRaisesRegex(ValueError,'history changed'):
            self.call('inventory-reconcile-v2')
        self.assertFalse(self.next.exists())
        m.durable_bytes(self.first/'journal.json',saved)

        target = m.backup_path(self.first,self.target)
        backup = target.read_bytes()
        target.write_bytes(b'adulterated backup')
        with self.assertRaisesRegex(ValueError,'backup digest changed'):
            self.call('inventory-reconcile-v2')
        target.write_bytes(backup)
        self.assertFalse(self.next.exists())

        self.gate.unlink()
        with self.assertRaisesRegex(ValueError,'previous transport condition'):
            self.call('apply-reconcile-v2',True)
        self.assertFalse(self.next.exists())
        self.assertEqual(self.transport,'active')

    def test_existing_first_attempt_is_not_reused(self):
        self._authorize()
        with self.assertRaisesRegex(ValueError,'reconciliation requires explicit action'):
            self.call('inventory')
        with self.assertRaisesRegex(ValueError,'reconciliation requires explicit action'):
            self.call('apply',True)
        self.assertEqual(self.call('inventory-reconcile-v2')['prior_journal_sha256'],self.first_digest)
        self.assertFalse(self.next.exists())

    def test_rollback_after_accept_has_separate_approval_and_preserves_history(self):
        self._authorize()
        self.call('apply-reconcile-v2',True)
        proof=self._prove()
        self.call('accept-reconcile-v2',True,proof)
        record=m.current_record(self.mapping,self.next)
        rollback={key:record[key] for key in ('id','old','new','prior_journal_sha256')}
        m.durable_json(self.state/'migration-controller-web-adoption-v2-rollback-approval.json',rollback)
        self.assertEqual(self.call('rollback-reconcile-v2',True)['migration'],'restored')
        self.assertEqual(self.target.read_bytes(),b'current trusted controller')
        self.assertFalse((self.next/'hold').exists())
        self.assertEqual(self.transport,'active')
        for key,directory in [('retry',self.retry),('upgrade',self.upgrade),('first',self.first)]:
            self.assertEqual((directory/'journal.json').read_bytes(),self.initial_history[key])


if __name__=='__main__':
    unittest.main()
