# Previsão de entrega e revisões documentais da OS

Decisão funcional: a previsão é uma data de calendário informada manualmente, opcional e independente do prazo técnico do orçamento.

- Nas configurações do Atendimento, editar ou limpar a data; alterações registram anterior, nova, horário e origem/motivo. A sessão atual não identifica o operador individual.
- Sem data, o fluxo de emissão apresenta dois botões. Emitir sem data só é habilitado com campo vazio; Emitir com data exige data válida. Cancelar não grava. Com data previamente registrada, confirmar a data existente.
- A data informada na emissão é salva no Atendimento na mesma transação SQLite da OS. A emissão não altera o orçamento nem recalcula o prazo.
- A OS original é R01; reemissões R02+ são registros imutáveis ligados ao mesmo número de OS e à mesma versão do orçamento. O escopo operacional original é preservado. Alterar ou limpar a data sinaliza reemissão necessária; a anterior permanece consultável.
- As rotas originais de consulta/PDF identificam a primeira emissão; novas rotas /os/revisoes e /os/revisoes/:revision[/pdf] permitem consultar, reemitir e imprimir revisões específicas.
- A primeira renderização bem-sucedida das novas emissões é congelada em cache independente por revisão. Não se modifica PDF histórico; os documentos legados sem cache seguem o comportamento anterior. A marca de cancelamento é derivada sem substituir o original.
- Compatibilidade: o contrato de criação legado com authorized:true continua aceito; a interface nova sempre envia escolha explícita e revisão do Atendimento. A revisão impede confirmação sobre dados concorrentes. O reenvio de uma criação idêntica retorna a primeira emissão sem duplicação.
- Migração V21 aditiva, sem preenchimento retroativo. Há outras propostas V21 em paralelo: coordenar numeração, atualizar testes e ensaiar migração em cópia sintética da base antes de integrar.
- Validação: testes unitários de escolha, calendário, atomicidade, históricos, concorrência, cache e cancelamento; Chromium 1440/390/320. CI e homologação precisam ser confirmados. Sem merge, deploy ou acesso a dados reais.
