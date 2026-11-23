# FUNIX — MVP01 | Pré-ativação controlada, 14/11/2026

**Situação:** diagnóstico de preparação, não autorização de ativação. Esta entrega não altera Coda, Gmail, n8n, SQLite ou a configuração de produção. A PR acrescenta apenas o diagnóstico local server/gmail-analysis-preflight.ts e seus testes. A implementação do piloto continua OFF por padrão.

## Evidência verificada

- main/deploy WEB e API: 2989fdca49691d8556edf47a09450002547aaf45 (PR #222); contêineres saudáveis na verificação operacional informada pelo operador.
- SQLite instalado: esquema V18, uma OS; backup validado em 15/11/2026 UTC. Ensaio independente V18→V19 preservou tabelas/OS/orçamentos, mas **não** migrou produção. A PR #224 foi integrada à main em 15/11/2026 UTC (commit 8e801e9b0a8fc1fe5feec40d533d9e639e8b013b), mas o deploy produtivo V19 não foi comprovado. O estado da VPS deve ser verificado imediatamente antes de qualquer implantação.
- Gmail automático: mensagem de teste 1a1dca29843b68bd chegou ao ledger n8n, estado notified, sem erro; aviso correspondente estava awaiting_authorization. Não autorizar/reutilizar este caso histórico.
- Banco inspecionado: nenhum vínculo em gmail_analysis_pilot_scope, zero gmail_analysis_jobs.
- Variáveis de análise Gmail/Coda/OpenAI e corte/UUID estavam ausentes. Atualizações Storage, Gmail Intake e Queue estavam ativos; FUNIX_UPDATES_DECISIONS_ENABLED e FUNIX_UPDATES_CLARIFICATIONS_ENABLED estavam desligados.

## Bloqueio do contrato Coda — confirmado por leitura conectada

Documento Coda FUNIX: 2zsjI-nqWr.

| Tabela | ID | Campos relevantes observados | Lacuna |
| --- | --- | --- | --- |
| sgf_FilaAcontecimentos_Piloto | grid-ufoEhxRmil | Mensagem, situação, placa, experiência | **É uma fila**, não a fonte de contexto completo. |
| db_Processos | grid-ddGJJK3zs5 | ID_Processo (c-NBx3h_s_A1), Experiencia (c-uk1qayn1Ye) | Sem campos diretos de orçamento, versão e parceiro. |
| db_Experiencias | grid-oejkc9WuBX | xp_ID Experiencia (c-Zorfa5ARUf), ux_EspecificacaoPlaca (c-nixw6omFKQ), xp_OrcamentosGerados (c-YHFvtWsNV7) | Orçamentos são vínculos; não há equivalente inequívoco dos sete campos. |
| db_Orcamentos | grid-LgsVNgYj3J | ID_Orcamento (c-8dKWwlT8ZU), Placa (c-Q7iJ11V9iS), Veículo (c-tXwTM9CWaB), Seguradora (c-gz2gJg-gjC), Experiencia (c-ZFbj5rInCv) | Não há ID de processo e versão diretamente identificáveis. |

O adapter analysisCodaReader de server/gmail-analysis-providers.ts consulta **uma** tabela com sete colunas: processId, experienceId, plate, vehicle, partner, budgetId, budgetVersion. Não foi comprovada tabela única preexistente com esse contrato. **Nunca mapear processId para ID_Atendimento nem inventar versão de orçamento ou vínculo baseado apenas na placa.**

Possíveis soluções sujeitas a aprovação e testes:
1. Projeção de leitura no Coda com sete campos auditáveis, proveniência de vínculos e versão; alterações no Coda exigem autorização específica.
2. Adapter backend de leitura normalizada (Processos + Experiências + Orçamentos), com joins conservadores, tratamento de vínculos múltiplos, versão ausente e testes. PR separada; sem escrituras no Coda.

Nenhuma dessas soluções está implementada nesta PR.

## Pré-verificação automatizada (sem segredos)

Após publicação autorizada desta PR, no contêiner API:

~~~bash
sudo docker exec funixapp-api-1 node server/gmail-analysis-preflight.ts
~~~

O comando executa somente SELECT no SQLite e lê a presença de variáveis/flags. **Não** lê conteúdo de e-mails, não consulta Gmail/Coda/OpenAI, não imprime tokens, contas ou IDs configurados, não inicializa análise. readyForManualReview=true significa somente configuração local estruturalmente consistente; **não** prova permissões reais e **não** autoriza ativação. Código de saída 2 indica impedimentos.

O preflight bloqueia se análise já está ativa, piloto vinculado anteriormente, jobs presentes, aviso antigo/decidido, mapa Coda incompleto ou duplicado, segredo ausente, flags dependentes desligadas ou modo sintético incompatível.

## Procedimento de ativação — **não executar automaticamente**

1. Preservar backup externo e revisar compatibilidade de todas as instâncias; confirmar fonte Coda sem usar fila de acontecimentos.
2. Preparar credenciais exclusivas no cofre ou /etc/funix/runtime.env, validando privilégios reais de Gmail gmail.readonly, Coda somente leitura e projeto/chave OpenAI dedicado com limite financeiro. **Nunca** expor valores no Git, conversas, prints ou logs.
3. Registrar corte UTC **antes** de uma mensagem nova; enviar manualmente (por pessoa autorizada) o teste de piloto, receber aviso e capturar UUID, mantendo-o awaiting_authorization. Não reaproveitar o e-mail de 14/11.
4. Configurar UUID/corte/mapa/modo real-pilot, ainda com ENABLED=false; executar preflight e conferir pendências humanas. CODA_READ_ONLY_CONFIRMED=true sozinho não comprova permissão.
5. Somente após autorização expressa, ligar ENABLED=true, reiniciar de forma controlada e conferir GET autenticado /api/atualizacoes/analises-gmail?ids= com valid=true e authorized=false. Depois do vínculo persistente, não mudar UUID/corte/modelo/contexto.
6. Autorizar o único aviso na UI e acompanhar proposta reviewOnly; nenhuma comunicação deve ser enviada por IA ou alterações executadas no ERP/Coda/WhatsApp/Drive.

## Critério de avanço

**Não liberar ativação operacional do piloto** sem fonte Coda auditada, permissões reais confirmadas, novo aviso após corte, backup externo, autorização de teste de dados de terceiros e CI/revisão técnica. Aprovação de propostas não deve executar ações externas.

**Referências:** docs/integracoes/MVP01_GMAIL_ANALISE_CONTEXTUAL.md, server/gmail-analysis-providers.ts, server/gmail-analysis-pilot.ts, PRs #222/#220/#224 e evidências de 14/11/2026; conferência de estado da main em 15/11/2026 UTC.
