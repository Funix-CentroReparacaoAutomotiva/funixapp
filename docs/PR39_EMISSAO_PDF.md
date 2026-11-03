# PR #39 — emissão com jsreport, parcelamento global e prazo comercial

Continuação na branch existente `feat/orcamento-identificacao-pdf-download`, a partir de `17e1c50a6f4dc3ef91b9803bd38ebb9cef28f430`. Especificação vigente: pedido de conclusão da emissão e comentário [6593090247](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/39#issuecomment-6593090247).

**Implementação e testes são locais/sintéticos. O template real não foi executado nem homologado nesta tarefa.** Não houve merge, deploy, importação ou alteração de Coda, VPS ou banco instalado.

## Inspeção inicial

O HEAD do PR já continha V11, identidade `OR-000001`, nome amigável, histórico com download direto, adapter e cliente HTTP. Esses elementos foram aproveitados. Faltavam:

- Integrar o cliente ao endpoint real de emissão: o handler ainda chamava o PDF síncrono anterior, dentro da transação.
- Configuração local global de parcelamento e congelamento das taxas/resultados.
- Prazo comercial por cenário, independente da sugestão técnica.
- Reserva durável de identidade: `MAX(serial)+1` não cobria geração externa, falha, reinício e concorrência.
- Validação do PDF incompleto/stream sem limite e agrupamento de serviços repetidos no adapter.

A checagem inicial do PR passou com 232 testes Node. A auditoria identificou que isso não comprovava integração com o jsreport.

## Fluxo implementado

1. A prévia lê o cálculo oficial, a configuração global de parcelas e o prazo do cenário. O token inclui essas condições e as revisões vigentes.
2. A confirmação usa a mesma chave de idempotência. Uma transação curta valida o contexto/token e reserva o número global, UUID, data, snapshot e JSON completo do template.
3. A transação termina **antes** de iniciar `POST /api/report`. O renderer recebe somente os dados congelados, por autenticação Basic no backend.
4. O cliente verifica status HTTP, MIME, limite de 15 MiB, timeout de 12 s, assinatura `%PDF-` e terminador `%%EOF`, lendo o stream com limite.
5. Outra transação curta revalida o token e a posse da tentativa, grava snapshot + BLOB PDF + identidade e confirma a tentativa. Somente então a API devolve sucesso.
6. O navegador inicia o download. Se o download falhar depois da confirmação, oferece somente baixar novamente o arquivo preservado; não repete a emissão.

Nenhuma transação SQLite permanece aberta durante HTTP. Testado também com duas conexões e escrita concorrente não relacionada.

### Idempotência e números

`budget_emission_attempts` usa `INTEGER PRIMARY KEY AUTOINCREMENT`, iniciado acima das identidades V11 existentes. Números de tentativas falhas permanecem reservados: podem existir lacunas; nunca são atribuídos a outra emissão. Repetir a mesma chave/corpo reutiliza a reserva; chave com corpo diferente é 409. Documento já confirmado é devolvido diretamente, sem consultar dados vivos nem renderizar novamente.

Uma tentativa em andamento tem posse temporária de 30 s. Concorrência com a mesma chave recebe `PDF_RENDER_IN_PROGRESS`; não inicia outro renderer. Após interrupção/expiração, a repetição assume a mesma identidade. Uma resposta atrasada de um executor anterior não pode finalizar ou sobrescrever o PDF. A UI preserva a chave para recuperação.

Falha HTTP/timeout/PDF inválido ou falha no commit não cria versão parcial no histórico. Se dados comerciais/revisões mudarem durante a geração, a finalização é recusada; exige nova conferência. Tentativas são controle interno, não documentos emitidos.

## Parcelamento e arredondamento

Somente **Configurações → Parcelamento** mostra/edita a tabela, por revisão otimista. Não há escolha de taxa por Atendimento/cenário. Padrões aprovados: 3x 6%, 6x 8%, 9x 10%, 12x 12%. Percentuais são decimais exatos não negativos, sem expoente, até os limites já utilizados pela aplicação. API: `GET/PATCH /api/parcelamento`.

Na emissão: `totalParceladoExato = totalEfetivoVista × (1 + percentual/100)`; `parcelaExata = totalParceladoExato / quantidade`. `Q`/BigInt mantém os valores exatos, inclusive frações periódicas como numerador/denominador. A apresentação usa centavos, meio para cima; total e parcela são formatados independentemente. Não se altera o motor nem se cria uma parcela final diferente que o template não representa.

Leitura autorizada da origem confirmou:

- `Cnf_FormaPagamento`, `grid-BAYjf2tylI`, colunas `c-wBgCqMMKrx` e `c-lUEbjOQSEs`: taxas aprovadas 6/8/10/12%.
- `db_Orcamentos`, `grid-LgsVNgYj3J`: colunas de totais/parcelas com apresentação de duas casas; fórmula de geração calcula total com acréscimo e parcela por divisão, separadamente.
- Cálculos **sintéticos somente leitura**: `FormatNumber(330.165,true,2)` → `330,17`; `FormatNumber(330.165/9,true,2)` → `36,69`; `FormatNumber(600*1.10/9,true,2)` → `73,33`; `Round(330.165,2)` → `330.17`.

| À vista | Plano | Total exibido | Parcela exibida | Diferença da multiplicação exibida |
| --- | --- | --- | --- | --- |
| 600,00 | 3x +6% | 636,00 | 212,00 | 0,00 |
| 600,00 | 6x +8% | 648,00 | 108,00 | 0,00 |
| 600,00 | 9x +10% | 660,00 | 73,33 | −0,03 |
| 600,00 | 12x +12% | 672,00 | 56,00 | 0,00 |
| 300,15 | 9x +10% | 330,17 | 36,69 | +0,04 |

A diferença de apresentação é explícita em `snapshot.installments.plans[*].displayDifference`; os valores exatos e as taxas também ficam congelados. Não há rateio fictício nem alteração do total à vista. A homologação do template real deve conferir esses casos não múltiplos e empates de centavo. Não foram lidas linhas de orçamentos/clientes do Coda nem executadas ações de escrita.

## Prazo comercial

`Scenario.deadline = {mode:'automatic'|'manual', manualDays:number|null}`. Novos cenários e duplicações começam automáticos. O modo automático lê `calculation.days` atual, sem salvar cópia obsoleta. O manual começa com a sugestão válida e aceita somente inteiro positivo seguro; persiste por cenário e não muda quando serviços/capacidade mudam. Voltar ao automático remove a substituição.

O toggle e o campo ficam no painel financeiro expandido. Autosave confirmado, revisão, bloqueio de rascunho inválido e recuperação por leitura foram testados. Conflito preserva o valor local; manter o prazo exige nova confirmação explícita sobre a revisão lida. Carregar prazo salvo consulta o servidor, não apenas um cache anterior.

`snapshot.executionDeadline` preserva modo, valor manual, sugestão técnica, prazo efetivo e aviso. Prazo manual menor que a sugestão gera aviso na conferência, sem substituir a escolha. Prazo ausente/zero não é assumido como compromisso.

Quando faltar **somente capacidade para sugerir dias**, um prazo manual válido substitui essa sugestão comercial; o cálculo continua com `days:null` e sua pendência técnica registrada. Preços e energia precisam continuar válidos: a exceção não remove nenhum outro bloqueio do motor. Não foram alteradas fórmulas de energia, capacidade, prazo técnico ou precificação.

## Contrato do template e documentos

Template fixo **`FUNIX - Orcamento`**, endpoint HTTPS terminado em `/api/report`. As chaves existentes foram preservadas: `meta`, `cliente`, `veiculo`, `diagnosticos`, `condicoes`, `parcelamento`, `financeiro`.

- `meta.id` recebe o OR permanente; data em America/Sao_Paulo.
- Peças agrupam suas linhas efetivamente habilitadas no cenário. Diagnóstico e intensidade vêm do snapshot.
- Serviços repetidos são agrupados pelo **ID do serviço**, não por semelhança de nomes. Cada cluster mantém dimensões, quantidades, etapas realmente cadastradas e observações; não inventa nem rateia etapas legadas do Coda.
- A configuração atual não tem a taxonomia antiga de clusters de etapas do ERP. Usam-se serviços/etapas explícitos do App, sem transportar automaticamente as antigas regras de exposição/injeção de colorimetria. Nomes/renderização desses clusters devem ser conferidos no template real durante homologação.
- Componentes preservam quantidade fracionária e preço unitário final com MR oficial, nunca custo manual no lugar da revenda.
- Serviços sem cobrança continuam identificados como **Sem cobrança**, sem preço unitário zero artificial. Não entram nos totais ou no desconto.
- Serviços brutos efetivos + componentes − desconto = total à vista. Acréscimo por negociação já está nos unitários oficiais; não se aplica novamente. Moeda é apresentação pt-BR com duas casas; valores exatos permanecem no snapshot.
- `condicoes.prazo` usa o prazo comercial congelado. Parcelamento usa a configuração congelada, nunca o valor global atual durante leitura/download.

Nome: `<PLACA normalizada> - Orçamento FUNIX - <serial sem zeros>.pdf`; sem placa, `Orçamento FUNIX - <serial>.pdf`. UUID e letras legadas continuam internos/compatíveis. O histórico é a lista simples já iniciada no PR; links antigos de versões continuam acessíveis. PDFs antigos são BLOBs lidos literalmente, sem regeneração ou renumeração.

## Migração V12 e compatibilidade

Adições: duas colunas de prazo em `scenarios`, `installment_configuration` e `budget_emission_attempts`. V11 foi mantida; Atendimentos, catálogos, flags, IDs, configuração comercial e versões/PDFs anteriores não são reescritos. Testes verificam upgrade e rollback integral de DDL em falha, integridade/FKs, arquivos/reabertura e identidade acima do serial V11 existente.

Importadores aceitam declaradamente V12, preservando guards/idempotência anteriores. Nenhum importador ou carga real foi executado. A emissão é assíncrona; fixtures e testes passaram a aguardá-la, com injeção explícita de renderer sintético. `server/pdf.ts` é usado somente pelos doubles de regressão; **não existe fallback produtivo** para esse PDF. O mock HTTP de navegador consulta apenas a reserva do SQLite temporário de teste e verifica o JSON congelado.

## Configuração necessária — não aplicada nesta tarefa

No backend, pelo arquivo protegido já utilizado pela instalação (Compose já encaminha `runtime.env`):

```dotenv
FUNIX_JSREPORT_ENDPOINT=https://SEU-ENDPOINT-EXISTENTE/api/report
FUNIX_JSREPORT_USERNAME=USUARIO_DO_JSREPORT
FUNIX_JSREPORT_PASSWORD=SENHA_DO_JSREPORT
FUNIX_JSREPORT_TEMPLATE=FUNIX - Orcamento
```

O arquivo real não vai ao Git nem ao navegador/logs. O exemplo versionado tem credenciais vazias. HTTPS é obrigatório fora do localhost de testes. Não há n8n/Redis, nova rede, serviço, ferramenta ou subdomínio. Credenciais ausentes bloqueiam **novas emissões** com erro claro, mantendo o restante do App e os PDFs históricos acessíveis. Não desabilitar TLS nem autenticação para contornar falhas.

## Validação e evidências

Evidências: [diretório de QA](evidencias/pr39-pdf/), com screenshots desktop 1440 px, mobile 390 px e 320 px, resultados JSON e logs sanitizados.

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Build, TypeScript, Node e lint | `npm run check` | 253 testes Node, zero falhas; build e tipos aprovados; seis avisos de lint preexistentes |
| Instalador e scripts | `python -m unittest discover -s deploy/tests -v` e `bash -n deploy/funix-install deploy/funix-deploy deploy/funix-ssh deploy/test-containers.sh` | 23 testes; sintaxe aprovada |
| Parcelamento/prazo/emissão integrada | `python tests/browser/pdf_emission.py` | 33 grupos, 11 em cada resolução |
| Regressões anteriores | `python tests/browser/pdf_regressions.py` | 21 suítes, 370 grupos aprovados; retomadas com argumento `fase1_selection` e `editor_financeiro` após ajustar expectativas dos testes |

As regressões mantêm os contratos de concorrência, autosave, seleção, recomendações, curadoria, Mapa circular, editor, rodapé, preços, energia, snapshots e PDFs. As expectativas antigas de título por letra foram atualizadas para número OR; histórico agora é lista direta, com links antigos testados separadamente. Fechamento do radial usa o Escape/controle central atual da `main`, sem reinstalar o X antigo. O teste de gesto vertical passou a incluir peças sintéticas suficientes para existir rolagem real; a fixture anterior tinha cinco peças e não produzia overflow. Nenhum código de Mapa/gestos foi alterado nesta entrega.

A suíte dedicada cobre conflito e resposta perdida do prazo, falha do renderer, resposta de emissão perdida, falha do download após emissão, mudança global após conferência, reinício e download histórico imutável. Testes Node adicionais cobrem duas conexões SQLite, morte real de subprocesso após reserva, retomada com a mesma identidade, expiração/posse e rollback de finalização/DDL.

Todos os dados, PDFs, credenciais e respostas HTTP usados nos testes são sintéticos. O PDF válido dos doubles vem do renderer anterior exclusivamente como fixture; isso **não** homologa visualmente o jsreport real. Nenhum banco ou exportação privada é versionado.

## Homologação antes de publicar

1. Auditar este mesmo PR e a configuração pretendida do endpoint/template/autenticação, sem publicar segredos.
2. Com autorização separada, ensaiar em cópia isolada do SQLite e validar migrações/referências; manter backup compatível com a imagem anterior antes de publicação. Imagem antiga não deve ser iniciada sobre V12.
3. Homologar o **jsreport real** com dados exclusivamente sintéticos: agrupamentos, textos/acentos/intensidade, repetição e dimensões, componentes/frações, serviço sem cobrança, desconto/acréscimo, paginação e condições fixas do template.
4. Conferir os exemplos de parcelamento acima, incluindo diferenças de apresentação em centavos. Confirmar prazo automático/manual, alerta de prazo curto e congelamento após alterar configurações.
5. Conferir emissão/download automático, falha controlada, repetição com a mesma chave e download histórico com os mesmos bytes/nome. Não reenviar nova chave apenas porque o download falhou.
6. Só depois da auditoria/homologação e autorização específicas, decidir merge/publicação. Esta tarefa não executou nenhuma dessas operações.

**Pendência real:** configuração e homologação visual/operacional do template jsreport instalado. Os mocks comprovam o contrato e o fluxo do aplicativo, não o resultado visual do serviço real. Não é declarada homologação produtiva concluída.
