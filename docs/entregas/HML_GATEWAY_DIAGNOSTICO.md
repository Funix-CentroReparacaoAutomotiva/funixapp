# Homologação: diagnóstico e publicação do gateway

## Diagnóstico revisado

A hipótese anterior de comparação entre objeto JSON e string está descartada.
O programa original comparava explicitamente:

```python
api_data.get("revision") == revision
web_data.get("revision") == revision
```

O que a evidência confirma é mais limitado:

- `release.env`, `/api/ready` e `/release.json` foram exibidos antes da
  publicação com o mesmo prefixo de 12 caracteres, `8e801e9b0a8f`;
- pelo gateway, os três testes autenticados retornaram HTTP 200;
- a comparação original falhou naquele processo;
- um ensaio privado posterior leu exatamente o mesmo SHA completo, como `str`,
  nos dois objetos JSON e no arquivo de release;
- os contratos reais são objetos: a API retorna `revision`, `source`, `status`
  e `storage`; a Web retorna `revision`.

Isso não permite identificar a causa da primeira falha: os valores completos,
seus tipos e o resultado de cada comparação não foram registrados naquele
instante. A execução posterior prova que não havia uma divergência persistente,
mas não reconstitui o estado do processo que falhou. Com as três strings
posteriores, a expressão original resulta em `True` para API e Web; portanto, a
falha real não é reproduzida pelas evidências preservadas.

Hipóteses ainda abertas, em ordem de utilidade para o próximo diagnóstico:

1. o valor local `revision` era diferente no ponto da comparação por mudança de
   estado, reatribuição ou leitura distinta da usada na verificação anterior;
2. uma das respostas daquele primeiro processo tinha valor ou tipo diferente,
   inclusive caractere invisível que o prefixo de 12 caracteres ocultou;
3. o gateway resolveu temporariamente outro backend ou conteúdo durante sua
   inicialização.

Cache é uma hipótese fraca: os testes eram diretos no gateway privado, o Nginx
conhecido não configura `proxy_cache`, e a repetição posterior coincidiu. Ainda
assim, a configuração completa do gateway não foi preservada no texto colado.
Nenhuma dessas hipóteses está confirmada.

O fluxo da aplicação está coerente. `release.env` fornece
`FUNIX_HML_REVISION`; o Compose passa esse valor à API como `FUNIX_REVISION`,
que é exposto em `/api/ready`. A imagem Web grava `APP_REVISION` em
`/release.json` no build. O Nginx da imagem Web rejeita `/api`; no desenho de
homologação, o gateway precisa encaminhar `/api` para `api:8787` e o restante
para `web:8080`. Os dois HTTP 200 autenticados confirmam que essas rotas
responderam, mas não registram quais revisões foram comparadas naquele instante.

## Correção proposta

`deploy/hml-gateway-validate.py` é um substituto somente leitura para a parte de
validação. Ele:

1. lê `FUNIX_HML_REVISION` sem remover espaços, `CR` ou caracteres invisíveis e
   exige um SHA completo de 40 caracteres;
2. lê a senha de um arquivo protegido, sem colocá-la na linha de comando nem
   imprimi-la;
3. consulta `/api/ready` e `/release.json` com Basic Auth;
4. desserializa cada resposta como objeto JSON;
5. antes de qualquer asserção, mostra os três valores completos com `repr`,
   tipo, comprimento e os três resultados de igualdade;
6. identifica separadamente cada origem inválida ou divergente;
7. valida `status=ready`, `source=app` e `storage=sqlite` na API.

O script não usa Docker, não altera Traefik e não inicia ou remove contêineres.
Os testes registram que os valores posteriores não reproduzem a falha original.
Também cobrem diferenças de valor, tipo e caractere invisível, autenticação
sintética e respostas malformadas. Esses cenários validam a instrumentação; não
são apresentados como reprodução da causa ainda desconhecida.

Exemplo para o ensaio privado, depois de um operador já ter iniciado o gateway
somente na rede `funix-hml_privada`:

```bash
GATEWAY_IP="$(docker inspect --format '{{(index .NetworkSettings.Networks "funix-hml_privada").IPAddress}}' funix-hml-gateway-1)"
python3 deploy/hml-gateway-validate.py \
  --release-env /opt/funix-hml/release.env \
  --release-key FUNIX_HML_REVISION \
  --credentials-file /etc/funix-hml/gateway-login-temporario.txt \
  --connect-host "$GATEWAY_IP" \
  --port 8080 \
  --host-header hml.funix.com.br
unset GATEWAY_IP
```

`FUNIX_HML_REVISION` também é o padrão do validador. O argumento explícito no
exemplo documenta o contrato real e evita confusão com a variável produtiva.

## Informações ainda necessárias da VPS

Para fechar a causa exata e revisar uma publicação, são necessários apenas
artefatos de homologação, todos sem segredos e sem conteúdo do SQLite:

- o arquivo original e não truncado do programa, incluindo todo o fluxo que
  atribui ou reutiliza `revision`, não apenas as duas expressões de comparação;
- `/opt/funix-hml/gateway.compose.yaml` e
  `/etc/funix-hml/gateway-nginx.conf` completos;
- os digests de imagem de `release.env`, com qualquer credencial omitida; a
  variável de revisão confirmada é `FUNIX_HML_REVISION`;
- `docker compose ... config --format json` somente para os serviços `api`,
  `web` e `gateway`, com valores sensíveis removidos;
- `docker inspect funix-hml-gateway-1` sanitizado, contendo apenas imagem,
  usuário, mounts, redes, portas, healthcheck e labels;
- a regra efetiva do router/service/middleware de homologação que o Traefik
  derivou das labels, mais os registros DNS A/AAAA de `hml.funix.com.br`.

Não são necessários senha, banco, cookies, token do registry, configuração dos
contêineres de produção ou qualquer reinício. O histórico do terminal não
preservou os valores e tipos no instante da falha nem os dois arquivos do
gateway.

## Diagnóstico seguro antes da publicação

As verificações são divididas pelo estado esperado. Antes da publicação, o
gateway removido pela reversão deve continuar ausente. Estes comandos não fazem
pull, build, restart, `up`, `down`, `rm` ou escrita em volume:

```bash
docker compose \
  --project-name funix-hml \
  --env-file /opt/funix-hml/release.env \
  -f /opt/funix-hml/compose.yaml \
  -f /opt/funix-hml/gateway.compose.yaml \
  config --quiet

for C in funix-hml-api-1 funix-hml-web-1; do
  STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$C")"
  test "$STATUS" = healthy || {
    echo "BLOQUEADO: $C nao esta saudavel"
    exit 1
  }
done

if docker container inspect funix-hml-gateway-1 >/dev/null 2>&1; then
  echo "BLOQUEADO: gateway deveria estar ausente antes da publicacao"
  exit 1
fi

docker inspect --format '{{json .NetworkSettings.Networks}}' \
  funix-hml-api-1 funix-hml-web-1

docker inspect --format '{{json .HostConfig.PortBindings}}' \
  funix-hml-api-1 funix-hml-web-1
```

Critérios anteriores à publicação: API e Web estão `healthy`, pertencem somente
à rede privada e não publicam portas no host; `funix-hml-gateway-1` não existe.
Não se consulta `.State.Health.Status` do gateway, pois ele não possui
`HEALTHCHECK` Docker.

Antes de atribuir qualquer falha a cache, repita cada GET com um query string
único e registre `Date`, `Age`, `Via`, `Server` e um hash do corpo, sem registrar
`Authorization`. O gateway deve enviar `Cache-Control: no-store` para
`/api/ready` e `/release.json`. A resposta posterior já reduz muito a
probabilidade de cache; essa coleta ajuda a distinguir a hipótese sem tratá-la
como causa confirmada.

## Publicação e reversão propostas

Esta etapa fica bloqueada até revisão dos artefatos acima e autorização
explícita. Com essa autorização, a unidade de mudança deve continuar sendo
somente o serviço `gateway` do projeto `funix-hml`:

```bash
docker compose \
  --project-name funix-hml \
  --env-file /opt/funix-hml/release.env \
  -f /opt/funix-hml/compose.yaml \
  -f /opt/funix-hml/gateway.compose.yaml \
  up --detach --no-build --pull never --no-deps gateway
```

Depois do `up`, execute primeiro o validador pelo IP privado e então pelo HTTPS
público, usando `--scheme https --connect-host hml.funix.com.br --port 443`.
Antes dos testes HTTP, verifique o estado pós-publicação:

```bash
test "$(docker inspect --format '{{.State.Running}}' \
  funix-hml-gateway-1)" = true

for C in funix-hml-api-1 funix-hml-web-1; do
  test "$(docker inspect --format '{{.State.Health.Status}}' "$C")" = healthy
done

docker inspect --format '{{json .NetworkSettings.Networks}}' \
  funix-hml-api-1 funix-hml-web-1 funix-hml-gateway-1

docker inspect --format '{{json .HostConfig.PortBindings}}' \
  funix-hml-api-1 funix-hml-web-1 funix-hml-gateway-1
```

Critérios posteriores à publicação: gateway `Running=true`, conectado somente
às redes privada e externa do Traefik, sem porta publicada no host; API e Web
continuam `healthy`; somente o gateway declara o hostname de homologação. Sem
credencial, `/`, `/api/ready`, `/release.json` e `/healthz` retornam 401. Com a
credencial, `/`, `/api/ready` e `/release.json` retornam 200, e o validador
confirma as revisões. Esses testes HTTP substituem um healthcheck Docker do
gateway. Nenhum comando deve nomear, reiniciar ou inspecionar contêineres de
produção.

Se qualquer critério falhar, a reversão é restrita ao gateway:

```bash
docker compose \
  --project-name funix-hml \
  --env-file /opt/funix-hml/release.env \
  -f /opt/funix-hml/compose.yaml \
  -f /opt/funix-hml/gateway.compose.yaml \
  rm --stop --force gateway
```

Após a reversão, confirme que `funix-hml-gateway-1` não existe e que API/Web de
homologação continuam saudáveis na rede privada. Arquivos de configuração e
credenciais devem ser preservados para análise até a decisão de descartá-los;
o rollback do serviço não precisa apagá-los.
