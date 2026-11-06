#!/bin/bash
# Local/CI only. No production network, host ports, credentials or Coda calls.
set -euo pipefail
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker() { command docker --host=unix:///var/run/docker.sock "$@"; }
suffix="${GITHUB_RUN_ID:-local}-$$"
api="funix-ci-api-$suffix"
web="funix-ci-web-$suffix"
cleanup() { docker rm -f "$api" "$web" >/dev/null 2>&1 || true; }
trap cleanup EXIT
secret=$(openssl rand -hex 24)
docker run -d --name "$api" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -e FUNIX_OPERATOR_PASSWORD="$secret" -e FUNIX_APP_ORIGIN=https://app.funix.com.br \
  -e FUNIX_DATABASE_PATH=/tmp/funix-ci.sqlite \
  -e FUNIX_REVISION="${GITHUB_SHA:-development}" funix-api:ci >/dev/null
unset secret
docker run -d --name "$web" --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m funix-web:ci >/dev/null
for container in "$api" "$web"; do
  for attempt in {1..75}; do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
    [[ $status == healthy ]] && break
    [[ $status != unhealthy ]] || {
      printf 'Container de teste não saudável: %s\n' "$container" >&2
      docker logs --tail 20 "$container" >&2
      docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' "$container" >&2
      exit 1
    }
    sleep 1
  done
  [[ $status == healthy ]] || exit 1
done
docker exec "$api" node --input-type=module -e '
import assert from "node:assert/strict";
const base="http://127.0.0.1:8787";
assert.equal((await fetch(base+"/api/atendimentos")).status,401);
assert.equal((await fetch(base+"/api/session",{method:"POST",headers:{Origin:"https://other.invalid","Content-Type":"application/json"},body:JSON.stringify({password:process.env.FUNIX_OPERATOR_PASSWORD})})).status,403);
const login=await fetch(base+"/api/session",{method:"POST",headers:{Origin:"https://app.funix.com.br","Content-Type":"application/json"},body:JSON.stringify({password:process.env.FUNIX_OPERATOR_PASSWORD})});
assert.equal(login.status,200); assert.match(login.headers.get("set-cookie"),/; Secure/);
const cookie=login.headers.get("set-cookie").split(";")[0];
assert.equal((await (await fetch(base+"/api/health")).json()).capabilities.messages,false);
for(const method of ["GET","POST","OPTIONS"]){
 const disabled=await fetch(base+"/api/integrations/whatsapp/events",{method,headers:{Cookie:cookie}});
 assert.equal(disabled.status,404); assert.equal(disabled.headers.get("cache-control"),"no-store");
 assert.equal(disabled.headers.get("access-control-allow-origin"),null);
}
const list=await fetch(base+"/api/atendimentos",{headers:{Cookie:cookie}});
assert.equal(list.status,200); assert.equal((await list.json()).total,0);
const created=await fetch(base+"/api/atendimentos",{method:"POST",headers:{Origin:"https://app.funix.com.br","Content-Type":"application/json",Cookie:cookie},body:JSON.stringify({phone:"+5511999990000"})});
assert.equal(created.status,201); const record=await created.json();
assert.equal((await fetch(base+"/api/atendimentos/"+record.id+"/messages")).status,401);
const messages=await fetch(base+"/api/atendimentos/"+record.id+"/messages",{headers:{Cookie:cookie}});
assert.equal(messages.status,200); assert.equal(messages.headers.get("cache-control"),"no-store");
assert.deepEqual(await messages.json(),{items:[],nextCursor:null});
assert.equal((await fetch(base+"/api/atendimentos/"+record.id,{headers:{Cookie:cookie}})).status,200);
assert.equal((await fetch(base+"/api/workspace",{headers:{Cookie:cookie}})).status,410);
assert.equal((await fetch(base+"/api/experiencias/i-ci",{method:"POST",headers:{Cookie:cookie}})).status,405);
const oversized=await fetch(base+"/api/atendimentos",{method:"POST",headers:{Origin:"https://app.funix.com.br","Content-Type":"application/json",Cookie:cookie},body:JSON.stringify({phone:"1",notes:"x".repeat(70000)})});
assert.equal(oversized.status,413);
assert.equal((await oversized.json()).error.code,"BODY_TOO_LARGE");
console.log("API de produção: sessão HTTPS, SQLite próprio, criação/consulta e ERP indisponível conferidos.");'
docker exec "$web" sh -ec '
  wget -Y off -q -O /tmp/spa http://127.0.0.1:8080/atendimentos/i-ci
  grep -q "<div id=\"root\"" /tmp/spa
  if wget -Y off -q -O /dev/null http://127.0.0.1:8080/api/session; then exit 1; fi
  if wget -Y off -q -O /dev/null http://127.0.0.1:8080/assets/missing.js; then exit 1; fi
  wget -Y off -q -O /dev/null http://127.0.0.1:8080/release.json
'
printf 'Imagens de produção: smoke tests concluídos.\n'
