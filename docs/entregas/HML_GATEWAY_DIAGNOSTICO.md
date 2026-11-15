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

O fluxo da aplicação está coerente. A API recebe `FUNIX_REVISION` no Compose e
expõe o valor em `/api/ready`. A imagem Web grava `APP_REVISION` em
`/release.json` no build. O Nginx da imagem Web rejeita `/api`; no desenho de
homologação, o gateway precisa encaminhar `/api` para `api:8787` e o restante
para `web:8080`. Os dois HTTP 200 autenticados confirmam que essas rotas
responderam, mas não registram quais revisões foram comparadas naquele instante.

## Correção proposta

`deploy/hml-gateway-validate.py` é um substituto somente leitura para a parte de
validação. Ele:

1. exige um SHA completo de 40 caracteres no arquivo de release;
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
  --release-key FUNIX_RELEASE \
  --credentials-file /etc/funix-hml/gateway-login-temporario.txt \
  --connect-host "$GATEWAY_IP" \
  --port 8080 \
  --host-header hml.funix.com.br
unset GATEWAY_IP
```

Se o arquivo usar outro nome para a variável, ele deve ser passado de forma
explícita em `--release-key`; não se deve tentar adivinhar entre variáveis.

## Informações ainda necessárias da VPS

Para fechar a causa exata e revisar uma publicação, são necessários apenas
artefatos de homologação, todos sem segredos e sem conteúdo do SQLite:

- o arquivo original e não truncado do programa, incluindo todo o fluxo que
  atribui ou reutiliza `revision`, não apenas as duas expressões de comparação;
- `/opt/funix-hml/gateway.compose.yaml` e
  `/etc/funix-hml/gateway-nginx.conf` completos;
- os nomes das variáveis e os digests de imagem de `release.env`, com qualquer
  credencial omitida (o histórico indica que esse arquivo contém somente
  release/imagens, mas isso precisa ser confirmado);
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

O operador pode executar estas verificações somente sobre homologação. Elas não
fazem pull, build, restart, `up`, `down`, `rm` ou escrita em volume:

```bash
docker compose \
  --project-name funix-hml \
  --env-file /opt/funix-hml/release.env \
  -f /opt/funix-hml/compose.yaml \
  -f /opt/funix-hml/gateway.compose.yaml \
  config --quiet

docker inspect --format '{{json .NetworkSettings.Networks}}' \
  funix-hml-api-1 funix-hml-web-1 funix-hml-gateway-1

docker inspect --format '{{json .HostConfig.PortBindings}}' \
  funix-hml-api-1 funix-hml-web-1 funix-hml-gateway-1

docker inspect --format '{{.State.Health.Status}}' \
  funix-hml-api-1 funix-hml-web-1 funix-hml-gateway-1
```

Critérios: os três contêineres estão saudáveis; API e Web pertencem somente à
rede privada; o gateway pertence à rede privada e à rede externa do Traefik;
nenhum deles publica porta no host; somente o gateway tem labels do hostname de
homologação; e o validador acima aprova os dois endpoints. Um teste sem
`Authorization` deve retornar 401 em `/`, `/api/ready`, `/release.json` e
`/healthz`; com credencial, os três primeiros devem retornar 200. `/healthz`
também deve permanecer protegido externamente.

Antes de atribuir qualquer falha a cache, repita cada GET com um query string
único e registre `Date`, `Age`, `Via`, `Server` e um hash do corpo, sem registrar
`Authorization`. O gateway deve enviar `Cache-Control: no-store` para
`/api/ready` e `/release.json`. A resposta posterior já reduz muito a
probabilidade de cache, mas essa coleta a elimina de forma objetiva.

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
Confirme também 401 sem credencial. Nenhum comando deve nomear, reiniciar ou
inspecionar contêineres de produção.

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
