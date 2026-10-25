# Correção tmpfs e atualização do Compose já instalado

O YAML anterior usava uma lista inline sem aspas: as vírgulas separavam `/tmp:rw`, `noexec`, `nosuid` e `size=...` em entradas diferentes. Assim, Docker recebia `noexec` como destino de montagem e recusava o caminho relativo.

`compose.yaml` agora usa `volumes`, `type: tmpfs`, `target: /tmp` e tamanho explícito em bytes:

- API: `16777216` bytes = 16 MiB.
- Web: `33554432` bytes = 32 MiB.

## Opções suportadas e verificação

A direção informou **Compose 5.6.0 e Engine 29.9.0 na VPS**. A fonte do [Compose 5.6.0](https://github.com/docker/compose/blob/v5.6.0/go.mod) usa compose-go 2.16.1. Seu [esquema](https://github.com/compose-spec/compose-go/blob/v2.16.1/schema/compose-spec.json) e [tipo ServiceVolumeTmpfs](https://github.com/compose-spec/compose-go/blob/v2.16.1/types/types.go) aceitam `size` e `mode`; **não aceitam `tmpfs.options`**. Não foi acrescentado campo desconhecido nem usada a permissão `mode` como substituto de flags de montagem.

Docker Linux monta esse tmpfs com `noexec,nosuid` por padrão. A configuração mantém esses padrões e RW, sem sobrescrevê-los com `exec`/`suid`. O teste executa a configuração de montagem extraída do Compose real, verifica `/proc/mounts`, capacidade via `statfs`, escrita e bloqueio EACCES de execução em `/tmp`.

Executado neste ambiente: Compose oficial **5.6.0**, binário Linux x86_64 em `/tmp` com SHA-256 comparado ao `checksums.txt` do release; daemon local **28.4.0**. Não foi acessado o daemon **29.9.0** da VPS. Resultado real de API/Web: `rw,nosuid,nodev,noexec`, tamanhos exatos e execução bloqueada. Evidência: [compose-5.6-probe.txt](evidencias/tmpfs/compose-5.6-probe.txt).

Comandos de validação local:

```bash
python3 -m unittest discover -s deploy/tests -v
python3 deploy/test-compose-tmpfs.py --compose-bin /tmp/funix-compose-v5.6.0 --image funix-api:ci
git diff --check
```

São 18 testes Python aprovados, incluindo normalização real do Compose. O probe exige uma imagem Node 24 já presente; usa `--pull never`, dois contêineres descartáveis com rede `none`, sem portas e sem iniciar a stack FUNIX. Não cria/altera redes existentes. Sem o argumento `--compose-bin`, usa `docker compose` instalado.

Para repetir **na VPS**, a partir do checkout revisado, usar uma imagem API Node 24 já presente, preferencialmente o digest aprovado que foi baixado na tentativa anterior:

```bash
docker compose version --short
docker version --format '{{.Server.Version}}'
sudo python3 deploy/test-compose-tmpfs.py --image 'ghcr.io/funix-centroreparacaoautomotiva/funixapp-api@sha256:DIGEST_JA_PRESENTE'
```

Substituir o marcador pelo digest real já instalado. Este teste não é deploy: executa somente os dois probes descartáveis sem rede. Não baixa imagem nem altera containers existentes. Se a imagem não estiver presente, falha; não escolher imagem aleatória nem fazer pull global como recuperação.

## Atualização obrigatória na VPS antes do próximo deploy

**Atualizar o GitHub não atualiza `/opt/funix/compose.yaml`.** O SSH restrito do Actions só atualiza imagens; não pode substituir esse arquivo root-owned. A substituição precisa ser feita pelo administrador no console/SSH administrativo existente. Não ampliar o usuário `funix-deploy` nem executar novamente o instalador inicial.

1. Manter `FUNIX_DEPLOY_ENABLED=false` e não disparar outro deploy ainda.
2. No checkout administrativo existente, obter a branch/commit corrigido, revisar e fixar o SHA publicado no PR. Não executar `git pull` em diretório desconhecido nem scripts remotos via pipe.
3. Confirmar as versões e executar a validação de mounts acima no Engine real. Somente após sucesso, executar o bloco abaixo **na raiz do checkout revisado da FUNIX**. Ele altera somente o arquivo Compose da FUNIX e cria seu backup; não executa `up`, `down`, `restart`, `pull`, `prune` ou alterações de rede.

```bash
sudo bash -s -- "$PWD/compose.yaml" <<'BASH'
set -Eeuo pipefail
umask 077
src=$1
expected=6dc19cfa874216fa283d330037efcdd97f52ee53b2a477d2fa921dca6c770239
target=/opt/funix/compose.yaml
[[ -f $src && ! -L $src ]]
for path in /opt /opt/funix "$target"; do
  [[ -e $path && ! -L $path && $(stat -c %u "$path") == 0 ]]
  mode=$(stat -c %a "$path")
  (( (8#$mode & 022) == 0 ))
done
# Mesmo lock usado pelo deploy: não substituir durante uma implantação.
exec 9>/run/lock/funixapp-deploy.lock
flock -w 300 9
candidate=$(mktemp /opt/funix/.compose-tmpfs.XXXXXX)
trap 'rm -f -- "$candidate"' EXIT
install -o root -g root -m 0644 "$src" "$candidate"
printf '%s  %s\n' "$expected" "$candidate" | sha256sum --check --status
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH COMPOSE_FILE COMPOSE_PROJECT_NAME
# Nomes sintéticos somente para validação; nenhuma imagem será baixada/iniciada.
validate() {
  FUNIX_RELEASE=tmpfs-validation FUNIX_API_IMAGE=funix-api:validation FUNIX_WEB_IMAGE=funix-web:validation \
    docker --host=unix:///var/run/docker.sock compose --env-file /dev/null \
    --project-name funixapp --file "$1" config --quiet
}
validate "$candidate"
backup=$(mktemp /opt/funix/compose.yaml.before-tmpfs.XXXXXX)
cp -p -- "$target" "$backup"
mv -T -- "$candidate" "$target"
printf '%s  %s\n' "$expected" "$target" | sha256sum --check --status
validate "$target"
stat -c '%U:%G %a %n' "$target"
printf 'Compose corrigido instalado. Backup: %s\nNenhum serviço iniciado; deploy continua pendente.\n' "$backup"
BASH
```

`config --quiet` lê o `runtime.env` já instalado, sem imprimir senha ou token. Esperado: validação sem erro, checksum conferido e `root:root 644 /opt/funix/compose.yaml`. Guardar a saída no registro da manutenção. O hash acima identifica exatamente o Compose desta correção; uma revisão futura exige nova conferência, não remover a checagem.

4. Somente depois de confirmar o arquivo instalado e obter autorização de implantação, executar o fluxo manual existente na main com `deploy=true`. A substituição do arquivo não recria contêineres por si só. Manter o deploy automático desligado.

Sem acesso administrativo à VPS nesta sessão, a instalação remota **não está confirmada**. O próximo deploy deve aguardar o administrador concluir o procedimento e confirmar a validação. Nenhum serviço produtivo, Traefik, n8n, Evolution, Coda, secret ou rede foi modificado nesta correção.
