# Issue #46 — revisão compacta do Copiloto

Base: `main` em `f57bb2d` (PRs #44 e #45 integradas). Branch: `feat/issue46-compact-voice-review`.

## Entrega

- Cabeçalho apenas “Copiloto”; transcrição atrás de ícone acessível por teclado; fechamento explícito.
- Resumo agrupado por peça, com + verde, − vermelho, ↔ e antes → depois neutros, ! amarelo para pendências e alertas. Os símbolos têm nomes acessíveis; a informação não depende só da cor.
- Nova projeção de apresentação `compactVoiceReview`, gerada no servidor exclusivamente do plano efetivo e contexto validado. O campo adicional `reviewGroups` preserva `review` legado; nenhuma frase é parseada e nenhuma chamada extra à IA foi adicionada.
- Diagnóstico, intensidade, quantidade, dimensão, observações consolidadas e flags finais continuam visíveis quando materiais. Alterações mostram antes/depois; linhas repetidas incluem posição e quantidade para diferenciação. Inclusões e exclusões independentes não são inferidas como uma troca arbitrária.
- Exclusões globais têm identificação e confirmação adicional existentes. Habilitação/desabilitação é identificada como exclusiva do cenário. A revisão informa uma vez que os dados são compartilhados.
- Comandos pendentes/conflitantes têm entidade/motivo e não aparecem como alterações válidas. Avisos sobre uma alteração válida (por exemplo dimensão ainda pendente) são distintos de comandos que não serão aplicados.
- JSON técnico e avisos redundantes de sucesso removidos. Após sucesso, o Atendimento é atualizado pelo mecanismo da PR45 e a revisão é limpa/fechada. Falhas mantêm revisão recuperável e erro operacional.
- Aplicação permanece fora da rolagem interna. Não foram adicionados campos de preço/unidade nem componentes por voz.

## Validação executada

- `npm run check`: build, tipos, **430 testes aprovados**, zero falhas/ignorados; lint aprovado com avisos existentes.
- Seis testes novos de projeção: inclusão consolidada comparada ao SQLite persistido; antes/depois de diagnóstico/intensidade/dimensão/notas/quantidade; flags de cenário; linhas repetidas/exclusão global; ambiguidade com/sem mudança válida; substituição no patch efetivo; conflitos (os testes combinam alguns desses casos).
- `FUNIX_VOICE_ARTIFACTS=/workspace/issue46-final-browser node scripts/voice-browser-review.mjs`: aprovado em Chromium com viewports **320, 390 e 1440 px**. Verifica grupos/símbolos, rolagem interna e ação alcançável, pendências sem botão de aplicação, teclado, transcrição, ausência do JSON e dos dois avisos redundantes, atualização/limpeza após sucesso, erro HTTP 503 recuperável e cancelamento/confirmação de exclusão global.
- Regressão PR45 mantida: negociação de **R$ 123,45** antes da interpretação, alterada depois do planejamento, preservada após aplicação, com nova prévia usando as revisões atuais.
- Suíte anterior de aplicação, idempotência, rollback, recomendações/limite, negociação, motor e PDFs/snapshots imutáveis continua aprovada. Somente SQLite sintético e provedores simulados; o teste HTTP de erro é interceptado localmente.

## Escopo preservado

Sem alterações em `voice-apply.ts`, `voice-planner.ts`, validação/modelo de comandos, repositórios comerciais, migrações, banco, motor ou contratos de confirmação. A única extensão HTTP é metadado de apresentação na resposta de interpretação. Sem acesso direto ao aplicativo publicado, merge ou deploy.

Capturas em [evidências](evidencias/pr46-copiloto). A emulação Chromium e os microfones/provedores simulados não substituem homologação em aparelhos físicos com áudio real. A próxima entrega de componentes por voz permanece fora desta PR, inclusive a regra de preço padrão R$ 0,00.
