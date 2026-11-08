#!/usr/bin/env bash
# FUNIX Chat preflight. READ ONLY: no database, credentials, Docker control,
# backup, restart, rollback or file content appears in output.
set -euo pipefail
set +x

printf '%s\n' 'FUNIX_CHAT_PREFLIGHT: SOMENTE_LEITURA'
config=/etc/funix/runtime.env
if [[ -f "$config" && ! -L "$config" ]]; then
  meta=$(stat -c '%u:%g:%a' -- "$config")
  [[ "$meta" == '0:0:600' ]] && protection=OK || protection=REVISAR
  printf 'RUNTIME_PROTECAO: %s\n' "$protection"
  flag=$(awk '
    /^FUNIX_EVOLUTION_READ_ENABLED=/ {
      count++
      value=substr($0, index($0, "=")+1)
      if (value=="true") status="ATIVA"
      else if (value=="false") status="DESATIVADA"
      else status="VALOR_INVALIDO"
    }
    END { if (count>1) print "DUPLICADA"; else if (count==0) print "AUSENTE"; else print status }
  ' "$config")
  printf 'EVOLUTION_FLAG: %s\n' "$flag"
else
  printf '%s\n' 'RUNTIME_PROTECAO: AUSENTE_OU_SYMLINK'
  printf '%s\n' 'EVOLUTION_FLAG: NAO_VERIFICADA'
fi

for name in current previous; do
  f="/var/lib/funix/${name}.env"
  if [[ -f "$f" && ! -L "$f" ]]; then
    meta=$(stat -c '%u:%g:%a' -- "$f")
    [[ "$meta" == '0:0:600' ]] && status=PROTEGIDO || status=REVISAR
  else
    status=AUSENTE_OU_SYMLINK
  fi
  printf 'REGISTRO_%s: %s\n' "${name^^}" "$status"
done

if [[ -x /usr/local/sbin/funix-deploy && ! -L /usr/local/sbin/funix-deploy ]]; then
  printf '%s\n' 'ROLLBACK_SCRIPT: ENCONTRADO_NAO_EXECUTADO'
else
  printf '%s\n' 'ROLLBACK_SCRIPT: NAO_CONFIRMADO'
fi

printf '%s\n' 'BACKUP_SQLITE: NAO_TESTADO'
printf '%s\n' 'RESTAURACAO_RUNTIME: NAO_TESTADA'
