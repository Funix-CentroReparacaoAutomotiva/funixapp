"""Immutable first Web adoption and hash-chained second publication."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / 'remote-hml' / 'control.py'
spec = importlib.util.spec_from_file_location('funix_hml_control_chain', PATH)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

ORIGINAL = {
    'revision': '54b60d98b6c39ff0dc8ada0f7daa60bcf6cf2325',
    'api': 'sha256:53508314296731231f4e2af860f39793ccd8696a91bf4de48163bb2758ac47d0',
    'web': 'sha256:cc2e9a6b9ef4d8679d1e9830876d32f0cbd065ccf3305ed4e384aba2c1988476',
    'gateway': 'sha256:1d4bb63430ffa684179547f9b14656ffe7ccb10d2a7f3776befc1f6b40012c5e',
}
WEB_FIRST = 'sha256:1399b35c184a48591fab864685b4a82d4fa350d2cc79ea8fd9ff80f9f338b50b'
WEB_SECOND = 'sha256:4aae0d21ec1a207285f48cbaea5e1bd1ba889abc9e2053d54079fc90066c521a'


class WebAdoptionChainTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.journal = self.directory / 'operation.json'
        self.record = {'schema': 1, 'phase': 'accepted', 'project': 'funix-hml',
                       'candidate': ORIGINAL}
        self.journal.write_text(json.dumps(self.record))
        self.initial = self.directory / 'web-adoption.json'
        self.second = self.directory / 'web-adoption-model-b.json'
        self.sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        self.first_record = {
            'schema': 'funix-hml-web-adoption/1',
            'journal_sha256': self.sha(self.journal),
            'original': ORIGINAL, 'web': WEB_FIRST,
            'panel_revision': '6ba7797c3ffa14dd192665ae3adef451761d640b',
        }
        self.initial.write_text(json.dumps(self.first_record))
        self.second_record = {
            'schema': 'funix-hml-web-adoption/2',
            'journal_sha256': self.sha(self.journal),
            'original': ORIGINAL,
            'previous_adoption_sha256': self.sha(self.initial),
            'previous_web': WEB_FIRST, 'web': WEB_SECOND,
            'panel_revision': 'dbfad4be34546497a833fda0c06fc1119332204a',
        }
        p = patch.object(control, 'private_file', side_effect=lambda path: path)
        p.start()
        self.addCleanup(p.stop)

    def test_before_and_after_append_only_second_adoption(self):
        first_bytes = self.initial.read_bytes()
        self.assertEqual(control.effective_release(self.record, self.journal),
                         ({**ORIGINAL, 'web': WEB_FIRST}, self.sha(self.initial)))
        self.second.write_text(json.dumps(self.second_record))
        self.assertEqual(control.effective_release(self.record, self.journal),
                         ({**ORIGINAL, 'web': WEB_SECOND}, self.sha(self.second)))
        self.assertEqual(self.initial.read_bytes(), first_bytes)

    def test_legacy_record_mutation_invalidates_second(self):
        self.second.write_text(json.dumps(self.second_record))
        self.initial.write_text(json.dumps(self.first_record) + '\n')
        with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
            control.effective_release(self.record, self.journal)

    def test_second_record_must_be_bound_to_first_and_journal(self):
        for key, value in (
            ('previous_adoption_sha256', '0' * 64),
            ('previous_web', ORIGINAL['web']),
            ('journal_sha256', '0' * 64),
            ('schema', 'wrong'),
            ('original', {**ORIGINAL, 'api': 'sha256:' + 'a' * 64}),
            ('web', WEB_FIRST),
            ('panel_revision', 'none'),
        ):
            with self.subTest(key=key):
                document = {**self.second_record, key: value}
                self.second.write_text(json.dumps(document))
                with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
                    control.effective_release(self.record, self.journal)

    def test_missing_or_invalid_prior_blocks_successor(self):
        self.second.write_text(json.dumps(self.second_record))
        self.initial.unlink()
        with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
            control.effective_release(self.record, self.journal)
        self.initial.write_text(json.dumps({**self.first_record, 'web': 'sha256:' + 'a' * 64}))
        with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
            control.effective_release(self.record, self.journal)

    def test_journal_mutation_rejected(self):
        self.second.write_text(json.dumps(self.second_record))
        self.journal.write_text(json.dumps(self.record) + '\n')
        with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
            control.effective_release(self.record, self.journal)

    def test_extra_fields_are_forbidden(self):
        self.second.write_text(json.dumps({**self.second_record, 'unreviewed': True}))
        with self.assertRaisesRegex(control.Blocked, 'invalid_web_adoption'):
            control.effective_release(self.record, self.journal)


if __name__ == '__main__':
    unittest.main()
