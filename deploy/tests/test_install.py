"""Actual installer, temporary paths and fake host commands; no host mutation."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.host = self.root / 'host'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for p in ['opt', 'etc/sudoers.d', 'var/lib', 'home', 'usr/local/sbin', 'run/lock']:
            (self.host / p).mkdir(parents=True, exist_ok=True)
        for p in self.host.rglob('*'):
            p.chmod(0o755)
        src = self.root / 'source'
        (src / 'deploy').mkdir(parents=True)
        for p in ['compose.yaml', 'deploy/funix-deploy', 'deploy/funix-ssh', 'deploy/funix-deploy.sudoers', 'deploy/runtime.env.example', 'deploy/check-install.py']:
            (src / p).write_bytes((ROOT / p).read_bytes())
        script = (ROOT / 'deploy/funix-install').read_text()
        # Replace longest paths first, including ancestor checks and account home.
        import re
        script = re.sub(r'(?<![A-Za-z0-9_.-])/(?:opt|etc|var|home|usr|run)(?:/[A-Za-z0-9_.-]+)*', lambda m: str(self.host) + m[0], script)
        script = script.replace('export PATH=', f'export PATH={self.bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin # ')
        script = script.replace('$(id -u) == 0', f'$(id -u) == {os.getuid()}')
        script = script.replace('$(stat -c %u "$parent") == 0', f'$(stat -c %u "$parent") == {os.getuid()}')
        script = script.replace('$(stat -c %u \"$lock\") == 0', f'$(stat -c %u \"$lock\") == {os.getuid()}')
        script = script.replace('-o root -g root ', '')
        self.script = src / 'deploy/funix-install'
        self.script.write_text(script)
        self.env = {**os.environ, 'TEST_HOST': str(self.host), 'TEST_ROOT': str(self.root)}
        fake = '''#!/usr/bin/env python3
import json, os, pathlib, sys
root=pathlib.Path(os.environ['TEST_ROOT']); host=pathlib.Path(os.environ['TEST_HOST'])
name=pathlib.Path(sys.argv[0]).name; args=sys.argv[1:]
with (root/'calls').open('a') as f: f.write(json.dumps([name, *args])+'\\n')
if name=='getent': sys.exit(0 if os.environ.get('ACCOUNT') else 2)
if name=='useradd': (host/'home/funix-deploy').mkdir(); sys.exit(0)
if name in ['passwd','chown','visudo']: sys.exit(0)
assert name=='docker'
assert not set(args)&{'up','pull','stop','down','prune','restart','rm','run','create'}
if args[-2:]==['version','--short']: print(os.environ.get('VERSION','2.30.3'))
elif 'network' in args: sys.exit(1 if os.environ.get('NO_NETWORK') else 0)
elif args[-2:]==['ps','-aq']: print('abc')
elif 'inspect' in args:
 assert args[args.index('--format')+1]=='{{json .Config.Labels}}'
 for item in json.loads(os.environ.get('CONTAINERS','[]')): print(json.dumps(item['Config']['Labels']))
elif 'login' in args:
 assert sys.stdin.read()=='synthetic-ghcr-token'
 if os.environ.get('BAD_LOGIN'): sys.exit(1)
 path=pathlib.Path(args[args.index('--config')+1]); (path/'config.json').write_text('{"auths":{"ghcr.io":{"auth":"synthetic"}}}')
else: assert args[-2:]==['config','--quiet']
'''
        for name in ['docker', 'getent', 'useradd', 'passwd', 'chown', 'visudo']:
            p = self.bin / name
            p.write_text(fake)
            p.chmod(0o755)
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(self.root / 'key')], check=True)
        self.key = (self.root / 'key.pub').read_text().strip()
        self.inputs = self.key + '\nsynthetic-password-$#\nsynthetic-password-$#\nreader\nsynthetic-ghcr-token\n'

    def run_install(self):
        return subprocess.run(['bash', str(self.script)], input=self.inputs, env=self.env, text=True, capture_output=True)

    def assert_clean(self):
        for p in ['opt/funix', 'etc/funix', 'var/lib/funix', 'home/funix-deploy', 'usr/local/sbin/funix-deploy', 'etc/sudoers.d/funix-deploy']:
            self.assertFalse((self.host / p).exists(), p)

    def test_success_permissions_forced_key_and_no_container_mutation(self):
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stderr)
        for p, mode in [('etc/funix/runtime.env', 0o600), ('etc/funix/registry/config.json', 0o600), ('etc/sudoers.d/funix-deploy', 0o440), ('usr/local/sbin/funix-deploy', 0o755)]:
            self.assertEqual((self.host / p).stat().st_mode & 0o777, mode)
        self.assertIn('FUNIX_OPERATOR_PASSWORD=synthetic-password-$#', (self.host / 'etc/funix/runtime.env').read_text())
        self.assertEqual((self.host / 'home/funix-deploy/.ssh/authorized_keys').read_text(), f'restrict,command="/usr/local/sbin/funix-ssh" {self.key}\n'.replace('/usr/local/sbin', str(self.host / 'usr/local/sbin')))
        self.assertNotIn('synthetic-password', result.stdout + result.stderr)
        self.assertNotIn('synthetic-ghcr-token', (self.root / 'calls').read_text() + result.stdout + result.stderr)
        before = (self.host / 'etc/funix/runtime.env').read_bytes()
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assertEqual((self.host / 'etc/funix/runtime.env').read_bytes(), before)

    def test_missing_network_old_compose_existing_account_and_bad_login(self):
        for variable, value in [('NO_NETWORK', '1'), ('VERSION', '2.29.0'), ('ACCOUNT', '1'), ('BAD_LOGIN', '1')]:
            with self.subTest(variable=variable):
                self.env[variable] = value
                self.assertNotEqual(self.run_install().returncode, 0)
                self.assert_clean()
                del self.env[variable]

    def test_conflicting_project_or_routes_including_stopped_containers(self):
        for labels in [{'com.docker.compose.project': 'funixapp'}, {'traefik.http.routers.other.rule': 'Host(`app.funix.com.br`)'}, {'traefik.http.services.funixapp-web.loadbalancer.server.port': '80'}]:
            self.env['CONTAINERS'] = json.dumps([{'Config': {'Labels': labels}}])
            self.assertNotEqual(self.run_install().returncode, 0)
            self.assert_clean()

    def test_other_projects_are_preserved(self):
        self.env['CONTAINERS'] = json.dumps([{'Config': {'Labels': {'com.docker.compose.project': name}}} for name in ['traefik', 'n8n', 'evolution', 'postgres', 'redis']])
        self.assertEqual(self.run_install().returncode, 0)

    def test_symlink_and_writable_ancestor_refused(self):
        (self.host / 'opt/funix').symlink_to(self.root / 'absent')
        self.assertNotEqual(self.run_install().returncode, 0)
        (self.host / 'opt/funix').unlink()
        (self.host / 'opt').chmod(0o777)
        self.assertNotEqual(self.run_install().returncode, 0)
        self.assert_clean()

    def test_invalid_key_and_password_refused_before_install(self):
        for inputs in ['command="sh" '+self.inputs, self.key+'\nshort\nshort\n', self.key+'\nlong-enough-password\ndifferent-password\n']:
            self.inputs = inputs
            self.assertNotEqual(self.run_install().returncode, 0)
            self.assert_clean()


if __name__ == '__main__':
    unittest.main()
