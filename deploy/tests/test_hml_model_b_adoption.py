"""Modelo B adoption: pinned image, live identity, HTTPS, and immutable journal."""
import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

PATH = Path(__file__).resolve().parents[1] / 'remote-hml' / 'rootctl.py'
spec = importlib.util.spec_from_file_location('funix_hml_rootctl_model_b', PATH)
ctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctl)

ORIGINAL = {
    'revision': '54b60d98b6c39ff0dc8ada0f7daa60bcf6cf2325',
    'api': 'sha256:53508314296731231f4e2af860f39793ccd8696a91bf4de48163bb2758ac47d0',
    'web': 'sha256:cc2e9a6b9ef4d8679d1e9830876d32f0cbd065ccf3305ed4e384aba2c1988476',
    'gateway': 'sha256:1d4bb63430ffa684179547f9b14656ffe7ccb10d2a7f3776befc1f6b40012c5e',
}
MODEL_B_WEB = 'sha256:4aae0d21ec1a207285f48cbaea5e1bd1ba889abc9e2053d54079fc90066c521a'


class Response:
    def __init__(self, authenticated):
        self.status = 200 if authenticated else 401

    def getheader(self, name, default=''):
        return 'Basic realm="HML"' if name == 'WWW-Authenticate' and self.status == 401 else default

    def read(self, maximum):
        return 'Orquestração do ERP'.encode('utf-8')


class Connection:
    def __init__(self, hostname, timeout):
        if hostname != 'hml.funix.com.br' or timeout != 5:
            raise AssertionError('unexpected destination')
        self.authenticated = False

    def request(self, method, path, headers):
        if method != 'GET' or path != '/painel/':
            raise AssertionError('unexpected HTTP operation')
        self.authenticated = bool(headers.get('Authorization'))

    def getresponse(self):
        return Response(self.authenticated)

    def close(self):
        pass


class ModeloBAdoptionTest(unittest.TestCase):
    def test_target_is_exact_and_original_unchanged(self):
        baseline = dict(ORIGINAL)
        selected = ctl.approved_model_b_release(baseline)
        self.assertEqual(selected, {**ORIGINAL, 'web': MODEL_B_WEB})
        self.assertEqual(baseline, ORIGINAL)
        self.assertNotEqual(selected['web'], ORIGINAL['web'])

    def test_wrong_predecessor_is_refused(self):
        for changed in ('revision', 'web'):
            bad = dict(ORIGINAL)
            bad[changed] = 'a' * 40 if changed == 'revision' else 'sha256:' + 'a' * 64
            with self.subTest(field=changed), self.assertRaisesRegex(ctl.Blocked, 'web_adoption_predecessor'):
                ctl.approved_model_b_release(bad)

    def run_adoption(self, live, existing=None, worker_state='inactive'):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            state = root / 'updater'
            operation = state / 'op-test'
            operation.mkdir(parents=True)
            (state / 'lock').write_text('')
            journal = operation / 'operation.json'
            journal.write_text('{"phase":"accepted"}')
            config = operation / 'config.json'
            config.write_text('{"credentials":"/ignored-private-credential"}')
            adoption = operation / 'web-adoption.json'
            if existing is not None:
                adoption.write_text(json.dumps(existing))
            record = {'phase': 'accepted'}
            prep = Mock()
            prep.STATE = state
            prep.private_file.side_effect = lambda path: Path(path)
            prep.installed_from_journal.return_value = dict(ORIGINAL)
            prep.read_json.side_effect = lambda path: json.loads(Path(path).read_text())
            prep.sha.return_value = 'f' * 64
            updater = Mock()
            updater.installed_preflight.return_value = live
            updater.read_login.return_value = 'Basic synthetic-only'
            prep.load_updater.return_value = updater

            with patch.multiple(ctl, ROOT=root, locked=contextlib.nullcontext,
                                require_idle=lambda: None, prep_module=lambda: prep,
                                active_record=lambda _: (journal, record)), \
                 patch.object(ctl.subprocess, 'check_output', return_value=worker_state), \
                 patch.object(ctl.http.client, 'HTTPSConnection', Connection):
                if live != {**ORIGINAL, 'web': MODEL_B_WEB} or existing is not None or worker_state != 'inactive':
                    with self.assertRaises(ctl.Blocked) as caught:
                        ctl.adopt_published_panel()
                    actual = dict(json.loads(adoption.read_text())) if adoption.exists() else None
                    return str(caught.exception), actual
                result = ctl.adopt_published_panel()
                saved = json.loads(adoption.read_text())
                again = ctl.adopt_published_panel()
                self.assertEqual(result, again)
                self.assertEqual(journal.read_text(), '{"phase":"accepted"}')
                return result, saved

    def test_model_b_adopted_and_idempotent(self):
        result, record = self.run_adoption({**ORIGINAL, 'web': MODEL_B_WEB})
        self.assertEqual(result['status'], 'web_adopted')
        self.assertEqual(record['web'], MODEL_B_WEB)
        self.assertEqual(record['original'], ORIGINAL)
        self.assertEqual(record['journal_sha256'], 'f' * 64)
        self.assertEqual(record['panel_revision'], 'dbfad4be34546497a833fda0c06fc1119332204a')

    def test_old_web_is_rejected_without_writing(self):
        error, record = self.run_adoption({**ORIGINAL, 'web': 'sha256:828eb94e74f35ae51faff66436baf7ddbcce57895b6de00a6f4554a075de7d7e'})
        self.assertEqual(error, 'web_adoption_live_release')
        self.assertIsNone(record)

    def test_api_and_gateway_changes_rejected(self):
        for service in ('api', 'gateway', 'revision'):
            live = {**ORIGINAL, 'web': MODEL_B_WEB}
            live[service] = 'a' * 40 if service == 'revision' else 'sha256:' + 'a' * 64
            with self.subTest(service=service):
                error, record = self.run_adoption(live)
                self.assertEqual(error, 'web_adoption_live_release')
                self.assertIsNone(record)

    def test_worker_busy_rejected(self):
        error, record = self.run_adoption({**ORIGINAL, 'web': MODEL_B_WEB}, worker_state='active')
        self.assertEqual(error, 'worker_busy')
        self.assertIsNone(record)

    def test_existing_different_adoption_is_not_overwritten(self):
        prior = {
            'schema': 'funix-hml-web-adoption/1',
            'journal_sha256': 'f' * 64,
            'original': ORIGINAL,
            'web': 'sha256:828eb94e74f35ae51faff66436baf7ddbcce57895b6de00a6f4554a075de7d7e',
            'panel_revision': 'f142beae5f26224e9fd587fb9b56151a26785266',
        }
        error, after = self.run_adoption({**ORIGINAL, 'web': MODEL_B_WEB}, existing=prior)
        self.assertEqual(error, 'web_adoption_already_exists')
        self.assertEqual(after, prior)


if __name__ == '__main__':
    unittest.main()
