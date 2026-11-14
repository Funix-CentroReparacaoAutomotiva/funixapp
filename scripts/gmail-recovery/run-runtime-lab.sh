#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
: "${FUNIX_GMAIL_LAB_N8N:?Set the absolute path to the disposable n8n 2.47.7 bin/n8n}"
[[ $(node "$FUNIX_GMAIL_LAB_N8N" --version) == '2.47.7' ]] || { echo 'Expected n8n 2.47.7'; exit 1; }
lab_root=$(mktemp -d "${FUNIX_GMAIL_LAB_PARENT:-/tmp}/funix-gmail-n8n.XXXXXX")
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
broker_port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
guard="$repo/scripts/gmail-recovery/runtime-network-guard.cjs"
lab_pid=''
cleanup() { if [[ -n "$lab_pid" ]]; then kill "$lab_pid" 2>/dev/null || true; wait "$lab_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM
# Fresh settings/database and only explicitly selected environment values.
env -i PATH="$PATH" \
  HTTP_PROXY="${HTTP_PROXY:-}" HTTPS_PROXY="${HTTPS_PROXY:-}" NO_PROXY="${NO_PROXY:-}" \
  http_proxy="${http_proxy:-}" https_proxy="${https_proxy:-}" no_proxy="${no_proxy:-}" \
  N8N_USER_FOLDER="$lab_root/state" N8N_LISTEN_ADDRESS=127.0.0.1 N8N_HOST=127.0.0.1 \
  N8N_PORT="$port" N8N_RUNNERS_BROKER_PORT="$broker_port" \
  N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false N8N_TEMPLATES_ENABLED=false \
  N8N_SECURE_COOKIE=false N8N_ENCRYPTION_KEY=synthetic-disposable-lab-encryption-only \
  CODE_ENABLE_STDOUT=true \
  NODE_OPTIONS="--require=$guard" node "$FUNIX_GMAIL_LAB_N8N" start > "$lab_root/runtime.log" 2>&1 &
lab_pid=$!
ready=false
for attempt in {1..120}; do
  if curl --silent --fail --max-time 1 "http://127.0.0.1:$port/rest/settings" -o "$lab_root/readiness.json" &&
    node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(d.data?0:1)' "$lab_root/readiness.json" 2>/dev/null; then ready=true; break; fi
  kill -0 "$lab_pid" 2>/dev/null || break
  sleep 1
done
[[ "$ready" == true ]] || { echo "Runtime failed; diagnostic directory: $lab_root"; exit 1; }
echo "Disposable runtime evidence directory: $lab_root"
FUNIX_GMAIL_LAB_URL="http://127.0.0.1:$port" FUNIX_GMAIL_LAB_WORK="$lab_root" \
  node --require "$guard" "$repo/scripts/gmail-recovery/runtime-lab.ts" > "$lab_root/results.log" 2>&1
cat "$lab_root/evidence.json"
