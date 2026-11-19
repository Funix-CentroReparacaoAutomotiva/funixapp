import importlib.util
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

    def test_inventory_mismatch_has_no_service_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); target=root/'old'; target.write_bytes(b'old')
            source=root/'new'; source.write_bytes(b'new')
            with patch.object(migration,'command') as command,self.assertRaises(ValueError):
                migration.migrate({target:source},root/'migration',{'old':{},'new':{}})
            command.assert_not_called()
