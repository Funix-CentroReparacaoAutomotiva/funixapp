"""Opt-in local laboratory. Does not load .env, select a remote daemon or prune shared resources."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = Path(__file__).with_name('compose.yaml')
EVOLUTION = 'evoapicloud/evolution-api@sha256:456b4104b0ddffbb092d6b3c0560a4ae86fc3e014e885b882aca4b1b371dfc81'
LOCAL_DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
SELECTORS = {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}


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
    folder.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k not in SELECTORS and not k.startswith(('LAB_', 'COMPOSE_'))}
    project = 'evoreadlab-' + secrets.token_hex(6)
    report = {'state': 'blocked', 'project': project, 'httpHarnessInvoked': False, 'image': EVOLUTION}
    # Conservative space guard for layered VFS extraction; not an image size guarantee.
    report['freeBytes'] = shutil.disk_usage(ROOT).free
    if report['freeBytes'] < 8 * 1024**3:
        report['reason'] = 'Less than the laboratory guard of 8 GiB free; no pull/start attempted'
        write_private(folder / 'run-summary.json', json.dumps(report, indent=2) + '\n')
        print('BLOCKED: insufficient local disk; summary in .runtime/evolution-sandbox/run-summary.json')
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
            report['localDockerVersion'] = command([*LOCAL_DOCKER, 'info', '--format', '{{.ServerVersion}}'], env).strip()
            report['storageDriver'] = command([*LOCAL_DOCKER, 'info', '--format', '{{.Driver}}'], env).strip()
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
