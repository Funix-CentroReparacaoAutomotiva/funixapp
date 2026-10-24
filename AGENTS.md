# AGENTS.md — FUNIX, V1.0 / primeiro subincremento M1

## Autoridade e limite autorizado

A direção/CTO autorizou implementar **somente o primeiro subincremento M1**: criar, salvar, pesquisar, abrir, editar e reabrir Atendimentos no banco próprio. Ao concluir testes e apresentação, parar para revisão. Não fazer push, deploy, mudança de VPS/DNS/Cloudflare, alterações de credenciais, leitura/escrita produtiva Coda ou mutações de integrações sem autorização expressa.

Fontes atuais em `docs/especificacao-v1.0/originais/`: especificação unificada V1.0, respostas explícitas V1.0, V0.9 aprovada e V20. `FONTES.json` registra SHA-256 dos 20 originais recebidos. As respostas mais recentes e a autorização do CTO prevalecem sobre escopos antigos. A V20 determina identidade visual, com adaptações pontuais aprovadas na V1.0. A V0.9 determina regras comerciais futuras; comentários históricos não são regras vigentes. Documentos institucionais dão contexto, sem gerar funcionalidades automaticamente.

O antigo AGENTS foi preservado em `docs/historico/AGENTS_ANTES_V1_0.md`. Pareceres antigos de arquitetura, transferência por agendamento, sincronização operacional e divisão Comercial/Produção/Financeiro são históricos, não o contrato atual deste MVP.

## Produto e sequência oficial

- **M1:** Atendimento + composição/motor de orçamento, desenvolvido por subincrementos revisados.
- **M2:** integração unidirecional Coda, primeiro simulada e depois autorizada separadamente.
- **M3:** Chat real WhatsApp, preservando o canal atual e mostrando somente eventos reais.
- **M4:** IA assistiva com confirmação humana para alterações/envios.

O App não consulta/cria clientes, veículos, entidades ou pagadores Coda; não importa Atendimentos legados nem acompanha operação. Sem Veículos, Experiências, agenda, OS, Produção ou Financeiro no MVP. Enviar ao ERP não é agendar. Não desenvolver esses recursos nesta etapa.

## Contrato deste subincremento

- Reaproveitar React/TypeScript/Vite/backend Node; não reconstruir do zero.
- SQLite próprio via Node 24, migração versionada, dados fora do Git e sem fallback Coda.
- Telefone obrigatório na criação manual; demais campos comerciais opcionais e textuais. Telefone não é identidade civil nem chave única. Não inferir DDI de número ambíguo.
- UUID técnico estável independente de telefone/placa. Prefixo legível definitivo ainda requer confirmação; não inventar sequência Coda.
- Entrada somente Conversas e Funil. Chat e IA global/contextual explicitamente indisponíveis, sem simulações. Preservar identidade V20, Kanban horizontal/recolhível, Quadro/Lista, retorno contextual e cabeçalho coerente.
- Fases visíveis exatas: Novo lead; Aguardando dados; Em negociação (24h); Morno (3 dias); Frio (5 dias); Rejeitados. Sem avanço automático por tempo. Rejeição exige recusa explícita e motivo; ausência de resposta não vira perda.
- Sem motor de orçamento, catálogos, snapshots, PDF, WhatsApp ou IA neste subincremento. Acesso aos originais foi confirmado, mas hierarquia V2 é proposta, não catálogo validado.
- Persistência confirmada pelo backend é distinta de formulário ainda não salvo. Falhas devem preservar o formulário, com status verdadeiro, sem gravação fictícia.

## Engenharia e validação

Manter autenticação existente e validação de origem em escritas. SQL parametrizado, limites de entrada, erros sanitizados e dados sintéticos nos testes. Nenhum segredo no frontend/Git/logs. Não usar localStorage como banco comercial. Gravações de Atendimento são locais; ações externas continuam indisponíveis.

Executar `npm run check`, testes de persistência com arquivo real/reinício e QA de navegador conforme documentação do subincremento. Distinguir testes executados de requisitos futuros. Banco de produção exigirá armazenamento durável autorizado; não alterar infraestrutura nem implantar esse banco nesta tarefa. Não misturar dados de teste ao banco normal.
