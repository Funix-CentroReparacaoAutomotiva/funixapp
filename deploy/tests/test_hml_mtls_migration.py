import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'remote-hml'/(name+'.py'))
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
migration=load('migrate')
control=load('control')


class MigrationTest(unittest.TestCase):
    def test_restored_release_and_pending_block(self):
        old={'revision':'a'*40}; new={'revision':'b'*40}
        for phase, expected in (('accepted',new),('restored',old)):
            self.assertEqual(control.installed_from_journal(dict(schema=1,project='funix-hml',phase=phase,
                             previous=old,candidate=new)),expected)
        with self.assertRaises(control.Blocked):
            control.installed_from_journal(dict(schema=1,project='funix-hml',phase='installing',previous=old,candidate=new))

    def test_code_migration_restore_and_interruption_preserve_unrelated_state(self):
        for failure in ('none','exception','interrupt'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as directory:
                root=Path(directory); installed=root/'installed'; installed.mkdir()
                source=root/'source'; source.mkdir()
                target=installed/'module.py'; target.write_bytes(b'old')
                additional=installed/'new-module.py'
                source_one=source/'module.py'; source_one.write_bytes(b'new')
                source_two=source/'new-module.py'; source_two.write_bytes(b'added')
                untouched=root/'credentials'; untouched.write_bytes(b'synthetic-private-state')
                mapping={target:source_one,additional:source_two}
                approval={'old':migration.inventory(mapping),'new':{str(t):migration.digest(s) for t,s in mapping.items()}}
                operation=root/'migration'
                def validate():
                    if target.read_bytes()==b'new':
                        if failure=='exception': raise ValueError('synthetic validation')
                        if failure=='interrupt': raise KeyboardInterrupt()
                with patch.object(migration,'command',return_value='active') as commands:
                    if failure=='interrupt':
                        with self.assertRaises(KeyboardInterrupt):
                            migration.migrate(mapping,operation,approval,validate=validate)
                        self.assertEqual(json.loads((operation/'journal.json').read_text())['phase'],'installing')
                        result=migration.migrate(mapping,operation,None,recover=True,validate=validate)
                    else:
                        result=migration.migrate(mapping,operation,approval,validate=validate)
                    self.assertEqual(result,'accepted' if failure=='none' else 'restored')
                    self.assertEqual(target.read_bytes(),b'new' if failure=='none' else b'old')
                    self.assertEqual(additional.exists(),failure=='none')
                    self.assertEqual(untouched.read_bytes(),b'synthetic-private-state')
                    self.assertTrue(all(args.args[0:2] in (('systemctl','show'),('systemctl','stop'),('systemctl','start'))
                                        for args in commands.call_args_list))

    def test_candidate_pins_detect_crlf_before_any_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            package=root/'remote-hml'
            package.mkdir()
            installed=root/'installed'
            installed.mkdir()
            source=package/'official.py'
            source.write_bytes(b'print("safe")\\n')
            data=source.read_bytes()
            blob=hashlib.sha1(b'blob '+str(len(data)).encode()+bytes([0])+data).hexdigest()
            control=package/'control.py'
            control.write_text('FILES = {"official": "'+blob+'"}\\n')
            prepare_hash=hashlib.sha256(control.read_bytes()).hexdigest()
            rootctl=package/'rootctl.py'
            rootctl.write_text("PREP_SHA = '"+prepare_hash+"'\\n")
            mapping={installed/'control.py':control}
            with patch.object(migration,'PACKAGE',package),patch.object(migration,'targets',return_value=mapping):
                migration.source_integrity(mapping)
                source.write_bytes(data.replace(b'\\n',b'\\r\\n'))
                with self.assertRaisesRegex(ValueError,'official module pin'):
                    migration.source_integrity(mapping)
                source.write_bytes(data)
                control.write_bytes(control.read_bytes().replace(b'\\n',b'\\r\\n'))
                with self.assertRaisesRegex(ValueError,'prepare controller pin'):
                    migration.source_integrity(mapping)

    def test_retry_preserves_terminal_journal_and_requires_exact_restoration(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/'source.py'
            source.write_bytes(b'new')
            target=root/'installed.py'
            target.write_bytes(b'old')
            mapping={target:source}
            approval={'old':migration.inventory(mapping),
                      'new':{str(target):migration.digest(source)}}
            with patch.object(migration,'command',return_value='active'):
                def reject(): raise ValueError('synthetic failed check')
                self.assertEqual(migration.migrate(mapping,root/'migration',approval,validate=reject),'restored')
                old_record=(root/'migration'/'journal.json').read_bytes()
                with patch.object(migration,'STATE',root):
                    migration.prior_restoration(mapping)
                    self.assertEqual(migration.migrate(mapping,root/'migration-retry',approval),'accepted')
                    self.assertEqual((root/'migration'/'journal.json').read_bytes(),old_record)
                    self.assertEqual(target.read_bytes(),b'new')
                    with self.assertRaises(ValueError):
                        migration.prior_restoration(mapping)
                self.assertEqual(json.loads((root/'migration-retry'/'journal.json').read_text())['phase'],'accepted')

    def test_interrupted_retry_can_be_recovered_without_replaying_update(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            target=root/'installed.py'
            target.write_bytes(b'old')
            source=root/'source.py'
            source.write_bytes(b'new')
            mapping={target:source}
            approval={'old':migration.inventory(mapping),'new':{str(target):migration.digest(source)}}
            with patch.object(migration,'command',return_value='active'):
                self.assertEqual(migration.migrate(mapping,root/'migration',approval,validate=lambda: (_ for _ in ()).throw(ValueError('reject'))),'restored')
                def interrupt(): raise KeyboardInterrupt()
                with self.assertRaises(KeyboardInterrupt):
                    migration.migrate(mapping,root/'migration-retry',approval,validate=interrupt)
                self.assertEqual(target.read_bytes(),b'new')
                with patch.object(migration,'STATE',root):
                    with self.assertRaisesRegex(ValueError,'installed code differs'):
                        migration.prior_restoration(mapping)
                    migration.prior_restoration(mapping,require_installed_old=False)
                self.assertEqual(migration.migrate(mapping,root/'migration-retry',None,recover=True),'restored')
                self.assertEqual(target.read_bytes(),b'old')

    def test_retry_rejects_incomplete_legacy_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            target=root/'installed.py'
            target.write_bytes(b'old')
            source=root/'source.py'
            source.write_bytes(b'new')
            mapping={target:source}
            approval={'old':migration.inventory(mapping),'new':{str(target):migration.digest(source)}}
            with patch.object(migration,'command',return_value='active'):
                migration.migrate(mapping,root/'migration',approval)
            with patch.object(migration,'STATE',root),self.assertRaisesRegex(ValueError,'prior migration not safely restored'):
                migration.prior_restoration(mapping)

    def test_inventory_mismatch_has_no_service_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); target=root/'old'; target.write_bytes(b'old')
            source=root/'new'; source.write_bytes(b'new')
            with patch.object(migration,'command') as command,self.assertRaises(ValueError):
                migration.migrate({target:source},root/'migration',{'old':{},'new':{}})
            command.assert_not_called()
