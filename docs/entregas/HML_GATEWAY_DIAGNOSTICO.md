# Homologação: diagnóstico e publicação do gateway

## Atualização: HTTPS após correção dos upstreams

Segundo o ensaio relatado pelo responsável, trocar os upstreams genéricos por
funix-hml-api-1:8787 e funix-hml-web-1:8080 resolveu a divergência das revisões,
inclusive com o gateway temporário conectado às duas redes. Isso sustenta
ambiguidade dos aliases Docker api/web nas redes compartilhadas; o DNS Docker
do instante original não foi inspecionado. A configuração e seu backup já foram
instalados pelo responsável. Esta PR não altera Nginx ou arquivos da VPS.
O histórico abaixo registra as conclusões anteriores a essa nova evidência.

Todos os testes diretos 401/200 e revisões passaram na última tentativa.
A nova falha foi somente HTTPS. A mensagem genérica não identifica se houve
recusa TCP, erro TLS, certificado inválido ou status HTTP inesperado.
A causa HTTPS permanece não confirmada.

## Validade do teste em loopback

TCP em 127.0.0.1:443 com TLS server_hostname=hml.funix.com.br e Host igual é
correto para testar o Traefik local **se a publicação 443 incluir loopback**.
SNI seleciona certificado; Host participa da seleção do router HTTP.
Esse teste ignora DNS A/AAAA, firewall externo, eventual proxy/CDN e caminho
externo. Seu resultado não comprova a acessibilidade pública.

Docker pode publicar 443 somente em um IP específico ou em outra família.
Publicação via NAT pode funcionar sem aparecer como processo em ss.
Esperar 401 e descartar todos os erros não permite atribuir falha ao
Let's Encrypt. Repetições também misturam indisponibilidade transitória,
certificado inválido e roteamento incorreto sem indicar qual ocorreu.

O validador autenticado da PR usava HTTPSConnection(connect_host), que também
usa connect_host como SNI, independentemente de Host. Agora esse modo exige
connect-host igual a host-header em HTTPS. O novo modo diagnóstico separa
explicitamente IP TCP de SNI/Host, ambos fixados em homologação.

## Hipóteses priorizadas para investigação

Ordem por aderência ao sintoma e custo de verificação; não há evidência para
declarar qual causa é mais provável com certeza.

| Hipótese | Evidência favorável e limite | Discriminador |
| --- | --- | --- |
| Router/service inválido ou não carregado | Gateway direto passa; cadeia Traefik não foi validada | TLS válido + 404/502/503; erro do provider e configuração efetiva |
| Loopback não alcança o entrypoint | Único destino testado foi 127.0.0.1; bind real desconhecido | Recusa/timeout TCP; comparar publicação 443 e IPs DNS |
| Certificado padrão, cadeia não confiável ou emissão pendente | Hostname novo pode receber certificado padrão; erro TLS perdido | Categoria certificate e verify_code; certificado público apresentado |
| DNS A/AAAA aponta para outro caminho | Não afeta diretamente loopback; pode afetar ACME/acesso público | Comparar A/AAAA com destinos esperados e testar cada IP com mesmo SNI |
| Rede/porta errada entre Traefik e gateway | Duas redes; teste direto não prova seleção pelo Traefik | 502/503/504, server.port e traefik.docker.network |

websecure e letsencrypt são nomes configuráveis, não garantias de existência.
Só atribuir falha ao resolver após identificar erro ACME específico.
Um healthcheck Traefik em /healthz sem credencial recebe 401 e pode excluir
o backend, causando 503: verificar se essa opção foi herdada. Não criar
exceção pública de autenticação como solução automática.

## Procedimento mínimo manual, sem gateway e sem credenciais

Executar somente após autorização, na VPS, com gateway ainda ausente:

    python3 deploy/hml-gateway-validate.py --diagnose-https

Não lê release, senha, token, banco ou arquivo de certificado. Resolve apenas
hml.funix.com.br pelo resolver do sistema; faz um GET sem autenticação em /
para loopback e cada A/AAAA distinto, uma vez por endereço, com timeout de seis
segundos por operação. Usa validação TLS padrão de cadeia/hostname, sem fallback
inseguro, redirects ou retries. Não usa o hostname de produção.

A saída JSON por linha preserva destino, horário UTC, etapa, categoria/errno,
verify_code quando disponível, SAN/validade/protocolo quando TLS passa, status
HTTP e presença de desafio Basic. Não imprime corpo, cookies, Authorization
ou texto arbitrário de exceções. Não modifica Docker/Traefik.

| Resultado | Interpretação e próximo dado |
| --- | --- |
| dns | Resolver falhou; obter A/AAAA esperados e resposta do resolver |
| tcp + recusa/timeout | TLS não alcançado; obter bind 443/publicação Docker |
| tls | Handshake/protocolo falhou; confirmar serviço atendendo o destino |
| certificate + verify_code | Certificado reprovado; não há status HTTP; obter metadados públicos e erro do resolver se houver |
| TLS válido + 404 | Router ausente ou outra origem de 404; não é falha de certificado |
| TLS válido + 401 e Basic | Compatível com gateway protegido; correlacionar router/service antes de concluir |
| TLS válido + 502/503/504 | Investigar service, porta, rede, disponibilidade e healthcheck; status isolado não identifica origem |
| TLS válido + 200/3xx | Rota/autenticação inesperada; não aceitar nem seguir redirect |

Com gateway ausente, o provider Docker normalmente retira router/service.
404 ou certificado padrão podem ser esperados. Não exigir 401 nesse estado,
emitir certificado ou recriar gateway para fazer a coleta passar.
Saída zero significa coleta sem erro DNS/TCP/TLS/transporte HTTP, **não aceite
da homologação**; HTTP inesperado permanece registrado. Se TLS falha, não há
tentativa insegura de alcançar HTTP. Acesso da VPS aos IPs públicos pode sofrer
hairpin NAT; o caminho externo requer observação em rede externa autorizada.

Complementos mínimos sanitizados, escolhidos pela etapa que falhar:

1. TCP: publicação efetiva de 443 (HostIp/HostPort), endereço do entrypoint
   websecure e resultado de ss -ltn '( sport = :443 )'. ss isoladamente não
   descarta NAT Docker.
2. DNS/TLS: A/AAAA esperados e observados; SAN, emissor, validade e fingerprint
   SHA-256 do certificado público para SNI de homologação. Se TLS falha, a
   sonda não captura certificado não verificado; esses metadados exigem
   inspeção manual aprovada. Não ler armazenamento ACME privado.
3. Roteamento: labels planejadas somente de funix-hml, rule Host, entrypoints,
   tls, certresolver, service, server.port, traefik.docker.network, nomes de
   middlewares e healthcheck sem headers. Confirmar websecure e letsencrypt
   na configuração estática (tipo de challenge/entrypoint, sem segredos).
4. Se disponível, snapshot anterior à reversão do router/service funix-hml@docker,
   rede selecionada e erro de configuração. Caso não exista, fornecer mensagens
   sanitizadas da janela da falha referentes à homologação: colisão de nomes,
   entrypoint/resolver inexistente, erro ACME ou backend. A ausência atual do
   router não explica seu estado anterior. Não habilitar dashboard/API para
   obter essa informação.

O responsável fornece somente a projeção necessária: não compartilhar inspect
completo, env, acme.json, hashes Basic Auth ou logs brutos. Verificar colisões
de nomes de routers/services/middlewares sem divulgar configuração produtiva.
Revisar associação router → service → gateway:8080 pela rede traefik_default;
API/Web permanecem privadas. A configuração dinâmica efetiva não existe no
repositório; labels planejadas não provam o que Traefik carregou.

## Critério para nova tentativa e reversão

Antes de outra publicação: identificar a categoria da falha ou recuperar erro
histórico, revisar configuração planejada/estática pertinente, eliminar
colisões, confirmar caminho TCP e A/AAAA esperados. Se a evidência foi perdida,
registrar a lacuna e submeter ensaio controlado instrumentado à autorização
específica; não repetir o script opaco como descoberta inicial.

Após autorização separada, exigir gateway Running, upstreams específicos,
rede/porta corretas, TLS confiável para homologação, 401 com Basic sem senha,
401 com senha incorreta e 200/revisões corretas autenticadas, tanto no caminho
direto quanto no público pertinente. Preservar cada erro/status e interromper
na etapa identificada. O rollback ao final deste documento remove somente
gateway, sem parar Web/API, reiniciar Traefik, alterar DNS/certificados ou usar
compose down. Com gateway ausente, não há mudança desta investigação a reverter.

## Histórico anterior à correção dos upstreams

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
homologação, o gateway deve encaminhar `/api` para `funix-hml-api-1:8787` e o restante
para `funix-hml-web-1:8080`. Os dois HTTP 200 autenticados confirmam que essas rotas
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
