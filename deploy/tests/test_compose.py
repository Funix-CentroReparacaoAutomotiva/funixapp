"""Validate the actual Compose with synthetic inputs; never creates containers."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ComposeTests(unittest.TestCase):
    def test_tmpfs_long_mounts_have_exact_sizes_and_absolute_targets(self):
        with tempfile.TemporaryDirectory(prefix='funix-compose-config-') as folder:
            folder = Path(folder)
            runtime = folder / 'runtime.env'
            runtime.write_text('')
            compose = folder / 'compose.yaml'
            compose.write_text((ROOT / 'compose.yaml').read_text().replace('/etc/funix/runtime.env', str(runtime)))
            env = {**os.environ, 'FUNIX_RELEASE': 'tmpfs-validation',
                   'FUNIX_API_IMAGE': 'funix-api:validation', 'FUNIX_WEB_IMAGE': 'funix-web:validation'}
            for key in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY',
                        'DOCKER_CERT_PATH', 'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES']:
                env.pop(key, None)
            result = subprocess.run([
                'docker', '--host=unix:///var/run/docker.sock', 'compose',
                '--env-file', str(runtime), '--file', str(compose),
                'config', '--format', 'json',
            ], env=env, capture_output=True, text=True, check=True)
            config = json.loads(result.stdout)
        self.assertEqual(set(config['services']), {'api', 'web'})
        for name, size in [('api', 16 * 1024 * 1024), ('web', 32 * 1024 * 1024)]:
            with self.subTest(service=name):
                service = config['services'][name]
                self.assertNotIn('tmpfs', service)
                self.assertEqual(len(service['volumes']), 1)
                mount = service['volumes'][0]
                self.assertEqual(mount['type'], 'tmpfs')
                self.assertEqual(mount['target'], '/tmp')
                self.assertFalse(mount.get('read_only', False))
                self.assertEqual(int(mount['tmpfs']['size']), size)
                self.assertEqual(set(mount['tmpfs']), {'size'})
                self.assertTrue(service['read_only'])
                self.assertEqual(service['cap_drop'], ['ALL'])
                self.assertEqual(service['security_opt'], ['no-new-privileges:true'])
                self.assertNotIn('ports', service)
        self.assertEqual(config['networks']['traefik']['name'], 'traefik_default')
        self.assertTrue(config['networks']['traefik']['external'])


if __name__ == '__main__':
    unittest.main()
