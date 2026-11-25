#!/usr/bin/env python3
"""One-time, pinned HML-only jsreport install. Run via authenticated VPS SSH."""

import fcntl
import json
import os
import pathlib
import shutil
import sqlite3
import stat
import subprocess
import tempfile
from datetime import datetime, timezone

BASE = pathlib.Path('/opt/funix-hml')
PROTECTED = pathlib.Path('/etc/funix-hml')
DB = pathlib.Path('/var/lib/funix-hml/app-data/funix.sqlite')
SHA = 'f7a45e763ef64a016533ae037639d995a4affaac'
OLD_SHA = 'ec063ed7132600c67d198e866b1679c6eeef3a0d'
OLD_API = 'sha256:7a110fdcab113412ecbc3cf36a4eba216269aff74d231c96036b978d89fb9be0'


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=subprocess.DEVNULL)


def output(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def write_atomic(path, data, mode=0o600):
    temporary = path.with_name(path.name + '.new')
    temporary.write_text(data)
    temporary.chmod(mode)
    temporary.replace(path)


lock = BASE / '.panel-deploy.lock'
with lock.open('a+') as lockfile:
    fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)

    secret = PROTECTED / 'jsreport.env'
    meta = secret.stat()
    assert meta.st_uid == 0 and stat.S_IMODE(meta.st_mode) == 0o600
    raw = secret.read_bytes().splitlines()
    assert len(raw) == 2
    assert raw[0] == b'FUNIX_JSREPORT_USERNAME=funix-hml-render'
    assert raw[1].startswith(b'FUNIX_JSREPORT_PASSWORD=') and len(raw[1]) > 26
    assert DB.is_file()
    release = json.loads((BASE / 'release-simple.json').read_text())
    assert release['services']['api']['image'] == OLD_API
    assert release['services']['api']['environment']['FUNIX_REVISION'] == OLD_SHA
    compose_path = BASE / 'compose.yaml'
    original = compose_path.read_text()
    assert original.count('      FUNIX_JSREPORT_ENDPOINT: ""') == 1
    assert original.count('  web:\n') == 1
    assert original.count('\nnetworks:\n') == 1
    for name in ['api', 'web', 'gateway']:
        state = json.loads(output('docker', 'inspect', f'funix-hml-{name}-1'))[0]
        assert state['State']['Health']['Status'] == 'healthy'
    assert json.loads(output('docker', 'network', 'inspect', 'funix-hml_privada'))[0]['Internal']

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_dir = PROTECTED / 'backups' / ('jsreport-' + stamp)
    backup_dir.mkdir(parents=True, mode=0o700)
    backup_dir.chmod(0o700)
    shutil.copy2(compose_path, backup_dir / 'compose.yaml')
    shutil.copy2(BASE / 'release-simple.json', backup_dir / 'release-simple.json')
    with sqlite3.connect(DB) as src, sqlite3.connect(backup_dir / 'funix.sqlite') as dst:
        src.backup(dst)
    assert sqlite3.connect(backup_dir / 'funix.sqlite').execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    print('Backup consistente:', backup_dir)

    with tempfile.TemporaryDirectory(prefix='funix-hml-jsreport-') as work:
        source = pathlib.Path(work) / 'source'
        source.mkdir()
        run('git', 'init', '-q', str(source))
        run('git', 'fetch', '-q', '--depth=1', 'https://github.com/Funix-CentroReparacaoAutomotiva/funixapp.git', SHA, cwd=source)
        assert output('git', 'rev-parse', 'FETCH_HEAD', cwd=source) == SHA
        run('git', 'checkout', '-q', 'FETCH_HEAD', cwd=source)
        relay_source = source / 'deploy/hml-jsreport-egress.mjs'
        assert relay_source.is_file()
        image = 'funix-hml-api:jsreport-' + SHA[:7]
        print('Construindo imagem API:', SHA)
        run('docker', 'build', '--target', 'api', '-t', image, str(source))
        image_id = output('docker', 'image', 'inspect', image, '--format', '{{.Id}}')
        assert image_id.startswith('sha256:')

        tls = PROTECTED / 'jsreport-tls'
        tls.mkdir(mode=0o750, exist_ok=True)
        os.chown(tls, 0, 1000)
        tls.chmod(0o750)
        key, cert = tls / 'server.key', tls / 'server.pem'
        if not key.exists() and not cert.exists():
            run('openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '365',
                '-subj', '/CN=jsreport-egress', '-addext', 'subjectAltName=DNS:jsreport-egress',
                '-keyout', str(key), '-out', str(cert))
        assert key.is_file() and cert.is_file()
        os.chown(key, 0, 1000)
        key.chmod(0o440)
        cert.chmod(0o644)
        relay_dest = PROTECTED / 'hml-jsreport-egress.mjs'
        shutil.copyfile(relay_source, relay_dest)
        relay_dest.chmod(0o644)

    updated = original.replace(
        '      FUNIX_JSREPORT_ENDPOINT: ""',
        '      FUNIX_JSREPORT_ENDPOINT: https://jsreport-egress:8443/api/report\n'
        '      FUNIX_OS_JSREPORT_ENABLED: "true"\n'
        '      NODE_EXTRA_CA_CERTS: /tls/ca.pem',
    )
    updated = updated.replace(
        '      - path: /etc/funix-hml/runtime.env\n        format: raw',
        '      - path: /etc/funix-hml/runtime.env\n        format: raw\n'
        '      - path: /etc/funix-hml/jsreport.env\n        format: raw', 1,
    )
    api_start = updated.index('  api:\n')
    web_start = updated.index('  web:\n')
    api = updated[api_start:web_start]
    assert api.count('    volumes:\n') == 1
    api = api.replace('    volumes:\n',
        '    volumes:\n'
        '      - type: bind\n'
        '        source: /etc/funix-hml/jsreport-tls/server.pem\n'
        '        target: /tls/ca.pem\n'
        '        read_only: true\n'
        '        bind:\n'
        '          create_host_path: false\n', 1)
    updated = updated[:api_start] + api + updated[web_start:]
    relay = '''  jsreport-egress:
    <<: *seguranca
    image: funix-hml-api:jsreport-f7a45e7
    init: true
    command: ["node", "/app/hml-jsreport-egress.mjs"]
    env_file:
      - path: /etc/funix-hml/jsreport.env
        format: raw
    environment:
      NODE_ENV: production
      NODE_EXTRA_CA_CERTS: /tls/server.pem
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('https://jsreport-egress:8443/api/report').then(r=>process.exit(r.status===405?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 3
    volumes:
      - type: bind
        source: /etc/funix-hml/hml-jsreport-egress.mjs
        target: /app/hml-jsreport-egress.mjs
        read_only: true
        bind:
          create_host_path: false
      - type: bind
        source: /etc/funix-hml/jsreport-tls
        target: /tls
        read_only: true
        bind:
          create_host_path: false
      - type: tmpfs
        target: /tmp
        tmpfs:
          size: 16777216
    mem_limit: 256m
    cpus: 0.25
    networks: [privada, jsreport_out]

'''
    updated = updated.replace('  web:\n', relay + '  web:\n', 1)
    updated = updated.replace('  privada:\n    driver: bridge\n    internal: true\n',
        '  privada:\n    driver: bridge\n    internal: true\n'
        '  jsreport_out:\n    driver: bridge\n', 1)
    write_atomic(compose_path, updated)
    release['services']['api']['image'] = image_id
    release['services']['api']['environment']['FUNIX_REVISION'] = SHA
    write_atomic(BASE / 'release-simple.json', json.dumps(release, indent=2) + '\n')

    files = ['-f', str(compose_path), '-f', str(BASE / 'gateway.compose.yaml'),
             '-f', str(BASE / 'release-simple.json')]
    common = ['docker', 'compose', '--env-file', str(BASE / 'release.env'), *files]
    try:
        run(*common, 'config', '--quiet', cwd=BASE)
        run(*common, 'up', '-d', '--no-deps', 'jsreport-egress', cwd=BASE)
        run(*common, 'up', '-d', '--no-deps', 'api', cwd=BASE)
        for name in ['api', 'web', 'gateway']:
            state = json.loads(output('docker', 'inspect', f'funix-hml-{name}-1'))[0]
            assert state['State']['Running']
        print('Instalação aplicada, imagem API:', image_id)
    except Exception:
        shutil.copy2(backup_dir / 'compose.yaml', compose_path)
        shutil.copy2(backup_dir / 'release-simple.json', BASE / 'release-simple.json')
        run(*common, 'up', '-d', '--no-deps', 'api', cwd=BASE)
        print('Configuração restaurada após falha')
        raise
