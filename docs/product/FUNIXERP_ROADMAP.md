# FunixERP — Roadmap técnico de evolução modular

**Versão:** proposta v0.2 — 24/11/2026.  
**Escopo:** evolução do FunixApp existente para FunixERP; não é o roadmap de todos os projetos FUNIX. A direção autorizou estruturar o planejamento, não aprovou automaticamente cada regra de negócio, desenvolvimento, migração ou publicação. Prazos e capacidade são hipóteses. Este documento é uma visão de marcos e dependências; tarefas executáveis ficam nas issues canônicas. Não substitui contratos técnicos vigentes nem o registro empresarial privado.

## 1. Princípios

- Evolução incremental da arquitetura existente (React/TypeScript, Node, SQLite); monólito modular como hipótese inicial, reavaliado por evidência, sem reescrita ou microserviços por padrão.
- Preservar identidade Entidade–Contato–Chat–Atendimento, orçamento emitido imutável, consentimento comercial, Experiência, autorização técnica e OS, conforme contratos vigentes. Atendimento não pressupõe venda ou reparação. Produção V1: uma Experiência por Atendimento; uma OS por versão autorizada; complementos na mesma Experiência. Não inferir autorizações históricas.
- Diferenciar código implementado, CI aprovado no SHA exato, integração, instalação, homologação funcional e operação verificada.
- Uma fonte autorizada por domínio e período; migração gradual com inventário, conciliação, ensaio, backup, reversão e aceite. Não presumir Coda desativado nem sincronização bidirecional.
- Contas, papéis e auditoria proporcionais ao risco antes de operações sensíveis em ambiente real. Segredos e dados privados fora do Git público.
- Manter as regras de `AGENTS.md` e [política de ferramenta](../governanca/politica-uso-chatgpt-codex.md). Não interpretar este plano como autorização de merge, deploy, mudanças em VPS, integrações, dados ou envios externos.

## 2. Linha de base observada

Consulta ao repositório em 24/11/2026. Não constitui auditoria da instalação.

| Domínio | Evidência | Estado verificável / próximo resultado |
| --- | --- | --- |
| Identidade e cadastro | #282, #344, PRs #345 e #349 | Ajustes em PRs abertas; consolidar identidade e Chat sem duplicidade. |
| Comercial | #293, #297, #300, #304, #256 / PR #257 | Iniciativas existentes; inventariar regressões, importação e aceites antes de criar trabalho duplicado. |
| Comunicação | #294, #298, #307, #311, #289 | Reusar contratos e corrigir somente lacunas verificadas; separar leitura de envio. |
| Produção | #292, #305, #310, PR #267, [Produção V1](../PRODUCAO_V1.md) | PR #267 integrada em 19/11; fundação de agendamento, consentimento e OS. Pátio, vistoria de entrada, planejamento e registro de execução são próximos incrementos, não funcionalidades presumidas. |
| Documentos | #295, #312, #313 | Reutilizar OS/PDF e revisões; definir documentos da operação. |
| Plataforma | #291, #299, #302, #303; #330, PR #346 | Conferir condições efetivas de HML antes de publicação; não bloquear especificação/desenvolvimento isolado sem motivo. |
| Governança | #301, #329, #347, PR #348 | Painel multiprojeto; mapa publicado ainda com apenas uma raiz de projeto. |
| Financeiro/fiscal/gestão | #167, #176, #212 | Requisitos futuros já registrados para extrato, emissão fiscal e indicadores; não são capacidades operacionais confirmadas. |

Blueprint de descoberta: citado em #301, não localizado em `main` nem nas buscas iniciais autorizadas no Drive. Reconciliar versão e decisões antes de congelar modelo de domínio; não recriar uma especificação anterior sem verificar a fonte.

## 3. Marcos de maturidade

| Marco | Resultado de negócio | Gate de saída proposto |
| --- | --- | --- |
| M0 — Consolidação | Comercial/Chat/OS estáveis | Identidade e histórico preservados, valores e documentos coerentes, testes de regressão, caminho HML autorizado e aceite funcional. |
| M1 — ERP Operacional | Oficina controlada da aprovação à entrega | Caso representativo entra, recebe vistoria, é planejado, executado, inspecionado e entregue; bloqueios e complementos rastreáveis. |
| M2 — ERP Econômico (alvo FunixERP 1.0) | Operação, compras e financeiro conectados | Obrigações, recebíveis, pagamentos parciais/estornos, caixa, custos e fechamento de parceiro conciliados; migração/piloto autorizados e uso real verificado. Não requer emissão fiscal nativa se integração/processo autorizado e rastreável atender ao objetivo. |
| M3 — ERP Corporativo | Pessoas, manutenção, estoque e gestão | Rotinas selecionadas adotadas e dados protegidos, sem recriar folha/contabilidade de terceiros sem benefício. |
| M4 — ERP Inteligente | Assistência e automação verificáveis | Dados confiáveis; autorização humana em decisões materiais; custo, confiabilidade e ganho medidos. |

Marcos podem sobrepor desenvolvimento, nunca substituir gates. A designação 1.0 depende de aceite e operação, não de calendário.

## 4. Mapa de frentes e propriedade

Esta divisão é uma proposta inicial, não uma taxonomia permanente do painel. A Central/ChatGPT pode reagrupar, renomear, criar ou arquivar frentes por dados, a pedido da direção e preservando as referências. O limite de simultaneidade é adaptável.

| Frente | Referência existente ou candidata | Limite e primeiro incremento |
| --- | --- | --- |
| Plataforma | #291, #299, #302, #303 | Contratos compartilhados, segurança, migrações, fila de candidatos, rollback. |
| Comercial | #293, #297, #300, #304 | Cadastros, composição, motor, versões e consentimento; preservar matemática e históricos. |
| Comunicação | #294, #298, #307, #311 | Chats, eventos, mídia, vínculos, leitura/envio controlados. Coordenar identidade com Comercial. |
| Operação | #292, #305, #310 | Experiência, pátio, agenda, prontidão, planejamento, execução, qualidade, entrega. |
| Documentos | #295, #312, #313 | Revisões, inspeções e índice de documentos; referências estáveis e permissões. |
| Financeiro | Nova iniciativa proposta; reusar #167 | Títulos, parcelas, liquidações, estornos, caixa; sem integração bancária escrita. |
| Suprimentos | Nova iniciativa proposta | Requisições, cotações, pedidos, recebimento, devoluções e custo real; vincular à Experiência/OS quando aplicável. |
| Fiscal e parceiros | Nova iniciativa proposta; reusar #176 | Processo, requisitos por pagador, documentação, faturamento e conciliação; sem envio automático por IA. |
| Pessoas e administração | Nova iniciativa proposta | Cadastros, competências, manutenção; dados restritos. |
| Inteligência gerencial | Nova iniciativa proposta; reusar #212 | Métricas com fonte e definição; sem presumir energia de orçamento como horas/custo. |
| Integrações e IA | #296, #306, #309 | Adaptadores, n8n, voz, importação, assistência; revisão humana e limites explícitos. |

Não abrir duplicatas dos épicos/requests existentes. Verificar estado e escopo de cada issue antes de vincular, dividir ou criar nova. As novas iniciativas são candidatas, não trabalho ativo.

## 5. Primeiro ciclo: execução paralela limitada

Limite inicial proposto: até quatro pacotes de implementação em paralelo no ERP, sujeito à capacidade global de revisão/homologação e a outros projetos do portfólio. Uma entrega por frente, sem sessão duplicada sobre a mesma issue.

| Trilha | Próximo pacote de trabalho | Critério de aceite do pacote |
| --- | --- | --- |
| A — Comercial + Chat | #344: reconciliar #345/#349 e demais correções já em curso; dono único das alterações compartilhadas de identidade. | Reutilização inequívoca de identidade, nome/telefone persistidos, histórico e vínculos preservados; casos ambíguos bloqueiam associação indevida; regressões de orçamento/Chat. |
| B — Operação | #305/#310: especificar Pátio V1 sobre Produção V1; após aprovação do escopo, registrar entrada física distinta de agenda e saída. | Agenda não cria presença física; entrada/saída idempotentes, histórico e bloqueios explícitos; testes de concorrência e preservação de OS. Próximos incrementos: planejamento e progresso por fase. |
| C — Financeiro | Especificar fundação V1 (título, parcela, liquidação, contraparte, conta, moeda, datas, origem e auditoria); implementar só após contrato aprovado. | Casos sintéticos pagar/receber, parcial, estorno, duplicidade, saldos e reconciliação; valores exatos; nenhuma cobrança ou movimentação externa. |
| D — Documentos | #312/#313: inventariar OS/revisões e especificar vistoria de entrada/saída e índice documental, coordenado com B. | Vínculos por IDs, versões preservadas, evidências e autoria; sem inferir inspeção, aprovação ou compartilhar arquivos reais. |

Preparação paralela, não implementação: E — Suprimentos (contrato pedido/recebimento/custo/obrigação), F — Fiscal/parceiros (documentos exigidos, estados e integração fiscal, sem emissão/envio). Coordenação de plataforma é transversal, não mais quatro implementações simultâneas. Se uma frente aguardar decisão, liberar outra tarefa independente apenas após avaliar capacidade global.

## 6. Contratos de integração e ordem

| Contrato | Produtor / consumidores | Decisão a confirmar |
| --- | --- | --- |
| Identidade/veículo | Comercial/Chat → todos | Reutilizar IDs canônicos; conflitos não resolvidos por nome/placa. |
| Atendimento → consentimento → Experiência → autorização → OS | Comercial/Operação → documentos/financeiro | Preservar V24 e decisões posteriores, não confundir consentimento com liberação/receita. |
| Experiência → fase e itens de OS | Operação → suprimentos/gestão | Fase por Experiência, itens rastreáveis à OS, complementos sem duplicação. |
| Entrada/saída/inspeção/liberação | Operação ↔ documentos | Eventos distintos, autoria e critérios de autoridade; inspeção não decorre de status visual. |
| Pedido/recebimento/custo | Suprimentos → Operação/Financeiro | Atribuição de custo, competência e vencimento, sem criar obrigação duplicada. |
| Valor autorizado/faturamento/título/liquidação | Comercial/Fiscal/Financeiro | Estados distintos; origem e idempotência; pagamento não é inferido de entrega. |
| Documentos e evidências | Documentos ↔ todos | Metadados e IDs estáveis, acesso por papel, sem URLs privadas em artefato público. |

Congelar apenas contratos necessários para o próximo incremento. Toda mudança em schema/migração, sessão, identidade, API transversal, rotas globais ou eventos requer coordenação do responsável transversal; reservar versão de migração antes de implementar e revalidar contra a base integrada. Usar fixtures sintéticas e adaptadores de teste, não substituir banco real. Branch/worktree exclusivo por pacote; integração serializada em base atualizada, candidato HML identificado por SHA e testes. Uma HML compartilhada = fila única de publicação, salvo ambiente adicional explicitamente aprovado.

## 7. Sequência indicativa de ciclos

C1: inventário, contratos, estabilização e especificação V1 de Pátio/Financeiro. C2: entrada/saída e primeira unidade financeira, documentos mínimos. C3: etapas e prontidão, compras e títulos. C4: custos por Experiência, caixa e fechamento documental. C5: conciliar fluxos econômicos e operacionais. C6: piloto integrado e migração gradual, avaliar gate M2. Cadência inicial semanal ou quinzenal, sem compromisso de data; reduzir escopo ou WIP se a direção não conseguir validar. Replanejar com evidências após C1.

## 8. Protocolo de trabalho

1. Curadoria: demanda → issue existente (ou nova se necessário), objetivo, dono, dependências, limites, próximo resultado e critérios.
2. ChatGPT prepara requisitos/contratos, revisa PRs e usa conectores; Codex quando checkout, edição integrada, depuração e testes locais oferecem vantagem.
3. Executor em branch isolada, CI no SHA exato, evidência, limitações e revisão proporcional ao risco; não declarar revisão independente sem evidência.
4. Fila HML: verificar integridade do controlador, backups/reversão, candidato e isolamento. Homologação sintética/funcional e aceite explícito. Produção só com autorização específica.
5. Encerrar apenas após evidência de resultado e registrar o próximo passo. Contabilizar tempo até aceite, fila de revisão, bloqueios e retrabalho, não commits por agente.

## 9. Interface com o portfólio

O Painel de Desenvolvimento FUNIX é transversal a projetos, frentes e demandas avulsas. O FunixERP é apenas um projeto (manter ID estável `proj-funixapp` durante evolução). Ver [escopo do painel multiprojeto](../governanca/painel-desenvolvimento-portfolio.md). Não reclassificar projetos externos como módulos do ERP. ChatGPT é o curador e editor dos dados de acompanhamento sob demanda; o painel é uma interface de leitura, não um cadastro obrigatório. Não exigir que toda demanda tenha issue quando não se tratar de tarefa técnica que necessite desse registro. O GitHub é a fonte das tarefas deste repositório, não de toda necessidade empresarial.
