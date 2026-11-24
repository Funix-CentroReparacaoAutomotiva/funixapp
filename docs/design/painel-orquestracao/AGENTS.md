# AGENTS.md — FUNIX | Central de Orquestração

> Diretriz consolidada em 24/11/2026, issue #347. Escopo exclusivo: curadoria de dados de acompanhamento. Não concede permissões novas.
> Roadmap de referência: PR #354, `docs/governanca/painel-desenvolvimento-portfolio.md` (v0.3). Leia [PUBLICACAO_DADOS.md](./PUBLICACAO_DADOS.md) e [snapshot.json](./snapshot.json).

## 1. Papéis e fonte
- Direção é orquestradora: decide prioridades, escopo, autorizações e aceite.
- ChatGPT organiza, registra, reagrupa e atualiza sob solicitação. Não exigir cadastro manual, taxonomia fixa ou issue para demanda não técnica. Não existe CTO autônomo responsável pelo mapa nem monitoramento contínuo.
- Sessões especializadas entregam evidências e próximos passos; não duplicam execução ou publicam sem autorização aplicável.
- A Web HML em https://hml.funix.com.br/painel/ lê o snapshot público desta branch ao clicar Atualizar; falha conserva o mapa exibido. Consulta de issues/PRs não mede atividade de agentes. Não presumir implantação de nova UI.

## 2. Portfólio flexível
- Projetos raiz confirmados: FunixERP (`proj-funixapp`), SGF (`proj-sgf`) e Painel de Orquestração (`proj-painel-desenvolvimento`). Não fixar esses nomes/quantidades no código. Caixa de ideias é card avulso, não projeto.
- Projeto: ID único e estável, `presentation: "group"`, `parentId: null`; frentes/subfrentes ligadas por ID. Demandas sem projeto podem ser cards avulsos. Preservar IDs, evidências e histórico ao reagrupar; não duplicar uma ideia após classificação. O painel não descobre projetos/chats automaticamente.
- SGF abrange assistentes de gestão (arquitetura a definir) e automações gerenciais. Não declarar boletim diário ou assistente operacional sem evidência; acesso cotidiano a recursos disponíveis é evolução futura.
- GitHub é fonte canônica de tarefas técnicas deste repositório, não de toda necessidade FUNIX. Usar fontes autorizadas; contrato atual restringe referências públicas GitHub ao repositório indicado. Não simular suporte a fontes externas ou privadas. Não inventar projetos/links.

## 3. Estados e evidências
- Distinguir issue aberta de atividade; PR integrada, CI aprovado, instalação e aceite operacional são estados distintos. Planos, protótipos e relatórios históricos não comprovam execução atual.
- Se incerto, `nao_verificado` ou `acompanhamento`, com explicação. Não inventar estado, responsável, prioridade, data, bloqueio ou percentual.
- Estados materiais (`em_execucao`, `em_revisao`, `homologacao`, `bloqueado`, `concluido`) exigem `statusReason`, `updatedAt` e evidência issue/PR pertinente; `bloqueado` exige `blocker`. Vínculo por si só não comprova conclusão.
- `decisionPending: true/false` apenas após conferência explícita; ausente/null = não verificado. Não inferir decisão a partir de bloqueio. Contagens por folhas de trabalho não duplicam pais. Exibir — para desconhecido sem positivos, N+ para mínimo confirmado, zero somente quando determinado. A UI consolidada #353 traz quatro indicadores por projeto e cinco por frente; não pressupor sua instalação na HML. Não adicionar alertas de dado antigo ou textos excessivos ao card.

## 4. Atualização sob demanda (sem deploy)
1. Receber pedido da direção; ler mapa vigente e histórico.
2. Confrontar mudanças com evidências. Preparar proposta em branch derivada de `painel-publicado`, só mapa e documentação pertinente. Se for problema de código, tratar na #347/#353 ou PR técnica própria.
3. Alterar `snapshotId` a cada publicação material e `publishedAt` para horário real; manter schemaVersion 1, repository `Funix-CentroReparacaoAutomotiva/funixapp`, hierarquia sem ciclos, URLs canônicas e limites do contrato.
4. Validar pelo modelo/validador e testes compatíveis; revisar diff, privacidade e evidências. Se execução oficial indisponível, declarar limitação, não fingir testes.
5. Publicar por PR com base `painel-publicado` após aprovação aplicável. Pedido explícito de publicação de dados dentro do escopo é autorização dessa publicação, sem pedir confirmação repetida. Não autoriza merge de software ou deploy. Não contornar proteção de branch ou validações.
6. Conferir leitura de retorno e versão publicada. Informar direção para clicar Atualizar; não declarar aceite visual sem evidência.

## 5. Limites
- Repositório e snapshot públicos mesmo com Basic Auth da página. Somente metadados genéricos autorizados. Nunca dados financeiros/RH/operacionais confidenciais, clientes, links privados de chats/documentos, credenciais ou identificadores sensíveis. Recursos e vínculos privados exigem fonte privada autorizada.
- Sem alteração de API, SQLite, VPS, produção, Traefik, gateway, Docker ou autenticação em atualização de mapa. Sem cron, webhook, agente autônomo ou API IA paga por padrão. A restrição é sobre atualização do painel, não proibição de automações SGF autorizadas separadamente.
- Código: #353 consolida #337/#348/#352; não iniciar implementação concorrente. HML segue #356 e procedimento simplificado; #330 encerrada por obsolescência. Não reativar controlador legado. Release e autorização operacional são independentes.

## 6. Critério de pronto
Mapa validado e autorizado, novo snapshotId, commit visível na branch, evidências rastreáveis e comunicação à direção. Aceite no navegador separado. Registrar limitações. Não confundir publicação de dados, instalação de código e uso efetivo.
