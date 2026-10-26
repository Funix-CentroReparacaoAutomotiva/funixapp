"""Run the workflow's actual validator against sanitized Compose JSON.

Compose omits false create_host_path in normalized JSON. Missing/false is safe;
true, temporary storage and unrelated services must still fail. No host access.
"""
import copy
import json
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ComposeConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = (ROOT / '.github/workflows/funix.yml').read_text()
        match = re.search(r"docker compose config --format json \| python3 -c '([^']+)'", workflow)
        if match is None:
            raise AssertionError('Production Compose validator not found in workflow')
        cls.validator = match[1]

    def config(self):
        return {'services': {
            'api': {
                'environment': {'FUNIX_DATABASE_PATH': '/data/funix.sqlite'},
                'volumes': [
                    {'type': 'bind', 'source': '/var/lib/funix/app-data', 'target': '/data', 'bind': {}},
                    {'type': 'tmpfs', 'target': '/tmp', 'tmpfs': {'size': '16777216'}},
                ],
            },
            'web': {},
        }}

    def validate(self, config):
        return subprocess.run(
            [sys.executable, '-c', self.validator], input=json.dumps(config),
            capture_output=True, text=True,
        )

    def test_false_omitted_or_explicit_is_accepted_without_printing_config(self):
        for bind in [None, {}, {'create_host_path': False}]:
            with self.subTest(bind=bind):
                config = self.config()
                volume = config['services']['api']['volumes'][0]
                if bind is None:
                    del volume['bind']
                else:
                    volume['bind'] = bind
                result = self.validate(config)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, '')

    def test_automatic_host_directory_creation_is_rejected(self):
        config = self.config()
        config['services']['api']['volumes'][0]['bind']['create_host_path'] = True
        self.assertNotEqual(self.validate(config).returncode, 0)

    def test_database_cannot_move_to_tmp_or_memory(self):
        for path in ['/tmp/funix.sqlite', ':memory:', '.runtime/funix.sqlite']:
            with self.subTest(path=path):
                config = self.config()
                config['services']['api']['environment']['FUNIX_DATABASE_PATH'] = path
                self.assertNotEqual(self.validate(config).returncode, 0)

    def test_wrong_or_missing_persistent_bind_is_rejected(self):
        for field, value in [('source', '/tmp/funix'), ('target', '/tmp'), ('type', 'tmpfs')]:
            with self.subTest(field=field):
                config = self.config()
                config['services']['api']['volumes'][0][field] = value
                self.assertNotEqual(self.validate(config).returncode, 0)
        config = self.config()
        config['services']['api']['volumes'].pop(0)
        self.assertNotEqual(self.validate(config).returncode, 0)

    def test_unrelated_services_are_rejected(self):
        for name in ['n8n', 'evolution', 'traefik']:
            with self.subTest(service=name):
                config = copy.deepcopy(self.config())
                config['services'][name] = {}
                self.assertNotEqual(self.validate(config).returncode, 0)

    def test_deploy_requires_manual_dispatch_on_main_with_explicit_true(self):
        workflow = (ROOT / '.github/workflows/funix.yml').read_text()
        match = re.search(r'\n  deploy:.*?\n    if: >-\n((?:      [^\n]*\n)+)', workflow, re.S)
        self.assertIsNotNone(match)
        # This job uses only comparisons and &&; exercise that actual expression.
        expression = ' '.join(match[1].split()).replace('&&', ' and ')
        expression = re.sub(r'\btrue\b', 'True', expression)
        cases = [
            ('push', 'refs/heads/main', False, False),
            ('push', 'refs/heads/main', True, False),
            ('pull_request', 'refs/pull/10/merge', True, False),
            ('workflow_dispatch', 'refs/heads/main', False, False),
            ('workflow_dispatch', 'refs/heads/main', True, True),
            ('workflow_dispatch', 'refs/heads/integracao/mvp-comercial-main', True, False),
        ]
        for event, ref, deploy, expected in cases:
            with self.subTest(event=event, ref=ref, deploy=deploy):
                actual = eval(expression, {'__builtins__': {}}, {
                    'github': SimpleNamespace(event_name=event, ref=ref),
                    'inputs': SimpleNamespace(deploy=deploy),
                })
                self.assertIs(actual, expected)


if __name__ == '__main__':
    unittest.main()
