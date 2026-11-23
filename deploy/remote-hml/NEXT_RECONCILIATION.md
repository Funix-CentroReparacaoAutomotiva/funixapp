# Segunda reconciliação administrativa do controlador HML

## Motivo e evidência

Em 23/11/2026, a direção confirmou o diretório
`/var/lib/funix-hml-ops/migration-controller-web-adoption`
como existente, com `root:root`, modo 0700, journal com ocorrências de
`phase: accepted`, SHA-256
`ead1885aae085b96189f3d93601922c9fd9837bf89d7260127b1f9982fa1fcd3`,
sem arquivo `hold`; transporte administrativo `active` e worker
`inactive`. O grep anterior não prova sozinho que a **fase de nível
superior** seja `accepted`; o pré-voo programático deve comprová-la.

O migrador anterior tem nome de tentativa fixo e recusa reutilizar esse
diretório. A PR #339 (integrada na `main` pelo commit
`4ceeb0816f0b378ef631939f841166390e8942ff`) corrige a leitura da
cadeia Web antiga → Modelo B, mas **não está instalada na VPS**.

## Procedimento novo e restrito

O comando `inventory-reconcile-v2` da revisão proposta inspeciona e
exige, em cadeia: migração original `restored`, retry `accepted`, upgrade
de permissões `accepted` e a **primeira reconciliação** `accepted`,
sem `hold`, com seus journals vinculados e backups validados.
O resultado apresenta o hash do journal anterior em
`prior_journal_sha256`, além dos inventários `old/new` dos 15 destinos.

A segunda tentativa dispõe do diretório exclusivo
`/var/lib/funix-hml-ops/migration-controller-web-adoption-v2` e dos
comandos:

- `inventory-reconcile-v2`: pré-voo de leitura, exige a cadeia anterior;
- `apply-reconcile-v2 --authorize`: exige aprovação privada
  `migration-controller-web-adoption-v2-approval.json` (root, modo 0600),
  com os valores **exatos** de `old`, `new` e
  `prior_journal_sha256` retornados pelo inventário; exige que o drop-in
  vigente corresponda à primeira reconciliação e que o transporte esteja
  ativo; abre uma nova transação com backup antes de trocar código;
- `probe-reconcile-v2 --authorize`: coloca o transporte em hold e abre
  prova mTLS temporária limitada, vinculada ao journal novo;
- `accept-reconcile-v2 --authorize`: consome **exclusivamente via stdin**
  a prova mTLS íntegra e recente da origem admitida, confere o desafio e
  o estado, persiste `accepted` e reabre o transporte;
- `recover-reconcile-v2 --authorize` e
  `rollback-reconcile-v2 --authorize`: recuperação e reversão dentro da
  tentativa v2, com aprovação específica no rollback. Não usar
  `recover-reconcile` histórico.

Os quatro journals anteriores, o primeiro registro
`web-adoption.json`, o Compose, as imagens Docker, o banco e as
credenciais são preservados. Um bloqueio, fase inesperada, drift de código,
backups alterados ou prova mTLS inválida deve encerrar a tentativa com
diagnóstico e eventual recuperação autorizada.

## Gates antes de qualquer operação com escrita

1. Revisar testes e fonte da nova PR, confirmar a revisão aprovada e
   verificar o tar `deploy` pelo `verify-migration-bundle.py`.
   Confirmar os 15 destinos e pins `PREP_SHA` e `FILES`.
2. Reconferir no **host** a fase superior de cada journal, SHA-256 e
   ausência de holds; verificar o conteúdo do drop-in systemd, locks,
   ausência de `armed.json`, resultado terminal de eventual request, modos,
   espaço em disco, saúde funcional e disponibilidade da prova mTLS.
3. Confirmar que o diretório da segunda tentativa ainda não existe,
   comparar os valores reais do inventário e documentar backup, rollback,
   executor, janela e autorização específica da direção.
4. Só após os gates, instalar o **controlador**, não o FunixApp, com os
   comandos acima. O procedimento pode interromper **temporariamente o
   transporte administrativo**; não executá-lo em produção nem presumir
   sucesso sem aceite final.
5. Depois do controlador `accepted`, confirmar hashes, transporte e
   estado mTLS. A operação `rootctl.py adopt-published-panel --authorize`
   é **outra autorização**, posterior; deve criar exclusivamente
   `web-adoption-model-b.json` se a primeira adoção ainda for válida e o
   release físico corresponder exatamente ao Modelo B.

Se houver falha entre a retirada do drop-in antigo e a criação do novo
journal, não improvisar reinstalações ou condições systemd: parar e
avaliar o estado administrativo e o plano de recuperação antes de retomar.
A etapa de CI no GitHub não substitui a inspeção no host.

**Nenhum dos comandos mutáveis acima foi executado por esta proposta.**
