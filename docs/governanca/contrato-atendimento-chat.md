# FUNIX — Contrato de domínio: Atendimento e Chat

**Decisão da direção, 17/11/2026.** Aprovação conceitual e autorização de adequação em desenvolvimento na PR #261. A implementação e a homologação ainda são pendentes. Este contrato prevalece sobre a interpretação de Atendimento como oportunidade exclusivamente comercial e sobre a autorização de envio independente de Atendimento introduzida naquela PR. Preservar as demais decisões aprovadas.

## 1. Conceitos e regras aprovadas

- **Entidade:** pessoa física ou jurídica com quem a FUNIX se relaciona.
- **Contato:** número telefônico da Entidade. Uma Entidade pode possuir vários Contatos.
- **Chat:** histórico de comunicação WhatsApp de um número na instância da FUNIX. Cada número WhatsApp tem seu próprio Chat; nunca combinar históricos por Entidade.
- **Atendimento:** unidade de interação da FUNIX com uma ou mais pessoas para receber, fornecer ou trocar informações, ajudar, orientar ou tratar uma demanda. A existência de interesse comercial, orçamento, contratação ou reparação não é requisito. Uma pergunta simples, SAC, reclamação, pedido de nota ou orientação também é Atendimento.
- **Orçamento:** proposta comercial de serviços, valores e condições; desdobramento possível, não obrigatório, do Atendimento.
- **Ordem de Serviço:** documento dos serviços autorizados para execução.
- **Experiência:** processo de prestação de serviço ao cliente. Não redefinir aqui seu ciclo operacional nem a relação documental entre OS, Atendimento e Experiência.

Um Atendimento pode reunir várias Entidades e vários Contatos/Chats; um Chat pode participar de vários Atendimentos ao longo do tempo. A seleção de um responsável exibe seus números, mas não atribui automaticamente todas as suas conversas passadas à demanda. Uma pessoa que participou continua no registro histórico, mesmo que outra passe a conduzir a interação. O histórico integral permanece no Chat do número, sem cópias, fusões ou transferência de mensagens.

**Invariante:** cadastrar pessoa/número, verificar WhatsApp, abrir uma tela ou consultar histórico não implica uma nova interação. Ao iniciar uma interação efetiva, inclusive não comercial, deve existir um Atendimento criado ou reutilizado para seu contexto. Não oferecer um caminho de comunicação ativa que dispense Atendimento. Não exigir que o operador crie manualmente um orçamento, lead ou ficha vazia como pré-condição de uma conversa.

## 2. Regras operacionais para implementar o invariante

As regras abaixo são escolhas de implementação propostas para concretizar a decisão, mantendo o funcionamento simples e acautelado.

| Situação | Comportamento esperado |
|---|---|
| Cadastro/consulta WhatsApp, abertura do Chat, rascunho ou cancelamento | Nenhum Atendimento novo. Chat disponível para leitura e preparação. |
| Primeira mensagem recebida em interação nova, por evento autêntico já suportado | Criar/reutilizar Atendimento e vínculo com o Chat; operação idempotente. Não depender de orçamento. |
| Primeira mensagem enviada (texto ou mídia) | Após confirmação explícita e validações, resolver/criar Atendimento e vínculo antes de chamar o provedor. Reutilizar o mesmo contexto quando houver retry/recibo incerto; não registrar mensagem entregue se não houve confirmação. |
| Continuidade de Atendimento aberto e contexto inequívoco | Reutilizar o Atendimento, sem criar outro a cada mensagem. |
| Demanda nova em Chat com Atendimento já encerrado | Criar novo Atendimento para nova interação, sem reabrir silenciosamente nem remover vínculos anteriores. Distinguir evento novo de replay, importação e leitura histórica. |
| Mais de uma demanda ativa ou contexto revogado/conflitante | Preservar mensagem e histórico; usar a seleção explícita de contexto já existente. Não enviar nem atribuir arbitrariamente a demanda; mostrar pendência operacional quando a associação não puder ser determinada. Resolver como exceção, não criar fluxo paralelo de conversa sem Atendimento. |
| Outro número/pessoa entra no mesmo assunto | Permitir vinculá-lo ao Atendimento existente, preservando os demais participantes e o histórico independente de cada número. |

O Atendimento não é sinônimo de lead. Usar classificação mínima de finalidade (comercial, não comercial, a classificar) ou mecanismo existente equivalente. Para novas interações não classificadas, manter visibilidade para triagem; não contabilizá-las como leads confirmados. Atendimentos não comerciais devem ser consultáveis/encerráveis, sem exigir orçamento, veículo ou motivo de perda comercial. Preservar o funil comercial, as fases existentes, as métricas e os dados legados; não reclassificar em massa por hipótese nem construir um novo sistema SAC. A escolha exata de nomes/campos e apresentação mínima é delegada à implementação, desde que não esconda demandas.

## 3. Adequação técnica delimitada da PR #261

Base auditada: `886792c2c32fbfe6ed5defd1852af26e966454b2`, branch `feat/entidades-contatos-whatsapp`. Manter a mesma PR e reaproveitar código/testes. Não reimplementar Entidades, Contatos, checagem WhatsApp, migração V22 ou identidade PN/LID.

Pontos localizados na revisão feita pelo ChatGPT:
- `server/chat/contact-channels.ts`: `dispatch()` hoje autoriza envio por Contato verificado sem resolver Atendimento. Reutilizar contexto/vínculos e ledger de envio existentes. Contexto comercial correto deve ser revalidado no servidor inclusive em texto, mídia, corridas e retries.
- `server/app.ts`, `src/EntityEditor.tsx` e componentes de Chat: abertura e leitura permanecem simples; a primeira comunicação efetiva deve criar/reutilizar Atendimento no fluxo, sem exigir cadastro duplicado. Não confundir `open-chat` com início efetivo da interação.
- `server/chat/local-associations.ts`: `inbound()` depende de `conversation_initialization` (primeiro evento histórico); hoje deixa de criar novo Atendimento após encerramento e o ramo de mensagens enviadas apenas registra evento se houver contexto. Adequar o ciclo, sem duplicar eventos ou reprocessar histórico. Reavaliar modos local/provider/legado existentes; não presumir que leitura de uma página equivale a evento novo. Se um modo não tiver evento confiável, explicitar a limitação e o mecanismo de triagem/associação, sem habilitar ingestão ou alterar Evolution/n8n.
- `server/atendimentos.ts` inicia em `novo-lead`; revisar a distinção de finalidade, criação/encerramento e projeções do funil. Não modificar regras de orçamento, OS, Experiência, cálculos ou documentos históricos.

Preservar proteção PN/LID, conflito de titularidade, sessão/Origin, destinatário resolvido no servidor, confirmação explícita, idempotência e proibição de retry cego. Não inferir pessoa por nome/foto ou número aproximado. Manter flags de envio/ingestão/mídia e contratos anteriores, salvo ajustes estritamente necessários. Não fazer backfill massivo; migração somente se indispensável, aditiva e testada em cópia sintética.

## 4. Aceite e limites

Testes focados, com API/SQLite reais e transporte sintético:
1. Salvar Entidade, verificar número, abrir Chat, cancelar confirmação: zero Atendimentos e zero envios criados.
2. Novo inbound autêntico: um Atendimento; evento repetido/concorrente e continuidade não duplicam. Nova interação após encerramento: novo Atendimento, vínculo anterior intacto.
3. Primeiro envio confirmado (texto e mídia): Atendimento existente ou novo antes do dispatch; mesmo requestId, concorrência e resultado incerto não duplicam Atendimento nem mensagem. Falha de contexto/identidade não dispara envio.
4. Duas pessoas/números no mesmo Atendimento, e mesmo número em Atendimentos sucessivos: históricos independentes e vínculos preservados. Contexto ambíguo exige decisão explícita.
5. SAC/dúvida sem orçamento pode ser atendido e encerrado; não vira lead/perda comercial artificial. Triagem permanece acessível.
6. Regressões dos Contatos/WhatsApp, vínculos N:N, Atendimentos e funil; Chromium mobile/desktop nos trechos alterados. TypeScript/build e CI antes da entrega. Evitar repetir diagnósticos ou suítes completas locais a cada ajuste.

**Autorizado:** desenvolvimento e testes isolados na mesma branch/PR. **Não autorizado nesta etapa:** merge, deploy, migração do banco instalado, consulta/envio real, alteração de VPS, Evolution, n8n ou flags de integração. A homologação da V22 e da Evolution instalada permanece pendente. Relatar commit, testes efetivos e limites, sem declarar a instalação corrigida.
