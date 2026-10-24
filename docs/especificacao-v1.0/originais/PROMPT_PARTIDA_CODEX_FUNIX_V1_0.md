# FUNIX — Prompt de partida para Codex (V1.0 unificada)

**Início do trabalho no repositório existente `Funix-CentroReparacaoAutomotiva/funixapp`.**

Leia primeiro `FUNIX_ESPECIFICACAO_UNIFICADA_V1_0_PARA_CONFERENCIA.md` e os documentos do pacote `REFERENCIAS/`. Entenda que:

- V20 = UX/UI de referência, não banco nem lógica executável;
- V0.9 = regras comerciais aprovadas, não código;
- respostas V1.0 = decisões explícitas mais recentes sobre Chat, IA, navegação e **ordem de desenvolvimento**;
- hierarquia de peças V2 = **proposta navegacional** que ainda precisa de saneamento antes de uso como catálogo real;
- guias antigos e AGENTS preexistente podem conter escopo superado: não desenvolver Veículos, Experiências, OS, agenda, Produção e Financeiro no App.

**Ordem oficial de MVP:** M1 Atendimento + motor de orçamento → M2 integração unidirecional Coda → M3 Chat real WhatsApp → M4 IA. As quatro etapas são partes do mesmo MVP. Não iniciar por Chat ou IA apesar do protótipo V20.

**Sua primeira ação:** inspecionar branch, arquitetura, frontend, backend, APIs, testes e documentos atuais do repositório; comparar com a V1.0. Produza diagnóstico curto e lista de mudanças estritamente necessárias. Reaproveite React/TypeScript/Vite/backend Node e preserve a identidade visual da V20 onde não conflitar com novas decisões.

**Comece a implementar imediatamente um primeiro subincremento verificável do M1:** criar, salvar, pesquisar, abrir, editar e reabrir Atendimento em banco comercial próprio, via interface compatível com V20; remover a aba Veículos; manter Chat e IA identificados como indisponíveis até sua integração real. Telefone obrigatório em abertura manual, campos comerciais restantes opcionais; banco não consulta entidades de clientes/veículos do Coda. Corrigir contexto de cabeçalho para sempre corresponder ao Atendimento selecionado.

Depois de implementar, execute `npm run check` (ou os scripts efetivos encontrados) e testes independentes sobre dados sintéticos: persistência após reinício; telefone mínimo; opcionais; busca e troca de Atendimento; sem mutação Coda. Informe arquivos modificados, teste realizado, limitações e próximo subincremento M1. **Pare para revisão depois desse primeiro subincremento.**

**Não fazer:** novo app do zero, novo redesenho geral, clientes fictícios em produção, integração WhatsApp fingida, cálculo financeiro por floats imprecisos, migração de cadastros Coda, acesso/escrita Coda produtivo, alteração de VPS/DNS/Cloudflare, deploy ou push remoto sem autorização da direção. Decisões técnicas reversíveis e proporcionais são suas; dúvidas materiais que mudam o comportamento comercial, valores ou autorização devem ser expostas brevemente.

**Critério de êxito imediato:** ao abrir a aplicação, criar um Atendimento real no banco próprio, encerrar/reabrir o aplicativo e encontrá-lo com dados corretos, em telas consistentes com V20. O restante do M1 segue em incrementos após a primeira revisão, com os catálogos próprios que a direção disponibilizará.
