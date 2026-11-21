# Migração administrativa de código HML (#274)

Roteiro para revisão e autorização independente. Usar o bundle integral do SHA
aprovado, root-owned, por canal administrativo. Preservar esse bundle, o
histórico e o journal até fechar a auditoria. Não executar os instaladores
históricos. O escopo é a troca dos 15 destinos fixos de código. Apenas o
transporte administrativo fica indisponível durante a troca. Pedidos interrompidos
seguem o [runbook de reconciliação](RECONCILIATION.md); recuperar o banco não
conclui automaticamente o pedido remoto.

## Somente leitura

`python3 -I deploy/remote-hml/migrate.py inventory`

Executar como administrador, a partir do bundle. A leitura toma o lock
administrativo e depois o lock oficial, sem esperar. Confirmar ausência física
de autorização armada, worker inativo, resultado terminal vinculado ao apontador
corrente e journal HML aceito/restaurado. Confirmar saúde funcional e GET mTLS
antes da janela. Comparar SHA-256 e modos root:root com a matriz aprovada,
incluindo as ausências de `hml-selection.py` e `hml-official-update.py`. Conferir
pais canônicos, 0700 nos diretórios privados, espaço e ausência de estado de
migração anterior. Qualquer divergência ou contenção interrompe o procedimento.

## Escrita, após autorização da direção

1. Registrar o mapa exato `{"old":...,"new":...}` em
   `/var/lib/funix-hml-ops/migration-approval.json` (root 0600). Suspender
   solicitações administrativas na janela. Preservar aprovação do preparador,
   ponteiros e históricos.
2. **Troca** — `python3 -I deploy/remote-hml/migrate.py apply --authorize`.
   O journal passa por `staging`, `prepared`, `installing` e `awaiting_probe`.
   Os backups e o staging são conferidos antes da troca. O hold durável e um
   drop-in persistente no serviço normal são gravados antes de substituir código.
   A condição impede ativação pelo boot, start ou restart enquanto o hold existe.
   Preservar o drop-in dedicado. Fora da janela o arquivo de hold fica ausente.
3. **Prova** — `python3 -I deploy/remote-hml/migrate.py probe --authorize`.
   Abre uma unidade transitória de até 120 segundos, sem restart, com a mesma
   identidade, origem, TLS e credenciais existentes e acesso apenas ao GET.
   O transporte normal permanece bloqueado. Por canal administrativo aprovado,
   o operador executa um GET autenticado ao endpoint mTLS existente e transfere
   o JSON diretamente, como entrada padrão, para
   `python3 -I deploy/remote-hml/migrate.py accept --authorize`.
   Não copiar tickets, resposta ou credenciais para Git ou logs. Este passo
   confia no administrador root para entregar o resultado real do GET. O
   mecanismo confere desafio de uso único, invocação ativa, snapshot do journal,
   último resultado e ausência de autorização armada. Não automatizar aprovação
   pelo n8n. Se o GET falhar ou expirar, o hold continua e o ensaio encerra por
   limite de tempo. Após inspeção, usar nova prova ou recuperação autorizada.
4. **Aceite** — Depois de validar prova, código e backups, o migrador para a
   unidade transitória, persiste `accepted` e só então libera o transporte
   normal. Confirme novamente GET mTLS, mesmo resultado e revisão, saúde
   funcional e worker inativo. Se o start falhar, o migrador repõe o hold.
   Se a conferência pós-aceite falhar, interromper operações administrativas
   e recorrer à reversão abaixo com nova autorização.

## Interrupção e reversão de código

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
