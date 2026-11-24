# FUNIX — Central de Orquestração | Escopo e roadmap do portfólio

**Versão:** v0.3 — 24/11/2026. Consolidação das decisões de produto da direção; implementação técnica e releases permanecem sujeitos aos seus gates.  
**Decisão de escopo da direção:** o painel não existe exclusivamente para o FunixERP. Deve acompanhar outros projetos e necessidades de desenvolvimento da FUNIX. Em 24/11/2026, a direção também definiu que o painel é uma visualização flexível e o ChatGPT faz a curadoria e atualização dos dados por solicitação, sem cadastro manual pela direção. O desenho técnico abaixo é proposto; não concede novas autorizações. Complementa #301, #329 e #347 sem substituir suas decisões ou abrir backlog concorrente.

## 1. Modelo de portfólio

O proprietário é o orquestrador e diretor de produto. A Central de Orquestração apoia priorização, escopo, dependências, evidências e coordenação. Cada projeto pode ter um responsável, roadmap, frentes/subfrentes e trabalhos. Podem existir iniciativas transversais ou demandas avulsas, sem encaixe artificial em um ERP.

- O FunixERP (evolução do FunixApp) é um projeto, com ID estável `proj-funixapp`. Seu [roadmap](../product/FUNIXERP_ROADMAP.md) não é o roadmap geral da FUNIX.
- Outros projetos confirmados serão raízes irmãs, não filhos de FunixApp. Não inventar projetos a partir de categorias, ferramentas, conversas ou menções.
- O próprio Painel de Orquestração é projeto independente (`proj-painel-desenvolvimento`); a governança do portfólio é transversal. Manter #301, #329, #347 e trabalhos existentes. Não recriar issues para retitular uma estrutura.
- SGF — Sistema de Gestão FUNIX (`proj-sgf`): assistentes e automações de apoio à gestão, distintos do ERP que registra/processa os dados. Frentes iniciais: Assistentes de gestão (arquitetura a definir, sem fixar quantidade de chats/agentes) e Automações gerenciais, com Boletim gerencial diário como primeira demanda em planejamento. Não presumir implantação nem autorizar envios.
- Caixa de ideias (`caixa-ideias`): entrada avulsa de ideias sem classificação, não um quarto projeto. Classificar/reagrupar por dados quando fizer sentido, sem duplicar demandas. Usar o contrato atual de card avulso; não exigir formulários ou issue para cada ideia.
- Distinguir acompanhamento da construção e acesso cotidiano aos recursos efetivamente disponíveis. Acesso rápido aos assistentes/ferramentas é evolução futura, dependente de fonte privada autorizada; não declarar recursos ativos sem verificação.
- Demandas sem projeto podem ter apresentação avulsa se o contrato vigente permitir; caso contrário, preparar evolução de contrato em PR específica, não forçar tipos inexistentes.
- A prioridade é global: limitar simultaneidade pela capacidade real de decisão, revisão e homologação de todos os projetos, não só pela capacidade dos agentes.

### 1.1. Princípio de produto: estrutura orientada pelos dados, não pelo código

- O painel exibe; o ChatGPT organiza, registra, reorganiza, atualiza e contextualiza os dados a pedido da direção, com as ferramentas autorizadas. O usuário não precisa cadastrar cards, preencher formulários ou manter uma taxonomia.
- Projetos, agrupamentos, frentes, subfrentes, trabalhos avulsos, nomes, ordenação e vínculos podem evoluir por edição de dados, preservando IDs e histórico. A árvore é uma representação útil do momento, não um organograma obrigatório. Não exigir quatro níveis nem número fixo de frentes, e não criar código/rotas para cada projeto.
- Manter apenas contrato técnico mínimo de integridade, segurança e apresentação. Campos opcionais ausentes permanecem desconhecidos. Novas categorias ou relacionamentos só exigem código se o contrato atual não puder representá-los corretamente.
- A direção pode solicitar em linguagem natural: "atualize o painel", "inclua este projeto", "reorganize as frentes" ou "registre esta decisão". O ChatGPT lê a fonte vigente, interpreta o pedido, consulta evidências, altera somente o necessário, valida e publica dados quando houver autorização aplicável, verifica a leitura de retorno e informa a revisão. No botão Atualizar, o painel apenas lê a última versão publicada.
- Não exigir uma issue para toda demanda avulsa: o snapshot pode ser registro primário de acompanhamento público quando não existir sistema de tarefas apropriado. Quando houver fonte canônica (por exemplo, issue técnica), manter referência sem replicar sua gestão. Informação privada permanece na fonte autorizada, não no snapshot público.
- Atualizações sob demanda de dados são operação distinta de alterações de código e deploy. Solicitação explícita da direção para publicar dados dentro do escopo permitido deve ser tratada como autorização dessa publicação, sem pedir aprovação repetitiva para a mesma ação; se houver conflito de regra, proteção de branch, dúvida de divulgação ou alteração de software, preparar proposta e escalar. Não autoriza merge de software, produção, ações externas ou publicação de informações privadas.
- Não transformar o painel em sistema de cadastro, edição de tarefas ou operador de agentes. Ações úteis de navegação/copiar briefing são opcionais; integração de escrita pela interface só será reconsiderada se houver demanda e benefício demonstrados. Sem sincronização contínua, cron ou API de IA paga por padrão.

## 2. Fontes e privacidade

O GitHub é fonte canônica das tarefas técnicas deste repositório, não de todo projeto ou necessidade da empresa. Para cada projeto/trabalho, definir fonte autorizada, ID estável, status verificável, próximo resultado, responsável quando conhecido, dependências e evidências. Um projeto pode usar fonte diferente. Painel é projeção de gestão, não banco duplicado de tarefas. O ChatGPT mantém a representação publicada; não presume acesso a todos os chats, aplicativos ou projetos.

**Limite do MVP atual:** contrato `schemaVersion: 1` e `repository: Funix-CentroReparacaoAutomotiva/funixapp`, validação e referências GitHub deste repositório. Não simular suporte a fontes externas, links privados ou múltiplos repositórios; evoluir de maneira compatível em projeto separado quando necessário.

O repositório e a branch `painel-publicado` são públicos, ainda que o painel instalado exija login. Publicar somente mapa e evidências efetivamente públicos e autorizados. Não incluir dados empresariais confidenciais, links de chats privados, URLs de documentos privados, identificadores sensíveis, dados pessoais ou credenciais. Criar mecanismo privado autorizado para as informações não publicáveis antes de exibi-las em painel real; não usar proteção da página como proteção da fonte pública.

## 3. Inventário constatado em 24/11/2026

- Snapshot vigente `funix-portfolio-2026-11-24-v4`, publicado pela PR #355 em `painel-publicado` (commit `1409cd89f66afb4a64a7399b289971f38d1328b9`): 32 nós, 54 registros, três projetos raiz — FunixERP, SGF e Painel de Orquestração — e Caixa de ideias avulsa. Não prova que o inventário completo de outros sistemas/chats foi realizado. #329 permanece para lacunas de inventário e verificação visual.
- #347 é o registro de execução do painel. A PR #353 consolida #337/#348/#352 (indicadores, Minha atenção, Frentes registradas e copiar contexto local). CI 11/11 no SHA `019d5c72a04e25a0755d6eb7cf70c3d05f37663d`; ainda sem confirmação de instalação dessa revisão. Não integrar as PRs empilhadas em paralelo.
- #330 encerrada por obsolescência; #356 integrada. Usar [operação HML simplificada](../entregas/HML_OPERACAO_ATUALIZADOR.md), sem recuperar controlador mTLS legado. Validar novo artefato e preservar API/banco/produção no escopo Web-only.
- O índice de chats privados não está disponível como fonte confirmada nesta consulta. Blueprint citado em #301 continua não localizado nas consultas anteriores; não reconstruir decisões por suposição.

## 4. Roadmap único do painel (independente do ERP e do SGF)

| Etapa | Entrega | Critérios |
| --- | --- | --- |
| P1 — Curadoria e leitura (prioridade) | Aproveitar #353 e mapa publicado #355; Minha atenção, Frentes registradas, mapa flexível e Caixa de ideias | Três projetos confirmados e ideias avulsas; títulos coerentes; estados desconhecidos preservados; próximos passos/evidências; atualização sob demanda sem deploy; aceite mobile em HML. |
| P2 — Gestão do portfólio | Refinar próximos resultados, dependências e filas de homologação conforme uso real | Não inferir prioridade, dependência ou disponibilidade; sem cadastro manual obrigatório nem novo banco de tarefas. |
| P3 — Atalhos locais e recursos disponíveis | Aproveitar Copiar contexto e Abrir ChatGPT já existentes na #353; evoluir para acesso a conversas/recursos via índice privado autorizado | Sem API de IA paga; sem presumir criação de chat em Projeto; distinguir recursos implantados de trabalhos em desenvolvimento; não publicar URL privada. |
| P4 — Ações autenticadas (opcional, não prioritário) | Reavaliar somente se curadoria via ChatGPT não for suficiente | Benefício comprovado, controle de papéis, confirmação, idempotência, auditoria e fonte canônica; sem cadastro manual obrigatório. |
| P5 — Assistência opcional | Avaliar automação/IA mediante benefício e interfaces suportadas | Piloto, limites de custo, sem agentes autônomos ou sincronização recorrente do painel por padrão. Não impede automações gerenciais do SGF expressamente autorizadas. |

Esta sequência consolida #347 e substitui a priorização anterior de escrita na interface. P1 inclui os atalhos locais já implementados: não remover nem atrasar a entrega por causa da nomenclatura das etapas. P2–P5 são evolução condicionada à necessidade. Não condicionar desenvolvimento do ERP/SGF à perfeição do painel. Atualizações de dados continuam independentes de deploy.

## 5. Próximo pacote de trabalho

1. Reutilizar #329/#347 e o mapa v4. Confirmar o que ainda falta de inventário e manter links de conversas em canal privado autorizado. Não cadastrar placeholders como projetos reais.
2. Reconciliar tarefas existentes e o roadmap ERP com o mapa publicado. Preservar IDs estáveis, não transformar prioridade proposta em status, não declarar decisões pendentes sem evidência. Mapear novas iniciativas ERP somente após confirmar necessidade e registro canônico; não duplicar #167, #176 ou #212.
3. Curador prepara alteração de dados em branch derivada de `painel-publicado`, com novo snapshotId, timestamp real de publicação conforme procedimento, validação do schema, testes do código compatível, diff e revisão. PR de dados com base `painel-publicado`; publicação sob solicitação explícita da direção, após validação e conforme aprovação aplicável; não criar uma segunda aprovação para a mesma publicação se já autorizada. Não alterar código, banco ou VPS para editar mapa.
4. Para a evolução do contrato/UI: aproveitar a PR consolidada #353; alinhar nomenclatura e eliminar referências residuais ao CTO, verificar mapa real de três projetos e Caixa de ideias, fixtures multiprojeto, estados desconhecidos, mobile, CI no SHA exato e gate HML. Não iniciar PR concorrente.
5. Após publicação autorizada, conferir snapshot e orientar direção a clicar Atualizar. Se houver evolução de UI, homologar em candidato próprio e conferir instalação separadamente.

## 6. Protocolo de coordenação

Em cada trabalho registrar: projeto/frente, origem, objetivo, prioridade explicitamente definida, próximo resultado, dependências, dono, situação, decisão pendente quando confirmada, links de evidência, data de verificação e restrições. Indicadores devem preservar desconhecido em vez de inventar zero. Não confundir PR aberta com execução ativa, CI com homologação, ou merge com publicação.

Cada sessão especializada entrega uma síntese curta: issue, branch, PR/SHA, testes efetivos, pendências, próximo passo e decisão requerida. Central consolida sem duplicar histórico. Revisão periódica do portfólio decide qual trabalho entra ou sai da execução; não pressupõe operação assíncrona ou agentes continuamente ativos.

**Limites desta consolidação documental:** não concede autorização de merge de software, deploy, alteração de VPS/API/banco, dados de produção, integração externa, disparo de agentes ou custo adicional. A publicação de dados #355 já ocorreu separadamente.
