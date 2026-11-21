#!/usr/bin/env bash
set -euo pipefail

test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$(id -u)" = 0
test "$(cat /proc/1/comm)" = systemd

sources=deploy/remote-hml
structure=$sources/structure
code=/usr/local/lib/funix-hml-ops
prepare_code=/usr/local/lib/funix-hml-prepare
state=/var/lib/funix-hml-ops
updater=/var/lib/funix-hml/updater
transport=funix-hml-ops-transport.service
worker=funix-hml-ops-worker.service
ops=funix-hml-ops
prep=funix-hml-prep
host_marker=/tmp/funix-system-boundary-host

for path in "$code" "$prepare_code" "$state" /var/lib/funix-hml /var/lib/funix-hml-prepare-control \
  "$host_marker" /etc/sudoers.d/funix-hml-{ops,prep} /etc/systemd/system/"$transport" \
  /etc/systemd/system/"$worker" /usr/local/sbin/funix-hml-{ops-request,ops-status,prepare}; do
  [[ ! -e "$path" && ! -L "$path" ]]
done
for user in "$ops" "$prep"; do
  ! getent passwd "$user"
  ! getent group "$user"
done

diagnose() {
  local result=$?
  if (( result != 0 )); then
    printf 'Failed phase: %s\n' "$phase"
    journalctl --no-pager -n 70 -u "$transport" -u "$worker" || true
  fi
  systemctl stop "$transport" "$worker" || true
}
phase=setup
trap diagnose EXIT
umask 077
touch "$host_marker"
chmod 644 "$host_marker"
for user in "$ops" "$prep"; do
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
  test "$(id -Gn "$user")" = "$user"
  passwd -S "$user" | awk '$2=="L" || $2=="LK" {ok=1} END {exit !ok}'
done
install -d -m 0755 "$code"
install -d -m 0700 "$prepare_code" "$state" "$state/requests" "$updater" "$updater/op-fixture"
install -m 0644 "$sources/rootctl.py" "$code/rootctl.py"
install -m 0600 "$sources/control.py" "$prepare_code/control.py"
install -m 0644 .github/scripts/probe-system-boundary.py "$code/transport.py"
install -m 0600 /dev/null "$state/control.lock"
install -m 0755 "$structure/funix-hml-ops-status" /usr/local/sbin/funix-hml-ops-status
install -m 0755 "$structure/funix-hml-ops-request" /usr/local/sbin/funix-hml-ops-request
install -m 0755 "$structure/funix-hml-prepare-wrapper" /usr/local/sbin/funix-hml-prepare
install -m 0440 "$structure/funix-hml-ops" /etc/sudoers.d/funix-hml-ops
install -m 0440 "$structure/funix-hml-prepare-sudoers" /etc/sudoers.d/funix-hml-prep
visudo -cf /etc/sudoers.d/funix-hml-ops
visudo -cf /etc/sudoers.d/funix-hml-prep
install -m 0644 "$structure/$transport" "$structure/$worker" /etc/systemd/system/
systemctl daemon-reload

python3 - "$updater" <<'PY'
import json
from pathlib import Path
import sys

state = Path(sys.argv[1])
journal = state / "op-fixture" / "operation.json"
release = {"revision": "a"*40}
journal.write_text(json.dumps(dict(schema=1, project="funix-hml", phase="accepted",
                                   maintenance=True, candidate=release, previous=release)))
(state / "active.json").write_text(json.dumps({"journal": str(journal)}))
PY

phase=preparation-sudoers
expect_denied() {
  if "$@" > /dev/null 2>&1; then
    echo "Unexpected sudo permission"
    return 1
  fi
}
expect_denied runuser -u "$prep" -- sudo -n -- /usr/local/sbin/funix-hml-ops-status
expect_denied runuser -u "$prep" -- sudo -n -- /usr/local/sbin/funix-hml-prepare extra
expect_denied runuser -u "$prep" -- sudo -n -- /usr/bin/id
prep_result=$(runuser -u "$prep" -- sudo -n -- /usr/local/sbin/funix-hml-prepare || test "$?" = 1)
python3 -c 'import json,sys; v=json.loads(sys.argv[1]); assert v["status"]=="blocked" and v["reason"]=="FileNotFoundError" and v["deploy"] is False' "$prep_result"

wait_transport() {
  local pid
  for _ in {1..100}; do
    pid=$(systemctl show "$transport" -p MainPID --value)
    if [[ "$pid" != 0 && "$pid" != "${1:-0}" ]] &&
      journalctl --no-pager -u "$transport" -o cat | grep -Fx "FUNIX_BOUNDARY_TRANSPORT_OK $pid" >/dev/null; then
      printf '%s\n' "$pid"
      return
    fi
    sleep .2
  done
  return 1
}
phase=transport-and-restart
systemctl start "$transport"
first_pid=$(wait_transport)
test ! -e "$state/current.json"
systemctl kill --signal=SIGKILL "$transport"
restarted_pid=$(wait_transport "$first_pid")
test "$(systemctl show "$transport" -p NRestarts --value)" -ge 1

# Hold the real controller lock so the actual worker stays before any state
# changes. Verify PID 1 starts it as root and leaves it stopped after a kill.
phase=worker-interruption
exec 9<>"$state/control.lock"
flock -x 9
systemctl start --no-block "$worker"
worker_pid=0
for _ in {1..100}; do
  worker_pid=$(systemctl show "$worker" -p MainPID --value)
  [[ "$worker_pid" != 0 ]] && break
  sleep .1
done
test "$worker_pid" != 0
test "$(ps -o euid= -p "$worker_pid" | xargs)" = 0
test "$(systemctl show "$worker" -p Restart --value)" = no
systemctl kill --signal=SIGKILL "$worker"
for _ in {1..100}; do
  [[ "$(systemctl show "$worker" -p ActiveState --value)" == failed ]] && break
  sleep .1
done
test "$(systemctl show "$worker" -p Result --value)" = signal
test "$(systemctl show "$worker" -p MainPID --value)" = 0
test "$(systemctl show "$worker" -p NRestarts --value)" = 0
flock -u 9
test ! -e "$state/current.json"
test -z "$(ls -A "$state/requests")"
test "$(systemctl show "$transport" -p MainPID --value)" = "$restarted_pid"
printf '%s\n' FUNIX_SUDOERS_SYSTEMD_BOUNDARY_OK

# Only the disposable runner owns these synthetic paths and services.
phase=migration-gate
systemctl reset-failed "$worker"
/usr/bin/python3 .github/scripts/rehearse-migration-gate.py
