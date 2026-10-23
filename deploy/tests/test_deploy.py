"""Exercise the actual deploy script in a temporary filesystem with fake Docker.

Only hardcoded host paths, effective-uid checks and PATH are mapped to the sandbox.
No VPS, SSH, Docker daemon or production files are accessed.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
OLD = "a" * 40
NEW = "b" * 40
DIGEST = "sha256:" + "1" * 64


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for directory in ["opt/funix", "etc/funix/registry", "var/lib/funix/releases", "run/lock"]:
            (self.root / directory).mkdir(parents=True, exist_ok=True, mode=0o700)
        (self.root / "opt/funix/compose.yaml").write_text("name: funixapp\n")
        runtime = self.root / "etc/funix/runtime.env"
        runtime.write_text("FUNIX_OPERATOR_PASSWORD=synthetic-test-only\n")
        runtime.chmod(0o600)
        script = (ROOT / "deploy/funix-deploy").read_text()
        script = script.replace("/opt/funix", str(self.root / "opt/funix"))
        script = script.replace("/etc/funix", str(self.root / "etc/funix"))
        script = script.replace("/var/lib/funix", str(self.root / "var/lib/funix"))
        script = script.replace("/run/lock/funixapp-deploy.lock", str(self.root / "run/lock/funixapp-deploy.lock"))
        script = script.replace("[[ $(id -u) == 0 ]]", f"[[ $(id -u) == {os.getuid()} ]]")
        script = script.replace("$(stat -c %u \"$1\") == 0", f'$(stat -c %u "$1") == {os.getuid()}')
        script = script.replace("export PATH=", f"export PATH={self.bin}:")
        # Installing in this sandbox does not require changing ownership.
        script = script.replace("-o root -g root ", "")
        self.script = self.root / "deploy"
        self.script.write_text(script)
        fake = self.bin / "docker"
        fake.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]
root=pathlib.Path(os.environ['FUNIX_TEST_ROOT'])
with (root/'calls.jsonl').open('a') as out: out.write(json.dumps(args)+'\\n')
assert '--host=unix:///var/run/docker.sock' in args
assert not any(a in args for a in ['down','prune','rm','restart'])
if 'network' in args:
 assert args[-2:]==['inspect','traefik_default']; sys.exit(0)
assert 'compose' in args
if args[-2:]==['version','--short']: print('2.30.3'); sys.exit(0)
assert args[args.index('--project-name')+1]=='funixapp'
if 'up' in args or 'pull' in args or 'stop' in args:
 assert args[-2:]==['api','web']
if 'up' in args:
 release=pathlib.Path(args[args.index('--env-file')+1]).read_text()
 if os.environ.get('FUNIX_TEST_FAIL_REVISION','!') in release: sys.exit(1)
sys.exit(0)
''')
        fake.chmod(0o700)
        self.env = {**os.environ, "FUNIX_TEST_ROOT": str(self.root)}

    def run_deploy(self, *args):
        return subprocess.run(["bash", str(self.script), *args], env=self.env, text=True, capture_output=True)

    def state(self, name):
        return self.root / "var/lib/funix" / name

    def success(self, revision):
        result = self.run_deploy("deploy", revision, DIGEST, DIGEST)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_updates_only_funix_and_persists_digest_release(self):
        self.success(OLD)
        text = self.state("current.env").read_text()
        self.assertIn(OLD, text)
        self.assertIn("funixapp-web@" + DIGEST, text)
        self.assertNotIn("PASSWORD", text)
        calls = [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]
        self.assertTrue(any("up" in call for call in calls))

    def test_unhealthy_update_restores_previous_without_advancing_state(self):
        self.success(OLD)
        self.env["FUNIX_TEST_FAIL_REVISION"] = NEW
        result = self.run_deploy("deploy", NEW, DIGEST, DIGEST)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("anterior restaurada", result.stderr)
        self.assertIn(OLD, self.state("current.env").read_text())
        self.assertFalse(self.state(f"releases/{NEW}.env").exists())

    def test_first_failure_stops_only_funix(self):
        self.env["FUNIX_TEST_FAIL_REVISION"] = NEW
        result = self.run_deploy("deploy", NEW, DIGEST, DIGEST)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Primeira implantação falhou", result.stderr)
        self.assertFalse(self.state("current.env").exists())

    def test_manual_rollback_restores_pair_and_swaps_previous(self):
        self.success(OLD)
        self.success(NEW)
        result = self.run_deploy("rollback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(OLD, self.state("current.env").read_text())
        self.assertIn(NEW, self.state("previous.env").read_text())

    def test_invalid_commands_and_paths_cannot_reach_docker(self):
        for args in [("down",), ("rollback", "../../etc/passwd"), ("deploy", NEW, "latest", DIGEST), ("deploy", NEW + ";id", DIGEST, DIGEST)]:
            self.assertNotEqual(self.run_deploy(*args).returncode, 0)
        self.assertFalse((self.root / "calls.jsonl").exists())

    def test_revision_cannot_be_silently_replaced_by_different_digests(self):
        self.success(OLD)
        result = self.run_deploy("deploy", OLD, "sha256:" + "2" * 64, DIGEST)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("outros digests", result.stderr)

    def test_ssh_wrapper_rejects_injection_and_arbitrary_shell(self):
        for command in ["sh", "docker ps", "rollback ../../etc/passwd", "rollback\nid", "deploy " + NEW + " " + DIGEST + " " + DIGEST + "; id"]:
            result = subprocess.run(["bash", str(ROOT / "deploy/funix-ssh")], env={**self.env, "SSH_ORIGINAL_COMMAND": command}, capture_output=True)
            self.assertEqual(result.returncode, 64)


if __name__ == "__main__":
    unittest.main()
