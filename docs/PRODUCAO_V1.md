# Produção V1 no FunixApp

## Fluxo no Atendimento

**Agendamento e experiência** está disponível no menu do Atendimento e na tela **Orçamentos emitidos**. O operador confirma quais versões emitidas receberam consentimento comercial e escolhe as referências de cliente, veículo e pagador da ficha. Nenhum vínculo é deduzido do telefone, de nomes semelhantes ou de um orçamento antigo. As três referências são congeladas na primeira confirmação. Referências textuais da ficha continuam válidas e conservam a ausência de ID cadastral.

A confirmação grava a entrada agendada, a entrega opcional e o consentimento das versões escolhidas na mesma transação. Orçamentos fora da seleção seguem em seu estado anterior. A Experiência pode ser reagendada depois de criada. Uma nova seleção registra consentimento de complementos nessa mesma Experiência. Se um Atendimento exigir correção de sua identificação depois da confirmação, será preciso definir um fluxo auditável de correção.

A tela lista os orçamentos emitidos, o histórico de transições e as OS disponíveis. Uma versão consentida pode ser autorizada tecnicamente ou rejeitada com motivo. Cada autorização emite uma única OS, antes ou depois da entrada física. A entrada agendada registra um compromisso, e a avaliação técnica continua independente da inspeção de recebimento.

## Decisões de armazenamento e acesso

- A migração V24 adiciona uma Experiência única por Atendimento, um histórico de transições separado e um vínculo da OS com a Experiência. Um gatilho exige, para cada nova OS, que a versão pertença ao mesmo Atendimento e esteja tecnicamente autorizada. O índice único de OS por versão permanece. Reenvios de autorização devolvem a OS original. Alterações de agenda usam revisões da Experiência e do Atendimento.
- A previsão de entrega tem a mesma fonte dos documentos anteriores, `atendimentos.delivery_date`. O agendamento usa a rotina de histórico existente e a Experiência exibe a previsão atual. A primeira OS fixa a previsão daquele momento. Mudanças posteriores seguem o fluxo de revisão documental existente.
- A OS reaproveita `operationalScope` para serviços, componentes, etapas, quantidades e prazo do orçamento congelado. A identificação operacional de cliente e veículo vem da Experiência confirmada. A rejeição comercial e a técnica convergem em Rejeitado, com origens e motivos próprios. O cancelamento comercial conserva a marca d'água e registra o evento na mesma transação do cancelamento.
- O login usa senha compartilhada e sessão em memória. A autoridade técnica nesta entrega é a capacidade de emissão que a sessão autenticada já tinha. O histórico identifica a origem da decisão e grava o responsável individual como nulo. Restringir a avaliação a supervisores identificados exige contas e papéis aprovados.
- O ensaio de consolidação cadastral do PR #266 continua com seu contrato de cópia V23. Os testes dessa rotina exercitam V23 sintético, e o ensaio da Produção verifica a atualização dessa versão para V24.
- As OS anteriores à V24 continuam disponíveis para consulta, revisão e PDF. Elas mantêm `experience_id` nulo e a migração não deduz consentimento, autorização técnica nova ou Experiência a partir delas. Cancelamentos anteriores continuam visíveis pelos metadados existentes. Uma OS histórica sem cancelamento aparece sem estado no novo ciclo. Mudanças de escopo exigem emissão de outra versão e uma nova decisão.
- Executado integra o modelo de estados com uma transição a partir de Autorizado e uma OS vinculada. A operação que registra execução e a inspeção de recebimento ficam para a etapa que possuir evidência desses eventos.
- A Experiência é a chave para o planejamento manual futuro. A fase operacional deve ser única pelo par `(experience_id, phase_id)`, e os itens devem referenciar as OS de origem para que os complementos contribuam com serviços para as mesmas fases. Esta entrega cria o vínculo que permite essa consolidação. O modelo de planejamento e a programação automática ficam para etapas posteriores.

## Validação com dados sintéticos

- `npm run check` concluiu build, TypeScript do servidor, lint, 1.119 testes de servidor e 8 testes do relatório de voz. O build emitiu o aviso de tamanho do bundle, e o lint reportou avisos preexistentes.
- `server/tests/production.test.ts` cobre consentimento múltiplo, reenvios, complementos, rejeição comercial e técnica, cancelamento, proteção referencial, falhas injetadas e rollback. O teste de concorrência usa workers simultâneos com conexões independentes no mesmo banco temporário. O ensaio de migração abre e reabre um arquivo sintético V23 e confere dados e PDFs preexistentes.
- A suíte de OS também verifica sessão, origem das escritas, bloqueio da criação direta, PDF imutável e revisões documentais.
- `python tests/browser/work_order_flow.py` passou em Chromium com desktop de 1.440 px e mobile de 390 e 320 px. As 40 verificações cobriram agendamento, reagendamento, rejeição técnica, resposta perdida após emissão, acesso aos PDFs e às revisões R01–R03, cancelamento e regressão visual dos botões de documentos. [Resultado por resolução](evidencias/producao-v1/resultado-chromium.json)
- `python tests/browser/pdf_emission.py` passou nas mesmas três larguras. Verificou a emissão comercial, a recuperação idempotente, os cálculos exibidos e a preservação dos arquivos e snapshots em SQLite.
- O ensaio `tests/browser/os_v1_render.py` passou em Chromium do sistema para documentos sintéticos de 1, 4, 10, 19, 40 e 80 peças. Conferiu paginação, texto, colisões e equivalência visual ao modelo de referência.

| Largura | Agendamento | Experiência e avaliação técnica |
| --- | --- | --- |
| 1.440 px | [Captura](evidencias/producao-v1/desktop-agendamento.png) | [Captura](evidencias/producao-v1/desktop-experiencia.png) |
| 390 px | [Captura](evidencias/producao-v1/mobile390-agendamento.png) | [Captura](evidencias/producao-v1/mobile390-experiencia.png) |
| 320 px | [Captura](evidencias/producao-v1/mobile320-agendamento.png) | [Captura](evidencias/producao-v1/mobile320-experiencia.png) |
