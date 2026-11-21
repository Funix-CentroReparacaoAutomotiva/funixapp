"""Verify a deploy tar against an independently approved Git revision."""
import argparse
import ast
import hashlib
from pathlib import Path
import re
import subprocess
import tarfile


def assignment(content, name):
    return next(ast.literal_eval(node.value) for node in ast.parse(content).body
                if isinstance(node, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == name for target in node.targets))


def verify(repo, revision, archive):
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise ValueError('full approved revision required')
    with Path(archive).open('rb') as bundle:
        actual = hashlib.file_digest(bundle, 'sha256').hexdigest()
        with subprocess.Popen(['git', '-C', repo, '-c', 'core.autocrlf=false', 'archive', '--format=tar', revision, 'deploy'],
                              stdout=subprocess.PIPE) as source:
            expected = hashlib.file_digest(source.stdout, 'sha256').hexdigest()
            if source.wait() or expected != actual:
                raise ValueError('bundle differs from approved Git archive')
        bundle.seek(0)
        with tarfile.open(fileobj=bundle, mode='r:') as tar:
            def read(name):
                member = tar.getmember('deploy/' + name)
                if not member.isfile():
                    raise ValueError('expected regular bundle member')
                with tar.extractfile(member) as stream:
                    data = stream.read()
                if b'\r\n' in data:
                    raise ValueError('candidate contains CRLF')
                return data

            ctl = read('remote-hml/control.py')
            pins = assignment(ctl, 'FILES')
            prep_pin = assignment(read('remote-hml/rootctl.py'), 'PREP_SHA')
            if len(pins) != 12 or 'hml-selection' not in pins or hashlib.sha256(ctl).hexdigest() != prep_pin:
                raise ValueError('controller integrity')
            rows = {}
            for name, owner_mode in (('rootctl.py', '0644'), ('transport.py', '0644'), ('control.py', '0600')):
                folder = 'prepare' if name == 'control.py' else 'ops'
                rows[f'/usr/local/lib/funix-hml-{folder}/{name}'] = (
                    owner_mode, hashlib.sha256(read('remote-hml/' + name)).hexdigest())
            for name, pin in pins.items():
                if not re.fullmatch(r'hml-[a-z-]+', name):
                    raise ValueError('invalid official module path')
                data = read(name + '.py')
                if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != pin:
                    raise ValueError('official module integrity')
                rows[f'/usr/local/lib/funix-hml-prepare/official/{name}.py'] = (
                    '0600', hashlib.sha256(data).hexdigest())
    return actual, rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trusted_repo')
    parser.add_argument('approved_revision')
    parser.add_argument('archive')
    args = parser.parse_args()
    try:
        actual, rows = verify(args.trusted_repo, args.approved_revision, args.archive)
    except Exception:
        raise SystemExit('BLOCKED: bundle or integrity pins failed verification') from None
    print(f'commit {args.approved_revision}\narchive SHA-256 {actual}')
    for path, (mode, digest) in sorted(rows.items()):
        print(f'{digest} root:root {mode} {path}')


if __name__ == '__main__':
    main()
