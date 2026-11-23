import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'remote-hml' / 'control.py'
spec = importlib.util.spec_from_file_location('hml_control', path)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class WebAdoptionTest(unittest.TestCase):
    def test_adoption_keeps_original_and_rejects_changed_journal(self):
        original = {'revision': 'a' * 40, 'api': 'sha256:' + 'b' * 64,
                    'web': 'sha256:' + 'c' * 64, 'gateway': 'sha256:' + 'd' * 64}
        record = {'schema': 1, 'phase': 'accepted', 'project': 'funix-hml',
                  'candidate': original}
        with tempfile.TemporaryDirectory() as folder:
            journal = Path(folder) / 'operation.json'
            journal.write_text(json.dumps(record))
            adoption = journal.with_name('web-adoption.json')
            digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            with patch.object(control, 'private_file', side_effect=lambda path: path):
                self.assertEqual(control.effective_release(record, journal), (original, None))
                new_web = 'sha256:' + 'e' * 64
                adoption.write_text(json.dumps({
                    'schema': 'funix-hml-web-adoption/1',
                    'journal_sha256': digest(journal), 'original': original,
                    'web': new_web, 'panel_revision': 'f' * 40,
                }))
                self.assertEqual(control.effective_release(record, journal),
                                 ({**original, 'web': new_web}, digest(adoption)))
                self.assertEqual(json.loads(journal.read_text()), record)
                journal.write_text(json.dumps(record) + '\n')
                with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
                    control.effective_release(record, journal)
