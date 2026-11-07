"""Offline safety/control-flow tests. These do NOT homologate Docker or Evolution."""
import importlib.util
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('evolution_lab_runner', Path(__file__).with_name('run.py'))
lab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lab)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.calls = []
        self.version = '2.3.7'
        self.fail_step = None
        self.collision = False
        self.package = None
        self.envfile = None

    def tearDown(self):
        self.temp.cleanup()

    def fake_command(self, args, env, timeout=120):
        self.calls.append(args)
        self.assertNotIn('DOCKER_HOST', env)
        self.assertNotIn('DOCKER_CONTEXT', env)
        self.assertEqual(args[:2], ['docker', '--host=unix:///var/run/docker.sock'])
        self.assertGreater(timeout, 0)
        if '--env-file' in args:
            self.envfile = Path(args[args.index('--env-file') + 1])
            self.assertEqual(self.envfile.stat().st_mode & 0o777, 0o600)
            content = self.envfile.read_text()
            self.assertIn('LAB_API_KEY=', content)
            self.assertIn('LAB_REDIS_PASSWORD=', content)
            self.assertNotIn('inherited-not-allowed', content)
        if self.fail_step and self.fail_step in args:
            raise RuntimeError('Synthetic failure with raw output withheld')
        if 'ls' in args or 'ps' in args:
            return 'existing-resource' if self.collision else ''
        if 'create' in args:
            return 'synthetic-inspection-id\n'
        if 'cp' in args:
            self.package = Path(args[-1])
            self.package.write_text(json.dumps({'version': self.version}))
        return 'synthetic-local-result\n'

    def run_lab(self, free=16 * 1024**3):
        # Restore umask after exercising main; never depend on the operator environment.
        old = os.umask(0o077)
        try:
            with patch.object(lab, 'ROOT', self.root), patch.object(lab, 'command', self.fake_command), \
                 patch.object(lab.shutil, 'disk_usage', return_value=type('Usage', (), {'free': free})()), \
                 patch.dict(os.environ, {'DOCKER_HOST': 'tcp://not-used.invalid', 'DOCKER_CONTEXT': 'not-used', 'LAB_API_KEY': 'inherited-not-allowed'}):
                with redirect_stdout(io.StringIO()):
                    code = lab.main()
        finally:
            os.umask(old)
        report = json.loads((self.root / '.runtime/evolution-sandbox/run-summary.json').read_text())
        return code, report

    def test_low_disk_blocks_before_any_docker_or_http(self):
        code, report = self.run_lab(free=1024)
        self.assertEqual(code, 2)
        self.assertEqual(self.calls, [])
        self.assertFalse(report['httpHarnessInvoked'])

    def test_wrong_image_version_never_starts_and_unstarted_container_removed(self):
        self.version = 'unknown'
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertFalse(report['httpHarnessInvoked'])
        self.assertFalse(any('up' in c for c in self.calls))
        self.assertTrue(any('rm' in c and 'synthetic-inspection-id' in c for c in self.calls))

    def test_pull_failure_stops_before_create_or_up(self):
        self.fail_step = 'pull'
        code, _ = self.run_lab()
        self.assertEqual(code, 2)
        self.assertFalse(any('create' in c or 'up' in c for c in self.calls))

    def test_collision_does_not_adopt_or_remove_existing_resources(self):
        self.collision = True
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertFalse(report['httpHarnessInvoked'])
        self.assertFalse(any('pull' in c or 'up' in c or 'down' in c for c in self.calls))

    def test_cleanup_failure_is_not_reported_as_success(self):
        self.fail_step = 'down'
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertEqual(report['state'], 'blocked')
        self.assertTrue(report['cleanup'].startswith('FAILED:'))

    def test_partial_start_failure_cleans_only_own_random_project(self):
        self.fail_step = 'up'
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        down = [c for c in self.calls if 'down' in c]
        self.assertEqual(len(down), 1)
        self.assertEqual(down[0][down[0].index('--project-name') + 1], report['project'])
        self.assertTrue(report['project'].startswith('evoreadlab-'))
        self.assertIn('--volumes', down[0])
        self.assertFalse(any('prune' in c for c in self.calls))

    def test_exercise_failure_still_reports_attempt_and_cleans(self):
        self.fail_step = 'exercise'
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertTrue(report['httpHarnessInvoked'])
        self.assertEqual(report['cleanup'], 'own fresh project removed')
        self.assertFalse(self.envfile.exists())

    def test_control_flow_uses_pinned_image_and_recovery_no_credentials_persist(self):
        code, report = self.run_lab()
        self.assertEqual(code, 0)  # simulated commands only
        self.assertEqual(report['state'], 'completed')
        self.assertIn('@sha256:', report['image'])
        self.assertTrue(any('outage' in c for c in self.calls))
        self.assertTrue(any('recovery' in c for c in self.calls))
        self.assertFalse(self.envfile.exists())
        self.assertNotIn('LAB_API_KEY', json.dumps(report))
        self.assertNotIn('LAB_PG_PASSWORD', json.dumps(report))
        self.assertNotIn('LAB_REDIS_PASSWORD', json.dumps(report))

    def test_compose_runtime_is_private_and_unrelated_to_app_deploy(self):
        text = lab.COMPOSE.read_text()
        self.assertIn('internal: true', text)
        self.assertNotRegex(text, r'(?m)^\s*(ports|external|container_name|network_mode):')
        self.assertEqual(text.count('@sha256:'), 3)
        self.assertNotIn(':latest', text)
        self.assertNotIn('/var/run/docker.sock', text)
        self.assertNotIn('env_file:', text)
        self.assertIn("TELEMETRY_ENABLED: 'false'", text)

    def test_http_runner_has_no_provider_connection_route(self):
        text = Path(__file__).with_name('contract.mjs').read_text()
        self.assertIn('http://127.0.0.1:8080', text)
        self.assertIn('qrcode: false', text)
        self.assertNotRegex(text, r'/instance/(connect|restart|logout)|/message/send|/chat/getBase64')
        self.assertIn("from '/poc/client.ts'", text)


if __name__ == '__main__':
    unittest.main()
