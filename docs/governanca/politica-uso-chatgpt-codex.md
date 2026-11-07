# FUNIX — Política de escolha entre ChatGPT, Codex e ferramentas conectadas

**Estado:** diretriz aprovada pela direção em 2026-11-07, com vigência documental na branch `main` após a integração desta PR. **Escopo:** desenvolvimento de software, integrações, automações, testes, depuração e documentação técnica da FUNIX. Não substitui as políticas empresariais, as instruções específicas de cada tarefa nem as regras de segurança e aprovação.

## 1. Objetivo

Preservar a capacidade de uso do Codex sem transferir custos, falhas ou retrabalho para outra ferramenta. O resultado desejado é **entrega verificável com o menor esforço total proporcional ao risco**, não reduzir o número de chamadas ao Codex a qualquer custo.

**Regra-base:** ChatGPT resolve diretamente quando possui contexto, ferramentas, permissões e meios de validação suficientes. Codex entra quando seu ambiente de desenvolvimento oferece vantagem material. Nunca encaminhar uma tarefa ao Codex apenas por conter código, parecer difícil ou envolver GitHub.

## 2. Decisão antes de convocar o Codex

O assistente que recebe a demanda verifica quatro critérios, sem exigir questionário ou relatório para atividades rotineiras:

1. **Ambiente necessário:** é indispensável trabalhar em um checkout local, terminal, servidor de desenvolvimento, navegador de QA ou arquivos que o ChatGPT não consegue acessar e testar diretamente?
2. **Acoplamento e iteração:** a mudança atravessa vários componentes, depende de dependências locais, exige depuração reproduzível ou ciclos de edição e execução?
3. **Validação:** o ChatGPT consegue verificar a entrega com as ferramentas disponíveis? Resposta plausível ou diff isolado não é equivalente a testes executados.
4. **Custo e risco total:** delegar reduz de fato tempo, tentativas e risco? Não presumir preços ou equivalência entre cotas de ChatGPT, Codex e API.

**Decisão:**
- **ChatGPT / ferramentas conectadas:** especificações, perguntas técnicas, arquitetura, pesquisas, análise de requisitos, revisão de PRs/diffs, documentação, consulta a GitHub/Coda/n8n e pequenas alterações cujo resultado possa ser verificado diretamente. Tarefas complexas de análise podem permanecer integralmente no ChatGPT.
- **Codex:** trabalho que se beneficia substancialmente de checkout e comandos locais, alterações integradas e dependentes, execução de builds/testes, depuração, QA visual com aplicação em funcionamento, refatoração ampla ou investigação com muitas iterações. Uma correção pequena pode exigir Codex se reproduzir e testar o defeito depender desse ambiente.
- **Outra ferramenta específica:** se a demanda é essencialmente editar dados, consultar ERP, executar fluxo n8n ou operar Gmail/Drive e houver conector apropriado, preferi-lo a encaminhar artificialmente a atividade ao Codex.
- **Sem acesso suficiente:** declarar a limitação; propor a menor etapa verificável. Não afirmar que testes ou alterações foram realizados e não usar Codex como atalho para obter permissões não autorizadas.

**Em caso de empate real, priorizar ChatGPT**, desde que a entrega e sua validação sejam equivalentes. Pedido explícito da direção para utilizar uma ferramenta específica prevalece dentro dos limites técnicos e de segurança.

## 3. Entrega ao Codex: contrato mínimo

Quando Codex for útil, encaminhar um pacote pequeno e objetivo, preferencialmente com: **problema/resultado esperado; repositório, branch e arquivos relevantes; limites do escopo; critérios de aceitação; testes pertinentes; proibições de produção, credenciais, dados reais, merge ou deploy quando não autorizados.**

Não gastar execuções de Codex só para:
- repetir conversas, pesquisas ou decisões já concluídas;
- redescobrir sem necessidade a estrutura completa do repositório;
- reescrever especificações que o ChatGPT consegue concluir;
- testar ou alterar componentes não relacionados ao pedido;
- gerar relatórios extensos sem utilidade operacional.

Evitar o extremo inverso: não economizar Codex sacrificando compilação, regressões, segurança, reversibilidade ou verificação de integridade. Priorizar uma unidade de mudança coerente em vez de muitos microchamados repetitivos.

## 4. Regras de execução e segurança

- A escolha da ferramenta **não concede novas autorizações**. Não efetuar merge, deploy, alterações em produção, migrações de dados reais, despesas ou envios externos sem autorização aplicável.
- Cumprir os limites específicos da tarefa e as instruções relevantes do repositório. Tratar instruções históricas como histórico quando substituídas por decisões posteriores.
- Testar de forma proporcional ao impacto e informar **o que foi efetivamente verificado** e o que depende de ambiente ou aprovação.
- Respeitar privacidade, gestão de segredos e procedimentos de reversão. Nunca usar créditos disponíveis como justificativa para ações arriscadas.
- Não usar dois agentes para executar o mesmo trabalho em paralelo sem benefício claro e coordenação explícita.

## 5. Distribuição das instruções

**Antes da convocação:** as instruções do **Projeto FUNIX no ChatGPT** determinam o encaminhamento; um arquivo GitHub sozinho não consegue impedir que uma sessão Codex seja iniciada.

**Durante a execução no repositório:** o arquivo raiz `AGENTS.md` contém orientações essenciais e aponta para esta política. O Codex reconhece `AGENTS.md`; o documento detalhado deve ser lido **quando a decisão de ferramenta/escopo exigir**, não por obrigação antes de cada modificação trivial.

**Fonte técnica versionada:** este arquivo governa a decisão de roteamento para trabalhos de desenvolvimento do FunixApp. Para outras iniciativas da FUNIX, aplicar o mesmo princípio pelas instruções do projeto, sem pressupor que o repositório do aplicativo governa automaticamente outros sistemas.

**Aplicação no Projeto FUNIX:** a direção confirmou a inclusão da diretriz nas Instruções do Projeto em 2026-11-07. As instruções do projeto realizam a triagem antes da convocação; este documento detalha os critérios técnicos versionados. Para alterações futuras, manter os dois pontos coerentes, sem duplicar o texto integral aqui.

## 6. Revisão de eficácia

Após um conjunto pequeno de demandas reais, revisar exemplos de roteamento, chamadas Codex evitadas, reenvios, falhas de validação, tempo até aceite e consumo disponível no painel de uso. Ajustar critérios apenas a partir de evidência; não estabelecer economia percentual fictícia.

**Observação de dívida técnica:** o `AGENTS.md` atual acumula muitas instruções históricas. Uma revisão para separar regras duráveis de decisões de fase pode economizar contexto em cada sessão Codex, mas deve ocorrer **em mudança separada e com preservação das decisões aprovadas**. Este PR não reescreve esse histórico.
