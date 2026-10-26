# FUNIX — Entrega ao Codex | Mapa Mestre V0.9 aprovado

**Data de consolidação:** 23/10/2026. **Âmbito:** MVP Comercial, não o ERP operacional. **Finalidade:** iniciar implementação incremental sobre o repositório existente `Funix-CentroReparacaoAutomotiva/funixapp`.

## 1. Arquivos entregues e precedência

- `FUNIX_mapa_mestre_V09_APROVADO.json`: **fonte funcional principal**, exportada pelo proprietário após a revisão final. Contém `model.levels`, `model.rules`, `model.implementation_contract_v09` e `reviews`.
- `FUNIX_mapa_mestre_interativo_v09.html`: **visualização auxiliar dos fluxos**, não fonte de verdade do estado da revisão. Para visualizar os status finais no navegador, importe o JSON aprovado no HTML. O HTML isolado pode exibir os status iniciais da V0.9.
- Este arquivo: escopo de execução para o Codex e esclarecimentos pós-revisão.

**Conferência:** 144/144 itens avaliáveis (atividades, gateways e regras do contador da UI) com `reviews[id].status == "ok"`; nenhuma correção ou item sem avaliação nesse conjunto. Alguns elementos de navegação `type:"sub"` não pertencem ao contador e guardam estados históricos `todo`/ausentes; não interpretar isso como 12 decisões de negócio pendentes. Comentários históricos e `initial_reviews`, `previous_reviews`, `legacy*`, `changes` históricos são contexto, NÃO regras vigentes. Algumas descrições na V0.9 ainda usam "proposta" por terem sido redigidas antes da aprovação; o status final de revisão do usuário prevalece para os itens efetivamente aprovados. Se houver contradição real, sinalizar, não inventar política.

**Importante:** o JSON é uma especificação de negócio (com modelo gráfico), não um esquema de banco, API, código executável ou declaração de homologação.

## 2. Decisões funcionais já aprovadas

1. O App FUNIX é **somente Comercial**: Atendimento → Diagnósticos → Serviços/Componentes → Preço/Energia/Prazo → Orçamento versionado → **Enviar ao ERP**. Não agenda. Não gera OS. Não controla Produção/Financeiro.
2. Campos de cliente, contato, veículo, placa/modelo/marca são texto do próprio Atendimento. **Não consultar nem sincronizar** as bases de clientes, entidades, veículos e pagadores do Coda. Telefone é obrigatório ao abrir Atendimento; **Enviar ao ERP não exige preencher cadastros adicionais** (comentário final do usuário em R10/NH01: "Nenhum dado é obrigatorio" para o envio).
3. O caminho normal de preço unitário é `base_não_dimensionada × FD × FV_tabela × FC_cor × FR_risco`. Se houver **preço especial exato** para `(tabela_comercial, serviço, dimensão)`, ele substitui todo o caminho normal. Em ambos os casos: teto para próximo múltiplo de R$ 0,05 do **unitário**, depois quantidade. Não há escala progressiva por quantidade.
4. Componente: valor manual (zero explicitamente informado é válido) × fator individual de curadoria FCT → teto do unitário em R$ 0,05 → quantidade. Preço ausente não é zero. Desconto/ajuste comercial nunca alteram componentes.
5. Modalidades exclusivas: nenhuma, desconto em serviços, ou ajuste do **total dos serviços**. Ajuste inferior aparece ao cliente como desconto, sem alterar valores originais dos itens. Ajuste positivo distribui aumento proporcional nas linhas de serviços; **o valor unitário ajustado de cada serviço deve ser calculado e armazenado** (comentário NN03). Tentar compensar resíduo no último serviço. Unitários em R$ 0,05 e total de linha = unitário × quantidade. Diferença residual até **R$ 0,50** em relação ao total informado pelo operador pode ser aceita, com ciência do operador; acima disso, solicitar revisão manual. O **total emitido fecha EXATAMENTE com a soma dos itens efetivos e componentes**. Não usar centavos escondidos, alterar peças ou travar sem permitir correção.
6. Energia por etapa `Eetapa = Ebase + Edimensão`; energia do serviço é a soma das etapas, considerando quantidade. Capacidade diária **global**, positiva; dias técnicos = teto(energia total/capacidade global). Energia não recebe fatores comerciais. Falta de dados essenciais para estimativa bloqueia a **emissão**, não o rascunho.
7. Etapas técnicas são materializadas no orçamento. Cada versão emitida A/B/C é um **snapshot imutável**, por comando manual, contendo preços, etapas, dimensões, energias e parâmetros. A OS futura usa exclusivamente o snapshot recebido e **não** reconstrói etapas a partir de catálogo vivo.
8. O botão **Enviar ao ERP** encaminha os dados disponíveis do Atendimento + snapshot de versão emitida por via única. O Coda cuida de completar/vincular cadastros, agenda, OS e demais operações. Um retorno técnico mínimo aceito/falhou/incerto não é sincronização de dados operacionais. Falhas devem ser visíveis e recuperáveis manualmente, preservando dados.
9. Nomenclatura legível observada no Coda: `PLACA-OR<numero><letra>`, às vezes `OR<numero><letra>` ou `SP-OR<numero><letra>`. **O algoritmo real de geração não foi verificado.** Não inventar a semântica de `SP`, número, mudança de placa ou continuação após Z. Gerar desde já IDs internos estáveis separados do rótulo; isolar a nomenclatura para homologar mais tarde, sem bloquear a persistência de Atendimentos.

## 3. Instrução operacional ao Codex — primeira execução

**Você está autorizado a trabalhar no código de desenvolvimento do repositório existente. NÃO está autorizado a escrever no Coda produtivo, publicar/deployar em produção, mudar DNS/VPS/credenciais ou refatorar inteiramente o frontend. Não faça push remoto sem a autorização do proprietário.**

1. **Inspecione primeiro o repositório real**, branch atual, arquitetura, scripts e estado de testes. Consulte `README.md`, `docs/DECISAO_COMERCIAL_PRIMEIRO.md` e documentos relevantes. Separe implementação verificada de intenção antiga. Os textos anteriores que dizem que o app agenda ou consulta clientes/veículos Coda ficaram **superados para o MVP pela V0.9**.
2. Emita diagnóstico **breve** e um plano de incrementos com arquivos/tabelas/APIs propostos. Evite abstrações SaaS, permissões por alçada, orquestração avançada, filas e tolerância a falhas desproporcionais.
3. **Implemente apenas o incremento 1**, sem aguardar nova sessão: banco comercial próprio com migrações simples e Atendimento persistente (criar, listar, consultar e editar), aproveitando React/TypeScript/Vite e API Node já existentes. Não recrie o aplicativo do zero. Um Atendimento exige apenas telefone na abertura; os demais dados são campos simples e opcionais. Não consultar Coda para resolver entidade/cliente/veículo. Preservar rascunho ao reiniciar servidor e navegador.
4. Escreva e rode testes desse incremento (persistência, valores opcionais, validação mínima, atualização e recuperação após reinício quando testável). Não usar dados produtivos para testes. Executar `npm run check` ou o comando real do projeto, registrando resultados.
5. Entregue resumo dos arquivos modificados, migrações, endpoints, comportamento implementado, evidências dos testes e dificuldades reais. **Pare após o incremento 1** para revisão do proprietário antes de iniciar os próximos incrementos.

## 4. Roadmap posterior (não implementar tudo no primeiro pedido)

- **Incremento 2:** Diagnósticos, serviços, componentes e catálogos técnicos/comerciais necessários à composição.
- **Incremento 3:** Motor matemático de preço, energia/prazo e negociação; usar Decimal ou cálculos exatos em inteiros de centavos, não ponto flutuante para fechar dinheiro. Validar preços normal/especial, FCT, múltiplos R$ 0,05 e tolerância de R$ 0,50.
- **Incremento 4:** Emissão manual A/B/C, snapshot imutável, visualização/exportação comercial e navegação do orçamento.
- **Incremento 5:** Botão de envio e payload, primeiro em **simulação**, com erros visíveis. **Escrita real no Coda só após investigação e autorização separadas.**

## 5. Condições para liberar operação real

A aprovação do Mapa Mestre **não comprova código implementado**. Antes de usar com clientes reais, confirmar recuperação do Atendimento, contas corretas, integridade das versões e orçamento apresentável. Antes de enviar ao Coda real, homologar o contrato receptor e o tratamento mínimo de falhas. Falha manualmente recuperável é aceitável; perda silenciosa de dados ou orçamento matematicamente inconsistente não é.
