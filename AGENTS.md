# AGENTS.md — Aplicativo FUNIX

Localização neste checkout: guia e prompt em `docs/`, V20 em `docs/design/` e referências em `docs/referencias/`. Os anexos originais foram preservados nesses diretórios. O backend é apenas de leitura; não habilitar comandos sem auditoria e autorização específicas.

## Direção atual do projeto

A direção confirmou nesta conversa o objetivo de substituir integralmente o Coda por um ERP próprio, em três blocos: **Comercial → Produção → Financeiro**. O primeiro bloco se chama **Módulo Comercial do ERP FUNIX**. Ver `docs/DECISAO_COMERCIAL_PRIMEIRO.md` para distinguir decisões confirmadas, propostas técnicas e estado implementado. O novo comercial será desenvolvido para persistência própria; a premissa de Coda como fonte inicial continua valendo para os registros legados e a operação ainda não migrada. A aprovação dessa direção não autoriza migração de dados ou mutações produtivas indiscriminadas. O código atual continua sendo uma base de leitura.

A direção solicitou, antes da modelagem física e da migração, **análise funcional e redesenho dos processos comerciais**. Preservar resultados e regras de negócio válidas; reconstruir mecanismos que existam por limitações do Coda. Não transportar tabelas de interface, buscas pela última linha ou cadeias auxiliares como requisitos do novo sistema. Consultar `docs/analise-funcional-comercial/ESPECIFICACAO_FUNCIONAL.md` e o primeiro caso `REDESENHO_DIAGNOSTICO.md`. São estudos em elaboração; não representam processos redesenhados homologados nem autorizam alterações produtivas. Preservar a V20.

## Fonte primária de implementação

Leia `GUIA_MESTRE_CODEX_APP_FUNIX.md` e abra `FUNIX_V20_Menu_Compacto_Kanban.html`. A V20 é o contrato inicial de UX (protótipo, não backend). O Coda FUNIX é o registro inicial das operações reais. Consulte `referencias/00_master_index.md` e as referências 01–10 dessa pasta. Não confunda hipótese/protótipo com capacidade implantada ou política aprovada.

## Invariantes de produto

- Início = Conversas | Funil | Veículos; Histórico dentro de Veículos.
- Conversas abre Atendimento; interior do Atendimento preserva Chat | Mapa | Diagnósticos da V18 integrada à V20.
- Funil = Atendimentos. Acompanhamento/Histórico = Experiências.
- Atendimento pode existir sem Experiência; ao agendar, regra de negócio 1:1. Não duplicar Experiências.
- Chat↔Atendimento: relação conceitual N:N, com escopo de mensagens e desambiguação.
- Cliente/Veículo: cadastros estruturados incrementais, sem forçar criação no primeiro contato.
- Copiloto global/contextual: começar com busca, filtros e navegação; alterações somente via comandos autorizados.
- Preservar layout V20; Kanban horizontal/recolhível e Quadro/Lista; seta de retorno contextual no header; sem barras desnecessárias.

## Regras de engenharia

- Auditar Coda (fórmulas, botões, tipos e relações) antes de escrever; nenhuma mutação produtiva sem aprovação/ambiente seguro.
- `fase_Operacional` é calculada; não gravá-la para simular drag-and-drop. Agendamento `at_Agendar` e fluxo Atendimento→Orçamento→PDF→OS exigem auditoria.
- Coda permanece source of truth inicialmente; não migrar banco sem decisão. Segredos apenas no backend; autenticação, autorização, LGPD, logs mínimos, idempotência, recuperação e testes.
- Inventariar integrações verificáveis (Coda/Superhuman Docs, Evolution API, n8n, Redis, jsreport, Imagine.io e outras), sem presumir status.
- Não deixar o array fictício V20, chat de exemplo ou IA simulada em produção. Se integração não disponível, sinalizar mock claramente e isolar em adaptadores.
- Entregar incrementos executáveis com evidências de teste, limitações conhecidas e instruções de execução.

## Decisões e exceções

Perguntar ao responsável quando houver risco material de dados, dinheiro, segurança, conformidade ou mudança do desenho aprovado. Preferir alterações reversíveis e simples. Preservar histórico e autorizações comerciais/operacionais; IA não aprova escopo, preço, serviço ou entrega sem autorização adequada.
