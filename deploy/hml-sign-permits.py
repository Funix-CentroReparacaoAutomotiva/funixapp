"""Sign HML candidate permits from the independent authorization environment."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def main(directory):
    source = Path(__file__).with_name('hml-selection.py')
    spec = importlib.util.spec_from_file_location('hml_selection', source)
    selector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(selector)

    request = json.loads(os.environ['HML_PERMIT_REQUEST'])
    if not isinstance(request, dict) or set(request) != {'candidate', 'installed_revision'}:
        raise ValueError('invalid request')
    candidate = selector.selection(request['candidate'])
    installed = request['installed_revision']
    if not isinstance(installed, str) or not re.fullmatch('[a-f0-9]{40}', installed):
        raise ValueError('invalid predecessor')
    if installed == candidate['revision']:
        raise ValueError('candidate already installed')

    now = int(time.time())
    directory.mkdir(mode=0o700)
    with tempfile.TemporaryDirectory(prefix='funix-hml-signer-') as name:
        private = Path(name)
        key = private / 'signer.pem'
        key.write_text(os.environ.pop('HML_PERMIT_SIGNING_KEY'), encoding='ascii')
        key.chmod(0o600)
        for action in ('register', 'arm'):
            permit = {
                'schema': 'funix-hml-permit/1', 'scope': 'funix-hml',
                'action': action, 'candidate': candidate, 'installed_revision': installed,
                'issued_at': now, 'expires_at': now + 1200,
            }
            message = private / 'permit'
            message.write_bytes(json.dumps(permit, sort_keys=True, separators=(',', ':')).encode('ascii'))
            signed = subprocess.run(
                ['openssl', 'pkeyutl', '-sign', '-inkey', str(key), '-rawin', '-in', str(message)],
                stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=10,
            ).stdout
            if len(signed) != 64:
                raise ValueError('expected Ed25519 signature')
            (directory / (action + '.json')).write_text(
                json.dumps({'permit': permit, 'signature': base64.b64encode(signed).decode('ascii')}),
                encoding='ascii',
            )


if __name__ == '__main__':
    try:
        main(Path(sys.argv[1]))
    except Exception:
        raise SystemExit('HML permit signing failed')
