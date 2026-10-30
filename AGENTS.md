# AGENTS.md — FUNIX, Issue #7 / MVP Comercial integrado

## Decisão vigente Issue #20 — 29/10/2026

FC habilitado por serviço, FR sempre no normal e exceção exata tabela+serviço+dimensão ignora todos os fatores. Modo Desconto somente sobre serviços com `discountable === true`; componentes e serviços não descontáveis mantêm preços integrais. Negociação/ajuste segue o contrato anterior, sem rateio novo. MR continua único por Atendimento. Flags no JSON de configuração V7, sem nova tabela/migração: FC ausente preserva comportamento global legado; FC null é pendência explícita; desconto ausente nunca concede permissão. Faturável é atributo informativo distinto. A fonte atual confirma FV 1/0.8/0.6/0 para as quatro tabelas, pela decisão simplificada da direção; não transportar herança/percentuais Coda. FC divergente entre regras requer revisão, energia negativa/incompleta continua bloqueada. Finalização do PR #21 após merge do #19: base main. Decisão posterior 6500884942: FC false para Interna/Lavagem/Inspeção técnica pelos IDs de origem e opção MR Padrão 1.2 (1,20), sem seleção automática. Importação preserva valores locais, reutiliza MR equivalente e sinaliza divergências. Sem migração nova, merge, deploy ou alterações produtivas. Registros atuais são de teste; não criar mecanismos adicionais de compatibilidade só para preservá-los e não apagar o banco nesta tarefa. Relatório: `docs/ISSUE20_REGRAS_COMERCIAIS.md`.

## Decisões atuais pós-auditoria do PR #17

A direção autorizou área global **Configurações**, rota `/configuracoes`, ao lado de Conversas/Funil; reutilizar CatalogManager/PricingEditor. Histórico permanece no Atendimento, sem acesso duplicado à configuração global. Isso substitui a proibição anterior de tela Configurações. Exibir `Calculando…` em linhas/totais pendentes e indicação de valor não atualizado em falha, sem calcular dinheiro no frontend.

O único multiplicador de componentes é MR por Atendimento. Remover FCT do contrato, repositório e PDF novos. Migração V7 remove apenas a coluna obsoleta, sem reset automático de Atendimentos/catálogos/configurações. Os DDLs de versões anteriores e fixtures de upgrade continuam históricos para permitir a atualização. Dados existentes são de teste, mas não é necessário excluí-los para essa migração. Não há autorização de execução em produção/VPS, merge ou deploy. Detalhes e evidências atuais em `docs/PR17_AJUSTES_AUDITORIA.md`.

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
- Entrada por Conversas, Funil e Configurações globais (administrativa). Chat e IA global/contextual explicitamente indisponíveis, sem simulações. Preservar identidade V20, Kanban horizontal/recolhível, Quadro/Lista, retorno contextual e cabeçalho coerente.
- Fases visíveis exatas: Novo lead; Aguardando dados; Em negociação (24h); Morno (3 dias); Frio (5 dias); Rejeitados. Sem avanço automático por tempo. Rejeição exige recusa explícita e motivo; ausência de resposta não vira perda.
- Catálogos simplificados por autorização posterior à Issue #7: catálogo único, sem aprovação manual nem distinção operacional de origem/status. Itens ativos e identificados são utilizáveis imediatamente; peças sem código permanecem indisponíveis, sem inventar identidades. Preservar hierarquia, referências e campos legados, sem migração destrutiva. Implementar apenas os cálculos V0.9 aprovados com dados configuráveis; nunca inventar preços, fatores ou etapas. Vazios bloqueiam emissão, não rascunho. WhatsApp/IA e Coda continuam indisponíveis.
- Complemento aprovado no PR #11: edição compacta no cabeçalho, sem faixa/título duplicados ou acesso operacional à manutenção de catálogos; miniabas numéricas com variações por cópia de flags e comparação; seletor de peças compacto. A administração originalmente restrita ao código/API foi levada à área global Configurações pela decisão pós-auditoria do PR17; sem seed comercial fictício. Cenários usam ordem numérica estável; letras são exclusivas das versões de orçamento. Preservar snapshots anteriores.
- Uma composição mestre por Atendimento; cenários contêm somente máscaras por IDs estáveis. Uma peça física, serviços repetidos permitidos; edição de atributos é global; novos itens habilitados só no cenário ativo. Peça pai desligada preserva flags dos filhos. Matriz usa inclusão efetiva.
- N cenários e N emissões, sem limite de três. Emissão manual, idempotente, snapshot imutável e PDF real; dinheiro e quantidades exatos, sem floats financeiros.
- Adicionar migrações sem recriar Atendimentos; provar atualização a partir do SQL original do M1.1, reinício, rollback de falha e ausência de órfãos na composição. Seguir as etapas internas da Issue #7 e submeter a entrega integrada para revisão.
- Persistência confirmada pelo backend é distinta de formulário ainda não salvo. Falhas devem preservar o formulário, com status verdadeiro, sem gravação fictícia.

## Engenharia e validação

Etapa B autorizada pela direção: navegação do Atendimento por telas completas, cabeçalhos/retorno nativo, apresentação compacta de cenários, swipe principal e Copiloto visível nas três abas. Base `24354733ef2b5e2c39fc036f23746529311a5282`. Reaproveitar History API/componentes, preservar autosave/guards/cenários/preços/PDF. Sem etapas C/D, importação Coda real, alterações produtivas, merge/deploy ou infraestrutura. Relatório: `docs/ETAPA_B_NAVEGACAO.md`; QA somente em bancos sintéticos isolados.

Issue #22: otimizar apenas gargalos medidos de autosave, recargas e consultas, na base `d829b948f6a0198d805aca47e3760304a9223f62` (PRs #19/#21 integrados). Preservar revisões otimistas, recuperação de gravações incertas, fórmulas, snapshots/PDFs e UI/UX do mapa. Medir antes/depois com bancos sintéticos isolados; não corrigir independência preço–energia, importar Coda, acessar VPS, alterar o banco existente, workflows ou infraestrutura. Entrega em PR para auditoria, sem merge/deploy. Relatório: `docs/ISSUE22_DESEMPENHO.md`.

Manter autenticação existente e validação de origem em escritas. SQL parametrizado, limites de entrada, erros sanitizados e dados sintéticos nos testes. Nenhum segredo no frontend/Git/logs. Não usar localStorage como banco comercial. Gravações de Atendimento são locais; ações externas continuam indisponíveis.

Executar `npm run check`, testes de persistência com arquivo real/reinício e QA de navegador conforme documentação do subincremento. Distinguir testes executados de requisitos futuros. Banco de produção exigirá armazenamento durável autorizado; não alterar infraestrutura nem implantar esse banco nesta tarefa. Não misturar dados de teste ao banco normal.
