#!/usr/bin/env bash
# Teste de imagem HML apenas em Docker local/CI; não altera VPS, rotas ou volumes.
set -euo pipefail
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
container="funix-panel-hml-ci-${GITHUB_RUN_ID:-local}-$$"
cleanup() { docker --host=unix:///var/run/docker.sock rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# Usa exclusivamente imagem criada no runner, sem serviços adicionais ou portas publicadas.
docker --host=unix:///var/run/docker.sock run -d --name "$container" --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m funix-web:ci >/dev/null
status=""
for attempt in $(seq 1 30); do
  status="$(docker --host=unix:///var/run/docker.sock inspect --format '{{.State.Health.Status}}' "$container")"
  [[ "$status" == healthy ]] && break
  [[ "$status" != unhealthy ]] || { echo "HML panel unhealthy" >&2; exit 1; }
  sleep 1
done
[[ "$status" == healthy ]] || { echo "HML panel not healthy" >&2; exit 1; }
docker --host=unix:///var/run/docker.sock exec "$container" sh -eu -c '
  base="http://127.0.0.1:8080/painel"
  wget -Y off -q -O /tmp/panel.html "$base/"
  grep -q "Central de Orquestração" /tmp/panel.html
  wget -Y off -q -O /tmp/snapshot.json "$base/snapshot.json"
  grep -q '"'"'"schemaVersion"'"'"' /tmp/snapshot.json
  wget -Y off -q -O /tmp/model.mjs "$base/model.mjs"
  grep -q "validateSnapshot" /tmp/model.mjs
  headers=$(wget -Y off -S -O /tmp/app.mjs "$base/app.mjs" 2>&1)
  printf "%s\n" "$headers" | grep -qi "Content-Type: application/javascript"
  grep -q "snapshot.json" /tmp/app.mjs
  wget -Y off -q -O /tmp/styles.css "$base/styles.css"
  grep -q "body" /tmp/styles.css
  test -r /usr/share/nginx/html/painel/index.html
'
echo "PAINEL_HML_WEB_OK (imagem local sem gateway real)"
