# FunixERP no ChatGPT via n8n

O piloto #362 usa a revisão do MVP da PR #361 e o endpoint HTTPS
`POST https://hml.funix.com.br/api/integrations/ai-tools/v1`. O corpo JSON tem
até 16 KiB. O gateway HML mantém sua autenticação Basic. A API exige um
`X-Funix-AI-Token` de serviço e aplica o escopo da credencial.

## Contrato v1

O corpo contém `operation`, `arguments` e, para escritas, `idempotencyKey`.
A chave é um UUID em minúsculas gerado uma vez por solicitação de negócio.
Ao repetir uma requisição incerta, reutilize a chave e os mesmos argumentos.

| Escopo | Operação | Argumentos |
|---|---|---|
| read | `atendimento.buscar` | `{q}`, termo de busca não vazio com até 100 caracteres |
| read | `atendimento.consultar` | `{id}` do Atendimento |
| read | `experiencia.consultar` | `{atendimentoId}`, retorna Experiência e revisões |
| read | `titulo.consultar` | `{id}` do título |
| read | `financeiro.consultar` | `{}`, retorna `data.pendingCents` com `receivable` e `payable` como strings de centavos |
| write | `atendimento.criar` | Campos aceitos pela criação manual da UI, por exemplo `{phone, name, reason}` |
| write | `agendamento.alterar` | `{atendimentoId, scheduledEntry, expectedAtendimentoRevision, expectedExperienceRevision}`. Entrada em Brasília, `AAAA-MM-DD` ou `AAAA-MM-DDTHH:mm`. Preserva entrega e vínculos |
| write | `titulo.criar` | `{kind, counterparty, description, amountCents, dueDate, experienceId?}`. `kind` é `receivable` ou `payable`, `amountCents` inteiro positivo, vencimento `AAAA-MM-DD` |

Sucesso HTTP 200 retorna `{ok, requestId, operation, id, data}`. Uma escrita
inclui `persisted`, `replayed` e `mutationRequestId`. Um reenvio confirmado
retorna o mesmo ID e `data: null`. Releia o registro pela operação de consulta.
O mesmo ator e chave com argumentos diferentes retorna HTTP 409. Erros da API
retornam `{error: {code, message, requestId}}`. Uma execução do n8n iniciada
só confirma despacho. Aguarde o resultado de negócio e confira `ok`.

## Credenciais e execução

A API habilita a rota na origem exata de HML quando
`ai-tools.credentials.json` está presente ao iniciar, no diretório do SQLite
(`/data` no contêiner). Use arquivo regular com permissão `0600` e leitura para
o usuário da API. Cada entrada tem `actor`, `sha256` (hash em hexadecimal
minúsculo do token de 32 bytes em Base64URL) e `scopes` (lista com `read` ou
`write`). Use atores estáveis na rotação. Remova a entrada para revogação
imediata. Grave mudanças de credenciais por substituição atômica do arquivo.

Rascunhos n8n no projeto pessoal de Richard Sgrancio:

- Consulta HML, ID `rAMYb6LM10gVi4fx`, gatilho `Entrada autenticada HML`.
- Alteração HML, ID `qHZUDtyxZ3yaOTKN`, mesmo nome de gatilho.

A entrada é POST com cabeçalho `X-Funix-N8n-Key` configurado em credenciais
Header Auth distintas. O nó `Executar no ERP HML` precisa de uma credencial
Templated Custom Auth distinta por fluxo e dos cabeçalhos `Authorization:
Basic …` para o gateway HML e `X-Funix-AI-Token` para o ERP. Cadastre os
segredos no cofre do n8n. Para execução pelo conector, use `triggerNodeName:
Entrada autenticada HML`, `inputs.webhookData.method: POST` e o JSON do contrato
em `inputs.webhookData.body`. A entrega do cabeçalho de entrada precisa ser
resolvida por um mecanismo seguro do conector, sem incluir o segredo na conversa.
Mantenha os fluxos inativos enquanto esse mecanismo estiver pendente.

## Validação

O workflow oficial `FUNIX - Homologacao (candidato)` requer uma PR aberta
contra `main`, CI aprovado para o SHA exato e autorização explícita para o
build. Use a variante `web`. A PR da integração inclui o candidato da #361
na sua ancestralidade para permitir esse build sem merge.

O ensaio local usa SQLite sintético e confirma as três alterações depois de
reiniciar a API, pela integração e pelas APIs de interface. Na HML, consulte
um Atendimento e a Experiência sintética existente, crie um Atendimento,
reagende a Experiência com as revisões retornadas, registre um título sintético
e releia os três registros. Compare os totais antes e depois e repita as
escritas com a mesma chave. Guarde IDs e códigos de solicitação. A tabela
`ai_tool_mutations` registra ator, horário, IDs e resumo na mesma transação
da escrita.
