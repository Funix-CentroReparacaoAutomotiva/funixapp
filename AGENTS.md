# AGENTS.md — FUNIX, Issue #7 / MVP Comercial integrado

## Autoridade e limite autorizado

Autorização atual: Issue #7, invocada pelo proprietário, para implementar a cadeia integrada do MVP Comercial em branch própria a partir de M1.2 `06e5a46035097b779872765eff8a5f2ababf7509`: cenários/matriz, configuração e motor V0.9, componentes, emissões N e PDF verdadeiro, QA integrado. Uma homologação funcional ao fim, com etapas internas testadas e revisão técnica. Permitidos commits e PRs de desenvolvimento; sem merge, deploy, execução remota, Coda, WhatsApp/IA ou mudanças de infraestrutura/secrets. Esta autorização substitui o limite antigo de parar após M1.2; não interromper trabalho independente para homologar microetapas.

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
- Catálogos simplificados por autorização posterior à Issue #7: catálogo único, sem aprovação manual nem distinção operacional de origem/status. Itens ativos e identificados são utilizáveis imediatamente; peças sem código permanecem indisponíveis, sem inventar identidades. Preservar hierarquia, referências e campos legados, sem migração destrutiva. Implementar apenas os cálculos V0.9 aprovados com dados configuráveis; nunca inventar preços, fatores ou etapas. Vazios bloqueiam emissão, não rascunho. WhatsApp/IA e Coda continuam indisponíveis.
- Uma composição mestre por Atendimento; cenários contêm somente máscaras por IDs estáveis. Uma peça física, serviços repetidos permitidos; edição de atributos é global; novos itens habilitados só no cenário ativo. Peça pai desligada preserva flags dos filhos. Matriz usa inclusão efetiva.
- N cenários e N emissões, sem limite de três. Emissão manual, idempotente, snapshot imutável e PDF real; dinheiro e quantidades exatos, sem floats financeiros.
- Adicionar migrações sem recriar Atendimentos; provar atualização a partir do SQL original do M1.1, reinício, rollback de falha e ausência de órfãos na composição. Seguir as etapas internas da Issue #7 e submeter a entrega integrada para revisão.
- Persistência confirmada pelo backend é distinta de formulário ainda não salvo. Falhas devem preservar o formulário, com status verdadeiro, sem gravação fictícia.

## Engenharia e validação

Manter autenticação existente e validação de origem em escritas. SQL parametrizado, limites de entrada, erros sanitizados e dados sintéticos nos testes. Nenhum segredo no frontend/Git/logs. Não usar localStorage como banco comercial. Gravações de Atendimento são locais; ações externas continuam indisponíveis.

Executar `npm run check`, testes de persistência com arquivo real/reinício e QA de navegador conforme documentação do subincremento. Distinguir testes executados de requisitos futuros. Banco de produção exigirá armazenamento durável autorizado; não alterar infraestrutura nem implantar esse banco nesta tarefa. Não misturar dados de teste ao banco normal.
