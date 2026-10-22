# Contrato do backend — primeiro incremento

**IMPLEMENTADO / TESTADO localmente:** API Node 24 sem dependências de servidor, com autenticação de desenvolvimento e apenas consultas de negócio. **NÃO HOMOLOGADO:** não houve chamada da aplicação à API REST oficial do Coda; o acesso real do conector Superhuman Docs é distinto dessa conexão contínua.

Servidor padrão `127.0.0.1:8787`, acessado pelo proxy `/api` do Vite. Execute `npm run dev:api` e `npm run dev` em terminais separados. O processo usa `--use-env-proxy` para preservar proxy e confiança TLS do ambiente. Configure `.env` a partir de `.env.example`; valores secretos nunca usam prefixo `VITE_`.

| Rota | Resposta / comportamento |
| --- | --- |
| `GET /api/health` | Disponibilidade do processo e presença de configuração Coda; não comprova autorização remota. Sem registros pessoais. |
| `GET /api/session` | `{ authenticated, configured }`; `configured` indica senha local com pelo menos 12 caracteres. |
| `POST /api/session` | JSON `{ password }`. Exige `Origin` igual a `FUNIX_APP_ORIGIN`. Cria sessão de oito horas. |
| `DELETE /api/session` | Revoga a sessão; exige a mesma verificação de origem. |
| `GET /api/workspace` | Página de Atendimentos ou Experiências, estágios, cursor seguinte, origem e capacidades. Requer sessão. |
| `GET /api/atendimentos/:rowId` | `WorkRecord` do Atendimento real pelo ID de linha Coda. Requer sessão. |
| `GET /api/experiencias/:rowId` | `WorkRecord` da Experiência real pelo ID de linha Coda. Requer sessão. |
| Outros métodos de negócio | `405 READ_ONLY`; não há comando de agendamento, envio, alteração de status ou fase. |

O contrato TypeScript compartilhado está em `shared/contracts.ts`. Erros têm formato `{ error: { code, message, requestId } }`; o texto bruto de falhas do provedor e suas credenciais não são devolvidos. Respostas usam `Cache-Control: no-store`. Experiência com vínculo de Atendimento ausente, múltiplo ou sem ID verificável retorna `503 CODA_RELATION_CONFLICT`, sem escolher uma origem por aproximação.

## Consulta paginada

Parâmetros: `area=funil|veiculos`, `scope=acompanhamento|historico`, `q` com até 150 caracteres, `limit` entre 1 e 100 (padrão 50), `cursor` opaco retornado pela página anterior. O cursor pertence à mesma área/filtro; ao mudar a consulta, reinicie sem cursor.

**A busca é progressiva:** `q` filtra a página consultada por ID, nome, contato, veículo, placa ou etapa, ignorando acentos e caixa. Uma página vazia com `nextCursor` não estabelece ausência no ERP. Consulte as páginas seguintes; a interface precisa comunicar esse limite. Não há índice de busca paralelo nem varredura integral automática do ERP.

O Funil preserva a vista auditada `Viz. Atendimentos (PC)`, com seis status comerciais. O acompanhamento preserva `ViewExperiencia_Comercial`, agrupado por cinco fases comerciais; `detail` mostra a fase operacional derivada. `finished` e `departed` são flags distintas. O Histórico retorna `409 HISTORY_POLICY_PENDING`: a vista atual do ERP não filtra saídas e a mudança depende de decisão.

## Adaptador Coda

Todas as chamadas usam `GET` no host fixo `https://coda.io/apis/v1`, documento `2zsjI-nqWr`. O bearer token fica apenas no processo backend. Redirecionamentos são recusados; há timeout de 12 segundos por chamada. Não há retry automático de negócio.

Os IDs de tabelas e colunas foram auditados em leitura pelo conector em 21/10/2026. O adaptador usa IDs estáveis e verifica que ainda existem; renomeações de apresentação preservam o mapeamento, enquanto remoção de coluna retorna erro de contrato. Metadados de colunas/estágios têm cache em memória de cinco minutos.

Os IDs de views fornecidos por `FUNIX_CODA_FUNIL_VIEW_ID` e `FUNIX_CODA_ACOMPANHAMENTO_VIEW_ID` precisam ser confirmados na **API REST**, pois os IDs `table-*`/`v-*` do conector não foram certificados como equivalentes. O adaptador verifica nome, tipo `view` e tabela base quando o metadado a informa. Sem essa configuração, falha explicitamente; não usa a tabela inteira como fallback.

A listagem solicita `visibleOnly=true` para preservar os filtros da vista. Como esse parâmetro também pode ocultar colunas, ela obtém os IDs visíveis e hidrata cada registro pelo endpoint da tabela base, com até quatro consultas simultâneas. Só devolve os campos mínimos do DTO. Cache em memória de até 500 DTOs por 30 segundos reduz consultas ao abrir cards; não há persistência nem cache de linhas brutas. A marca `fetchedAt` corresponde à consulta da página; os detalhes podem ter até 30 segundos de cache.

Essa estratégia evita perder filtros ou omitir campos ocultos, mas custa uma consulta da página mais até N consultas de detalhes. Latência, limites de API, formato de referências ricas e equivalência das views precisam de teste real após configurar credencial e rede. Esses pontos não estão homologados por testes com respostas sintéticas.

## Acesso e limites do marco

Cookie `HttpOnly`, `SameSite=Strict`, restrito a `/api`; `Secure` quando a origem configurada é HTTPS. Há bloqueio de oito falhas de login por endereço em 15 minutos, limite de sessões e validação de corpo/origem. O servidor permanece em loopback por padrão e não expõe dados sem senha configurada.

Esse acesso local é uma proteção para desenvolvimento. Login nominal, papéis, revogação administrativa, auditoria de operações e hospedagem segura são requisitos para implantação com equipe; a senha compartilhada não constitui autenticação corporativa.

**TESTADO:** autenticação, expiração/revogação de sessão, origem, limite de tentativas, `401/403/405/409/503`, indisponibilidade sem falso sucesso, sanitização, referências ambíguas, separação finalização/saída, paginação opaca, hidratação de campos ocultos, cache mínimo, IDs estáveis e chamadas somente GET. Os testes HTTP são executados em processo, sem abrir portas ou chamar sistemas produtivos.
