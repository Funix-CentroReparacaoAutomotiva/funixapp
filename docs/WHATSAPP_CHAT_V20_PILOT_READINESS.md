# FUNIX — Gate de homologação do Chat V20 na instalação existente

**Status em 07/11/2026:** plano técnico em revisão, **não executado na VPS**. Não constitui aprovação de merge, deploy, leitura de histórico real ou uso de credenciais. Consolida as PRs #86 (transporte), #88 (configuração) e #90 (interface). Base de código: `feat/chat-v20-conversation-read-ui`.

## 1. Objetivo e limites

Validar de maneira **reversível e de escopo mínimo** a leitura pelo FunixApp já instalado em `app.funix.com.br`, utilizando a Evolution API e o WhatsApp `funix_comercial` **já operacionais**. Não criar nova instalação, VM, banco, Redis, n8n, webhook ou serviço. Não enviar mensagens, importar históricos, habilitar ingestão, realizar migração N:N ou criar vínculos automáticos com Atendimentos.

O FunixApp atual é o ambiente de testes operacionais do aplicativo, **mas a Evolution, o WhatsApp e o n8n atendem à operação real**. Testes em cliente real só podem ocorrer após autorização própria, com privacidade e finalidade verificadas.

## 2. Evidência já comprovada versus pendências

| Elemento | Evidência/status |
| --- | --- |
| Rede interna/porta TCP | Teste anterior do operador: `funixapp-api-1` alcançou `evolution-api-nvzq-api-1:8080`. Isso **não** prova HTTP autenticado entre contêineres. |
| Endpoint Evolution | Duas consultas autorizadas com JID **sintético**, `POST /chat/findMessages/funix_comercial`, retornaram 200; a segunda comprovou página 1 com zero registros. Não prova outros filtros, nomes, históricos ou carga. Issue #76. |
| Código | PRs #86, #88 e #90, empilhadas, continuam sem merge/deploy. Interface com testes sintéticos de navegador em 320/390/1440 px, CI aprovado na HEAD registrada da #90. |
| Identificador técnico (`instanceId`) | **Existência e formato confirmados** em 08/11/2026, via PostgreSQL produtivo: uma linha de `public."Instance"` com `name='funix_comercial'`, `id` não nulo compatível com `^[A-Za-z0-9_-]{1,128}# FUNIX — Gate de homologação do Chat V20 na instalação existente

**Status em 07/11/2026:** plano técnico em revisão, **não executado na VPS**. Não constitui aprovação de merge, deploy, leitura de histórico real ou uso de credenciais. Consolida as PRs #86 (transporte), #88 (configuração) e #90 (interface). Base de código: `feat/chat-v20-conversation-read-ui`.

## 1. Objetivo e limites

Validar de maneira **reversível e de escopo mínimo** a leitura pelo FunixApp já instalado em `app.funix.com.br`, utilizando a Evolution API e o WhatsApp `funix_comercial` **já operacionais**. Não criar nova instalação, VM, banco, Redis, n8n, webhook ou serviço. Não enviar mensagens, importar históricos, habilitar ingestão, realizar migração N:N ou criar vínculos automáticos com Atendimentos.

O FunixApp atual é o ambiente de testes operacionais do aplicativo, **mas a Evolution, o WhatsApp e o n8n atendem à operação real**. Testes em cliente real só podem ocorrer após autorização própria, com privacidade e finalidade verificadas.

## 2. Evidência já comprovada versus pendências

| Elemento | Evidência/status |
| --- | --- |
| Rede interna/porta TCP | Teste anterior do operador: `funixapp-api-1` alcançou `evolution-api-nvzq-api-1:8080`. Isso **não** prova HTTP autenticado entre contêineres. |
| Endpoint Evolution | Duas consultas autorizadas com JID **sintético**, `POST /chat/findMessages/funix_comercial`, retornaram 200; a segunda comprovou página 1 com zero registros. Não prova outros filtros, nomes, históricos ou carga. Issue #76. |
| Código | PRs #86, #88 e #90, empilhadas, continuam sem merge/deploy. Interface com testes sintéticos de navegador em 320/390/1440 px, CI aprovado na HEAD registrada da #90. |
. **Valor não exibido e ainda não provisionado no backend FUNIX**; alias e ID não são intercambiáveis. |
| Segredo disponível para o backend FunixApp | **NÃO PROVISIONADO/VERIFICADO**. A chave existente no ambiente Evolution não aparece automaticamente no FunixApp. |
| API real de lista `findChats` | **NÃO HOMOLOGADA**. Nome `pushName` pode faltar; apresentação usa nome verificado pelo parser, número PN válido ou "Contato não identificado". |
| Paginação/completude | **NÃO COMPROVADAS**; `offset` não é snapshot, pode repetir e omitir mensagens sob mudanças. |
| Persistência de vínculos V20 | **NÃO IMPLANTADA**; IDs efêmeros até 30 min/reinício, sem associação N:N. |

### Evidência administrativa de 08/11/2026 (somente metadados)

Saída fornecida pelo administrador no terminal da Hostinger: `docker exec -i evolution-api-nvzq-postgres-1 psql -X -w -U evolution -d evolution` com transação `BEGIN TRANSACTION READ ONLY`, `statement_timeout=3000ms`, `lock_timeout=500ms` e `ROLLBACK`. O SQL consultou somente agregados de `public."Instance"`, restringidos ao alias `funix_comercial`, sem retornar valor de `id`. Resultado: `INSTANCIA: CONFIRMADA` e `ID_TECNICO: FORMATO_COMPATIVEL`. **Não houve acesso a conteúdo de conversas, chave, alterações ou ativação do FunixApp.** Não há confirmação de credencial nem comunicação HTTP autenticada a partir do FunixApp.

## 3. Configuração no backend (apenas referência; **não aplicar agora**)

A implementação `server/chat/evolution-config.ts` só carrega a ponte quando `FUNIX_EVOLUTION_READ_ENABLED=true` **exatamente**. Caso contrário não instancia transporte; o endpoint experimental fica ausente.

- Origem **fixa no código**, já aprovada apenas para comunicação interna: `http://evolution-api-nvzq-api-1:8080`.
- Alias fixo: `funix_comercial`.
- `FUNIX_EVOLUTION_INSTANCE_ID`: ID **técnico real** da instância, não alias, JID ou identificador de contato; requer verificação de metadados por administrador autorizado.
- `FUNIX_EVOLUTION_READ_API_KEY`: credencial de leitura usada **somente no backend**; nunca em `VITE_*`, URL, GitHub, chat, log, screenshot, shell history ou navegador.
- `FUNIX_EVOLUTION_READ_ENABLED=false` ou ausente: estado inativo. Quando a flag é `true` sem chave/ID válidos, o bootstrap **falha fechado** em vez de oferecer leitura insegura.

O `compose.yaml` utiliza `/etc/funix/runtime.env`, propriedade root, modo 0600, formato raw. **Não usar `docker inspect` completo, `docker compose config` sem `--quiet`, `env`, `printenv`, `set -x` ou eco de comandos contendo chaves**. Arquivos/variáveis de ambiente também podem ser lidos por administradores com privilégios Docker/root; 0600 não elimina esse risco. Qualquer provisionamento é tarefa do operador autorizado na própria VPS, com canal de segredo apropriado, sem transmitir valores ao ChatGPT.

## 4. Gates, na ordem

### Gate A — revisão estática e preservação (sem VPS)

1. Confirmar que #86 → #88 → #90 formam a sequência aprovada e que **CI geral e Chromium da HEAD atual** estão verdes. Corrigir conflitos antes de decidir merge.
2. Confirmar que não há migração SQLite V15 ou escrita no banco/WhatsApp, que `capabilities.messages=false` e rotas de envio/ingest seguem inalteradas.
3. Revisar autenticação/cookies, falha 404 quando desabilitado, limite de respostas, tratamento 503, origem fixa e ausência de JID de consulta livre pelo navegador.
4. Confirmar revisão humana das evidências de QA responsivo; build/CI não substituem essa revisão.

### Gate B — metadados e recuperação (requer autorização administrativa específica, **sem ler mensagens reais**)

1. Operador identifica por fonte administrativa autorizada o **ID técnico** da instância `funix_comercial` e confere sua correspondência; o resultado compartilhável é apenas "CONFERE / NÃO CONFERE", método/fonte/data, **sem valores de segredo ou dados de cliente**.
2. Operador valida o caminho seguro de provisionamento **da credencial no backend FUNIX** sem imprimir/copiar chaves nem alterar Evolution. Não supor que mesma chave permite consulta irrestrita sem risco.
3. Antes de instalar nova imagem, preservar a **revisão e digests** existentes; verificar procedimento documentado `deploy/funix-deploy rollback` para **api/web exclusivamente**, sem `docker compose down`, sem mexer em outras stacks.
4. Planejar backup consistente do SQLite FUNIX atual, local privado, com integridade e restauração verificadas **antes** de mudança potencialmente irreversível. Esta cadeia de PRs **não prevê** migração, mas a garantia depende da versão-base efetivamente instalada e das demais alterações que sejam incluídas no deploy.
5. Separadamente, preservar cópia **privada root-only** do `/etc/funix/runtime.env`, pois o rollback das imagens **não restaura** esse arquivo. Validar o procedimento administrativo de restauração sem mostrar seu conteúdo.
6. Registrar janela, responsável, critérios de interrupção e caminho de recuperação se a API não atingir readiness. Não alterar contêineres ainda.

### Gate C — implantação inativa no FunixApp atual (aprovação explícita de merge e deploy)

1. Somente após Gate A e B, submeter a sequência das PRs a revisão/merge **autorizados**, com CI final contra a base vigente.
2. Fazer deploy **manual autorizado** das imagens do FunixApp atual com flag Evolution **ausente ou `false`**; a operação deve limitar-se aos serviços `funixapp-api`/`funixapp-web`.
3. Verificar `/api/ready` e release web/backend, navegação, Funil, login, Chat legado e disponibilidade **404** da rota experimental para sessão autenticada (a 404 é esperada quando desabilitada). Sem consulta à Evolution.
4. Se falhar, restaurar imagem/revisão anteriores pelo fluxo de rollback existente e conferir de novo a prontidão. Não tocar Evolution, PostgreSQL, Redis, n8n, webhook ou sessão WhatsApp.

### Gate D — ativação de leitura restrita (autorização **adicional**, específica)

1. Depois de confirmar ID, escopo, finalidade, privacidade e restauração, autorizar **separadamente** colocar as três variáveis no runtime protegido. Aplicar a configuração por processo supervisionado que atue **somente no FunixApp**, verificando readiness.
2. Primeiro validar rota e filtro em **JID sintético inexistente**, com status/quantidade **agregada e sem corpo real**; não interpretar 200 sozinho como prova de filtros corretos.
3. **Somente com nova autorização** escolher uma conversa real de escopo delimitado e validar apresentação, identidade, completude assumidamente desconhecida, tempos e comportamento de erro. Não executar ensaio de carga, extração em massa, mídia ou envio.
4. Registrar somente resultados sanitizados e necessários: data, revisão, rotas, tempo agregado, status, erro, quantidade limitada e efeito observado. Nunca nomes, telefones, histórico, chave, imagens ou payload bruto em issues, CI ou chat.
5. Interromper imediatamente em erro de escopo/filtro, 401/403 persistente, 5xx, lentidão relevante, vazamento de conteúdo, consumo anormal, risco à sessão WhatsApp ou qualquer comportamento inesperado.

## 5. Rollback da flag **e** da imagem são controles distintos

Se o piloto habilitado falhar, primeiro **desativar/restaurar a configuração Evolution** no arquivo privado do FunixApp e aplicar essa configuração somente ao serviço FUNIX, confirmando que a rota experimental voltou a 404. Restaurar a imagem/revisão anterior pelo mecanismo autorizado se houver também regressão de código. O `deploy/funix-deploy rollback` restaura a imagem registrada, **não** uma versão anterior de `runtime.env`.

Se a API não subir por chave/ID inválidos, corrigir/desabilitar a flag **no arquivo privado**, sem expor valores, antes de tentar novamente. A reversão do Chat **não** exige reiniciar ou desconectar a Evolution/WhatsApp.

## 6. Registro do gate (sem PII)

| Campo | Resultado |
| --- | --- |
| Aprovador, data e escopo por gate | PENDENTE |
| CI da HEAD e QA Chromium | CONFERIR ANTES DE MERGE |
| ID técnico da instância confere por metadado? | SIM quanto à existência e ao formato: `INSTANCIA: CONFIRMADA` / `ID_TECNICO: FORMATO_COMPATIVEL` em 08/11/2026. O valor não foi exibido; provisionamento e uso pelo backend continuam NÃO VERIFICADOS. |
| Credencial provisionada em backend com proteção? | NÃO VERIFICADO |
| Cópia privada do `runtime.env` e restauração revisadas? | NÃO EXECUTADO |
| Revisão atual/digests e rollback verificados? | NÃO EXECUTADO |
| Backup/restauração SQLite FUNIX verificados? | NÃO EXECUTADO |
| Deploy **com flag off** autorizado e realizado? | NÃO |
| Leitura com JID sintético pós-deploy autorizada? | NÃO |
| Leitura real autorizada separadamente? | NÃO |
| Evolution/n8n/WhatsApp produtivos modificados? | NÃO |

**Decisão nesta entrega:** apenas preparo documental e auditoria estática. Não há evidência de homologação real nem autorização implícita para executá-la.
