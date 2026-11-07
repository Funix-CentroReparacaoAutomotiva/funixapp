"""Opt-in local laboratory. Does not load .env, select a remote daemon or prune shared resources."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = Path(__file__).with_name('compose.yaml')
EVOLUTION = 'evoapicloud/evolution-api@sha256:456b4104b0ddffbb092d6b3c0560a4ae86fc3e014e885b882aca4b1b371dfc81'
LOCAL_DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
SELECTORS = {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}
MIN_FREE_BYTES = 8 * 1024**3
DOCKER_INFO_FORMAT = '{"root":{{json .DockerRootDir}},"driver":{{json .Driver}},"driverStatus":{{json .DriverStatus}},"version":{{json .ServerVersion}}}'


def local_daemon_identity():
    """Reject forwarded sockets and a different/inaccessible mount namespace."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
            peer.settimeout(5)
            peer.connect('/var/run/docker.sock')
            pid, _, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            process = Path('/proc') / str(pid)
            if pid <= 0 or (process / 'comm').read_text().strip() != 'dockerd':
                raise ValueError()
            ours = os.stat('/proc/self/ns/mnt')
            daemon = os.stat(process / 'ns/mnt')
            if (ours.st_dev, ours.st_ino) != (daemon.st_dev, daemon.st_ino):
                raise ValueError()
            started = (process / 'stat').read_text().rsplit(')', 1)[1].split()[19]
            endpoint = os.stat('/var/run/docker.sock')
            return pid, started, daemon.st_ino, endpoint.st_dev, endpoint.st_ino
    except (OSError, ValueError, IndexError, AttributeError):
        raise RuntimeError('Storage preflight blocked: DOCKER_NAMESPACE_UNVERIFIED') from None


def mount_table():
    # Kernel metadata only; no Docker resource directories/content are enumerated.
    try:
        rows = []
        raw = Path('/proc/self/mountinfo').read_text()
        for line in raw.splitlines():
            fields = line.split()
            separator = fields.index('-')
            mount = fields[4]
            for encoded, decoded in [('\\040', ' '), ('\\011', '\t'), ('\\012', '\n'), ('\\134', '\\')]:
                mount = mount.replace(encoded, decoded)
            rows.append({'id': fields[0], 'device': fields[2], 'path': Path(mount), 'type': fields[separator + 1]})
        if not rows:
            raise ValueError()
        return raw, rows
    except (OSError, ValueError, IndexError):
        raise RuntimeError('Storage preflight blocked: MOUNT_TABLE_UNAVAILABLE') from None


def filesystem_space(path, mounts):
    """Resolve the existing directory and match stat's device to its deepest mount."""
    resolved = path.resolve(strict=True)
    before = resolved.stat()
    if not resolved.is_dir():
        raise ValueError()
    ancestors = [m for m in mounts if resolved.is_relative_to(m['path'])]
    depth = max(len(m['path'].parts) for m in ancestors)
    device = f'{os.major(before.st_dev)}:{os.minor(before.st_dev)}'
    matches = [m for m in ancestors if len(m['path'].parts) == depth and m['device'] == device]
    if not matches:
        raise ValueError()
    usage = shutil.disk_usage(resolved)  # statvfs of this filesystem, never ROOT as fallback
    after = resolved.stat()
    if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
        raise ValueError()
    return {'freeBytes': usage.free, 'device': device, 'mountId': matches[-1]['id'], 'filesystem': matches[-1]['type']}


def storage_preflight(env, report):
    """All checks precede pulls, secrets, resource inspection and container creation."""
    raw_mounts, mounts = mount_table()
    report['storage'] = {'minimumFreeBytesPerFilesystem': MIN_FREE_BYTES}
    try:
        report['storage']['workspace'] = filesystem_space(ROOT, mounts)
    except (OSError, ValueError, RuntimeError):
        raise RuntimeError('Storage preflight blocked: WORKSPACE_STORAGE_ACCESS') from None
    if report['storage']['workspace']['freeBytes'] < MIN_FREE_BYTES:
        raise RuntimeError('Storage preflight blocked: WORKSPACE_SPACE_LOW')
    identity = local_daemon_identity()
    try:
        info = json.loads(command([*LOCAL_DOCKER, 'info', '--format', DOCKER_INFO_FORMAT], env, timeout=15))
        root = info['root']
        if not isinstance(root, str) or not root.startswith('/') or '\x00' in root or root == '/':
            raise ValueError()
        if not isinstance(info['version'], str) or not info['version']:
            raise ValueError()
        status = info.get('driverStatus')
        if status is not None and (not isinstance(status, list) or any(
            not isinstance(entry, list) or len(entry) != 2 or not all(isinstance(value, str) for value in entry)
            for entry in status
        )):
            raise ValueError()
        if info['driver'] not in {'vfs', 'overlay2', 'fuse-overlayfs'} or any(
            'snapshotter' in value.lower() for entry in status or [] for value in entry
        ):
            raise RuntimeError('Storage preflight blocked: DOCKER_BACKEND_UNSUPPORTED')
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        raise RuntimeError('Storage preflight blocked: DOCKER_INFO_UNAVAILABLE') from None
    try:
        docker_root = Path(root).resolve(strict=True)
        if docker_root == Path('/'):
            raise ValueError()
        report['storage']['docker'] = filesystem_space(docker_root, mounts)
        # A separate driver/volume mount beneath DockerRootDir must not escape the check.
        nested = [m for m in mounts if m['path'] != docker_root and m['path'].is_relative_to(docker_root)]
        report['storage']['dockerNestedMounts'] = [filesystem_space(m['path'], mounts) for m in nested]
    except (OSError, ValueError, RuntimeError):
        raise RuntimeError('Storage preflight blocked: DOCKER_STORAGE_ACCESS') from None
    if identity != local_daemon_identity() or raw_mounts != mount_table()[0]:
        raise RuntimeError('Storage preflight blocked: STORAGE_IDENTITY_CHANGED')
    if any(s['freeBytes'] < MIN_FREE_BYTES for s in [report['storage']['docker'], *report['storage']['dockerNestedMounts']]):
        raise RuntimeError('Storage preflight blocked: DOCKER_SPACE_LOW')
    report['localDockerVersion'] = info['version']
    report['storageDriver'] = info['driver']


def command(args, env, timeout=120):
    # Never stream output: startup/instance responses can include even lab secrets.
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'Local command failed (exit {result.returncode}); raw output withheld')
    return result.stdout


def write_private(path, value):
    path.write_text(value)
    path.chmod(0o600)


def main():
    os.umask(0o077)
    folder = ROOT / '.runtime' / 'evolution-sandbox'
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError:
        print('BLOCKED: workspace storage inaccessible; cannot write a private summary')
        return 2
    env = {k: v for k, v in os.environ.items() if k not in SELECTORS and not k.startswith(('LAB_', 'COMPOSE_'))}
    project = 'evoreadlab-' + secrets.token_hex(6)
    report = {'state': 'blocked', 'project': project, 'httpHarnessInvoked': False, 'image': EVOLUTION}
    # Conservative checks, not an image size guarantee or a reservation of free blocks.
    try:
        storage_preflight(env, report)
    except (RuntimeError, OSError, ValueError) as error:
        report['reason'] = str(error) if isinstance(error, RuntimeError) else 'Storage preflight unavailable'
        write_private(folder / 'run-summary.json', json.dumps(report, indent=2) + '\n')
        print('BLOCKED: storage preflight; summary in .runtime/evolution-sandbox/run-summary.json')
        return 2
    with tempfile.TemporaryDirectory(prefix=project + '-', dir=folder) as tmp:
        temp = Path(tmp)
        output = temp / 'results'
        output.mkdir()
        config = temp / 'lab.env'
        write_private(config, f'LAB_PG_PASSWORD={secrets.token_hex(32)}\nLAB_REDIS_PASSWORD={secrets.token_hex(32)}\nLAB_API_KEY={secrets.token_hex(32)}\nLAB_OUTPUT_DIR={output}\n')
        compose = [*LOCAL_DOCKER, 'compose', '--project-name', project, '--env-file', str(config), '--file', str(COMPOSE)]
        inspection_id = None
        started = False
        try:
            # A nonce is not the sole protection against accidentally adopting old resources.
            for resource in ['volume', 'network']:
                if command([*LOCAL_DOCKER, resource, 'ls', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.Name}}'], env).strip():
                    raise RuntimeError('Project collision: refusing to adopt existing resources')
            if command([*LOCAL_DOCKER, 'ps', '-a', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.ID}}'], env).strip():
                raise RuntimeError('Project collision: refusing to adopt existing containers')
            command([*compose, 'config', '--quiet'], env)
            command([*compose, 'pull'], env, timeout=900)
            # Inspect package.json without running ENTRYPOINT or even a process.
            inspection_id = command([*LOCAL_DOCKER, 'create', '--network', 'none', '--entrypoint', '/bin/true', EVOLUTION], env).strip()
            package = temp / 'package.json'
            command([*LOCAL_DOCKER, 'cp', inspection_id + ':/evolution/package.json', str(package)], env)
            if json.loads(package.read_text()).get('version') != '2.3.7':
                raise RuntimeError('Pinned image does not declare package version 2.3.7; not executed')
            report['imageId'] = command([*LOCAL_DOCKER, 'image', 'inspect', EVOLUTION, '--format', '{{.Id}}'], env).strip()
            command([*LOCAL_DOCKER, 'rm', '-v', inspection_id], env)
            inspection_id = None
            started = True  # cleanup even if Compose only partially succeeds
            command([*compose, 'up', '-d', '--wait', '--wait-timeout', '120'], env, timeout=180)
            # No QR/connect/send route is called; the runner creates qrcode:false.
            report['httpHarnessInvoked'] = True
            command([*compose, 'exec', '-T', 'evolution', 'node', '/lab/contract.mjs', 'exercise'], env, timeout=240)
            command([*compose, 'stop', 'postgres'], env)
            command([*compose, 'exec', '-T', 'evolution', 'node', '/lab/contract.mjs', 'outage'], env, timeout=60)
            command([*compose, 'stop', 'evolution'], env)
            command([*compose, 'up', '-d', '--wait', '--wait-timeout', '120', 'postgres', 'redis'], env, timeout=180)
            command([*compose, 'restart', 'redis'], env)
            command([*compose, 'start', 'evolution'], env)
            # Fresh process reconnects to retained local DB; no provider auto-connect (state close).
            command([*compose, 'exec', '-T', 'evolution', 'node', '/lab/contract.mjs', 'recovery'], env, timeout=150)
            report['state'] = 'completed'
            report['reason'] = 'Laboratory assertions completed; see local synthetic artifacts'
        except (RuntimeError, subprocess.TimeoutExpired, OSError, ValueError) as error:
            report['reason'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        finally:
            if inspection_id:
                command([*LOCAL_DOCKER, 'rm', '-v', inspection_id], env)
            if started:
                try:
                    command([*compose, 'down', '--volumes', '--remove-orphans'], env, timeout=120)
                    report['cleanup'] = 'own fresh project removed'
                except (RuntimeError, subprocess.TimeoutExpired, OSError):
                    report['cleanup'] = 'FAILED: inspect only the project recorded here; never global prune'
                    report['state'] = 'blocked'
                    report['reason'] = 'Laboratory cleanup failed'
            for file in output.glob('*.json'):
                shutil.copyfile(file, folder / file.name)
                (folder / file.name).chmod(0o600)
            write_private(folder / 'run-summary.json', json.dumps(report, indent=2) + '\n')
    print(report['state'].upper() + ': summary in .runtime/evolution-sandbox/run-summary.json')
    return 0 if report['state'] == 'completed' else 2


if __name__ == '__main__':
    raise SystemExit(main())
