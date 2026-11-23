# FUNIX ERP — Painel de Orquestração | MVP funcional

**Estado:** código funcional em desenvolvimento. **Não implica publicação, homologação operacional ou autorização de deploy.**

## Finalidade

Página online, estática e somente de leitura para o proprietário enxergar a estrutura de desenvolvimento definida pelo CTO e os registros públicos associados a cada trabalho. Sem cadastro de tarefas, chat com CTO, execução ou aprovação de agentes pelo painel.

## Como abrir

- Para uma demonstração sem instalar nada, abra o `FUNIX_Painel_Orquestracao_Funcional.html` entregue junto com o pacote. Ele inclui um **snapshot embutido**: navegação, mapa e histórico funcionam sem servidor; quando o navegador permite, consulta os **estados atuais** das PRs/issues via API pública do GitHub. A estrutura do HTML avulso só muda ao receber uma nova cópia.
- Para a **versão conectada e atualizável**, hospede `index.html`, `styles.css`, `app.mjs`, `model.mjs` e `snapshot.json` juntos, em um serviço HTTPS estático com acesso adequado. O navegador busca `snapshot.json` a cada carregamento ou clique em Atualizar, independentemente do código de interface. O GitHub é consultado apenas para os estados dos registros técnicos exibidos.
- Em desenvolvimento local, entre nesta pasta e execute `python3 -m http.server 8765 --bind 127.0.0.1`; acesse `http://127.0.0.1:8765/`. Não abrir `index.html` diretamente em `file://`; use o standalone para esse caso.

## O que o CTO controla

A fonte é `snapshot.json`, em contrato v1 (`schemaVersion: 1`). O CTO pode substituir livremente o agrupamento de exemplo FunixApp, suas seis frentes e 16 épicos iniciais, inclusive por um mapa vazio, com novos níveis, papéis e dependências. **Nenhuma frente, ID, número de níveis, quantidade de agentes ou tipo de projeto é fixada na interface.**

- `root`: nó central, título e descrição.
- `nodes`: `id` estável, `parentId` opcional, tipo, título, descrição, estado operacional, razão, próximo resultado, bloqueio, papéis, data e referências de evidência.
- `relations`: vínculos explícitos entre trabalhos, fora da hierarquia pai-filho (mostrados em detalhes; conexões entre frentes de topo aparecem tracejadas).
- `records`: vínculo explícito de cada issue, bug, PR ou outro registro a um nó. Subdivisões herdam a consulta do histórico de seus descendentes. PRs não são atribuídas automaticamente por palavras no título ou pelo autor.
- `snapshotId`, `publishedAt`: identidade e data da revisão documental. **Não são timestamps de execução técnica nem de implantação.**

### Estados permitidos

`nao_verificado`, `planejado`, `acompanhamento`, `em_execucao`, `em_revisao`, `homologacao`, `bloqueado`, `concluido`.

Apenas o CTO, com evidências rastreáveis e autoridade aplicável, preenche estados materiais. `concluido` é registro do CTO e não significa automaticamente publicado ou aceito operacionalmente. O snapshot inicial usa **Em acompanhamento** para as iniciativas públicas e **Não verificado** para os épicos sem comprovação de etapa. Há uma exceção comprovável: o épico de governança inclui este MVP em desenvolvimento, com PR #318.

### Atualização segura

1. O CTO consulta a situação efetiva das entregas e o histórico do repositório.
2. Atualiza apenas os campos necessários de `snapshot.json` em branch/PR autorizada, sem dados internos, pessoais ou segredos.
3. Testa `node --test tests/painel.test.mjs` e revisa o diff; publica o snapshot por mecanismo de aprovação apropriado.
4. A página servida pela web passa a ler o novo arquivo no próximo acesso/atualização. **O site não modifica o JSON, não cria PRs e não aciona agentes.**

## Segurança e limitações

- O repositório `Funix-CentroReparacaoAutomotiva/funixapp` é público. Por isso este snapshot contém apenas títulos e registros públicos, não inclui clientes, colaboradores identificáveis, infraestrutura privada, credenciais nem relatórios internos.
- A versão estática realiza consultas **não autenticadas** a `api.github.com` apenas para itens visíveis; há cache local de cinco minutos para reduzir rate limit. Se a API estiver indisponível, o rótulo fica **Estado não verificado**, sem inventar status.
- O painel não descobre automaticamente uma iniciativa nova apenas pela existência de uma issue. O CTO organiza `snapshot.json` e suas referências; este é o ponto de controle escolhido para evitar organização automática errada.
- Não há serviço de sincronização agendado, banco de tarefas, feed de agentes em tempo real ou atualização automática de `snapshot.json` implementados.
- A hospedagem online, o acesso protegido e a política de atualização pública devem ser definidos e autorizados separadamente. Nunca usar o GitHub público como armazenamento de informação confidencial.

## Verificação

- `node --test tests/painel.test.mjs` — valida contrato, segurança de referências, profundidade arbitrária e estados.
- `python3 build_standalone.py` — gera o HTML único usando **a mesma fonte** da versão web.
- `python3 tests/browser_smoke.py` — testes Chromium de interação em 1440, 390 e 320 px, com API GitHub simulada, estrutura personalizada e mapa vazio. Exige Python `playwright` e Chromium; não realiza login nem mutação externa.
- A integração de CI usa o script `npm run test:painel` já existente no projeto. Nenhum teste alegado como homologação de infraestrutura.

**Decisão de produto:** direção em 22/11/2026, contrato do painel de estrutura dinâmica, issue #301. **PR técnica:** #318.

## Gate técnico e pacote para revisão (ciclo 2)

O CTO mantém o mapa em `snapshot.json`; não existe catálogo fixo de frentes. Antes de registrar uma revisão, executar:

```sh
node --test tests/painel.test.mjs
node validate_snapshot.mjs
python3 build_standalone.py
```

O novo verificador obriga **data, justificativa e ao menos uma referência de evidência** quando um nó for classificado como em execução, em revisão, em homologação, bloqueado ou concluído. Bloqueios exigem descrição. Isso protege o resumo contra afirmações sem fundamento, sem inferir estados automaticamente a partir da quantidade de PRs. A alteração de conteúdo continua sob responsabilidade do CTO, via branch/PR versionada, sem formulários para o proprietário.

A automação `painel-mvp-preview.yml` valida o snapshot e gera um **artefato ZIP de prévia em CI**, disponível no GitHub Actions, sem ativar hospedagem e sem permissões de escrita. O comando `npm run test:painel` também invoca a verificação estrutural. Os testes de Chromium trabalham com dados simulados, contemplando navegação em 1440/390/320 px e estruturas arbitrárias/vazias.

### Preparação para acesso online — ainda não executada

A página pode ser servida como site estático HTTPS, **desde que** o acesso esteja protegido por autenticação no gateway/hosting, com políticas de cache adequadas e uma origem confiável do `snapshot.json`. Não usar GitHub Pages público como substituto automático de acesso privado, nem copiar tokens GitHub para JavaScript no navegador. Antes de publicar, definir a hospedagem, quem terá acesso, mecanismo de atualização e rollback, conferir o CI do SHA exato e obter aprovação de deploy. A infraestrutura, credenciais e o domínio de produção não são alterados por esta PR.

**Limite de automação atual:** o histórico consulta estados públicos do GitHub automaticamente, mas a reorganização de frentes e o resumo de progresso dependem de atualização versionada do CTO. Não afirmar sincronização autônoma de agentes ou publicação contínua sem implementação específica.

## Agrupamentos de projetos (ciclo 3, 22/11/2026)

O CTO pode criar um nó com `presentation: "group"` (e `type` livre, por exemplo "Projeto") e colocar outros trabalhos dentro dele atribuindo `parentId` ao ID do grupo. O painel desenha automaticamente um contorno visual com o nome do agrupamento, cards dos filhos diretos e botão **Recolher/Expandir**. Selecionar o grupo mostra seu histórico agregado de todos os níveis descendentes, respeitando os vínculos explícitos. Grupos podem ficar vazios e coexistir com cards avulsos ou outros grupos.

`presentation` aceita `group` ou `card` (padrão para snapshots antigos); os rótulos e a quantidade de projetos **não são fixos**. O layout principal projeta grupos de primeiro nível; níveis mais profundos continuam disponíveis por navegação progressiva e breadcrumbs. Dependências cruzadas permanecem em `relations` e nos detalhes, sem linhas artificiais no mapa dos agrupamentos.

O snapshot inicial associa as seis frentes públicas do ERP ao projeto real **FunixApp**; isso apenas demonstra a agrupação e pode ser reorganizado pelo CTO. Não equivale à aprovação de prioridades, cronogramas ou homologação. Nenhuma rotina de agentes atualiza o snapshot automaticamente nesta fase.

Antes de publicar em HML, reconciliar e testar o build da PR de hospedagem #320 contra a versão atualizada da interface. Sem merge/deploy ou alteração de gateway pela simples inclusão desta funcionalidade.
