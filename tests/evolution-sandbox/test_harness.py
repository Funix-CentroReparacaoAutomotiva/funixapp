"""Offline safety/control-flow tests. These do NOT homologate Docker or Evolution."""
import importlib.util
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SPEC = importlib.util.spec_from_file_location('evolution_lab_runner', Path(__file__).with_name('run.py'))
lab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lab)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.docker = self.root / 'docker-store'
        self.docker.mkdir()
        self.docker_info = {'root': str(self.docker), 'driver': 'vfs', 'driverStatus': [], 'version': 'synthetic-version'}
        self.docker_free = 16 * 1024**3
        self.space_errors = set()
        self.free_overrides = {}
        self.probes = []
        self.mounts = [{'id': '1', 'device': '8:1', 'path': self.root, 'type': 'ext4'},
                       {'id': '2', 'device': '8:2', 'path': self.docker, 'type': 'xfs'}]
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
        if lab.DOCKER_INFO_FORMAT in args:
            return json.dumps(self.docker_info)
        if 'ls' in args or 'ps' in args:
            return 'existing-resource' if self.collision else ''
        if 'create' in args:
            return 'synthetic-inspection-id\n'
        if 'cp' in args:
            self.package = Path(args[-1])
            self.package.write_text(json.dumps({'version': self.version}))
        return 'synthetic-local-result\n'

    def fake_space(self, path, mounts):
        self.assertEqual(mounts, self.mounts)
        self.probes.append(path)
        if path in self.space_errors:
            raise PermissionError('synthetic inaccessible path; must not echo it')
        docker = path.is_relative_to(self.docker)
        return {'freeBytes': self.free_overrides.get(path, self.docker_free if docker else self.workspace_free),
                'device': '8:2' if docker else '8:1', 'mountId': '2' if docker else '1', 'filesystem': 'xfs' if docker else 'ext4'}

    def run_lab(self, free=16 * 1024**3, identity_error=False, mounts_error=False, identity_changed=False, mounts_changed=False):
        self.workspace_free = free
        # Restore umask after exercising main; never depend on the operator environment.
        old = os.umask(0o077)
        try:
            with patch.object(lab, 'ROOT', self.root), patch.object(lab, 'command', self.fake_command), \
                 patch.object(lab, 'filesystem_space', self.fake_space), \
                 patch.object(lab, 'mount_table', side_effect=RuntimeError('Mount metadata unavailable') if mounts_error else
                              [('before', self.mounts), ('after', self.mounts)] if mounts_changed else None,
                              return_value=('synthetic-stable-mounts', self.mounts)), \
                 patch.object(lab, 'local_daemon_identity', side_effect=RuntimeError('Daemon namespace unavailable') if identity_error else
                              [('before',), ('after',)] if identity_changed else None,
                              return_value=('synthetic-local-peer',)), \
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

    def assert_no_lab_commands(self):
        self.assertFalse(any(token in call for call in self.calls for token in ['pull', 'create', 'up', 'exec', 'down']))

    def test_docker_partition_low_even_when_workspace_has_space(self):
        self.docker_free = 1024
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertEqual(self.probes, [self.root, self.docker])
        self.assertEqual(report['storage']['workspace']['device'], '8:1')
        self.assertEqual(report['storage']['docker']['device'], '8:2')
        self.assertIn('DOCKER_SPACE_LOW', report['reason'])
        self.assert_no_lab_commands()

    def test_separate_partitions_both_checked_before_pull(self):
        code, report = self.run_lab()
        self.assertEqual(code, 0)  # commands remain mocked
        self.assertEqual(self.probes, [self.root, self.docker])
        self.assertEqual(report['storage']['workspace']['freeBytes'], 16 * 1024**3)
        self.assertEqual(report['storage']['docker']['filesystem'], 'xfs')

    def test_inaccessible_docker_path_never_falls_back_to_workspace(self):
        self.space_errors.add(self.docker)
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertIn('DOCKER_STORAGE_ACCESS', report['reason'])
        self.assertNotIn('inaccessible path', report['reason'])
        self.assert_no_lab_commands()

    def test_inaccessible_workspace_blocks_before_daemon_query(self):
        self.space_errors.add(self.root)
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertIn('WORKSPACE_STORAGE_ACCESS', report['reason'])
        self.assertEqual(self.calls, [])

    def test_missing_docker_directory_blocks_instead_of_measuring_ancestor(self):
        self.docker_info['root'] = str(self.docker / 'missing')
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertIn('DOCKER_STORAGE_ACCESS', report['reason'])
        self.assertEqual(self.probes, [self.root])
        self.assert_no_lab_commands()

    def test_unknown_or_unsupported_docker_storage_blocks(self):
        for root, driver, status in [('', 'vfs', []), ('relative/path', 'vfs', []),
                                      (str(self.docker), 'devicemapper', []),
                                      (str(self.docker), 'overlay2', [['driver-type', 'io.containerd.snapshotter.v1']])]:
            self.calls.clear()
            self.docker_info.update(root=root, driver=driver, driverStatus=status)
            code, _ = self.run_lab()
            self.assertEqual(code, 2)
            self.assert_no_lab_commands()

    def test_daemon_namespace_or_mount_metadata_unavailable_blocks(self):
        for options in [{'identity_error': True}, {'mounts_error': True}]:
            self.calls.clear()
            code, _ = self.run_lab(**options)
            self.assertEqual(code, 2)
            self.assert_no_lab_commands()

    def test_daemon_or_mount_identity_change_blocks(self):
        for options in [{'identity_changed': True}, {'mounts_changed': True}]:
            self.calls.clear()
            code, report = self.run_lab(**options)
            self.assertEqual(code, 2)
            self.assertIn('STORAGE_IDENTITY_CHANGED', report['reason'])
            self.assert_no_lab_commands()

    def test_workspace_summary_inaccessible_blocks_without_docker(self):
        old = os.umask(0o077)
        try:
            with patch.object(lab, 'ROOT', self.root), patch.object(Path, 'mkdir', side_effect=PermissionError()), \
                 patch.object(lab, 'command', self.fake_command), redirect_stdout(io.StringIO()):
                self.assertEqual(lab.main(), 2)
        finally:
            os.umask(old)
        self.assertEqual(self.calls, [])

    def test_nested_docker_storage_mount_is_checked(self):
        nested = self.docker / 'volumes'
        nested.mkdir()
        self.mounts.append({'id': '3', 'device': '8:3', 'path': nested, 'type': 'ext4'})
        code, report = self.run_lab()
        self.assertEqual(code, 0)
        self.assertIn(nested, self.probes)
        self.assertEqual(len(report['storage']['dockerNestedMounts']), 1)

    def test_nested_docker_mount_low_blocks_despite_free_root_directory(self):
        nested = self.docker / 'volumes'
        nested.mkdir()
        self.mounts.append({'id': '3', 'device': '8:3', 'path': nested, 'type': 'ext4'})
        self.free_overrides[nested] = 1024
        code, report = self.run_lab()
        self.assertEqual(code, 2)
        self.assertIn('DOCKER_SPACE_LOW', report['reason'])
        self.assert_no_lab_commands()

    def test_filesystem_probe_uses_each_partition_device_and_its_own_space(self):
        original_stat = os.stat

        def stat(path, *args, **kwargs):
            values = list(original_stat(path, *args, **kwargs))
            values[2] = os.makedev(8, 2 if Path(path).is_relative_to(self.docker) else 1)
            return os.stat_result(values)

        def usage(path):
            return type('Usage', (), {'free': 1024 if path == self.docker else 16 * 1024**3})()

        with patch.object(lab.os, 'stat', side_effect=stat), patch.object(lab.shutil, 'disk_usage', side_effect=usage) as disk:
            workspace = lab.filesystem_space(self.root, self.mounts)
            docker = lab.filesystem_space(self.docker, self.mounts)
        self.assertEqual(workspace['device'], '8:1')
        self.assertEqual(docker['device'], '8:2')
        self.assertEqual(docker['freeBytes'], 1024)
        self.assertEqual([call.args[0] for call in disk.call_args_list], [self.root, self.docker])

    def test_filesystem_probe_rejects_missing_path_mount_mismatch_and_statvfs_denied(self):
        with self.assertRaises(FileNotFoundError):
            lab.filesystem_space(self.docker / 'missing', self.mounts)
        with patch.object(lab.shutil, 'disk_usage') as disk:
            with self.assertRaises(ValueError):
                lab.filesystem_space(self.docker, [{'id': '1', 'device': '999:999', 'path': Path('/'), 'type': 'ext4'}])
            disk.assert_not_called()
        dev = self.docker.stat().st_dev
        mounts = [{'id': '1', 'device': f'{os.major(dev)}:{os.minor(dev)}', 'path': Path('/'), 'type': 'ext4'}]
        with patch.object(lab.shutil, 'disk_usage', side_effect=PermissionError()):
            with self.assertRaises(PermissionError):
                lab.filesystem_space(self.docker, mounts)

    def test_socket_proxy_or_different_mount_namespace_is_rejected_offline(self):
        peer = MagicMock()
        peer.getsockopt.return_value = lab.struct.pack('3i', 42, 1000, 1000)
        manager = MagicMock()
        manager.__enter__.return_value = peer
        ours = type('Stat', (), {'st_dev': 1, 'st_ino': 1})()
        other = type('Stat', (), {'st_dev': 1, 'st_ino': 2})()
        for comm, namespace in [('socket-forwarder', ours), ('dockerd', other)]:
            with patch.object(lab.socket, 'socket', return_value=manager), \
                 patch.object(Path, 'read_text', return_value=comm), \
                 patch.object(lab.os, 'stat', side_effect=[ours, namespace]):
                with self.assertRaisesRegex(RuntimeError, 'DOCKER_NAMESPACE_UNVERIFIED'):
                    lab.local_daemon_identity()

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
