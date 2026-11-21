# Migração administrativa de código HML (#274)

Roteiro para revisão e autorização independente. Usar o bundle integral do SHA
aprovado, root-owned, por canal administrativo. Preservar esse bundle, o
histórico e o journal até fechar a auditoria. Não executar os instaladores
históricos. O escopo é a troca dos 15 destinos fixos de código. Apenas o
transporte administrativo fica indisponível durante a troca. Pedidos interrompidos
seguem o [runbook de reconciliação](RECONCILIATION.md); recuperar o banco não
conclui automaticamente o pedido remoto.

## Bundle autorizado e verificação fora da VPS

O payload aprovado tem SHA `ee7a9f4a4305b2886c57548b14431a9cd025e5cf`.
Os auxiliares desta entrega são ferramentas administrativas externas ao
payload. Revisá-los no HEAD da entrega e mantê-los separados do tar aprovado.
Mudança no payload exige nova identidade, checksum e decisão do PO.

Em checkout confiável, com GitHub HTTPS validado e URL oficial, buscar a
referência da PR e confirmar que o SHA aprovado está na ancestralidade.
A aprovação do SHA deve vir da direção por canal independente. O verificador
confere bytes e pins e pressupõe objetos Git obtidos dessa fonte confiável.

```bash
set -eu
umask 077
approved=ee7a9f4a4305b2886c57548b14431a9cd025e5cf
git fetch https://github.com/Funix-CentroReparacaoAutomotiva/funixapp.git refs/pull/288/head
git merge-base --is-ancestor "$approved" FETCH_HEAD
git archive --format=tar "$approved" deploy > funix-hml-deploy.tar
python3 -I deploy/remote-hml/verify-migration-bundle.py . "$approved" funix-hml-deploy.tar
```

O tar integral de `deploy/` verificado tem SHA-256
`922a407dfdf6f72e5b7edaa798fc4f861ab30380f05387c7dd7f1628e1e8d5c5`.
O verificador regenera o tar esperado do Git, recusa divergência byte a byte
por SHA-256, confere as 12 entradas de `control.FILES` e o `PREP_SHA` e imprime
a matriz dos 15 destinos. Confrontar a saída com a matriz do
[pré-voo anterior](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/288#issuecomment-7058359886),
usando para `transport.py` o SHA-256 novo
`5a5667774543d7aeb5810d8352382dce572c7577eacae91a66744e006c4c627b`.
Os dois valores `old: null` são `hml-selection.py` e `hml-official-update.py`.
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

- A partir do bundle conferido, executar como administrador
  `python3 -I deploy/remote-hml/migrate.py inventory`. Ele faz leitura lógica
  sob lock administrativo e lock oficial, ambos não bloqueantes. Confrontar
  todo `old/new` com o inventário e a matriz aprovados, inclusive os dois
  ausentes. Usar `stat` e `namei -l` nos destinos e seus pais para confirmar
  caminhos canônicos, arquivo regular com link único, proprietário e grupo
  root e modos da matriz. Conferir diretórios privados 0700 e a integridade
  dos controladores e módulos instalados pelo mapa antigo. Validar separadamente
  as unidades, wrappers e sudoers históricos contra o inventário.
- Confirmar worker `inactive`, ausência física de aprovação armada,
  resultado terminal ligado ao apontador corrente, journal HML na fase
  esperada e transporte administrativo já ativo. Inventário bem-sucedido
  valida locks e `idle()` naquele instante. Inspecionar ausência física de
  diretório ou journal de migração pendente. Conferir a aprovação do preparador
  apenas em resumo, sem exibir ticket, token ou conteúdo privado.
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
   registrar o mapa exato `{"old":...,"new":...}` em
   `/var/lib/funix-hml-ops/migration-approval.json` (root 0600). Suspender
   solicitações administrativas na janela e preservar os registros existentes.
2. Executar `python3 -I deploy/remote-hml/migrate.py apply --authorize`
   somente na janela liberada. O migrador revalida `idle()` e o mapa sob os
   dois locks. As fases são `staging`, `prepared`, `installing` e
   `awaiting_probe`. Registra backups e staging e grava hold/drop-in
   persistentes antes de substituir código. Conferir `awaiting_probe` e
   transporte normal parado. Se houver resultado ambíguo, preservar o hold
   e o journal e seguir a contingência.

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
- Na janela autorizada, em root e a partir do bundle conferido, executar
  `python3 -I deploy/remote-hml/migrate.py probe --authorize`. A unidade
  GET-only funciona por até 120 segundos. Confirmar que o transporte normal
  segue parado. O migrador guarda a identidade da invocação e o desafio
  no journal privado. O auxiliar devolve o corpo completo sem reescrever
  `migration_probe`.
- Preparar e validar previamente o canal SSH independente e já aprovado com
  host key conhecida e acesso root de escrita autorizado para a janela.
  Desabilitar tracing e gravação de entrada no cliente e no canal de
  administração. Capturar o GET em memória **antes** de abrir `accept`:
  ambos precisam do lock administrativo. Evitar arquivos, clipboard, argv
  externo, ambiente exportado e logs para o corpo. Exemplo para Bash na
  origem aprovada com acesso a ambos os canais, substituindo somente caminhos
  e identidades previamente conferidos:

```bash
(
  set +x
  set -o pipefail
  proof=$(python3 -I collect-migration-proof.py probe "$gateway" "$ca" "$client_cert" "$client_key") || exit 1
  # printf é builtin. Corpo segue exclusivamente para stdin do canal.
  builtin printf '%s' "$proof" | ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes "$admin_ssh" \
    '/usr/bin/python3 -I /root/funix-hml-approved/deploy/remote-hml/migrate.py accept --authorize'
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

- **Recovery** — `python3 -I deploy/remote-hml/migrate.py recover --authorize`.
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
  apagar o journal ou remover o hold. Escalar ao administrador.
- **Rollback após `accepted`** — Registrar autorização separada
  `{"id":...,"old":...,"new":...}` do journal exibido pelo inventário em
  `/var/lib/funix-hml-ops/migration-rollback-approval.json`, root 0600.
  Executar `python3 -I deploy/remote-hml/migrate.py rollback --authorize`.
  A reversão confere que o estado operacional continua igual ao do aceite.
  Recusa drift de código, modos e backups. A fase `rollback` permite retomar
  uma reversão já autorizada com recovery. Os módulos antes ausentes só são
  removidos se ainda têm os bytes aprovados. Confirmar SHA-256 e modos antigos,
  as duas ausências e o GET mTLS após a restauração.
- **Preservação** — Não mexer em SQLite, Docker, credenciais, certificados,
  contas, sudoers, configurações n8n ou journals operacionais. A migração
  mantém os locks e registra somente sua própria transação. A única alteração
  persistente de systemd é a condição dedicada do transporte. Uma falha de
  validação ou divergência exige inspeção administrativa com o canal bloqueado.

Antes de qualquer futura autorização de atualização, preparar formalmente o
novo candidato para gerar `prepared.json`; aprovações anteriores não são
convertidas. A conferência do host e qualquer execução operacional exigem
autorização separada.
