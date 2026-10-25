#!/usr/bin/env python3
"""Probe only disposable, networkless containers from the real Compose mounts.
Requires an existing Node 24 image. Never pulls images or starts the FUNIX stack.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--compose-bin', help='Optional standalone Compose binary for version-specific validation')
parser.add_argument('--image', default='funix-api:ci', help='Already present Node 24 image (never pulled)')
args = parser.parse_args()
env = dict(os.environ)
for key in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH',
            'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES']:
    env.pop(key, None)
env['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
env.update(FUNIX_RELEASE='tmpfs-validation', FUNIX_API_IMAGE=args.image, FUNIX_WEB_IMAGE=args.image)
compose = [args.compose_bin] if args.compose_bin else ['docker', '--host=unix:///var/run/docker.sock', 'compose']
probe = r'''
const fs = require('node:fs'), assert = require('node:assert/strict');
const mount = fs.readFileSync('/proc/mounts','utf8').split('\n').map(l=>l.split(' ')).find(p=>p[1]==='/tmp');
assert(mount); assert.equal(mount[2], 'tmpfs');
const flags = mount[3].split(',');
for (const flag of ['rw','noexec','nosuid']) assert(flags.includes(flag), 'Missing '+flag);
const stats = fs.statfsSync('/tmp');
assert.equal(stats.bsize * stats.blocks, Number(process.env.EXPECT_TMPFS_SIZE));
fs.writeFileSync('/tmp/funix-exec-probe', '#!/bin/sh\nexit 0\n', {mode:0o755});
const child = require('node:child_process').spawnSync('/tmp/funix-exec-probe');
assert.equal(child.error?.code, 'EACCES');
console.log(JSON.stringify({bytes: stats.bsize*stats.blocks, flags, executionBlocked:true}));
'''
with tempfile.TemporaryDirectory(prefix='funix-tmpfs-probe-') as folder:
    folder = Path(folder)
    runtime = folder / 'runtime.env'
    runtime.write_text('')
    candidate = folder / 'compose.yaml'
    candidate.write_text((ROOT / 'compose.yaml').read_text().replace('/etc/funix/runtime.env', str(runtime)))
    config = json.loads(subprocess.check_output(compose + ['--env-file', str(runtime), '-f', str(candidate), 'config', '--format', 'json'], env=env, text=True))
    services = {}
    for name, size in [('api', 16777216), ('web', 33554432)]:
        mounts = config['services'][name]['volumes']
        assert len(mounts) == 1 and mounts[0]['type'] == 'tmpfs' and mounts[0]['target'] == '/tmp'
        assert int(mounts[0]['tmpfs']['size']) == size
        services[name] = {'image': args.image, 'network_mode': 'none', 'read_only': True,
                          'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
                          'volumes': mounts, 'environment': {'EXPECT_TMPFS_SIZE': str(size)},
                          'entrypoint': ['node', '-e', probe]}
    fixture = folder / 'probe.json'
    fixture.write_text(json.dumps({'services': services}))
    command = compose + ['-p', 'funix-tmpfs-probe-' + uuid.uuid4().hex[:12], '-f', str(fixture)]
    subprocess.run(command + ['config', '--quiet'], env=env, check=True)
    for name in services:
        subprocess.run(command + ['run', '--rm', '--no-deps', '-T', '--pull', 'never', name], env=env, check=True, timeout=90)
print('PASS: API/Web Compose mounts preserve exact sizes, rw, noexec and nosuid. No VPS services or networks accessed.')
