# Migração administrativa de código HML (#274)

Roteiro para revisão e autorização independente. Usar o bundle integral do SHA
aprovado, root-owned, por canal administrativo. Preservar esse bundle, o
histórico e o journal até fechar a auditoria. Não executar os instaladores
históricos. O escopo é a troca dos 15 destinos fixos de código. Apenas o
transporte administrativo fica indisponível durante a troca. Pedidos interrompidos
seguem o [runbook de reconciliação](RECONCILIATION.md); recuperar o banco não
conclui automaticamente o pedido remoto.

## Bundle autorizado e verificação fora da VPS

Registrar o SHA integral do payload reconciliado, o SHA-256 do tar e a saída
dos 15 destinos do verificador no pré-voo. A autorização registrada para o
payload anterior `ee7a9f4a4305b2886c57548b14431a9cd025e5cf` identifica uma
revisão histórica. Submeter a nova identidade e a matriz à direção para
autorização independente antes da execução.

Em checkout confiável, com GitHub HTTPS validado e URL oficial, buscar a
referência da PR e confirmar que o SHA aprovado está na ancestralidade.
A aprovação do SHA deve vir da direção por canal independente. O verificador
confere bytes e pins e pressupõe objetos Git obtidos dessa fonte confiável.

```bash
set -eu
umask 077
: "${approved:?informe o SHA integral aprovado pela direção}"
git fetch https://github.com/Funix-CentroReparacaoAutomotiva/funixapp.git refs/pull/288/head
git merge-base --is-ancestor "$approved" FETCH_HEAD
git -c core.autocrlf=false archive --format=tar "$approved" deploy > funix-hml-deploy.tar
python3 -I deploy/remote-hml/verify-migration-bundle.py . "$approved" funix-hml-deploy.tar
```

O verificador regenera o tar esperado do Git, recusa divergência byte a byte
por SHA-256 e CRLF, confere as 12 entradas de `control.FILES` e o `PREP_SHA`
e imprime a matriz dos 15 destinos. Confrontar a saída com o inventário
privado do host e registrar os valores reais. No estado histórico descrito
pela #308, 13 dos 14 destinos legados existiam e `hml-official-update.py`
estava ausente. `hml-selection.py` é o 15º destino e deve estar ausente antes
do retry. A leitura autorizada do host deve confirmar esse estado.
Preservar o manifesto recuperado e os backups. As unidades e wrappers do
arquivo histórico são referência para conferência.

Na futura transferência autorizada, o operador recebe o SHA do tar por canal
independente e recalcula `sha256sum` **antes** de extrair. Qualquer diferença
bloqueia uso. Extrair somente em diretório de staging novo, canônico, root:root
0700, no caminho privado adotado para a janela. Usar `--no-same-owner
--no-same-permissions` e umask 077. Conferir root:root, ausência de escrita de
grupo/outros, links e o mapa de fontes novamente antes de chamar o migrador.
O arquivo aprovado não é uma aprovação administrativa de escrita.

## Fase 1 — Pré-voo somente leitura

**Responsável:** operador administrativo aprovado. **Evidência ao PO:** SHA do
bundle, comparação dos 15 destinos, modos, checks de estado e GO/NO-GO
sanitizado. Preservar o JSON integral de inventário em local privado.

- Começar pela sondagem física dos diretórios e journals com as ferramentas
  já instaladas e o acesso de leitura autorizado. Registrar somente a
  classificação sanitizada. Transferir ou extrair o bundle para staging é
  escrita administrativa e requer autorização própria, embora a ação
  `inventory` a partir de um bundle já conferido seja somente leitura.

- A partir do bundle conferido, executar como administrador
  `python3 -I deploy/remote-hml/migrate.py inventory`. Ele faz leitura lógica
  sob lock administrativo e lock oficial, ambos não bloqueantes. Confrontar
  todo `old/new` com o inventário e a matriz aprovados, inclusive as ausências.
  Usar `stat` e `namei -l` nos destinos e seus pais para confirmar
  caminhos canônicos, arquivo regular com link único, proprietário e grupo
  root e modos da matriz. Conferir diretórios privados 0700 e a integridade
  dos controladores e módulos instalados pelo mapa antigo. Validar separadamente
  as unidades, wrappers e sudoers históricos contra o inventário.
- Confirmar worker `inactive`, ausência física de aprovação armada,
  resultado terminal ligado ao apontador corrente, journal HML na fase
  esperada e transporte administrativo já ativo. Inventário bem-sucedido
  valida locks e `idle()` naquele instante. Classificar separadamente os
  diretórios `migration/` e `migration-retry/` exibidos como `migration` e
  `migration_retry`. A migração inicial exige ausência física de ambos. O
  retry exige original schema 1 em `restored`, sem hold ou drop-in anterior,
  e ausência física de `migration-retry/`. O inventário compara o staging e
  os backups históricos com os hashes do journal e informa `journal_sha256`.
  A abertura do retry também verifica os hashes e os modos dos arquivos
  instalados contra a restauração e confirma a ausência de `hml-selection.py`.
  Conferir a aprovação do preparador apenas em resumo, sem exibir ticket,
  token ou conteúdo privado.
- Conferir bytes e inodes livres com `df -PB1` e `df -Pi` nos sistemas de
  arquivos do staging, journal e destinos. Reservar espaço para o tar,
  a árvore extraída, a soma dos 13 originais e dos 15 arquivos novos,
  o maior temporário de substituição por filesystem e margem operacional.
- Confirmar HTTPS válido e saúde funcional de API/Web pelo procedimento HML
  existente. Confirmar GET mTLS normal pelo auxiliar em modo `status`, a
  partir da origem permitida com credenciais autorizadas. Registrar apenas
  resultado e consistência da revisão e do journal. A evidência anterior do
  PO e o status sanitizado do n8n são referências históricas.
- Abortar por divergência, contenção, estado não terminal, saúde degradada
  ou falta de acesso confirmado à prova completa pela origem permitida.

## Fases 2 e 3 — Autorização e troca

**Proprietário da decisão:** direção. **Executor:** operador nomeado, com
canal administrativo independente e tempo para contingência.

1. Submeter inventário instantâneo, identidade do pacote, prova de acesso
   de leitura pela origem admitida e plano de retorno à direção. Solicitar
   autorização independente para esse mapa e essa janela. Com a autorização,
   registrar em arquivo privado root 0600 o mapa exato indicado abaixo.
   Suspender solicitações administrativas na janela e preservar os registros
   existentes.
2. Escolher os comandos da tentativa identificada na tabela abaixo. Executar
   o comando de abertura com `python3 -I deploy/remote-hml/migrate.py` e
   `--authorize` somente na janela liberada. O migrador revalida `idle()`, o
   mapa e os pins dos candidatos antes de criar o journal, sob os dois locks.
   As fases são `staging`, `prepared`, `installing` e
   `awaiting_probe`. Registra backups e staging e grava hold/drop-in
   persistentes antes de substituir código. Conferir `awaiting_probe` e
   transporte normal parado. Se houver resultado ambíguo, preservar o hold
   e o journal e seguir a contingência.

| Tentativa | Arquivo de aprovação em `/var/lib/funix-hml-ops/` | Abertura | Prova | Aceite | Recuperação | Reversão |
|---|---|---|---|---|---|---|
| Inicial | `migration-approval.json` com `old` e `new` | `apply` | `probe` | `accept` | `recover` | `rollback` |
| Após restauração da #308 | `migration-approval-retry.json` com `old`, `new` e `prior_journal_sha256` | `retry-restored` | `probe-retry` | `accept-retry` | `recover-retry` | `rollback-retry` |

No retry, `old` e `new` abrangem os 15 destinos atuais. `prior_journal_sha256`
é o hash dos bytes do journal original conferido e aprovado. `migration-retry/`
recebe journal, staging e backups próprios. Preservar sem alterações o
journal, os backups, o staging e as aprovações originais. O retry deste
bundle exige a restauração legada da #308. Uma tentativa schema 2 restaurada
permanece arquivada em seu diretório para inspeção.

## Fase 4 — Prova mTLS e transferência da evidência

**Responsáveis:** operador da origem mTLS já autorizada e administrador root
do host, pelo canal de administração independente. A prova depende de acesso
a uma origem que o transporte permite e a um certificado cliente já
autorizado, com sua chave privada e CA dedicada. Confirmar essa capacidade no
pré-voo. Se apenas o workflow n8n sanitizado alcançar a origem, parar e
submeter a dependência ao PO antes de qualquer alteração de infraestrutura.
O n8n não fornece a prova completa nem autoriza a migração.

- No pré-voo, usar `python3 -I collect-migration-proof.py status "$gateway"
  "$ca" "$client_cert" "$client_key"`. O gateway é o IPv4 privado do
  transporte, que deve coincidir com o IP SAN do servidor. O auxiliar faz um
  GET direto na porta 18443, sem proxy ou redirecionamento, verifica a cadeia
  com a CA existente e exige autenticação do cliente. A chave deve ser
  privada e pertencer à identidade que executa o cliente.
- Na janela autorizada, em root e a partir do bundle conferido, executar o
  comando de prova da tentativa escolhida, por exemplo `probe-retry --authorize`.
  A unidade GET-only funciona por até 120 segundos. Confirmar que o transporte normal
  segue parado. O migrador guarda a identidade da invocação e o desafio
  no journal privado. O auxiliar devolve o corpo completo sem reescrever
  `migration_probe`.
- Preparar e validar previamente o canal SSH independente e já aprovado com
  host key conhecida e acesso root de escrita autorizado para a janela.
  Desabilitar tracing e gravação de entrada no cliente e no canal de
  administração. Capturar o GET em memória **antes** de abrir o comando de aceite:
  ambos precisam do lock administrativo. Evitar arquivos, clipboard, argv
  externo, ambiente exportado e logs para o corpo. Exemplo para Bash na
  origem aprovada com acesso a ambos os canais, substituindo somente caminhos
  e identidades previamente conferidos. O exemplo usa o comando para o retry
  da #308. Para a tentativa inicial, usar `accept`.

```bash
(
  set +x
  set -o pipefail
  proof=$(python3 -I collect-migration-proof.py probe "$gateway" "$ca" "$client_cert" "$client_key") || exit 1
  # printf é builtin. Corpo segue exclusivamente para stdin do canal.
  builtin printf '%s' "$proof" | ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes "$admin_ssh" \
    '/usr/bin/python3 -I /root/funix-hml-approved/deploy/remote-hml/migrate.py accept-retry --authorize'
)
```

O administrador root responde pela origem da evidência e a entrega diretamente
ao CLI. O trecho SSH presume login root já aprovado e o caminho verificado
do bundle. Se o canal existente exigir outro método autorizado de elevação ou
separar os operadores, a direção deve confirmar previamente a forma de
transferir stdin sem gravar o corpo. Não copiar tokens, certificados, chaves,
desafios ou tickets para GitHub, logs ou chat.

O coletor exige HTTP 200, schema/escopo corretos, journal terminal, ausência
de aprovação armada e desafio bem formado. Sob locks, `accept` compara o
desafio e a invocação ativa, o estado atual e o snapshot da prova, incluindo
o journal e o último resultado. Resposta expirada, divergente ou reutilizada
não fecha o aceite. Erro de TLS, rejeição ou timeout mantém o hold. Se a
prova não chegar, a unidade transitória expira. Após inspeção, usar nova prova
ou contingência autorizada. Não iniciar `accept` com saída sanitizada.

## Fase 5 — Aceite e verificação

**Responsáveis:** operador e PO. **Evidência:** status do migrador, hashes e
modos dos 15 destinos, revisão e journal preservados, worker inativo, GET
mTLS normal e saúde funcional/HTTPS. O CLI valida código e backups, para
a unidade transitória, persiste `accepted` e libera o transporte normal.
Conferir de novo o GET em modo `status` e o estado esperado. Se o start falhar,
o migrador repõe o hold. Se falhar a verificação pós-aceite, interromper
solicitações e acionar o procedimento de reversão com autorização separada.

## Fase 6 — Interrupção e reversão de código

**Responsáveis:** operador preserva evidência e isolamento. A direção decide
a recuperação ou reversão em autorização separada. O PO confere fase,
inventário final, resultado mTLS e saúde antes de retomar solicitações.

- **Recovery.** Usar `recover --authorize` para a tentativa inicial deste
  bundle ou `recover-retry --authorize` para o retry vinculado ao histórico.
  Preservar todos os arquivos. Antes do primeiro journal, o staging incompleto
  é arquivado sob outro nome sem tocar nos destinos. Temporários residuais
  não bloqueiam a próxima gravação atômica. Se houve troca parcial, o migrador
  mantém o transporte bloqueado, verifica backups e modos, restaura os bytes
  antigos, valida e grava `restored` antes de reabrir. Para reconciliar uma
  fase terminal com prova registrada, o journal operacional e o último
  resultado devem coincidir com o snapshot da prova. A fase `accepted`
  sempre exige esse snapshot. Divergência mantém ou repõe o hold e
  bloqueia o start. Uma restauração anterior à prova pode ser reconciliada
  com o código antigo validado. Em ambiguidade, não reexecutar apply,
  apagar o journal ou remover o hold. Um journal legado schema 1 pendente
  na transação original ou no retry exige inspeção e, quando autorizada,
  recuperação com o bundle legado verificado e seu comando correspondente.
  O migrador reconciliado recusa operar sobre esse journal pendente. Após
  a recuperação legada, voltar ao pré-voo com inventário atualizado.
- **Rollback após `accepted`.** Registrar autorização separada
  `{"id":...,"old":...,"new":...}` do journal exibido pelo inventário em
  `/var/lib/funix-hml-ops/migration-rollback-approval.json`, root 0600.
  Para o retry, incluir `prior_journal_sha256` e usar
  `migration-rollback-approval-retry.json` no mesmo diretório. Executar o
  comando de reversão indicado na tabela com `--authorize`.
  A reversão confere que o estado operacional continua igual ao do aceite.
  Recusa drift de código, modos e backups. A fase `rollback` permite retomar
  uma reversão já autorizada com recovery. Os módulos antes ausentes só são
  removidos se ainda têm os bytes aprovados. Confirmar SHA-256 e modos antigos,
  as ausências registradas e o GET mTLS após a restauração.
- **Preservação** — Não mexer em SQLite, Docker, credenciais, certificados,
  contas, sudoers, configurações n8n ou journals operacionais. A migração
  mantém os locks e registra somente sua própria transação. A única alteração
  persistente de systemd é a condição dedicada do transporte. Uma falha de
  validação ou divergência exige inspeção administrativa com o canal bloqueado.

Antes de qualquer futura autorização de atualização, preparar formalmente o
novo candidato para gerar `prepared.json`; aprovações anteriores não são
convertidas. A conferência do host e qualquer execução operacional exigem
autorização separada.

## Registro de um novo candidato

A versão em revisão do controlador oferece `rootctl.py register-candidate`
para o canal administrativo. O comando recebe um objeto JSON pela entrada
padrão com `pr`, `run_id`, `attempt`, `artifact_id`, `revision`, `sha256`
e `size`. O servidor determina a revisão instalada a partir do journal.
A resposta `candidate_registered` confirma a gravação da seleção. A
preparação, a aprovação de uso único e o despacho continuam etapas distintas.

Para substituir o PowerShell na rotina, o próximo incremento precisa de um
canal remoto de autorização independente do executor n8n. Esse canal deve
registrar o candidato, obter o recibo de preparação e aprovar a prévia exata.
O n8n então despacha o ticket pelo mTLS existente e acompanha o estado até
`accepted` ou `auto_restored`. O aceite da liberação exige uma revisão
diferente da instalada, com backup, HTTPS e serviços externos conferidos.

O piloto desta VPS já consumiu a tentativa de migração e sua repetição.
A instalação de outro controlador precisa de uma migração que parta do
inventário aceito. Os journals de migração existentes fazem parte da trilha.

## Autorizar pela interface do GitHub

A atualização acrescenta a rota mTLS `POST /v1/authorize`. O n8n apresenta
documentos assinados para registrar o candidato e, depois da preparação
pelo SSH restrito, emitir o ticket. O GitHub Actions assina a identidade
completa do artefato e a revisão instalada. Cada autorização para emitir
ticket vale por vinte minutos e só pode ser usada uma vez. O despacho
continua em `POST /v1/update` com o ticket devolvido por `GET /v1/status`.

Antes de liberar o workflow de assinatura, configurar no GitHub o ambiente
`hml-authorization` para a branch `main`, com aprovadores designados,
prevenção de autoaprovação e proibição de contornar a proteção. Armazenar
a chave Ed25519 privada somente como segredo desse ambiente, com o nome
`HML_PERMIT_SIGNING_KEY`. Na VPS, instalar apenas a chave pública em
`/var/lib/funix-hml-ops/permit-public.pem` com modo 0600 e criar
`/var/lib/funix-hml-ops/permits` com modo 0700, ambos root:root. A credencial
mTLS permanece no n8n. Os documentos assinados viajam como artefatos do
workflow. Seu uso exige mTLS e a origem já autorizada pela VPS.

A migração começa com `inventory-upgrade`. Conferir a saída com os
hashes da revisão aprovada e registrar o JSON retornado no arquivo privado
`migration-controller-permits-approval.json`, no diretório de operações.
Usar `apply-upgrade`, `probe-upgrade` e `accept-upgrade` com
`--authorize` e a prova mTLS do transporte de ensaio. A recuperação usa
`recover-upgrade` com a mesma revisão. O novo journal vincula o histórico
da migração anterior aceita. Aprovações anteriores não são válidas para
esta atualização.

Para a primeira execução, selecionar um artefato novo e aprovado, solicitar
o workflow de assinatura, enviar `register.json` ao controlador, executar
o preparador, enviar `arm.json` e acionar a atualização existente no n8n.
Conferir o resultado do worker pelo mesmo identificador de operação.
Um bloqueio expirado ou interrompido deve ser inspecionado antes de pedir
novos documentos.
