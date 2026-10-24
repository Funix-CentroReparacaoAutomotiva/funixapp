# API — MVP Comercial FUNIX V1.0 / M1.1

API Node 24 existente com sessão de operador e banco SQLite próprio. A inicialização não instancia o adaptador Coda. O contrato antigo foi preservado em `historico/API_CODA_LEGADO.md`, sem validade como API ativa.

## Rotas

| Rota | Resposta |
|---|---|
| `GET /api/health` | Processo vivo, origem App/SQLite e capacidades; sem registros ou segredos |
| `GET /api/ready` | 200 somente com senha configurada e tabela local acessível; revisão da aplicação; sem consulta externa |
| `GET /api/session` | Estado autenticado/configurado |
| `POST /api/session` | JSON com senha, origem exata; cookie HttpOnly/SameSite=Strict e Secure quando HTTPS |
| `DELETE /api/session` | Revoga sessão; exige origem exata |
| `GET /api/atendimentos?q=&limit=50&offset=0` | Lista autenticada: `{items,total,nextOffset,stages}`; total do banco para a busca |
| `POST /api/atendimentos` | Criação autenticada e com origem exata; 201 com registro persistido |
| `GET /api/atendimentos/:id` | Registro autenticado por UUID técnico; 404 se inexistente/inválido |
| `PATCH /api/atendimentos/:id` | Atualiza campos permitidos e exige `revision`; 200 com registro persistido |
| `GET /api/workspace` e rotas `/api/experiencias*` | 410 após autenticação; função operacional fora do MVP; nenhuma consulta Coda |
| Outros métodos de negócio | 405; não há exclusão, envio, orçamento, agenda ou comando operacional |

Contrato compartilhado em `shared/contracts.ts`: `Atendimento`, `AtendimentoInput`, `AtendimentoPatch`, `AtendimentoList` e `ATENDIMENTO_STAGES`. Os tipos antigos permanecem somente para o adaptador legado isolado.

## Atendimento e validações

Telefone textual é obrigatório e precisa conter ao menos um dígito, sem exigir DDI/DDD ou ficha completa. Valores opcionais omitidos na criação viram texto vazio; omitidos no PATCH preservam o conteúdo anterior; texto vazio explícito limpa o campo opcional. Números/objetos/null não substituem textos. Telefone repetido é aceito, sem cadastro/vínculo ou escolha automática de outro Atendimento.

Campos graváveis: `phone`, `name`, `vehicle`, `brand`, `model`, `plate`, `reason`, `notes`, `stage`, `rejectionReason`, `explicitRefusal`. Campos técnicos retornados: `id`, `phoneNormalized`, `createdAt`, `updatedAt`, `revision`. São calculados no backend, não aceitos livremente do navegador.

Limites em caracteres: phone/plate 100; name/vehicle/model 250; brand 150; reason/notes 8000; rejectionReason 2000. JSON de cadastro/edição limitado a 64 KiB; senha a 1 KiB. Campos desconhecidos são rejeitados.

Telefone original é preservado com limpeza das bordas; a versão E.164 só é preenchida para formato internacional inequívoco com `+` e quantidade plausível de dígitos. Um telefone nacional/ambíguo permanece válido sem normalização inventada. Não há consulta a provedor ou Coda.

Fases: `novo-lead`, `aguardando-dados`, `em-negociacao`, `morno`, `frio`, `rejeitados`. Rótulos exatos da V1.0; a criação padrão é Novo lead. Mudanças são manuais. Rejeitados exige `explicitRefusal: true` e motivo preenchido; nenhum job avança fase por tempo.

A atualização é SQL condicional pela revisão técnica; se o registro mudou, retorna 409 `VERSION_CONFLICT` sem sobrescrever. Essa revisão não é versão A/B/C de orçamento. Não há geração de orçamento neste incremento.

## Segurança, pesquisa e erros

Todas as operações de dados exigem sessão. POST/PATCH também exigem `Origin` idêntico a `FUNIX_APP_ORIGIN` e Content-Type JSON. A UI continua na mesma origem, inclusive por proxy local de desenvolvimento. Sem CORS permissivo.

Consultas parametrizadas; busca simples em textos normalizados para ignorar acentos/caixa e em ID. Busca por telefone tolera formatação; pesquisa alfanumérica de placa/ID não é ampliada por dígitos de telefones não relacionados. `limit` 1–100 e `offset` inteiro não negativo; `q` até 150 caracteres.

Erros usam `{error:{code,message,requestId}}`, sem SQL, caminhos de banco, senhas ou stack na resposta. Casos: 400 dados inválidos; 401 autenticação; 403 origem; 404 registro; 409 revisão; 413 tamanho; 415 JSON; 500 erro interno; 503 readiness indisponível. Nunca retornar sucesso vazio como recuperação de falha de armazenamento.

Sessões permanecem em memória e reiniciar API exige novo login. Não há usuários/alçadas/SaaS. O limitador de login herdado usa endereço do peer, com as limitações atrás de proxy já documentadas. O banco persistido é independente da sessão.
