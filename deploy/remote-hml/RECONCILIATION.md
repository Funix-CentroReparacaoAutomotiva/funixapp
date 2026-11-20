# Reconciliação administrativa de solicitação interrompida

Runbook para revisão; não autoriza execução no piloto. Apenas administrador
local autorizado, com o bundle confiável da revisão instalada. O canal mTLS
não oferece recovery, rollback, aprovação ou reconciliação.

1. Suspender somente `funix-hml-ops-transport.service`, por autorização
   administrativa. Não parar Docker, Traefik ou a aplicação para diagnosticar.
   Não reenviar POST. Verificar a unidade worker e seu PID; enquanto existir
   executor ativo, não iniciar outro nem inferir abandono por timeout do cliente.
2. Preservar cópia administrativa privada dos registros, modos/proprietários,
   hashes e horários. Inspecionar localmente `/var/lib/funix-hml-ops/current.json`
   e o diretório correspondente em `requests/`: `ticket.json`, `started.json`
   e `result.json`, quando existentes. Não divulgar ticket, arquivos privados,
   conteúdo do SQLite ou journal bruto do systemd. Saídas externas devem limitar-se
   a identificador, revisões, fase, categorias de erro e próxima ação.
3. Correlacionar o identificador, operação e revisão com o journal oficial
   `operation.json` da operação e com `active.json` no state oficial. Consultar
   o preflight somente leitura do atualizador oficial (interface documentada em
   `docs/entregas/HML_OPERACAO_ATUALIZADOR.md`), release/config/override vigente,
   revisões API/Web, HTTPS e autenticação. Conferir backup e seu digest/integridade
   conforme o contrato oficial, sem abrir/publicar dados reais nesta revisão.
   Extrair somente categorias sanitizadas dos logs; ausência de resultado não
   equivale a ausência de mutação.
4. Classificar pela tabela. Discordância entre registros, revisão instalada ou
   ponteiro ativo é sempre `unknown`, nunca presumir sucesso pelo HTTP 202.

| Classe | Evidência necessária | Ação autorizável separadamente |
| --- | --- | --- |
| accepted | Journal aceito e operação ativa exata, revisão candidata instalada e validações oficiais aprovadas | Preservar dados posteriores; não executar recovery destrutivo/rollback. Registrar conclusão administrativa |
| restored | Journal restaurado, revisão anterior instalada e validada, backup/recuperação coerentes | Registrar restauração; não repetir atualização nem reutilizar aprovação |
| pending | Executor encerrado e journal em fase não terminal coerente | Recuperação administrativa pelo comando oficial, autorização exata e lock oficial; reclassificar após conclusão |
| unknown | Falta de registros, executor possivelmente ativo, inconsistência ou journal aceito com validação divergente | Manter canal suspenso e bloquear nova operação; revisão administrativa do incidente |

`accepted_pending_open` e outras fases intermediárias são `pending`: usar a
recuperação oficial que preserva escritas posteriores ao aceite, nunca restaurar
manualmente um backup. Rollback de atualização aceita é outra operação, exige
autorização específica e confirmação de descarte dos dados posteriores.

## Limite atual e critério de reabertura

Recuperar a transação oficial não altera o histórico do pedido remoto. Se
`started.json` existe sem `result.json`, o controlador informa
`running_or_interrupted` mesmo após journal restaurado e continua bloqueando
novas aprovações. Esta versão **não possui comando suportado para concluir esse
pedido após morte abrupta**. Não criar/editar `result.json`, apagar `current.json`,
rearmar ticket, trocar ponteiros ou remover locks/journals para desbloquear.

Registrar a classificação administrativa e manter o canal suspenso até revisão
do PO e procedimento de reconciliação suportado/autorizado separadamente. Para
pedidos terminados normalmente em `accepted` ou `auto_restored`, conferir todos
os vínculos e validadores antes de autorizar reabertura. Suspensão do transporte
não revoga um worker já despachado nem cancela uma autorização armada: cancelar
esta pelo comando administrativo existente, após inspeção. Revogação permanente
da identidade/CA exige procedimento de rotação separado; não manipular certificados
reais com base no ensaio sintético.
