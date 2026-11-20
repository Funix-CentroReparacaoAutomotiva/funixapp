# Migração administrativa do piloto (#274)

Proposta para revisão, sem execução na VPS. Não executar os instaladores
históricos recuperados. Preservar o bundle até concluir qualquer recuperação.
Pedidos interrompidos exigem o [runbook de reconciliação](RECONCILIATION.md);
recuperação do banco não conclui automaticamente o pedido remoto.

Entrega futura: diretório deploy completo da revisão aprovada, via canal
administrativo existente, propriedade root, sem escrita de grupo/outros.
Manter todas as credenciais e estado atuais nos seus diretórios privados.

1. Cancelar aprovação armada pelo comando administrativo existente; concluir
   revisão de qualquer worker/journal pendente. Não apagar tickets/journals.
2. Administrador local executa `python3 -I deploy/remote-hml/migrate.py inventory`.
   Saída contém somente paths fixos de código e hashes old/new, nunca segredos.
3. Revisar inventário contra os fontes instalados e revisão entregue. Registrar
   exatamente esse objeto JSON, por procedimento administrativo independente,
   em /var/lib/funix-hml-ops/migration-approval.json, root 0600. Não versionar.
4. Com autorização separada, executar `python3 -I deploy/remote-hml/migrate.py apply --authorize`.
   O processo usa os locks existentes, recusa worker/aprovação/journal pendentes,
   faz backup/staging privados e duráveis, para somente o transporte dedicado,
   substitui código e verifica hashes e importação/pins antes de reabrir.
5. Em falha normal, restaura o código anterior. Em interrupção, manter transporte
   parado e executar o mesmo bundle com `recover --authorize`, após inspeção.
   Não remover migration/journal.json para repetir. Uma migração já existente
   requer decisão administrativa, não reinstalação indiscriminada.

Não altera systemd, sudoers, contas, CA, certificados, tokens, credenciais,
aprovações, requests, SQLite, release ou journals do atualizador. O journal
próprio só registra a troca de código. Novo módulo ausente no piloto é incluído
com backup de ausência; recuperação só remove esse arquivo se ainda coincide
com o hash instalado, sem limpeza recursiva.

Aceite administrativo obrigatório: serviço ativo, GET/status por mTLS válido,
negativos CA/fingerprint/origem e ausência de aprovação; nenhum POST/update
durante migração. O job Linux descartável exercita as unidades reais com backend
sintético (REHEARSAL.md); não é ensaio de migração do piloto. PowerShell em
execução e rotação completa ainda precisam de ensaio fora da VPS antes de
autorizar este procedimento em produção administrativa.

O inventário da integração inclui `hml-selection.py`, o novo blob do verificador
de procedência e o novo SHA-256 de `control.py` fixado em `rootctl.py`. Os fontes
recuperados e seu manifesto continuam sendo a referência histórica. Confirme os
pins e os hashes do inventário antes de qualquer migração futura.

Antes de emitir uma nova aprovação, execute a preparação com o controlador
integrado. Ele aceita até 1 GiB e grava `prepared.json` sob o lock do atualizador.
Operações previamente preparadas e ainda sem journal podem ser revalidadas
pelo preparador para gerar esse registro. Se o registro já existe e diverge,
preserve-o para inspeção administrativa. Nenhum ticket anterior é convertido.

Para candidatos futuros: administrador seleciona PR/SHA/run/tentativa/artefato
conforme fluxo oficial, revisa checksum/size e predecessor, atualiza approval.json
do preparador por canal independente, executa preparação restrita e preflight.
Após accepted ou auto_restored, usar respectivamente candidate ou previous do
journal como instalado; nunca aceitar fase pendente. Só então emitir preview e
nova aprovação administrativa de uso único. Executor mTLS recebe ticket, não
poder de emitir aprovação. O workflow piloto fixado à PR257 não é reutilizável
sem revisão administrativa; esta PR não altera n8n nem seus parâmetros.

Revogação: cancelar aprovação armada e parar apenas o transporte dedicado por
administrador. Rotação de CA/certificados/fingerprint exige procedimento
separado e testes negativos/positivos, sem copiar material privado para Git.
O relatório PowerShell guarda somente código SSH; ticket não é persistido.
Guardar esse relatório local com ACL administrativa e retenção mínima para
auditoria, removendo-o após o aceite conforme política local.
