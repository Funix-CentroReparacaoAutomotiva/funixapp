# FUNIX — Escopo do Painel de Desenvolvimento multiprojeto

**Versão:** proposta v0.1 — 24/11/2026.  
**Decisão de escopo da direção:** o painel não existe exclusivamente para o FunixERP. Deve acompanhar outros projetos e necessidades de desenvolvimento da FUNIX. O desenho técnico abaixo é proposto; não concede novas autorizações. Complementa #301, #329 e #347 sem substituir suas decisões ou abrir backlog concorrente.

## 1. Modelo de portfólio

O proprietário é o orquestrador e diretor de produto. A Central de Desenvolvimento apoia priorização, escopo, dependências, evidências e coordenação. Cada projeto pode ter um responsável, roadmap, frentes/subfrentes e trabalhos. Podem existir iniciativas transversais ou demandas avulsas, sem encaixe artificial em um ERP.

- O FunixERP (evolução do FunixApp) é um projeto, com ID estável `proj-funixapp`. Seu [roadmap](../product/FUNIXERP_ROADMAP.md) não é o roadmap geral da FUNIX.
- Outros projetos confirmados serão raízes irmãs, não filhos de FunixApp. Não inventar projetos a partir de categorias, ferramentas, conversas ou menções.
- O próprio painel e governança do portfólio são capacidades transversais; manter as referências #301, #329, #347 e trabalhos existentes. Não recriar issues para retitular uma estrutura.
- Demandas sem projeto podem ter apresentação avulsa se o contrato vigente permitir; caso contrário, preparar evolução de contrato em PR específica, não forçar tipos inexistentes.
- A prioridade é global: limitar simultaneidade pela capacidade real de decisão, revisão e homologação de todos os projetos, não só pela capacidade dos agentes.

## 2. Fontes e privacidade

O GitHub é fonte canônica das tarefas técnicas deste repositório, não de todo projeto ou necessidade da empresa. Para cada projeto/trabalho, definir fonte autorizada, ID estável, status verificável, próximo resultado, responsável quando conhecido, dependências e evidências. Um projeto pode usar fonte diferente. Painel é projeção de gestão, não banco duplicado de tarefas.

**Limite do MVP atual:** contrato `schemaVersion: 1` e `repository: Funix-CentroReparacaoAutomotiva/funixapp`, validação e referências GitHub deste repositório. Não simular suporte a fontes externas, links privados ou múltiplos repositórios; evoluir de maneira compatível em projeto separado quando necessário.

O repositório e a branch `painel-publicado` são públicos, ainda que o painel instalado exija login. Publicar somente mapa e evidências efetivamente públicos e autorizados. Não incluir dados empresariais confidenciais, links de chats privados, URLs de documentos privados, identificadores sensíveis, dados pessoais ou credenciais. Criar mecanismo privado autorizado para as informações não publicáveis antes de exibi-las em painel real; não usar proteção da página como proteção da fonte pública.

## 3. Inventário constatado em 24/11/2026

- Snapshot `funix-cto-2026-11-22-hml-implantado-v2`, em `painel-publicado:docs/design/painel-orquestracao/snapshot.json`: 23 nós, 34 registros, uma raiz de projeto, seis frentes, 16 subfrentes e nenhuma relação explícita. Uma raiz publicada não prova inexistência de outros projetos.
- #329 já trata da reconciliação de projetos não publicados. Consulta aos repositórios de propriedade da conta retornou apenas FunixApp; isso não é inventário completo de trabalhos em outras ferramentas. O índice de chats privados não está disponível como fonte confirmada nesta consulta.
- #347 define a evolução de leitura para ações locais e integrações autorizadas. PR #348 aberta, empilhada sobre #337, propõe Minha atenção e Frentes registradas. Preservar essa dependência; não iniciar implementação concorrente.
- #330 / PR #346: conferir estado de HML e controlador antes de novo deploy, sem presumir falha ou recuperação efetiva.
- A busca inicial do Blueprint citado em #301 não encontrou a fonte. Não divulgar materiais de descoberta privados nem reconstruir decisões por suposição.

## 4. Roadmap do painel (independente do ERP)

| Etapa | Entrega | Critérios |
| --- | --- | --- |
| P1 — Curadoria e leitura | Reconciliar #329; completar #347 fase 1 e PR #348 | Vários projetos confirmados em raízes próprias, frentes diretas, decisão/bloqueio explícitos, estados desconhecidos preservados; visual mobile. |
| P2 — Gestão do portfólio | Próximos resultados, dependências e filas de homologação, visual de roadmap por projeto | Não inferir prioridade, dependência ou disponibilidade; respeitar contrato e associar ao trabalho canônico; separar evolução do snapshot e publicação do código. |
| P3 — Atalhos locais | Abrir fonte de tarefa, copiar briefing, abrir chat previamente autorizado mediante índice privado | Sem chamada paga de IA, sem presumir criação de chat em Projeto, sem publicar URL privada. |
| P4 — Ações autenticadas | Criar demanda/registrar decisão em fonte canônica, se autorizado | Controle de papéis, confirmação, idempotência, trilha e erros; não criar fonte concorrente. |
| P5 — Assistência opcional | Avaliar automação/IA mediante benefício e interfaces suportadas | Piloto e controle de custos; sem agente autônomo, cron ou API paga sem aprovação. |

Estas etapas refinam #347, não autorizam sua execução integral nem substituem suas fases. Não condicionar desenvolvimento do ERP à perfeição do painel. Uma atualização do mapa deve continuar independente de deploy de software quando o contrato permitir.

## 5. Próximo pacote de trabalho

1. Reutilizar #329/#347. Inventariar projetos externos e demandas por fonte confirmada; quando não localizável, pedir somente a referência mínima ao titular. Manter catálogo privado de links de conversas até haver solução autorizada. Não cadastrar placeholders como projetos reais.
2. Reconciliar tarefas existentes e o roadmap ERP com o mapa publicado. Preservar IDs estáveis, não transformar prioridade proposta em status, não declarar decisões pendentes sem evidência. Mapear novas iniciativas ERP somente após confirmar necessidade e registro canônico; não duplicar #167, #176 ou #212.
3. Curador prepara alteração de dados em branch derivada de `painel-publicado`, com novo snapshotId, timestamp real de publicação conforme procedimento, validação do schema, testes do código compatível, diff e revisão. PR de dados com base `painel-publicado`; publicação somente após aprovação aplicável. Não alterar código, banco ou VPS para editar mapa.
4. Para qualquer evolução do contrato/UI: coordenar com #347/#348 e #337; PR independente ou continuação autorizada, fixtures multiprojeto e estados desconhecidos, regressão mobile, CI no SHA exato e gate HML.
5. Após publicação autorizada, conferir snapshot e orientar direção a clicar Atualizar. Se houver evolução de UI, homologar em candidato próprio e conferir instalação separadamente.

## 6. Protocolo de coordenação

Em cada trabalho registrar: projeto/frente, origem, objetivo, prioridade explicitamente definida, próximo resultado, dependências, dono, situação, decisão pendente quando confirmada, links de evidência, data de verificação e restrições. Indicadores devem preservar desconhecido em vez de inventar zero. Não confundir PR aberta com execução ativa, CI com homologação, ou merge com publicação.

Cada sessão especializada entrega uma síntese curta: issue, branch, PR/SHA, testes efetivos, pendências, próximo passo e decisão requerida. Central consolida sem duplicar histórico. Revisão periódica do portfólio decide qual trabalho entra ou sai da execução; não pressupõe operação assíncrona ou agentes continuamente ativos.

**Limites desta proposta:** documentos de planejamento apenas. Sem atualização do snapshot publicado, merge, deploy, alteração de VPS/API/banco, dados de produção, integração externa, disparo de agentes ou custo adicional autorizado por este texto.
