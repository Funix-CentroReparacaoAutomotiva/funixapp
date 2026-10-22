# FUNIX — Guia-mestre de implementação do aplicativo

**Destinatário:** Codex, atuando como engenheiro de software principal, arquiteto de integrações, responsável pela qualidade e executor técnico.

**Solicitante:** Direção da FUNIX — funilaria e pintura automotiva em Contagem/MG.

**Marco do projeto:** aprovação conceitual e visual do protótipo `FUNIX_V20_Menu_Compacto_Kanban.html`. **Estado real:** protótipo de interface; não é aplicação integrada nem homologada.

**Objetivo deste documento:** transformar a visão de produto consolidada pela direção e a estrutura operacional existente no ERP Coda em **um aplicativo real, utilizável, seguro, evolutivo, conectado e testável**, empregando as integrações já disponíveis quando efetivamente verificadas.

> **INSTRUÇÃO PRINCIPAL AO CODEX:** Leia este guia inteiro e abra o HTML V20 antes de propor alterações ou escrever a interface. Observe o ERP Coda real e faça a ponte entre as duas referências. A V20 especifica a experiência desejada; o Coda contém entidades, relações e parte importante das regras de negócio já implementadas. **Não trate a V20 como um backend e não trate a aparência ou os nomes das colunas fictícias do HTML como esquema de banco de dados. Não recrie nem substitua por palpite as regras que já existem no ERP.** Trabalhe em incrementos verificáveis, mantendo o aplicativo executável, e solicite aprovação somente para decisões materiais, riscos relevantes, credenciais ausentes ou ambiguidades que alterem o negócio.

---

## 0. Como usar as fontes e o que já está decidido

### Ordem de referência e autoridade

1. **Regras obrigatórias:** legislação, segurança, privacidade, direitos do consumidor, termos autorizados e procedimentos técnicos/comerciais aprovados. A implementação nunca pode contorná-los.
2. **Modelo de negócio e dados existentes:** ERP FUNIX no Coda (acessível pela integração Superhuman Docs e/ou por APIs e credenciais disponibilizadas ao Codex), seus registros, relações, automações e fórmulas verificadas no ambiente atual. O ERP é **fonte inicial de verdade** das informações transacionais; alterações estruturais exigem análise e aprovação.
3. **Contrato visual e de interação:** `FUNIX_V20_Menu_Compacto_Kanban.html`. Ele incorpora o desenho interno V18 de Atendimento (Chat, Mapa, Diagnósticos). Preservar o que foi aprovado; reconstruir tecnicamente, se necessário, com fidelidade de UX.
4. **Este guia:** consolida as decisões da direção sobre arquitetura de navegação, responsabilidades e objetivos, e explicita os requisitos de implementação.
5. **Arquivos institucionais `00`–`10`:** princípios estratégicos, comercial, operacional, jurídico, tecnologia e marca. `00_master_index.md` governa precedência. Os documentos fazem ressalva de que uma versão ou capacidade só deve ser tratada como aprovada/implantada mediante confirmação no registro vivo `FUNIX_REGISTROS_VIVOS.md` — **não presumir que esse registro foi fornecido**. Se ausente, marcar estado da aprovação como não verificado.

Quando as fontes divergem, **documente exatamente o conflito**, sua origem, efeito e proposta. Não reconcilie por suposição. O ERP atual descreve o estado observado; mudanças aprovadas neste guia descrevem o objetivo do aplicativo; nenhuma das duas, isoladamente, certifica implantação ou autoridade para editar produção.

### Distinções obrigatórias em toda documentação

Use rótulos explícitos: **DECIDIDO (produto)**, **VERIFICADO (ERP)**, **EXISTENTE MAS NÃO AUDITADO**, **PROTÓTIPO**, **PROPOSTA**, **PENDENTE DE DECISÃO**, **IMPLEMENTADO**, **TESTADO**, **HOMOLOGADO**. Um desenho pronto não equivale a integração funcional. Registros e números de exemplo não são dados da FUNIX.

### A direção do projeto já foi aprovada

- **DECIDIDO:** a arquitetura visual V20 é o ponto de partida; não reiniciar o design.
- **DECIDIDO:** três áreas na entrada — **Conversas**, **Funil**, **Veículos**. **Histórico** é visualização/subárea de Veículos, não quarta área principal.
- **DECIDIDO:** seleção de um registro em Conversas/Funil abre o **Atendimento** com as visões internas V18. A área Conversas é **um atalho para o Atendimento**, não um produto paralelo com uma segunda tela exclusiva de mensagens.
- **DECIDIDO:** Produção e Histórico operam sobre **Experiências**, não sobre Atendimentos.
- **DECIDIDO:** Copiloto FUNIX é **global e contextual**, com possibilidade de consultar, filtrar, navegar e abrir registros do aplicativo. Ampliação para alterações deve ser controlada.
- **DECIDIDO:** o aplicativo deve se integrar ao Coda, aproveitando n8n, Evolution API, Redis, geração de PDFs/documentos e demais serviços **conforme inventário real**, sem replicações desnecessárias.
- **DECIDIDO:** ajustes finos de UX são permitidos durante o desenvolvimento, mas não autorizam substituir o modelo mental ou a identidade V20.

---

## 1. Contexto, propósito e abordagem de engenharia

A FUNIX realiza atendimento comercial, diagnóstico de danos, orçamentação, agendamento, recepção física, produção, entrega e pós-serviço. A empresa procura **lucratividade sustentável por meio de eficiência operacional, qualidade consistente e competitividade econômica**. Não é uma oficina de luxo nem orientada a descontos indiscriminados.

A aplicação deve **reduzir cliques, retrabalho e perda de contexto**, facilitar a passagem entre comercial, produção e histórico e tornar o ERP mais simples de operar no dia a dia. A tecnologia não deve gerar duplicações, perder rastreabilidade, alterar condições aceitas ou exigir cadastros prematuros.

**Postura esperada do Codex:** investigar antes de modificar; criticar escolhas técnicas, apontar riscos concretos e implementar de maneira incremental. Não construir framework sofisticado sem benefício demonstrado; não confundir velocidade de código com qualidade operacional. Aproveitar infraestrutura e autenticação existentes somente quando forem seguras e adequadas.

### Duas referências que precisam ser unificadas

**Visão de cima (V20 e decisões do produto):** como operador navega, pesquisa, conversa, vê o funil, acompanha o veículo, consulta histórico e usa o Copiloto.

**Visão de baixo (ERP existente):** entidades, tabelas, IDs, relacionamentos, fórmulas, botões, fluxos de orçamentos, OS, cadastros e estados do trabalho.

**Tarefa do Codex:** construir a camada intermediária — contrato de dados, backend/adaptadores, comandos autorizados, interface e testes — sem inventar um segundo ERP desnecessário e sem acoplar regras complexas diretamente aos componentes visuais.

---

## 2. Modelo de domínio e invariantes

### 2.1. Atendimento: porta de entrada comercial

- **Atendimento** é a entidade que nasce quando existe uma demanda/oportunidade de serviço.
- Inicialmente pode ter apenas informações leves e editáveis: nome informado, telefone/contato informado, veículo/modelo aproximado, placa quando conhecida, canal, motivo, fotos/mensagens vinculadas, fase comercial, próximos passos e dados do diagnóstico/orçamento em desenvolvimento.
- Um atendimento inicial **não exige que já exista uma entidade Cliente, Veículo ou Experiência**.
- O Funil opera com Atendimentos. A entidade continua persistida, mesmo depois de concluir/encerrar a fase comercial ou criar uma Experiência; o registro comercial não deve ser apagado.
- Diagnósticos, peças/serviços e orçamentos possuem vínculos e regras próprias no Coda. O Codex deve mapear o fluxo real antes de criar ou editar relações.
- Sempre exibir ID real, status real e campos reais. Atendimentos de retorno/retrabalho podem ter vínculo de origem próprio no ERP; mapear antes de supor que sejam um caso novo comum.

### 2.2. Experiência: extensão operacional de um atendimento

- **DECIDIDO:** o agendamento do veículo gera uma Experiência, que é uma extensão do Atendimento para a jornada do veículo e as ações operacionais/financeiras.
- **Cardinalidade de negócio esperada:** Atendimento `0..1` Experiência, e cada Experiência está associada a **exatamente um** Atendimento de origem. Uma vez gerada, não gerar outra Experiência indevidamente para o mesmo evento/agendamento.
- A Experiência contém ou referencia cadastro estruturado de cliente, veículo, planejamento, entrada, OS, produção, pagamentos/faturamento e saída; nem todos esses dados precisam ficar materializados na mesma tabela.
- **Produção e Histórico** consultam Experiências. A fase operacional e situação financeira podem ser *derivadas* de eventos/registros filhos e não editáveis diretamente.
- Uma Experiência que saiu do pátio vai para Histórico. Isso **não significa que foi excluída**; obrigações financeiras e pós-venda podem permanecer pendentes.
- Reentrada, garantia, retrabalho e outros vínculos devem respeitar o modelo existente; não quebrar a regra 1:1 criando relações informais. Quando a situação real pedir um novo ciclo, pesquisar as regras atuais e levar à direção qualquer decisão de domínio pendente.

### 2.3. Cliente e Veículo: cadastros estruturados, sem atrito inicial

**Situação observada no ERP:** `db_Atendimentos` tem `funil_Nome`, `funil_Contato`, `funil_Modelo`, `funil_Placa` como campos de entrada comercial, enquanto `db_Experiencias` tem `cliente_Entidade` e `cliente_Veiculo` como referências a entidades estruturadas.

**Direção de produto:** evoluir a captura do Atendimento para permitir procurar/vincular/cadastrar Cliente (e Veículo quando cabível) **assim que houver dados suficientes e confiáveis**, sem exigir cadastro antes de iniciar a negociação. Evitar pergunta ou cadastro redundante quando informações válidas já existirem.

**Importante:** critérios de identificação, desambiguação, deduplicação, atualização e autorização devem ser definidos a partir do esquema existente e aprovados antes de aplicar autocadastro. Nome parecido ou telefone incompleto não autorizam associação automática. Um telefone pode não ser uma identidade pessoal exclusiva. Não eliminar os campos de origem nem sobrescrever dados sem registro de proveniência.

### 2.4. Chat / Conversa: relação N:N com Atendimento

- **DECIDIDO:** relacionamento conceitual `Atendimento ↔ Chat` é **N:N**: um Atendimento pode ter múltiplas conversas, e uma conversa pode ser pertinente a mais de um Atendimento.
- A conversa é um canal/contexto comunicacional; o Atendimento é a demanda comercial. Não assumir que são a mesma entidade.
- Implementar, se ainda inexistente, **vínculo explícito** e auditável entre chat e atendimento, preservando os identificadores originais do provedor e seus eventos. Antes de criar tabelas no Coda, mapear o modelo/omnichannel atual.
- **Atenção crítica:** vincular um chat inteiro a dois atendimentos **não torna automaticamente todas as mensagens relevantes para os dois**. Projetar escopo, seleção e histórico das mensagens por demanda/período ou outra regra verificável, sem atribuições automáticas enganosas.
- Um contato pode ter atendimentos antigos e atuais, vários veículos e conversas por números/canais diferentes. O app deve mostrar e permitir selecionar o contexto adequado.
- Se um usuário chega por Conversas, ao abrir um item vai para o Atendimento correspondente, **com a aba Chat ativa**, ou recebe seleção contextual quando houver múltiplos atendimentos possíveis. Não inventar atendimento novo silenciosamente para todo chat.

### 2.5. Entidades adicionais a reconhecer, sem remodelar por suposição

Investigar: Orçamentos, versões/aprovações, Diagnósticos, Peças, Serviços, Ordens de Serviço, Processos/Fases, Planejamento, Pagamentos/Faturas/Títulos, Canais, Contatos, Conversas/Mensagens, anexos, retomadas e histórico de eventos. Definir chaves primárias, chaves externas, proprietário dos dados, status, origem da verdade, transações e permissões.

### Invariantes não negociáveis

1. Nunca apagar um Atendimento como efeito de gerar Experiência.
2. Não duplicar Experiência em agendamento repetido ou webhook reprocessado.
3. Não inventar Cliente/Veículo certo com dados incompletos.
4. Não duplicar orçamentos, OS, mensagens ou cobranças devido a retry.
5. Não modificar valor, escopo aprovado, autorização, OS ou situação financeira por uma ação de UI superficial.
6. Não alterar coluna calculada no Coda como se fosse campo livre; movimentações devem acionar os eventos/comandos de negócio corretos.
7. Não usar dados sintéticos como se fossem clientes reais após integrar produção.

---

## 3. Navegação final e interação do aplicativo

### 3.1. Estrutura da entrada: três áreas (sem cabeçalhos desnecessários)

O HTML `FUNIX_V20_Menu_Compacto_Kanban.html` é a **referência visual prioritária**. Abrir em desktop e celular; analisar CSS, HTML e comportamento observável.

**Topo da tela inicial:** iniciar diretamente por abas **Conversas | Funil | Veículos**. Não reintroduzir faixa grande com logo, “Centro de trabalho”, títulos repetidos, descrições extensas ou barra de status inferior decorativa. Economia vertical foi escolha explícita da direção.

**Ferramentas:** busca compacta por nome, telefone, placa, modelo/veículo, ID de Atendimento ou Experiência, e filtros pertinentes. Não inventar filtro textual que não corresponda à entidade exibida. Busca deve ter estado vazio, carregamento, erro e resultados múltiplos. Considerar paginação e busca server-side com o crescimento do ERP.

**Copiloto:** controle laranja fixo no canto inferior direito e disponível nas três áreas. Sem barra inferior redundante. Ajustar margens/padding/conteúdo para que cards, comandos e controles não fiquem escondidos pelo Copiloto.

### 3.2. Conversas

- Lista compacta, reconhecível, inspirada em inbox: contato, prévia da última mensagem, data/hora, indicador de não lidas e possível contexto do atendimento.
- Ordenação, busca, filtros úteis e notificação baseados em dados reais da integração de mensagens, não números fictícios.
- **Papel exato:** porta de acesso ao Atendimento; o usuário não está entrando em outro aplicativo de chat independente.
- Ao selecionar, abrir Atendimento V18 na visão Chat. Quando houver mais de um atendimento elegível, oferecer escolha pertinente ou contextualização clara; manter a navegação rápida.
- Ao entrar no Atendimento pelo chat, o retorno leva à lista de Conversas **na mesma posição, com a mesma busca e os mesmos filtros**.
- Não misturar mensagem recebida/visualizada com estágio comercial; a resposta ao cliente não avança automaticamente a negociação salvo regra explícita.

### 3.3. Funil comercial

- Visualização inicial **Kanban** de Atendimentos, com colunas baseadas **nos status reais do Coda**, não nas etapas fictícias de exemplo V20.
- Permitir alternância **Quadro / Lista**, com comportamento funcional real.
- Kanban navegável **horizontalmente**. Manter ergonomia para desktop, touch e trackpad.
- Cada coluna pode **recolher** ao clicar no cabeçalho; recolhida vira faixa vertical estreita contendo nome e contagem de cards; clicar novamente expande.
- Preservar visualização, colunas recolhidas, posição horizontal/vertical, filtros e pesquisa ao abrir e voltar de um Atendimento, inclusive quando fizer sentido preservar a navegação via URL.
- **Drag-and-drop** de cards, com feedback claro, compatibilidade touch/acessibilidade e validação de transições. Se uma transição não for permitida, **não confirmar visualmente nem persistir um status falso**; apresentar motivo e opção de ação correta.
- Card exibe somente o necessário à decisão: pessoa/contato, veículo/placa quando conhecidos, ID, etapa, próxima ação/pendência e outros dados comprovadamente úteis. Não adicionar dashboards de vaidade.
- A etapa “Agendado” pode representar passagem/resultado do comercial; mapear se o card deve sair da vista ativa do Funil após criar Experiência. **Não tratar exemplos de estágios da V20 como regra de negócio.**

### 3.4. Veículos = Acompanhamento + Histórico

**Acompanhamento:** visualização operacional de **Experiências ainda relevantes ao acompanhamento**, preferencialmente Kanban por fase real, com alternância Quadro/Lista e colunas recolhíveis, quando aplicável. Exibir agendados, veículos recebidos, fases de produção, bloqueios, finalizados ainda não retirados conforme regras reais; distinguir “Finalizado” de “Saiu”.

**Histórico:** visualização do mesmo domínio Experiência, filtrada por **saída/encerramento conforme critério real verificado**. Preferência por lista pesquisável; busca por placa, cliente, veículo e período. Registro pode permanecer financeiramente pendente mesmo depois de sair; permitir sinalização e acesso às informações, sem recolocá-lo no fluxo normal do pátio.

**Estado padrão:** acompanhar o que demanda ação, não exibir automaticamente todas as Experiências de todos os anos. Histórico a um clique, sem quarta aba principal.

**Drag-and-drop operacional:** atenção: a fase operacional do ERP é calculada com base em datas, OS e processos. Não escrever arbitrariamente a fase ao soltar um card. Antes de permitir uma transição, identificar o evento, recurso e autorização efetivos. **Quando uma transição não tiver contrato seguro definido, deixar a ação desabilitada e informar a limitação — em vez de simular sucesso.**

### 3.5. Atendimento (interior V18 preservado)

Ao abrir atendimento de Conversas ou Funil, mostrar o interior incorporado na V20:

- **Header compacto** com seta de voltar **à esquerda do nome/contato** (não botão flutuante “Painel inicial”). Nome/contato, identificador do Atendimento, placa/modelo/veículo disponíveis e indicador de propostas/orçamentos. Todos os dados reais e coerentes com o registro selecionado.
- **Visões internas:** `Chat`, `Mapa`, `Diagnósticos`. Navegação por abas e deslize horizontal quando apropriado; conteúdo adaptável a celular e desktop.
- **Chat:** histórico da conversa corretamente vinculada, composer de mensagens, envio, anexo, captura de áudio quando implementada, ferramentas relacionadas. O canal de envio deve usar infraestrutura autorizada e não gerar mensagens repetidas.
- **Mapa:** representação visual de áreas do veículo, navegação por regiões, escolha/contextualização de peças. Preservar funcionamento, mapeamento de regiões, relações com diagnóstico e fidelidade visual do SVG aprovado; não inventar segmentos de carro ao redesenhar.
- **Diagnósticos:** lista, inclusão/edição de diagnósticos e itens relacionados, integração com serviços, peças e orçamentos, sumário e ações apropriadas. Respeitar a estrutura real de dados, sem derivar automaticamente preços finais de uma demonstração.
- **Rodapé interno:** manter geometria e tratamento visual refinados da V18. O Copiloto laranja ocupa o canto inferior direito; ações de Chat/Mapa/Diagnósticos devem ter largura/área segura para não ficarem cobertas por ele.
- **Navegação de retorno:** sempre voltar à **origem concreta** (Conversas, Funil, Acompanhamento ou Histórico) com pesquisa, filtros, scroll e modo quadro/lista preservados. Browser back/forward também devem funcionar de maneira previsível.
- **Troca de contexto:** selecionar outro Atendimento/chat no header deve atualizar todas as três visões conjuntamente. Nunca mostrar mensagens de um contato com diagnóstico/orçamento de outro.

**Detalhe de implementação do protótipo:** atualmente o HTML V20 contém valores fixos no header da V18 e uma função JavaScript `open(d)` que **não substitui os dados internos pelo registro selecionado**; apenas troca de tela. Corrigir no app real. Não confundir a navegação demonstrada com integração pronta.

### 3.6. Abertura de uma Experiência

Para uma Experiência selecionada em Veículos, abrir **seu próprio contexto/visão operacional**, ainda que use componentes compartilhados. A V18 é o contrato visual do Atendimento comercial e **não prova que já existe uma tela completa de Experiência operacional**. Portanto:

- Definir, com base no ERP real, quais informações e ações a tela de Experiência precisa exibir: veículo/cliente, fase, entrada, OS, etapas, pendências, previsões, saída, pagamentos relevantes e vínculo ao Atendimento de origem.
- Reaproveitar a linguagem visual V20/V18 e a navegação de volta; **não inventar um redesign não solicitado**.
- Separar claramente painel comercial do painel operacional e controle financeiro, com permissões adequadas.
- Se um componente/tela ainda não existir, implementar a menor versão útil com registros reais e evoluir; não fingir que o card operacional abre um Atendimento comercial com campos fictícios.

---

## 4. Copiloto FUNIX — escopo e arquitetura

### 4.1. Papel

**Um único Copiloto global e contextual**, acessível de todas as telas e entendendo: rota atual, Atendimento/Experiência/Chat/veículo selecionado, permissões do operador e propósito do comando. Mesma identidade laranja V20/V18, mesmo ponto de entrada e padrão de comunicação visual.

Deve fazer mais que responder por texto: **ações de navegação e consulta são respostas melhores quando o usuário pede para encontrar algo**.

### 4.2. Exemplo principal de aceite

Usuário: **“Procura o carro da placa XPTO. Ele veio aqui mês passado. Abre o card da experiência dele.”**

Comportamento esperado:

1. Interpretar placa parcial ou completa e referência temporal **no fuso local correto**, sem inventar o veículo.
2. Consultar **dados reais** de Experiências/Veículos/Atendimentos conforme relações identificadas; pesquisar também Histórico, não somente o pátio.
3. Se houver **uma correspondência inequívoca**, navegar até a Experiência real, preservando a origem para retorno; apresentar confirmação discreta.
4. Se houver **várias passagens** ou placas semelhantes, exibir candidatos com placa, veículo, datas, situação e ID para desambiguação; não escolher no escuro.
5. Se nada for encontrado, informar objetivamente e oferecer pesquisa alternativa, sem inventar uma Experiência.
6. Permitir sequência contextual: “agora abre o orçamento aprovado desse carro” — sem repetir placa, apenas se o vínculo estiver comprovado.

### 4.3. Capacidades prioritárias

**Primeira etapa segura (consulta/navegação):** localizar atendimento, cliente, veículo, Experiência, orçamento; filtrar Funil por status; abrir Veículos por fase; consultar Histórico; navegar para chat vinculado; usar comandos textuais e, quando viável, voz como entrada.

**Etapas posteriores, com validação:** estruturar diagnóstico a partir de instruções/textos/fotos/áudios; preencher prévias; sugerir serviços e peças; preparar orçamento; iniciar ações de negócio **com confirmação humana e autorização**. Nenhuma aprovação comercial, alteração de preço, envio de mensagem, cancelamento, entrada/saída de veículo, emissão de OS ou mudança financeira deve ocorrer autonomamente sem controles explicitamente definidos.

### 4.4. Interface técnica entre IA e aplicativo

Preferir **tools/functions estruturadas** em vez de pedir à IA para clicar em pixels, inventar URLs ou editar diretamente o Coda. Exemplos **ilustrativos** de contratos (nomes finais a definir):

```ts
searchExperiencias({ placa?, cliente?, veiculo?, periodo?, status?, limit? })
searchAtendimentos({ texto?, telefone?, placa?, status?, limit? })
searchConversas({ telefone?, nome?, atendimentoId?, limit? })
getExperiencia({ experienciaId })
getAtendimento({ atendimentoId })
getOrcamentos({ atendimentoId?, experienciaId?, situacao? })
applyUiFilter({ area, filters })
navigateTo({ entityType, entityId, tab?, returnContext? })
```

Contratos devem validar argumentos, respeitar autorização, retornar IDs reais, citar a fonte interna, distinguir ausência/ambiguidade e suportar erros. **Separar comandos de consulta/navegação dos comandos de mutação**. Qualquer ferramenta de mutação precisa de permissões, pré-condições, confirmação humana conforme risco, trilha de auditoria e idempotência.

Não conceder ao modelo credenciais irrestritas nem permitir que texto vindo de cliente/WhatsApp execute instruções de sistema (prompt injection). Não transferir dados pessoais para provedores de IA sem avaliação de privacidade, necessidade, configuração de retenção e autorização cabível.

### 4.5. Comportamento visual

Preservar o botão laranja fixo da V20, painel, mensagens breves de trabalho/resultado e feedback discreto. Evitar respostas longas quando uma navegação resolve. Evitar overlays cobrindo dados ou ações essenciais. Estado de Copiloto aberto/fechado deve ser coerente entre rotas e funcionar em telas pequenas.

**Não confundir demonstração com IA:** a V20 não comprova que comandos de Copiloto consultem ERP; a implementação deve fornecer mecanismo real, métricas de erro, logs e testes.

---

## 5. ERP Coda — evidências iniciais verificadas e diligência obrigatória

> **Observação de pesquisa para orientar a descoberta, não substituir uma nova leitura pelo Codex:** conferido via conector Superhuman Docs em **20/10/2026**. IDs, contagens, fórmulas e permissões podem mudar. Validar novamente antes de codificar contra eles.

### Documento principal

- **Título:** `Funix`.
- **URL de navegação:** `https://docs.superhuman.com/d/Funix_d2zsjI-nqWr`.
- **URI do conector:** `superhuman://docs/2zsjI-nqWr`.
- **Observação:** Superhuman Docs é uma forma de acessar o documento; não presumir que seja a API transacional oficial, nem que toda operação da UI seja reproduzível por API.

### Entidades/tabelas identificadas

| Entidade/visão | Identificador observado | Verificação necessária |
|---|---|---|
| Tabela base Atendimento | `db_Atendimentos` — `grid-eGvJhrlDTH` | Campos, fórmulas, status, orçamentos, fechamento e agendamento. |
| Tabela base Experiência | `db_Experiencias` — `grid-oejkc9WuBX` | Relação de Atendimento, cliente/veículo, OS, produção, status e saída. |
| Funil | Página `section-mqlU0jAHtz`; vista `Viz. Atendimentos (PC)` | Filtros reais, grupos e regra para “ativo no funil”. |
| Produção | Página `section-XTRMwwB2dD`; vista `ViewExperiencia_Comercial` | Filtros reais de acompanhamento, fases e eventos de entrada/produção. |
| Histórico | Página `section-g-YxQ6aEaE`; vista `ViewExperiencia_ComercialFinalizadas` | Critério de histórico/saída; distinção de finalização e saída. |
| Orçamentos | `db_Orcamentos` — `grid-LgsVNgYj3J` | Versionamento, aprovações, valores, vínculo de Atendimento e Experiência. |
| OS | `db_OSs` — `grid-Umj75GSlHH` | Criação, autorização, fases, vínculo e faturamento. |
| Processos | `db_Processos` — `grid-ddGJJK3zs5` | Etapas, timestamps, planejamento e cálculo de fase operacional. |
| Cliente | lookup referenciando tabela `grid-l9d-WgpqtC` | Nome, contato, deduplicação, relacionamentos e LGPD. |
| Veículo | lookup referenciando tabela `grid-pDT-_PlSIJ` | Placa, especificação, cor, cliente/relacionamentos e normalização. |
| Status comercial | lookup referenciando tabela `grid-DXriGyd94a` | Valores, ordem, SLA, transições e estágio usado no Funil. |
| Fases operacionais | lookup referenciando tabela `grid-8fpISFOBb-` | Fases reais e mapeamento para fase comercial. |

Os nomes em formato `db_*` e IDs ajudam a localizar a estrutura, **não constituem migração obrigatória nem contrato de API definitivo**.

### Colunas e regras detectadas

**Atendimento:** `at_IdAtendimento`, `at_StatusComercial` (lookup gravável), `funil_Nome`, `funil_Contato`, `funil_Placa`, `funil_Modelo`, `funil_Canal`, `funil_contatoE164` (calculado), `at_OrcamentosGerados` (calculado), `at_OrcamentosAprovados`, `ID_Experiencia` (calculado com busca em `db_Experiencias`), `cliente_Entidade` (derivado da Experiência), `at_Agendar` (botão com regras), `at_Encerrar`, `at_Origem`, `at_programarRetomada` e campos de diagnóstico/serviços/peças.

**Experiência:** `Atendimento` (lookup), `cliente_Entidade`, `cliente_Veiculo`, `xp_OSs`, `xp_OrcamentosGerados`, `xp_dataEntrada`, `xp_DataChegadaProgramada`, `xp_DataFinalizacaoOperacional`, `xp_DataSaida`, `fase_Operacional`, `fase_Comercial`, `situacao_Financeiro`, `xp_Faturas`, `xp_TitulosFinanceiros`, `flag_Finalizada`, `flag_Saiu`, `flag_Cancelada`, `flag_Retrabalho`, `xp_DarEntradaNoVeiculo`, `xp_DarSaidaNoVeiculo`.

**Ponto crítico verificado:** `fase_Operacional` é uma **fórmula derivada** (considera saída, finalização, entrada, OS e processos); `flag_Finalizada` deriva da data de finalização e `flag_Saiu` da data de saída. `situacao_Financeiro` também deriva de dados de cobrança e recebimento. **Não habilitar drag-and-drop que escreva diretamente essas fórmulas.** A fase comercial da Experiência também é derivada da operacional. A transição correta deve resultar de **evento/ação legítima**, não de manipulação de rótulo.

**Ponto crítico de agendamento:** existe o botão `at_Agendar` e lógica condicional de elegibilidade. Auditar sua fórmula, ações encadeadas, efeitos em Cliente/Veículo/Experiência, idempotência, dependências e falhas parciais **antes de criar um endpoint alternativo**.

### Trabalho de engenharia reversa (obrigatório)

1. Ler a organização do ERP e localizar **as tabelas base e as visões**; diferenciar fórmulas, valores graváveis, botões e colunas auxiliares.
2. Extrair esquema **somente leitura**: tabela, coluna/ID, tipo, mutabilidade, fórmula, referências, significado, campo padrão e dono do dado. Não despejar dados pessoais em documentação pública.
3. Identificar fontes das áreas V20, filtros existentes, ordenação, estados reais e regras de transição.
4. Mapear Atendimento→Orçamento→aprovação→agendamento→Experiência→OS→processos→saída e os fluxos de falha, cancelamento, garantia/retrabalho e pós-venda.
5. Identificar o modelo atual de mensagem/omnichannel e a viabilidade da relação N:N de Chats↔Atendimentos.
6. Validar as entradas/saídas da integração já existente e quais ações podem ser realizadas via API, Pack, n8n ou outro serviço autorizado; não reproduzir código de botão Coda por aproximação.
7. Confirmar o sistema de registro campo a campo. Se houver dados duplicados em Coda/outro serviço, definir reconciliação e prioridade de verdade.
8. Entregar um **mapa de compatibilidade**: componente da UI → entidade → origem/consulta → transformação → comando autorizado → testes.
9. **Não alterar fórmulas, tabelas ou dados do Coda produtivo durante descoberta.** Criar massa de teste/cópia segura e obter aprovação antes de migração ou ação destrutiva.

---

## 6. Integrações e serviços — descobrir, preservar, conectar

O Codex pode dispor de acessos previamente configurados a aplicações. **Primeiro audite o que está realmente acessível nesta sessão/ambiente**; não presuma que histórico de outra IA, credenciais ou integrações estejam automaticamente disponíveis.

### Coda / Superhuman Docs

Sistema de registro inicial. Descobrir o método de acesso transacional mais seguro e confiável (API oficial, conector efetivamente autorizado, backend existente ou camada n8n). Não acoplar chamadas e segredos diretamente ao browser. Evitar escrita em colunas calculadas e operações que disparariam fórmulas inconsistentes. Implementar adaptador com paginação, projeção de campos, retry controlado, cache apropriado, logs, versionamento/concorrência e fallback.

### Evolution API — WhatsApp

Investigar instância(s), configuração, autenticação, webhooks, eventos, identificadores persistentes de conversa/mensagem, mensagens de entrada e saída, mídia, confirmação/entrega/leitura, histórico disponível, idempotência e regras de envio/privacidade. **Não disparar mensagens reais durante testes sem ambiente/contatos de teste e autorização.**

### n8n — automações/orquestração

Inventariar workflows existentes e seus webhooks, credenciais, erros e retry. Preferir reutilizar fluxos comprovados a duplicar a mesma função no novo app. Identificar quais são apenas protótipos e quais trabalham em produção. Definir contratos de entrada/saída, autenticação, idempotência, observabilidade e tratamento de timeout. Não remover autenticação para facilitar integração.

### Redis — estado, concorrência e deduplicação

Há contexto anterior de uso/planejamento de Redis em fluxos WhatsApp e geração de documentos. **Verificar existência e responsabilidades atuais**; reutilizar para locks, eventos, estado efêmero ou deduplicação quando comprovadamente necessário. Redis **não substitui** o ERP como registro durável.

### jsreport / geração de PDFs

Há histórico de fluxo com n8n e jsreport para documentos. Auditar o que já existe e como se relaciona a orçamentos, versões aprovadas, OS e comprovantes. Não emitir documento definitivo com dados simulados ou escopo sem aprovação. Se for necessária outra solução, justificar incompatibilidade concreta, custo e manutenção.

### Imagine.io (nome informado pela direção)

A direção menciona acesso a **“Imagine.io”**. **Identificar precisamente qual serviço/produto é esse, se há integração disponível, suas permissões, documentação e seu papel legítimo no aplicativo**. Não supor que seja motor de IA, banco de imagens, geração visual ou infraestrutura sem confirmação. Usar apenas se houver funcionalidade necessária e vantagem demonstrável.

### Demais recursos já conectados

Fazer inventário dos conectores, repositórios, aplicativos e serviços efetivamente disponíveis ao Codex. Confirmar acesso **sem expor chaves**, limites e custos. A conexão de ferramenta não autoriza alteração em produção. Usar mínimo privilégio.

### Fluxos de referência previamente discutidos — ESTADO A VALIDAR

Há histórico de desenho técnico como:

```text
WhatsApp → Evolution API → n8n → CRM/ERP Coda
Coda → Pack FUNIX → n8n → Evolution API → WhatsApp
Coda → Pack/n8n → Redis/jsreport → PDF/documento
```

Esses desenhos orientam investigação, **não são certificados de funcionamento em produção**. No fluxo de mensagens, verificar normalização E.164, consulta de atendimentos, processamento concorrente, deduplicação, criação/associação de registros e cobertura de falhas.

### Requisito de segurança de integração

Credenciais exclusivamente em cofre/variáveis de ambiente seguras; segregação entre homologação e produção; verificação de assinaturas/autenticação de webhook; retries com chave idempotente; logs técnicos sem exposição desnecessária de conteúdo de clientes; monitoramento e caminho de recuperação manual.

---

## 7. Arquitetura de software a implementar

### Princípios

- **Frontend:** fiel à V20, modular, responsivo, acessível, com estado de navegação preservado. A escolha de framework deve considerar o repositório e equipe existentes; não impor stack novo por preferência estética. Se iniciar sem stack prévia, propor uma stack web mainstream, sustentável e simples, justificando-a.
- **Backend / BFF / API:** concentra autenticação, autorização, consultas, transformação de dados, orquestração e ações de negócio. O navegador não deve falar com credenciais privadas de Coda/Evolution/n8n.
- **Adaptadores:** interfaces claras para `Atendimentos`, `Experiencias`, `Conversas`, `Orcamentos`, `Diagnosticos`, `Copiloto`, `Arquivos`; separar modelos da UI e modelos crus do Coda.
- **Contrato de comandos:** distinguir `Query` (leitura), `Command` (escrita/evento autorizado) e `Navigation` (mudança de rota/estado local). Evitar side effects de UI escondidos em consultas.
- **Fonte de verdade:** Coda inicialmente, com eventuais caches e índice de busca especializados **como derivados**, e não sistemas paralelos concorrentes. Não migrar automaticamente para PostgreSQL apenas por conveniência; qualquer migração exige caso explícito, plano e autorização.
- **Webhooks/assincronia:** processar eventos com IDs estáveis, ordenação quando importante, deduplicação, tratamento de eventos fora de ordem, estado de entrega e recuperação de falhas.
- **Observabilidade:** erros compreensíveis ao operador, logs correlacionáveis por `requestId`, sem dados excessivos, e monitoramento básico de integração.
- **Segurança:** login e sessões, autorização por papel/ação/dado, auditoria de alterações sensíveis, proteção contra CSRF/SSRF/injeção, validação de anexos, LGPD e tratamento controlado de dados de clientes.
- **Desempenho:** listas e Kanban não podem depender de baixar todas as linhas do ERP em cada navegação; paginação/consulta progressiva, debounce, cache criterioso e atualização incremental se demonstrar necessidade.
- **Resiliência:** falha de Evolution/n8n/Coda não pode simular sucesso. Mostrar indisponibilidade e permitir reconsulta/reprocessamento seguro. Prever fallback operacional autorizado.

### Organização de módulos sugerida (não obrigatória)

```text
src/
  app/                # rotas / navegação / layouts
  features/
    conversas/
    atendimentos/
    funil/
    experiencias/
    diagnosticos/
    orcamentos/
    copiloto/
  components/         # componentes visuais compartilhados
  domain/             # modelos, invariantes, comandos e validações
  integrations/
    coda/
    evolution/
    n8n/
    documents/
  server/             # BFF/APIs, autenticação e autorização
  tests/              # unitários, integração, fluxos E2E
  design/             # tokens e referência V20
```

Documentar contrato de API, modelos de transferência, erros esperados e origem dos dados. Não ser escravo desta árvore caso já exista projeto confiável organizado de outro modo.

### Estado/rotas sugeridos (adequar ao framework)

```text
/conversas
/funil?modo=quadro&...
/veiculos?aba=acompanhamento&modo=quadro&...
/veiculos?aba=historico&...
/atendimentos/:atendimentoId?aba=chat|mapa|diagnosticos
/experiencias/:experienciaId
```

O retorno à origem deve ser estável (histórico real de navegação + fallback) e preservar filtros, scroll, aba e colunas recolhidas. Deep links de Copiloto precisam de autenticação e de resolução de registros, não de IDs falsos.

---

## 8. Fluxos de ponta a ponta que devem funcionar

### Fluxo A — mensagem/contato → Atendimento

Evento recebido pela integração autorizada → deduplicar e persistir com ID do canal → resolver conversa e vínculos existentes → apresentar na lista Conversas → operador seleciona → abrir Atendimento correto na aba Chat → responder quando permitido → mensagem enviada com estado real e sem duplicação. Se não houver Atendimento inequívoco, exigir regra/seleção apropriada em vez de associar a cliente incorreto.

### Fluxo B — Atendimento inicial com cadastro proporcional

Criar oportunidade com dados mínimos, inclusive incompletos → permitir elaborar contexto, diagnósticos e orçamento preliminar dentro das condições técnicas → identificar Cliente/Veículo apenas quando possível/confiável → não criar registros artificiais por campos vazios → preservar vinculação de mensagem e proveniência.

### Fluxo C — Funil → alteração legítima de status

Consultar status real do Atendimento → arrastar para coluna permitida ou usar comando alternativo → validar regra, responsável e dados exigidos → executar ação oficial → obter confirmação do ERP → atualizar UI. Em falha, reverter transição otimista e mostrar motivo sem duplicar ação.

### Fluxo D — aprovação/agendamento → Experiência

Atendimento e orçamento conforme regras → aprovação explícita e registro da versão/scope → comando de agendamento autorizado → verificar/criar cadastro estruturado necessário conforme processo real → criar ou vincular **uma única Experiência** → confirmar associação 1:1 → mostrar no acompanhamento correto. Se falhar no meio, permitir recuperação idempotente e identificar registros parciais.

### Fluxo E — Produção → Histórico

Experiência agendada → entrada do veículo registrada → OS/processos/etapas reais → finalização técnica → saída física registrada → sai do acompanhamento e aparece no Histórico segundo o filtro correto. **Financeiro e pendências seguem independentes da presença física.** Não usar “finalizado” como sinônimo de “saiu”.

### Fluxo F — Copiloto → Experiência antiga

Texto/voz: “placa XPTO, veio mês passado, abre a experiência” → consultar ERP → desambiguar se necessário → abrir Experiência correta → comando contextual seguinte “abre o orçamento aprovado” com IDs reais e controle de autorização.

### Fluxo G — múltiplas demandas e chats

Mesmo telefone/contato pode ter 2 atendimentos ativos e 1 histórico. UI deve distinguir demandas e vincular conversa relevante corretamente; não replicar toda conversa indiscriminadamente para ambas.

### Fluxo H — orçamentos/documentos

Diagnósticos e serviços vinculados ao Atendimento → proposta comercial versionada → revisão humana apropriada → emissão de documento pelo fluxo existente validado → aprovação registrável → OS gerada apenas de escopo autorizado. Não assumir que custo estimado/energia é medição de tempo/custo real.

---

## 9. Escopo, prioridades e plano de execução

**A direção aprovou o produto final, não uma transformação irrestrita e simultânea de todos os módulos do ERP.** Implementar verticalmente, reduzindo risco e obtendo demonstrações utilizáveis. Não entregar somente documentação; após a auditoria inicial, **escrever código executável**.

### Fase 0 — inventário e contratos (curta, mas indispensável)

- Abrir a V20, mapear componentes e capturar visual de referência em desktop e celular.
- Inspecionar repositório/ambiente atual; identificar código, stack, hospedagem, permissões, testes e integrações.
- Ler o Coda real, fórmulas, botões, tabelas e views; registrar mapeamento e lacunas.
- Auditar contrato **Atendimento → Orçamento → PDF → OS**, agendamento e Experiência **em cópia/ambiente seguro** antes da integração de escrita.
- Criar `docs/ARQUITETURA_ATUAL.md`, `docs/MAPA_DADOS_CODA.md`, `docs/INTEGRACOES.md`, `docs/DECISOES_PENDENTES.md` e uma matriz curta de riscos de edição em produção.
- Apresentar plano técnico enxuto com decisões necessárias; começar implementação das partes seguras em paralelo, sem ficar paralisado na análise.

### Fase 1 — estrutura de aplicação + leitura real

- Projeto executável, autenticação mínima adequada, rotas, layout V20 fiel, componentes reutilizáveis e testes.
- Consulta **somente leitura** ao Coda: Atendimentos no Funil, Experiências em acompanhamento e histórico, campos de busca/filtro, abertura de registros.
- Estado real e ações de retorno. Substituir dados hardcoded por respostas verificáveis.
- Demonstrar busca real por placa/ID/nome e abertura do registro correto.

### Fase 2 — Atendimento e diagnóstico integrado

- Refatorar/portar as visões internas V18 mantendo a UX; binding dinâmico de Atendimento e conversas; mapa, regiões e diagnósticos ligados ao modelo real.
- Contratos de leitura/escrita para diagnosticar/adicionar/editar dentro de permissões.
- Garantir que troca de atendimento atualize todas as visões.

### Fase 3 — comunicação real + N:N

- Evolution API/n8n para receber e enviar mensagens com controle de entrega, anexos e histórico.
- Resolver modelo de vínculos Chat↔Atendimento; interface de associação manual/assistida e auditoria.
- Evitar duas fontes concorrentes de mensagens e consultas custosas ao provedor.

### Fase 4 — fluxos comerciais/operacionais com mutações controladas

- Kanban Funil com drag validado, atualização transacional e rollback visual.
- Agendamento e experiência idempotentes; associação de Cliente/Veículo; geração/acesso a orçamentos/OS conforme fluxos reais.
- Veículos: entrada, acompanhamento de processos, saída e histórico; alterações apenas por comandos autorizados.

### Fase 5 — Copiloto conectado

- Busca e navegação seguras por voz/texto e ferramentas estruturadas; contexto global/por registro.
- Desambiguação de resultados e continuação da conversa contextual.
- Sugestões estruturadas de diagnóstico/orçamento sujeitas a revisão; avaliação de qualidade e proteção contra comandos não autorizados.

### Fase 6 — validação operacional e implantação gradual

- Testes unitários, de integração com cópia/ambiente de teste, end-to-end, carga razoável, responsividade, permissões, duplicação, observabilidade e fallback.
- Homologação com usuários reais da FUNIX; corrigir erros que afetem fluxo ou fidelidade visual.
- Piloto com pequeno grupo e rollback; monitorar diferenças entre ERP e aplicativo; liberar progressivamente.

**Sequenciamento ajustável:** fases podem se sobrepor quando seguro; prioridades devem ser revistas pelo risco e pelo benefício real. Se alguma integração não estiver acessível, usar adaptador de teste claramente marcado, mantendo o fluxo evolutivo sem mascarar funcionalidade ausente.

---

## 10. Critérios concretos de aceite

### Visual / interação

- [ ] Entrada começa por **Conversas / Funil / Veículos**; sem faixa superior/rodapé redundantes.
- [ ] Interface testada em desktop e celular, responsiva e coerente com a V20. Decisões de espaçamento, cores, botões, tratamento do Copiloto, header e abas internas preservadas.
- [ ] Funil e acompanhamento com deslocamento horizontal e colunas recolhíveis, exibindo contagem correta.
- [ ] Alternância **Quadro/Lista** efetiva, usando os mesmos dados reais e mantendo filtros.
- [ ] Voltar do Atendimento/Experiência à origem exata, restaurando contexto e posição.
- [ ] Copiloto fixo não cobre botões, footer interno ou cards importantes.
- [ ] Sem falhas visíveis ao buscar zero resultados, carregar dados, perder internet, receber erro de integração ou ter registros ambíguos.

### Dados / integridade

- [ ] Conversas, Funil, Acompanhamento e Histórico mostram **registros reais**, sem exemplos fictícios em produção.
- [ ] Abriu Atendimento X: nome, chat, placa, mapa, diagnósticos e orçamentos pertencem a **X**.
- [ ] Abriu Experiência Y: operações e dados são de **Y**; relação de origem comprovada.
- [ ] Agendamento não gera Experiências duplicadas mesmo com clique duplo ou retry de webhook.
- [ ] Nenhuma edição direta de coluna derivada `fase_Operacional` ou situações calculadas.
- [ ] Movimento de card permitido persiste pelo comando correto; movimento proibido não persiste nem aparenta sucesso.
- [ ] Histórico corresponde a saída/critério real; “finalizado” e “saiu” não são confundidos.
- [ ] Mesma conversa associada a múltiplos atendimentos não contamina diagnósticos/orçamentos ou mensagens atribuídas.
- [ ] Contatos incompletos não geram Cliente/Veículo indevido.
- [ ] Pagamentos, preços e autorizações não são alterados por lógica implícita do frontend ou IA.

### Copiloto / integração

- [ ] “Encontre a experiência da placa [real] do mês passado” retorna o dado certo, desambigua várias ocorrências e abre com rota válida.
- [ ] “Mostre orçamentos aguardando aprovação” consulta/filtra status reais.
- [ ] “Quais veículos estão na pintura?” usa fase real e navega à visualização correta.
- [ ] Comando contextual seguinte reutiliza a entidade selecionada sem misturar contextos.
- [ ] Nenhum comando de Copiloto altera registro sensível sem autorização/permissão/confirmação adequadas.
- [ ] Mensagens de WhatsApp de teste chegam e saem uma vez, com identificador, status e falha tratada.
- [ ] PDFs/OS de teste respeitam versão e autorização; nada é disparado a clientes reais por testes não autorizados.

### Engenharia / entrega

- [ ] Repositório reprodutível; `README` com setup, variáveis de ambiente exemplificadas e comandos de execução/teste.
- [ ] Nenhuma chave, telefone ou dado de cliente confidencial no código-fonte, fixtures públicas ou logs sem controle.
- [ ] Rotas, adaptadores e regras de negócio testados; regressão visual para telas importantes.
- [ ] Logs, monitoramento e retry/idempotência mínimos documentados.
- [ ] Cada entrega descreve o que está realmente funcionando, o que é mock, riscos conhecidos e próximos testes.
- [ ] Homologação e eventual liberação produtiva dependem de validação explícita, não de sucesso isolado em ambiente de desenvolvimento.

---

## 11. Decisões técnicas que o Codex deve investigar, não presumir

1. **Stack e hospedagem:** existe repositório atual? Quais linguagens, dependências e padrões já operam? Qual local real de deployment e controle de versões? Melhor reaproveitar ou iniciar camada nova?
2. **Acesso ao Coda:** API/conector com capacidade de leitura/escrita suficiente? Limites, latência, qualidade de dados, ação de botões, filas e falha?
3. **Contrato do agendamento:** como exatamente o botão `at_Agendar` cria Experiência e cadastra Cliente/Veículo; qual a transação, rollback e condição de unicidade?
4. **Estados do Funil:** enumeração oficial, regras de fechamento e o significado de “Agendado” no Funil ativo.
5. **Estados da Experiência:** fonte da fase derivada, quem pode registrar evento de transição, quando entra/sai de Acompanhamento/Histórico.
6. **Chat N:N:** há entidade de conversa no Coda, fora dele ou em ambos? Qual chave estável do canal? Como delimitar mensagens por Atendimento? Quem pode associar/desassociar?
7. **Abertura de Experiência:** qual a menor tela operacional útil e quais ações pertencem a produção/financeiro versus comercial?
8. **Identidade Cliente/Veículo:** política segura para cadastro incremental, duplicatas, contato/placa e correção de registro.
9. **IA e dados:** qual provedor/modelo está disponível, política de dados, custo, limite, autenticação, latência, áudio e ferramentas?
10. **Documentos:** estado real de PDFs, orçamentos, versões e OS. Qual serviço já executa cada etapa?
11. **Segurança e papéis:** quem utiliza o app, quais operações podem fazer, credenciais e trilhas?

**Ao encontrar uma lacuna:** apresentar uma recomendação proporcional, evidência, risco, opção de implementação reversível e a decisão objetiva necessária. Não abrir uma consulta para cada detalhe cosmético. **Alterações com efeito financeiro, jurídico, técnico, de integridade dos dados ou implantação produtiva necessitam validação específica.**

---

## 12. Instruções finais de execução para o Codex

Você não é apenas um gerador de telas nem um auditor que escreve relatórios. **É o responsável técnico por transformar o produto aprovado em software funcional.**

**Comece na prática:**

1. Examine os arquivos anexados, principalmente a V20, e leia as referências institucionais pertinentes.
2. Identifique o ambiente real, o repositório de destino e as conexões de Coda, Evolution API, n8n e demais plataformas disponíveis.
3. **Não faça nenhuma mutação em sistemas produtivos na fase de descoberta.** Confirme recursos com acesso de leitura antes de pedir alteração de permissões.
4. Produza o mapa inicial de arquitetura e dados com distinção entre fato e suposição.
5. Proponha milestones executáveis, com testes e demonstração incremental.
6. Inicie o código-base e implemente a primeira fatia real que depende apenas de leitura/consulta e navegação. Não adie todo desenvolvimento até “resolver tudo”.
7. A cada milestone entregue **arquivos de código, instruções para rodar, evidência de teste, pontos pendentes e decisões que realmente precisam da direção**. Se houver acesso a ambiente de preview seguro, disponibilize-o.
8. Sempre que houver mudança de desenho, explicar precisamente por que a V20 não consegue atender ao requisito e obter validação antes de substituir a experiência aprovada.

**Não fazer:** refazer o design do zero; fingir conectividade do mock; colocar credenciais no browser; criar entidades duplicadas; codificar estágios fictícios; remover validação ou autenticação para facilitar; expor dados reais nos testes; alterar Coda produtivo sem autorização; prometer envio/OS/financeiro em transição de interface; migrar banco ou reconstruir os fluxos já existentes sem auditoria e justificativa.

**Resultado esperado:** um aplicativo que se pareça e funcione como a V20 foi concebida, mas cuja lógica, dados, mensagens, processos, orçamentos e ações respeitem o ERP real da FUNIX — com Copiloto integrado, navegação eficiente, integridade e possibilidade de evolução incremental.

---

## Anexo A — Evidências observáveis do HTML V20

Arquivo: `FUNIX_V20_Menu_Compacto_Kanban.html` (HTML autônomo de protótipo).

- Contém layout inicial com abas `Conversas`, `Funil`, `Veículos`, caixa de busca compacta e alternância de experiências **Em acompanhamento/Histórico**.
- O Funil demonstra Kanban com colunas horizontais, colapso vertical com contador, alternância `Quadro/Lista` e drag-and-drop HTML5.
- A área Veículos usa a entidade Experiência conceitualmente, mas a massa exibida é **fictícia**.
- O acesso ao interior usa visual de Atendimento V18, com cabeçalho compacto, Chat/Mapa/Diagnósticos, painel Copiloto e rodapé adequado.
- A função demonstrativa de abrir cards **não injeta os dados selecionados no interior**, e o drag-and-drop altera apenas o array local fictício. Portanto, **não transportar esses comportamentos para produção sem reescrever com estados, rotas, validações e adaptadores reais**.
- O botão de novo Atendimento e recursos de IA/áudio/anexos podem conter simulações; aferir cada um individualmente.
- Existe CSS histórico acumulado de muitas iterações: usar como referência visual, **não como obrigação de preservar todo código CSS e JavaScript legados**. Limpar sem descaracterizar a experiência aprovada.

## Anexo B — Documentos do projeto entregues no pacote

- `00_master_index.md` — governança, precedência e origem dos conceitos.
- `01_identity.md` — missão, personalidade e padrões de integridade.
- `02_business_model.md` — lógica econômica e compromissos financeiros.
- `03_customer_psychology.md` — hipóteses e pesquisa sobre o cliente.
- `04_sales.md` — fluxo comercial, orçamento, aprovação e passagem à operação.
- `05_operations.md` — produção, qualidade, entrada/saída e indicadores.
- `06_legal_and_policy.md` — LGPD, consumidor, contratos, segurança, dados.
- `07_digital.md` — dados, integrações, idempotência, IA e implantação.
- `08_brand_assets.md` — diretrizes visuais e de marca.
- `09_decision_framework.md` — decisão, autoridade e riscos.
- `10_strategy.md` — prioridades e tese estratégica.

Leia os arquivos pertinentes; **não transforme propostas de documentos em políticas vigentes sem consultar `FUNIX_REGISTROS_VIVOS.md`** e sua versão aprovada, quando disponibilizado.

**Fim do guia-mestre.**
