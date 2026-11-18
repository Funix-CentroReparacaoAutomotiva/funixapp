# Homologação: diagnóstico e publicação do gateway

## Estado vigente — publicação validada pelo operador (17/11/2026)

A homologação foi publicada em https://hml.funix.com.br, com revisão
`8e801e9b0a8fc1fe5feec40d533d9e639e8b013b`. Esta seção prevalece sobre
os diagnósticos e roteiros históricos abaixo (inclusive a afirmação antiga de
que o gateway não teria HEALTHCHECK). Não executar os roteiros de criação,
remoção ou ensaio com gateway ausente sobre a instalação atualmente publicada.
Esta atualização documental e de configuração versionada não acessa a VPS,
não executa merge/deploy e não declara homologação funcional completa.

### Evidência e correção

O gateway usa a imagem Web que herda um HEALTHCHECK com wget em /healthz
na porta 8080. A autenticação obrigatória do gateway faz a rota retornar
401 sem credenciais. A configuração planejada não sobrescrevia o teste
herdado. Em ensaio ativo anterior, as labels efetivas e as redes estavam
corretas, os testes diretos passaram e sete sondas HTTPS sem credenciais
retornaram 404 e o mesmo certificado não confiável (verify_code=18).
Não há histórico de saúde preservado do contêiner anterior.

O ensaio controlado V2, com alteração exclusiva do healthcheck, observou:

| Segundos | Saúde | HTTP sem credencial | TLS confiável |
| --- | --- | --- | --- |
| 0 | starting | 404 | não |
| 6 | healthy | 401 Basic | não |
| 12 | healthy | 401 Basic | sim |

A reversão do ensaio foi confirmada. A publicação seguinte persistiu o
healthcheck, manteve a autenticação e validou HTTPS em loopback, IP da VPS
e externamente pelo Windows. As rotas /, /api/ready, /release.json e
/healthz retornaram 401 Basic sem credenciais; os testes autenticados
internos e HTTPS confirmaram a mesma revisão da API, Web e release. O
gateway permaneceu healthy e ativo. As conferências dos demais serviços
e arquivos retornaram inalterados. Fonte: relatórios fornecidos pelo
operador, funix_hml_healthcheck_teste_v2_resultado.txt e
funix_hml_publicacao_definitiva_resultado.txt. A transição de 404 para
401 com o estado healthy é evidência causal forte da incompatibilidade
do healthcheck herdado; não reconstrói seu estado histórico. Não foi
necessário alterar Traefik, DNS ou configuração produtiva.

### Contrato versionado somente HML

O fragmento [deploy/hml-gateway-healthcheck.compose.json](../../deploy/hml-gateway-healthcheck.compose.json)
contém exatamente o healthcheck validado e atua somente em services.gateway.
Formato JSON aceito como YAML/Compose; não é um Compose completo nem um
instalador. A configuração efetiva já foi persistida pelo operador em
/opt/funix-hml/gateway.compose.yaml. Não aplicar novamente ao gateway
ativo apenas por existir este fragmento no Git. O backup original foi
preservado na VPS. SHA-256 do gateway.compose.yaml persistido conforme
relatório: 9b66a5f1f87188defc3334201123ace9fe992de0aafaadca3a73831145f7b068.

O teste local do Nginx reconhece 401 sem enviar senha. Isso comprova
resposta local compatível com a barreira de autenticação, não saúde dos
backends nem cadeia TLS, nem valida isoladamente o desafio Basic.
Os smoke tests autenticados e externos continuam obrigatórios. Não
usar este healthcheck nas imagens Web/API de produção, desativar a
autenticação de /healthz ou configurar healthcheck Traefik sem credencial
sobre a rota protegida. Manter os upstreams exclusivos
funix-hml-api-1:8787 e funix-hml-web-1:8080.

Antes de uma atualização autorizada, comparar a configuração normalizada
do projeto funix-hml no servidor com o contrato versionado; nunca imprimir
o Compose expandido ou variáveis de ambiente. Se houver divergência,
bloquear e revisar. O arquivo completo de operação da HML não está
versionado nesta PR; não substituir a configuração instalada por um
fragmento ou pelo compose.yaml produtivo.

Validação desta contribuição: dois testes unitários locais verificam a
estrutura isolada, o contrato exato e o comando shell com wget simulado
(401 aceito; 200, 404, 500 e falha de conexão rejeitados). O teste real
de Compose/Docker/Traefik é a evidência operacional anterior, não uma
nova execução desta PR. O CI do novo commit deve ser conferido.

### Próxima entrega: atualização por revisão da homologação (proposta)

O workflow .github/workflows/funix.yml valida PRs, mas o job publish
só publica imagens de main; deploy requer despacho manual de main com
deploy=true e usa o ambiente production. Portanto, ainda não há fluxo
aprovado para publicar uma revisão de PR diretamente na HML. Não usar
deploy produtivo, não fazer merge para obter um artefato de teste e não
copiar a chave SSH de root para o GitHub.

Implementar a atualização em mudança separada, com CI de ponta a ponta
em ambiente sintético, antes de habilitar qualquer acesso remoto:

1. Selecionar SHA imutável de PR revisada, aprovada nos checks da
   revisão exata. Construir API e Web dessa mesma revisão e publicar
   artefatos de HML separados dos packages produtivos, com digests
   vinculados ao SHA e permissões mínimas. Sem secrets produtivos no
   código de PR; nenhum workflow privilegiado executa código não
   confiável. A primeira implementação deve exigir despacho/autorização
   explícita e nunca atualizar automaticamente a produção.
2. Preparar manifesto SHA/digests, sem segredo. Preferir operação SSH
   restrita, própria da HML, com comando fixo e sem shell arbitrário,
   sem sudo genérico, sem Docker socket exposto e com validações de
   alcance. Se ainda não estiver implantado, usar procedimento manual
   revisado pelo administrador; não compartilhar chave privada.
3. Pré-check do Compose instalado: projeto funix-hml, redes privadas,
   gateway exclusivo com healthcheck acima, origem hml.funix.com.br,
   armazenamento e credenciais separados, ausência de integrações
   externas reais. Confirmar identidade e revisão atual, capacidade,
   backup consistente do SQLite HML e compatibilidade de migrações.
4. Com autorização, baixar somente os digests candidatos; serializar
   operação, registrar release anterior e trocar exclusivamente
   API/Web/gateway da HML conforme dependências. Gateway usa imagem
   Web: ao mudar a imagem Web, preservar também seu override e
   autenticação. Admitir breve indisponibilidade da HML; não usar
   compose down, prune ou alterar serviços compartilhados.
5. Validar serviços healthy, DNS/TLS estrito, 401 Basic nas quatro rotas,
   autenticação da aplicação e igualdade da revisão; em falha, restaurar
   a configuração e imagens anteriores, inclusive banco de HML se
   necessário mediante backup e compatibilidade previamente validados.
   Rollback de imagem não basta se a migração for incompatível.
6. Entregar o endereço protegido e a revisão para aprovação funcional
   da direção com dados sintéticos. Registrar resultado e só então
   discutir implantação produtiva separada, sujeita à aprovação.

Este fluxo é uma especificação de aceite, não automação já implantada.
Nenhuma modificação de workflow, credencial, produção ou VPS foi feita
nesta regularização.

---

## Histórico de investigação (preservado; não constitui instrução vigente)

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

## Evidência posterior à reversão

Com o gateway ausente, foi confirmado: A `hml.funix.com.br` =
`2.25.144.201`; TCP 443 acessível por loopback e IP público; Traefik ouvindo em
IPv4 e IPv6; `websecure=:443`; e `letsencrypt` configurado para HTTP-01 no
entrypoint `web`. O servidor apresentou `TRAEFIK DEFAULT CERT`, reprovado com
`verify_code=18`, e a busca filtrada não encontrou logs de homologação.

Isso confirma o caminho TCP/entrypoint no momento da coleta, mas não reproduz
a janela da falha. Certificado padrão e ausência de logs são esperados quando
o provider já removeu o router junto com o gateway. Não comprovam falha ACME,
router inválido ou sucesso anterior. Ainda faltam a resposta AAAA completa, a
confirmação de que o A é o IP público esperado e a acessibilidade pública da
porta 80 usada pelo HTTP-01. Nenhum bloqueador da publicação ficou confirmado
por essa coleta.

## Evidência da publicação controlada seguinte

O procedimento autorizado iniciou o gateway, validou API, Web, Basic Auth e
as três revisões, mas as 42 tentativas HTTPS em loopback e `2.25.144.201`
pararam na validação do certificado com `verify_code=18`. Nenhuma chegou ao
HTTP. A reversão confirmou a remoção exclusiva do gateway. O script executado
tinha SHA-256
`aa30a5774656bd3381e749de8a6e852aa9d0f74fe3f5c2defb9adb4475a49d2f`.

Isso confirma que o certificado padrão permaneceu durante toda a janela
observada. Ainda não distingue router ausente/rejeitado, provider sem observar
o contêiner, labels efetivas divergentes ou router carregado com erro ACME. O
filtro de logs anterior aceitava apenas linhas com domínio ou `funix-hml` e
podia omitir mensagens genéricas do provider/resolver; `[]` não prova ausência
de erros.

## Diagnóstico único, somente leitura, com gateway ausente

O utilitário `deploy/hml-traefik-readonly.py` deve ser revisado antes de uma
execução manual autorizada. Ele exige a janela UTC exata da tentativa anterior:

```bash
python3 deploy/hml-traefik-readonly.py \
  --since 'INICIO_UTC_DA_TENTATIVA' \
  --until 'FIM_UTC_DA_TENTATIVA' \
  --gateway-compose /opt/funix-hml/gateway.compose.yaml \
  > funix-hml-traefik-diagnostico.json
```

Ele executa somente `docker container inspect`, `docker network inspect` e
`docker logs` com limites `--since/--until`. Falha se o gateway existir. Não
executa `compose`, `exec`, `up`, `restart`, chamada à API do Traefik ou leitura
do socket por conta própria. A saída contém:

- estado/identidade opaca do Traefik, presença e modo do mount do Docker
  socket, participação em `traefik_default` e destinos de mounts, nunca suas
  origens;
- somente opções relevantes encontradas em argumentos/ambiente: Docker
  `watch`, `exposedByDefault`, `constraints` e endpoint; endereços dos
  entrypoints; storage/entrypoint do resolver. Endpoint, storage e constraints
  são representados apenas por presença e hash;
- SHA-256 do Compose de homologação e projeção de labels/redes/portas; qualquer
  valor Basic Auth é removido;
- contagens de warnings/erros da janela nas categorias provider Docker,
  router/service, ACME/certificado e rede, mais horário e hash de cada evento.
  O texto do log, hostnames e nomes de recursos não são emitidos.

Sem ativar o gateway, essa coleta pode confirmar que o Traefik está `Running`,
monta o socket, participa da rede, quais opções estáticas vieram de argumentos
ou ambiente, se a rede existe, se o Compose planejado contém o contrato
esperado e se houve categoria de erro preservada na janela. Pode confirmar um
bloqueador concreto como `watch=false`, socket ausente, rede ausente,
`exposedByDefault=false` sem `traefik.enable=true`, entrypoint/resolver
divergente ou labels planejadas incompletas.

Ela não lê conteúdo de arquivo estático montado. Portanto, opção ausente da
seção `static_from_args_or_env` significa **desconhecida**, não valor padrão.
Também não pode reconstruir labels efetivamente aplicadas ao contêiner já
removido, provar que `funix-hml@docker` carregou, inspecionar a associação
dinâmica histórica, provar acesso externo à porta 80 ou diagnosticar um erro
cujo log já saiu da retenção. Esses pontos continuam impossíveis com o gateway
ausente sem snapshot preservado da janela.

Não autorizar nova publicação apenas porque a coleta não encontrou eventos.
Uma nova tentativa passa a ser justificável se a projeção não mostrar
bloqueador, a janela de logs estiver disponível e revisada, as labels tiverem
router TLS, `certresolver=letsencrypt`, service explícito, porta 8080 e rede
`traefik_default`, e houver método aprovado para preservar inspect/configuração
efetiva durante a próxima janela. Se um bloqueador for confirmado, a mudança
deve ser mínima e específica: corrigir apenas a label/configuração de
homologação; para `watch=false`, socket/provider inacessível ou configuração
estática do Traefik, parar e submeter uma mudança de infraestrutura separada,
pois esta PR não autoriza alterar/reiniciar o Traefik compartilhado.

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
| Loopback não alcança o entrypoint | Enfraquecida: loopback e IP público alcançaram 443 após a reversão | Só volta a ser relevante se a coleta instrumentada mostrar recusa/timeout |
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
HTTP, fingerprint SHA-256 do certificado verificado e presença de desafio Basic. Não imprime corpo, cookies, Authorization
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

## Procedimento único para uma publicação futura autorizada

Este é um roteiro para revisão; não foi executado por esta PR. Uma autorização
futura deve cobrir uma única janela. Antes dela, o operador registra horário
UTC e identidade/`StartedAt` do Traefik, sem reiniciá-lo, e comprova:

1. gateway ausente; Web e API existentes continuam `healthy`;
2. DNS A e AAAA completos, A correspondente ao IP esperado e TCP público 80 e
   443 acessíveis (HTTP-01 depende de `web`, não apenas de `websecure`);
3. configuração Compose renderizada, limitada ao gateway, com
   `traefik.enable=true`, `traefik.docker.network=traefik_default`, regra Host
   para `hml.funix.com.br`, entrypoint `websecure`, `tls=true`,
   `tls.certresolver=letsencrypt`, router e service exclusivos da homologação,
   associação explícita router → service, e
   `loadbalancer.server.port=8080`;
4. gateway ligado somente a `funix-hml_privada` e `traefik_default`, sem porta
   publicada no host. Não configurar healthcheck do load balancer em rota
   protegida que devolve 401 sem credencial.

Depois de iniciar **somente** o serviço gateway pelo comando Compose já
revisado, registrar separadamente, sem segredos:

1. `docker inspect` projetado: `Running`, redes, ausência de host ports e as
   labels acima. Labels planejadas/inspect não provam que o router carregou;
2. mensagens do provider e ACME desde o marcador UTC, filtradas por
   `funix-hml`, `hml.funix.com.br` ou erro correlacionável. Guardar categoria e
   horário, não logs brutos nem configuração produtiva;
3. evidência de router carregado: preferencialmente snapshot sanitizado de
   `funix-hml@docker`; sem API/dashboard, correlação do evento do provider com
   TLS válido e 401 serve como evidência operacional, deixando essa limitação
   registrada;
4. espera limitada, mantendo todas as tentativas:

       python3 deploy/hml-gateway-validate.py \
         --diagnose-https \
         --https-attempts 36 \
         --https-interval 5 \
         --expect-status 401 \
         --expect-basic

São no máximo cerca de três minutos, além dos timeouts de rede. Cada tentativa
refaz DNS e testa loopback e todos os A/AAAA com TLS estrito, SNI/Host de
homologação. Certificado não confiável continua sendo falha; não usar `-k`,
contexto inseguro ou inspeção de `acme.json`. O relatório conserva, por
tentativa, conexão, categoria TLS/certificado, `verify_code`, certificado
verificado, status e desafio Basic. Atingir o limite encerra com falha, sem
ocultar a última observação.

Somente após TLS/401 aprovado, executar os testes autenticados já documentados:
senha incorreta = 401; Web, API e release = 200; e o validador de revisões no
caminho direto e no hostname HTTPS. Registrar valores/tipos/comparações, nunca
o cabeçalho Authorization. Uma falha 404 indica seleção de router; 502/503/504
indica associação/service/rede/backend; erro de certificado impede inferir o
status HTTP; erro ACME deve ser citado literalmente apenas após sanitização.

### Aceite ou reversão

Aceitar somente se, na mesma janela: router `funix-hml@docker` estiver
carregado sem colisão/erro; nenhum erro ACME pendente; cadeia e hostname do
certificado forem validados; loopback e cada A/AAAA devolverem 401 com desafio
Basic; senha errada devolver 401; respostas autenticadas devolverem 200; e as
três revisões SHA-40 forem idênticas. O gateway deve estar `Running`, nas duas
redes exatas, sem host ports, e Traefik deve alcançar gateway:8080.

Se qualquer item falhar, primeiro preservar os registros sanitizados da janela
e então executar apenas o equivalente revisado de `docker compose rm --stop
--force gateway` no projeto `funix-hml`. Confirmar gateway ausente e Web/API
inalteradas. Não usar `compose down`, não remover redes/volumes, não reiniciar
Traefik, não apagar certificado e não tocar na produção.

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
