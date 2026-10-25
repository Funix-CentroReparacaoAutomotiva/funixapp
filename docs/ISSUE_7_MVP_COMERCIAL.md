# Issue #7 — MVP Comercial integrado para homologação

Implementação em `feat/issue-7-mvp-comercial`, partindo exatamente da M1.2 auditada `06e5a46035097b779872765eff8a5f2ababf7509`. [Issue #7](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/7) é a autorização atual; substitui o limite antigo de homologação após cada subincremento. [PR #8](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/8) tem base na branch comercial, preservando a main antiga.

**Resultado:** cadeia navegável Atendimento → composição mestre → cenários/matriz → configuração comercial → componentes → motor V0.9 → negociação/prévia → emissões N → PDF real, com persistência após reinício. Verificação integrada realizada com dados sintéticos. A homologação funcional do proprietário e o uso produtivo ainda não foram realizados.

## Base, fontes e limites

- SHA e diretório limpo foram conferidos antes de criar a branch. Não houve merge/rebase com a main nem transporte dos PRs de infraestrutura.
- V0.9 aprovado (`model.levels`, `model.rules`, `implementation_contract_v09`) e instruções aprovadas governam o motor. Respostas históricas não foram transformadas em novas regras.
- Decisões da Issue #7 governam composição mestre, máscaras, emissões ilimitadas e homologação única. V20 continua a referência visual.
- Acesso aos originais V1.0, V0.9, V20 e hierarquia V2 confirmado. Referências institucionais de identidade e política legal foram usadas apenas para comunicação fiel, sem inventar preço, compromisso, garantia ou termo jurídico.
- Não há acesso ativo a Coda/WhatsApp/IA, agenda, OS, produção ou financeiro operacional. Nenhum sistema produtivo, VPS, Docker compartilhado, DNS, Traefik, secret ou workflow foi alterado.

## 1. Composição mestre, cenários e matriz

`diagnosis_items` continua com `UNIQUE(atendimento_id,piece_id)`. Clicar novamente numa peça individual já selecionada abre o mesmo item; Ambos continua selecionando duas peças físicas reais, sem terceira peça.

Linhas de serviço são independentes por `diagnosis_services.id`, mesmo quando repetem `service_id`. Editar quantidade, serviço, dimensão, observação ou diagnóstico altera a definição mestre compartilhada. Foi eliminado o delete/reinsert de todas as linhas durante a edição: IDs e flags sobrevivem a mudanças de atributos.

O diagnóstico contextual da peça é preservado. Cada lançamento de serviço também pode selecionar um diagnóstico próprio e observações, permitindo danos diferentes na mesma peça sem clonar a peça física. Isso é associação por lançamento, não criação automática de serviços nem uma taxonomia de intensidades inventada.

Cada cenário guarda nome, ordem de criação, revisão e máscaras por IDs de peça, linha de serviço e componente. Criar cenário vazio não copia itens; duplicar copia somente as flags. Novos itens mestre aparecem em todos, inicialmente habilitados **somente no cenário ativo**, conforme a proposta técnica da issue. Não há limite de três ou sete cenários. Nome é editável; IDs não dependem do nome.

Inclusão efetiva = peça pai habilitada E linha habilitada. Desligar pai não apaga flags dos filhos. A matriz e a edição usam a mesma persistência; modo Só diferenças compara inclusão efetiva e mantém o pai como contexto. Componente de preço zero ainda aparece como diferença quando a inclusão diverge. A matriz rola horizontalmente dentro da moldura móvel V20.

Todas as composições/prévias na interface preservam as mesmas linhas e atributos mestre, identificando as excluídas. Totais e PDF usam somente linhas efetivas. Na matriz, valores são anteriores à negociação; negociação é feita na emissão do cenário escolhido, conforme proposta UX da issue.

## 2. Migrações e integridade

As migrações 1 e 2 não foram reescritas. Atualizações novas são aditivas, dentro do runner transacional existente:

| Versão | Acréscimos |
|---|---|
| 3 | Cenários, máscaras de peças/serviços, revisão/parâmetros da composição e observação/diagnóstico por linha |
| 4 | Configuração comercial versionada, componentes monetários e máscaras dos componentes |
| 5 | Emissões por Atendimento, chave idempotente, snapshot e PDF imutáveis |

O primeiro cenário de um banco M1.2 copia os valores `enabled` existentes de pais/filhos. Colunas legadas são mantidas por compatibilidade; máscaras passam a governar a inclusão efetiva. Nenhum Atendimento, catálogo, peça ou linha é recriado para migrar.

O teste congela o runner original M1.2 em `server/tests/fixtures/m1_2_migrations.ts`, gera um banco sintético com serviços repetidos e quantidade `0.25`, compara registros brutos e prova persistência. Falha provocada em migração posterior reverte também colunas/tabelas intermediárias, sem reset. Banco futuro/estranho continua recusado.

FKs, validação de pertencimento ao Atendimento, revisões e transações protegem alterações. Excluir peça/linha/componente afeta todos os cenários com confirmação; máscaras filhas são removidas em cascata. Inativar cadastro preserva referências anteriores e impede novas seleções; a emissão verifica que referências efetivas estão ativas e validadas. Uma dimensão pode ser inativada mesmo se seu serviço pai já estiver inativo.

## 3. Configuração e cálculo V0.9

A configuração inicial é **vazia**, sem catálogo monetário fictício na execução normal. O operador mantém tabelas/FV, cores/FC, riscos/FR, base por serviço, FD por dimensão, etapas com dimensão técnica/energias, capacidade diária global, especiais por chave tripla e condições comerciais. Metadados de configuração incluem revisão e data; emissões copiam a configuração usada.

A interface permite salvar preços/fatores/energias pendentes como ausência, sem convertê-los em zero. Uma relação de preço especial precisa de chave e valor explícitos. Catálogos continuam próprios, sem importação Coda. Hierarquia V2 permanece proposta até validação; 23 folhas sem código continuam pendentes.

`server/exact.ts` usa inteiros BigInt e frações exatas. Números financeiros nunca passam por Number. Cálculos:

- Normal: base × FD × FV × FC × FR; teto do **unitário** ao próximo R$0,05; depois quantidade.
- Especial: somente chave exata tabela+serviço+dimensão, substituindo base/fatores. Ainda recebe teto unitário e quantidade.
- Componente: preço manual presente, inclusive zero, × FCT individual; teto unitário; quantidade. Nunca recebe negociação de serviços.
- Energia: soma de Ebase+Edimensão das etapas, com quantidade e inclusão efetiva; sem fatores comerciais. Dias técnicos = teto(energia/capacidade global positiva).
- Negociação exclusiva: nenhuma, desconto monetário D em serviços ou ajuste do subtotal A. A<S vira desconto preservando unitários originais. A>S distribui proporcionalmente e registra unitários finais em múltiplos R$0,05; tenta compensação no último serviço sem valor negativo.
- Resíduo |A−efetivo| até R$0,50 exige ciência explícita se não zero; superior bloqueia emissão com revisão manual. O total emitido é sempre soma das linhas efetivas − desconto + componentes.

Decisão técnica reversível do rateio: unitários proporcionais inicialmente recebem teto ao R$0,05; último serviço usa o múltiplo não negativo mais próximo. Empate usa o menor múltiplo. Não é otimização multivariável nem compensação escondida em componentes.

**Quantidades fracionárias:** teto unitário antes da quantidade pode resultar em frações de centavo (`0.05 × 0.25 = 0.0125`). Nenhuma nova regra de arredondamento de total foi inventada: API, UI e PDF preservam todos os dígitos e fecham exatamente. A apresentação comercial definitiva desses casos é ponto explícito da homologação; se a direção exigir duas casas no total, precisará aprovar uma política adicional compatível, sem alterar snapshots anteriores.

Ausências são indicadas por fluxo/linha. Preço já calculável pode aparecer mesmo com energia pendente. Emissão exige cálculo completo e escopo efetivo; rascunho permanece editável.

## 4. Emissão e PDF

Emissão é manual em duas ações: preparar prévia e emitir. Prévia retorna estado calculado e token de conferência. Na emissão, o servidor verifica novamente Atendimento, atributos, máscaras, catálogos, parâmetros e configuração; divergência retorna 409, não orçamento desatualizado.

`BEGIN IMMEDIATE` serializa sequência por Atendimento. Chave idempotente reapresentada com a mesma requisição retorna a versão original, inclusive após alterações posteriores. Reutilização da chave para conteúdo diferente é recusada. Rótulos A…Z,AA,AB… são apresentação reversível; IDs internos permanecem independentes. Não há limite de três versões.

Snapshot guarda contexto do Atendimento, composição/IDs/atributos, cenário/revisões, configuração, parâmetros, valores originais/finais, descontos/ajustes, fatores, etapas/energias, prazo e condições. PDF é gerado no ato e armazenado como BLOB, não regenerado a partir do catálogo vivo. Triggers recusam UPDATE/DELETE de versões. Mudanças posteriores não alteram snapshot ou bytes do PDF.

O PDF é um arquivo PDF 1.7 verdadeiro, paginado, com fonte DejaVu Sans incorporada e mapa Unicode. Fonte/licença estão versionadas. Geração local Node, sem dependência npm adicional, n8n, browser remoto ou serviço pago. Acentos, valores, escopo e prazo foram conferidos por `pdftotext`; a primeira página foi renderizada e inspecionada visualmente.

PDF e UI distinguem dias técnicos de data de entrega e não declaram autorização de execução/aceite jurídico. Condições comerciais são fornecidas pelo operador; não foi inventada garantia/validade legal. Modelo final para envio a clientes requer homologação específica, fora da execução sintética.

## 5. Evidências e resultados

| Verificação | Resultado |
|---|---|
| `npm run check` | Build, tipos, 49 testes Node, lint sem erros; quatro avisos preexistentes em App.tsx |
| Cenários/matriz Chromium | 3 grupos: duplicação/máscaras, edição global, reinício/mobile/scroll |
| MVP integrado Chromium | 7 grupos: entrada/catalogação real por UI, configuração, componentes e frações, negociação/PDF, Z/AA, reinício/mobile e ausência de provedores |
| Regressão M1.1 | 19 grupos preservados |
| Regressão M1.2 | 7 grupos preservados; expectativa de footer atualizada para a entrada de orçamento autorizada nesta issue |
| Deploy existente | 7 testes simulados preservados; sem Docker/VPS produtivo |
| Concorrência | Dois processos Node distintos emitindo no mesmo SQLite, sem sequência duplicada |
| Backup | Backup nativo/restauração de 27 versões e PDF idêntico comprovados |
| PDF | Arquivos A e AA extraídos por parser independente, com acentos e totais; A permanece idêntico após mudança/reinício |

[Evidências](evidencias/issue7/): relatórios JSON, logs, capturas desktop/mobile, PDFs sintéticos e textos extraídos. [Comandos](evidencias/issue7/COMANDOS.md) reproduzem as execuções. Não foram expostos `.env`, bancos, dependências instaladas, segredos ou dados de clientes reais.

O teste integrado cria dados pela interface, incluindo configuração financeira. Para alcançar a borda 26/27, as emissões intermediárias 2–25 usam comandos explícitos da API no banco sintético; A, Z e AA são emitidas pelos botões da interface. Não há resposta de sucesso mockada. 503 é simulado apenas na regressão M1.2; 401,409, persistência e PDFs usam API real. Hosts externos são bloqueados pelo harness e não houve chamadas a provedores.

## 6. Operação curta para homologação

1. Checkout da branch de desenvolvimento; Node 24/npm 11. Configurar senha de operador e `FUNIX_DATABASE_PATH` para **arquivo de desenvolvimento**, nunca arquivo produtivo. Rodar `npm run dev:api` e `npm run dev -- --port 5173 --strictPort`.
2. Criar Atendimento pelo Funil, informar telefone e abrir Diagnósticos/Mapa. Em Catálogos, validar as peças corretas e cadastrar os serviços, dimensões e diagnósticos fornecidos pela direção.
3. Compor lançamentos. Duplicar/renomear cenários e alterar somente inclusões. Para comparar atributos diferentes, criar linhas diferentes; o aviso de edição global permanece visível.
4. Em **Orçamento e componentes → Configuração comercial**, preencher dados reais de homologação fornecidos pelo operador, etapas/capacidade e condições. Selecionar tabela/cor/risco comuns em **Parâmetros do Atendimento**.
5. Adicionar componentes monetários, verificar matriz e pendências, escolher cenário e preparar emissão. Revisar negociação/resíduo, emitir e baixar PDF. Reabrir versões sem recalcular por dados atuais.
6. Reiniciar API/navegador, entrar novamente e localizar Atendimento/cenários/versões. Campos não salvos continuam sendo formulário, não banco; a interface avisa antes de descartá-los.

## 7. Pendências reais e implantação futura

- Dados comerciais próprios e validação da árvore V2 continuam sob responsabilidade da direção. A aplicação não os adivinha nem importa o Coda. Fixtures desta entrega são somente testes.
- Convenção de prefixo comercial do Atendimento não foi definida; UUID auditado permanece. Letras das versões não simulam sequência Coda.
- Apresentação das frações de centavo e formato/condições do documento para cliente devem ser homologados, sem mudança financeira silenciosa.
- Não há envio ao ERP, WhatsApp, IA, cadastros operacionais, agenda, OS, produção ou financeiro. Isso permanece fora desta autorização.
- Não foi feito teste de carga nem execução remota. Fonte PDF aumenta imagem/armazenamento; cada emissão guarda seu próprio PDF para garantir imutabilidade. O uso alvo continua um operador.
- O Compose legado não tem volume de SQLite e a main ainda é outra implementação. **Não implantar esta branch com esse Compose.** Proposta para revisão futura: diretório exclusivo FUNIX persistente e gravável pelo UID Node, montado em `/data` na API; `FUNIX_DATABASE_PATH=/data/funix.sqlite`; arquivo 0600/diretório restrito. Configurar backup consistente com o comando existente e cópia externa com retenção/ensaio de restauração antes de produção. Nenhum volume, serviço, credencial ou rotina de VPS foi criado nesta issue.

A entrega implementa a cadeia técnica e disponibiliza uma única experiência integrada para homologação. Não declara aprovação do proprietário, conformidade jurídica do PDF, prontidão produtiva ou autorização de merge/deploy.
