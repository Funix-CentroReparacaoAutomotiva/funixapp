# AGENTS.md — FUNIX | Painel de Orquestração do CTO

> **Escopo:** exclusivamente a manutenção dos **dados de acompanhamento** do painel FUNIX. Este arquivo complementa o `AGENTS.md` da raiz do repositório, a governança técnica e as autorizações vigentes. **Não concede permissões novas.**
>
> **Ler também:** [PUBLICACAO_DADOS.md](./PUBLICACAO_DADOS.md), [snapshot.json](./snapshot.json), [issue #301](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/301) e o contrato/validador do painel na branch `release/301-painel-hml-candidate`.

## 1. O que já existe

- A interface do painel está implantada na **HML**, em `https://hml.funix.com.br/painel/`, sob a autenticação existente.
- A interface possui botão **Atualizar** que consulta **somente quando acionado pelo usuário** o arquivo `snapshot.json` desta branch `painel-publicado`.
- O painel carrega a cópia instalada ao abrir a página; não sincroniza a estrutura automaticamente. A cada clique, compara a versão publicada e só substitui os cards se receber um mapa novo e válido. Em falha, preserva o mapa exibido.
- O estado de PRs/issues vinculadas pode ser consultado separadamente pela API pública do GitHub; **não** é um medidor automático de progresso dos agentes.
- **Não existe** coleta horária, agendamento de agente, atualização contínua, banco de tarefas do painel ou publicação de dados sem intervenção autorizada.

## 2. Papéis e gatilho de trabalho

- **Direção:** usa o painel para acompanhar as frentes e autoriza decisões fora da alçada delegada.
- **CTO:** é o curador responsável pela estrutura, estados, evidências e prioridades exibidos. Define quando atualizar e pode designar um subagente para pesquisar, reconciliar e preparar a proposta.
- **Subagente:** só trabalha quando convocado pelo CTO ou por instrução autorizada no contexto; não assume autonomia recorrente, não publica dados sem a revisão/aprovação cabível e não modifica código nem infraestrutura por dedução deste arquivo.
- **Usuário:** clica em **Atualizar** no painel quando quiser consultar a versão aprovada.

## 3. Fonte de verdade e interpretação

Consultar registros atuais e públicos do repositório `Funix-CentroReparacaoAutomotiva/funixapp` (issues, PRs, checks, commits e decisões técnicas). Não confundir:

- Issue aberta com desenvolvimento ativo; comentário ou commit com entrega homologada.
- PR aberta/integrada com implantação, aceite funcional ou atendimento concluído.
- Plano, rascunho, evidência histórica ou teste simulado com capacidade operacional vigente.
- Agrupamento do mapa com uma equipe/agente trabalhando nele naquele momento.

Quando houver dúvidas, manter `nao_verificado` ou `acompanhamento`, com explicação factual; jamais inventar status, responsável, data, bloqueio ou percentual.

Para estados materiais (`em_execucao`, `em_revisao`, `homologacao`, `bloqueado`, `concluido`), fornecer **`statusReason`**, **`updatedAt`** e **`evidence`** ao menos com uma issue ou PR pertinente. Para `bloqueado`, preencher também `blocker`. O vínculo é rastreabilidade, não prova automática de conclusão: verificar se a evidência sustenta a afirmação.

## 3.1. Vários projetos precisam aparecer como raízes no mapa

O painel **não descobre projetos automaticamente** a partir de outros chats, agentes, issues ou PRs. Para cada projeto que a direção deve visualizar, criar/atualizar um nó próprio em `snapshot.json` com:

- `id` único e estável, `title` curto e `presentation: "group"`;
- `parentId: null` para ser um **projeto principal**, irmão de `proj-funixapp` (não filho dele);
- `type: "Projeto"` ou classificação realmente adotada, `status` conservador e demais campos conforme evidências;
- frentes e subfrentes vinculadas pelos seus `parentId` corretos, preservando a rastreabilidade.

Exemplo de **estrutura**, não de projetos a inventar: `CTO → [Projeto A, Projeto B] → [Frentes] → [Subfrentes]`.

Projetos registrados só em outras branches ou em tarefas do GitHub **não aparecem** até sua entrada explícita nessa branch. Não inventar projetos ausentes nem marcar atividades de outros repositórios como comprovadas por issues do FunixApp. Atualizar `snapshotId` e `publishedAt` ao publicar uma mudança do mapa, confirmar o commit em `painel-publicado` e pedir à direção que clique em **Atualizar**.

## 3.2. Indicadores compactos do Modelo B e confiança dos números

O painel usa os dados do `snapshot.json` para mostrar um card com **nome + status**, **data de publicação** e, na linha inferior, **frentes diretas, decisões, ativos, bloqueados e concluídos**. Não adicionar alertas de desatualização, textos ou novos rótulos à superfície do card.

- Frentes = quantidade de `parentId` diretamente vinculados ao nó. A árvore determina isso sem lançamento manual.
- Ativos, bloqueados e concluídos = folhas de trabalho no ramo (sem contagem dupla de pai e filho), avaliadas pelos `status` `em_execucao`, `bloqueado` e `concluido` já vigentes.
- `status: nao_verificado` não comprova zero nos três estados. Se houver folhas sem verificação, números positivos aparecem como **mínimos** (`2+`); se não houver nenhum conhecido, aparece **`—`**, não 0.
- Para **decisões**, o contrato do frontend aceita `decisionPending: true` ou `false` por trabalho terminal quando o CTO tiver verificado esse campo; ausente/null significa não verificado. Se ainda não houver campo confiável, o painel exibirá **`—`**. Não preencher falsos zeros em massa, nem criar decisões com base em texto, status ou bloqueio.
- Um **0** no card deve ser entendido como valor efetivamente determinado na árvore publicada, não como suposição sobre trabalhos ainda não investigados.
- As contagens são projeção da fonte, **não substituem** a conferência técnica e não autorizam marcar trabalho como concluído ou implantar qualquer mudança.

## 4. Atualização sob demanda, sem deploy

1. **Receber a solicitação do CTO** com o escopo (frentes a revisar ou mapa completo).
2. **Ler o arquivo publicado atual** desta branch e seu histórico. Preservar IDs estáveis de nós, relações e registros; editar apenas o necessário. Não acrescentar cards somente para espelhar toda issue.
3. **Confrontar cada mudança relevante com fontes**. Registrar descrição, situação, motivo, próximo resultado, bloqueio, papel e evidência quando cabível. Se uma atividade não puder ser confirmada, identificá-la como não verificada.
4. **Preparar a proposta** numa branch de trabalho derivada de `painel-publicado`, alterando somente o mapa `docs/design/painel-orquestracao/snapshot.json` e eventual documentação pertinente.
5. **Versionar corretamente**: cada publicação material de dados precisa de um novo `snapshotId` único e de `publishedAt` com data/hora real de publicação. Não reutilizar um ID anterior. Não retroceder silenciosamente a data nem mudar o conteúdo mantendo a mesma versão.
6. **Validar e revisar**: manter `schemaVersion: 1`, `repository: Funix-CentroReparacaoAutomotiva/funixapp`, hierarquia sem ciclos, referências/URLs GitHub coerentes e conteúdo sem segredos ou dados pessoais. Usar o validador e os testes do painel da branch de desenvolvimento/release correspondente; se a base de trabalho não os contiver, testar com checkout isolado do código que implementa o contrato. Revisar o diff antes de publicar.
7. **Publicar somente após a aprovação aplicável**: preferir PR de dados com **base `painel-publicado`**. Integrar a PR aprovada nessa branch; nunca confundir com merge em `main` ou com release de software. Não disparar workflow de deploy da HML.
8. **Conferir o resultado**: confirmar que o commit está em `painel-publicado` e que a API pública disponibiliza o `snapshot.json`; orientar a direção a clicar em **Atualizar** no painel. O botão confirma a consulta no navegador, não a implantação do FunixApp.
9. **Registrar o que mudou**: informar ao CTO revisão/commit, frentes alteradas, evidências, pendências não verificadas e eventual limitação de sincronização ou acesso ao GitHub.

## 5. Limites de segurança e mudança

- Esta branch e os arquivos são **públicos**, ainda que a HML exija login. Não publicar nomes de clientes, informações internas de funcionários, senhas, tokens, IPs privados, arquivos operacionais sensíveis ou qualquer dado que não deva ser público.
- **Não alterar** API, banco, produção, VPS, Traefik, gateway, Docker, configurações de autenticação, fluxos financeiros nem a estrutura de deploy para atualizar os cards.
- **Não criar** cron, GitHub Actions agendado, n8n, webhooks ou agentes autônomos de atualização. O modelo aprovado é exclusivamente sob demanda.
- **Não forçar** PR, burlar proteção de branch, remover validações ou conceder acesso a si próprio. Em conflito ou falta de autorização, preparar proposta e escalar ao CTO/direção.
- Se houver problema no **código do painel**, abrir tarefa/PR técnica distinta, em branch própria, com testes e aprovação de implantação. Uma alteração de código não se publica como se fosse apenas mudança de `snapshot.json`.
- A atualização dos dados **não constitui deploy**. Novos merges em `painel-publicado` não substituem imagens da HML e não devem alterar o FunixApp em produção.

## 6. Critério de pronto de uma atualização

Considerar concluída a **publicação de dados** somente quando: mapa aprovado e validado, novo `snapshotId`, commit visível na branch `painel-publicado`, histórico/evidências rastreáveis e comunicação ao CTO. **Aceite visual no painel** é verificação separada e deve ser relatado como tal; não alegar que o usuário clicou em Atualizar ou que visualizou a revisão sem evidência.
