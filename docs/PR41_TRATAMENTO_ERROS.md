# PR #41 — Tratamento final de erros de emissão

Base auditada: `42d7043ac3fd6c054d5666bda1aed67d9d056446`. Mesmo PR e branch `feat/pdf-previa-historico-navegacao`.

## Causa e correção

O catch de `confirmEmission()` liberava `uncertain` para alguns status 4xx e `VERSION_CONFLICT`, mas não para as falhas explícitas do renderer. O backend já encerrava a tentativa como falha sem gravar versão; o frontend ainda bloqueava Voltar.

A função pequena `src/emission-error.ts::emissionWasNotIssued` reconhece **kind HTTP + código específico + status compatível**. Não infere resultado pelo status isolado. `api.ts` já preserva esses dados, portanto não foi alterado.

Quando a resposta confirma ausência de emissão, limpa somente `uncertain` e apresenta “O orçamento não foi emitido” com a causa do backend. Voltar e Confirmar ficam disponíveis após terminar a requisição. O snapshot conferido e a chave permanecem os mesmos no retry. Voltar fecha a prévia e libera a edição; **não apaga nem reutiliza a reserva**. Uma nova iniciativa posterior poderá reservar outro número, mantendo a lacuna legítima.

## Classificação auditada

| Resultado | Códigos / origem | Comportamento |
|---|---|---|
| Não emitido — renderer | `PDF_RENDER_FAILURE`, `PDF_INVALID_RESPONSE`, `PDF_INCOMPLETE`, `PDF_TOO_LARGE` (502) | Voltar liberado; retry explícito com a mesma chave; sem histórico/download |
| Não emitido — configuração/disponibilidade do renderer | `PDF_NOT_CONFIGURED`, `PDF_CONFIGURATION_INVALID`, `PDF_RENDER_UNAVAILABLE` (503) | Mesmo tratamento; backend reconheceu falha **antes da persistência definitiva** |
| Não emitido — validação | `BUDGET_INCOMPLETE` (422), `VERSION_CONFLICT` (409), `DOCUMENT_NUMBER_LIMIT` (503) | Voltar liberado; validação/revisão continua impedindo emissão inválida; reserva não é renumerada |
| Requisição recusada antes de emitir | `INVALID_COMMERCIAL_DATA`, `INVALID_JSON` (400), `AUTH_REQUIRED` (401), `ORIGIN_REJECTED` (403), `NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405), `BODY_TOO_LARGE` (413), `JSON_REQUIRED` (415) | Sem abandono incerto; autenticação existente preservada quando necessária |
| Desconhecido / em andamento | Rede/abort sem resposta, resposta de sucesso ilegível, HTTP genérico sem código reconhecido, `INTERNAL_ERROR`, códigos desconhecidos ou status incompatível | Mantém proteção e mesma solicitação; não afirma sucesso/falha |
| Desconhecido / posse da tentativa | `PDF_RENDER_IN_PROGRESS`, `PDF_LEASE_EXPIRED`, `IDEMPOTENCY_CONFLICT` (409) | Não permite descartar a chave e criar outra emissão por suposição; executor/documento pode já existir |
| Emitido, download falho | POST concluiu e retornou versão; GET do PDF falhou | Estado de versão emitida existente mantido; Voltar/Baixar novamente; exclusivamente GET do PDF original |

`PDF_RENDER_UNAVAILABLE` vindo em resposta estruturada do backend distingue-se da perda da resposta entre **navegador e FUNIX**. O primeiro descreve falha na geração anterior à gravação; o segundo não permite saber se o commit ocorreu. Nenhum 502/503/409 genérico é declarado definitivo. Não há classificação de sucesso a partir de erro: a versão continua sendo reconhecida somente no fluxo de resposta concluída já existente.

## Preservações

Nenhuma alteração em `server/budgets.ts`, `server/jsreport-client.ts`, `server/errors.ts` ou `src/api.ts`: foram inspecionados para determinar as garantias. Reserva, transações, leases, hash/token, idempotência, persistência e geração de PDF mantidos. Nenhuma mudança em cálculo, energia, rateio, negociação, parcelamento, prazo, A4, HTML/configuração do jsreport, snapshots/PDFs antigos, agrupamento, barra, gestos ou animações. Sem migração, acesso produtivo, merge ou deploy.

Arquivos funcionais: `src/emission-error.ts` e o catch de `src/FinancialPanel.tsx`. Testes: `server/tests/emission-errors.test.ts` e ampliação da suíte `tests/browser/pdf_emission.py`.

## Testes executados

- `npm run check`: **315 testes Node aprovados**, build/TypeScript/lint concluídos; mesmos 7 avisos preexistentes de lint.
- Navegador, backend real e renderer HTTP **sintético local**: **66 grupos aprovados**, 22 em cada largura 1440/390/320. Sem acesso à VPS/jsreport instalado ou dados reais.
- Regressões do fluxo normal, prévia sem reserva/download, histórico por cenário, prazo, swipe, transições e movimento reduzido preservadas na mesma suíte.
- `git diff --check`: sem erros.

| Aceitação solicitada | Evidência |
|---|---|
| Falha definitiva libera Voltar e não cria histórico | Renderer recusa e PDF inválido; UI + contagens SQL + tentativas failed |
| Retry conserva chave/reserva | Payloads POST comparados integralmente; OR-000002 reaproveitado apenas pela mesma tentativa; nenhum novo serial nessa repetição |
| Desconhecido continua protegido | Rede perdida, proxy 502/503, INTERNAL_ERROR e resposta 201 ilegível; Voltar bloqueado, chave original preservada |
| Resposta perdida recupera original | Versão já persistida recuperada, sem outro renderer ou histórico |
| Processamento em andamento protegido | 409 PDF_RENDER_IN_PROGRESS mantém Voltar bloqueado e o mesmo POST |
| Download falho não emite novamente | Sem botão Confirmar nessa condição; Baixar novamente não produz POST nem chama renderer |
| Sem duplicações | Duplo clique, replay e falhas verificados por versões, renderer, downloads e hashes |
| Voltar não deixa a UI bloqueada | Fecha prévia após erro conhecido, habilita Emitir/histórico/edição/navegação; reserva OR-000008 permanece failed |
| Persistência intacta | Reinício da API, integridade/FKs SQLite V12 e snapshots/PDFs históricos preservados |

Logs, JSONs por dispositivo e seis screenshots: [evidências desta correção](evidencias/orcamento-experiencia/erros-emissao/README.md). As evidências da implementação anterior foram preservadas separadamente.

## Limitações

Erro sem código reconhecido permanece conservadoramente incerto, mesmo que posteriormente se descubra que nada foi gravado; recuperar com a mesma confirmação. Não foi criado mecanismo novo entre recargas completas do navegador, nem alterada a política de leases. Testes mobile emulados; nenhuma homologação produtiva ou mudança no jsreport instalado foi realizada.
