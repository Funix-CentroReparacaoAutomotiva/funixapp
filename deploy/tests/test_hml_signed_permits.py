import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SignedPermitsTest(unittest.TestCase):
    def test_signer_and_controller_agree_and_reject_changed_or_expired_permit(self):
        ctl = load('permit_controller', DEPLOY / 'remote-hml/rootctl.py')
        selector = load('permit_selection', DEPLOY / 'hml-selection.py')
        request = {
            'candidate': {
                'pr': 1, 'run_id': 2, 'attempt': 1, 'artifact_id': 3,
                'revision': 'a' * 40, 'sha256': 'b' * 64, 'size': 100,
            },
            'installed_revision': 'c' * 40,
        }
        with tempfile.TemporaryDirectory() as name:
            folder = Path(name)
            key = folder / 'signer.pem'
            public = folder / 'permit-public.pem'
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', str(key)], check=True)
            subprocess.run(['openssl', 'pkey', '-in', str(key), '-pubout', '-out', str(public)], check=True)
            env = dict(os.environ, HML_PERMIT_REQUEST=json.dumps(request), HML_PERMIT_SIGNING_KEY=key.read_text())
            signed = folder / 'signed'
            subprocess.run(['python3', '-I', '-B', str(DEPLOY / 'hml-sign-permits.py'), str(signed)],
                           env=env, check=True)
            prep = SimpleNamespace(official_module=lambda _: selector)
            # The runner owns these fixtures. Exercise the real OpenSSL verifier.
            with patch.object(ctl, 'ROOT', folder), patch.object(ctl, 'prep_module', return_value=prep), \
                 patch.object(ctl, 'private_dir', return_value=folder), patch.object(ctl, 'private_file', return_value=public):
                for action in ('register', 'arm'):
                    body = (signed / (action + '.json')).read_bytes()
                    permit, candidate = ctl.verify_permit(body)
                    self.assertEqual(permit['action'], action)
                    self.assertEqual(candidate, request['candidate'])
                    changed = json.loads(body)
                    changed['permit']['candidate']['artifact_id'] = 4
                    with self.assertRaisesRegex(ctl.Blocked, '^permit_signature$'):
                        ctl.verify_permit(json.dumps(changed).encode())
                    with patch.object(ctl.time, 'time', return_value=permit['expires_at']):
                        with self.assertRaisesRegex(ctl.Blocked, '^permit_expired$'):
                            ctl.verify_permit(body)
