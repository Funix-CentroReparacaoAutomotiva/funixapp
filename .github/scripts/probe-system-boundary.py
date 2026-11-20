"""Synthetic transport payload for the real service unit."""
import json
import os
from pathlib import Path
import pwd
import subprocess
import time

USER = "funix-hml-ops"
STATE = Path("/var/lib/funix-hml-ops")
CODE = Path(__file__).parent / "rootctl.py"
STATUS = "/usr/local/sbin/funix-hml-ops-status"
REQUEST = "/usr/local/sbin/funix-hml-ops-request"
SUDO = ["/usr/bin/sudo", "-n", "--"]


def run(*args, body=None):
    return subprocess.run(args, input=body, capture_output=True, timeout=15)


def denied(*args):
    result = run(*args)
    assert result.returncode != 0 and not result.stdout, args


account = pwd.getpwnam(USER)
assert os.geteuid() == account.pw_uid != 0
assert os.getegid() == account.pw_gid
assert set(os.getgroups()) == {account.pw_gid}
assert os.umask(0o077) == 0o077
assert not Path("/tmp/funix-system-boundary-host").exists()
for path in ("/usr", "/etc"):
    assert os.statvfs(path).f_flag & os.ST_RDONLY, path
assert not os.access("/root", os.R_OK | os.X_OK)
assert not os.access(CODE, os.W_OK)
try:
    (STATE / "control.lock").open("rb")
except PermissionError:
    pass
else:
    raise AssertionError("transport can read private state")

status = run(*SUDO, STATUS)
assert status.returncode == 0, status.stderr
result = json.loads(status.stdout)
assert result["status"] == "ok" and result["journal"]["operation"] == "op-fixture"
assert result["armed"] is None and result["last_request"] is None

for args in ((STATUS, "extra"), (REQUEST, "extra"), ("/usr/bin/id",),
             ("/usr/local/sbin/funix-hml-prepare",),
             ("/usr/bin/systemctl", "start", "funix-hml-ops-worker.service")):
    denied(*SUDO, *args)
direct = run("/usr/bin/python3", "-I", str(CODE), "status")
assert direct.returncode != 0 and json.loads(direct.stdout)["reason"] == "root_only"

request = dict(action="update", operation="op-fixture", revision="a"*40,
               sha256="b"*64, ticket_id="c"*32)
blocked = run(*SUDO, REQUEST, body=json.dumps(request).encode())
assert blocked.returncode != 0 and json.loads(blocked.stdout)["reason"] == "approval_required"
print(f"FUNIX_BOUNDARY_TRANSPORT_OK {os.getpid()}", flush=True)
while True:
    time.sleep(10)
