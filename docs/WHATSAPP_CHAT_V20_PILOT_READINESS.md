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
| Identificador técnico (`instanceId`) | **Existência e formato confirmados** em 08/11/2026 por consulta de metadados ao PostgreSQL: uma instância `funix_comercial`, ID interno compatível com `^[A-Za-z0-9_-]{1,128}$`. O valor do ID não foi exibido e seu provisionamento ao FunixApp permanece pendente. |
| Segredo disponível para o backend FunixApp | **NÃO PROVISIONADO/VERIFICADO**. A chave existente no ambiente Evolution não aparece automaticamente no FunixApp. |
| API real de lista `findChats` | **NÃO HOMOLOGADA**. Nome `pushName` pode faltar; apresentação usa nome verificado pelo parser, número PN válido ou "Contato não identificado". |
| Paginação/completude | **NÃO COMPROVADAS**; `offset` não é snapshot, pode repetir e omitir mensagens sob mudanças. |
| Persistência de vínculos V20 | **NÃO IMPLANTADA**; IDs efêmeros até 30 min/reinício, sem associação N:N. |

### Evidência administrativa da instância — 08/11/2026

O administrador executou uma consulta somente de metadados em `public."Instance"`, com transação `READ ONLY`, timeouts de 3 s e 500 ms e `ROLLBACK`. Resultado: `INSTANCIA: CONFIRMADA`; `ID_TECNICO: FORMATO_COMPATIVEL`. Nenhum ID, segredo, contato ou mensagem foi exibido. Este resultado não comprova autenticação HTTP a partir do FunixApp nem provisiona o ID no backend.

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

### Pré-verificação administrativa na VPS — 08/11/2026

O administrador executou no terminal um roteiro somente leitura colado na sessão, depois que o download por URL raw pública de uma branch GitHub privada retornou HTTP 404. **Não foi uma execução do script remoto.**

Resultados: `RUNTIME_PROTECAO: OK`; `EVOLUTION_FLAG: AUSENTE`; `REGISTRO_CURRENT: PROTEGIDO`; `REGISTRO_PREVIOUS: PROTEGIDO`; `ROLLBACK_SCRIPT: ENCONTRADO`; `BACKUP_SQLITE: NAO_TESTADO`; `RESTAURACAO_RUNTIME: NAO_TESTADA`. Não houve alteração de serviços ou leitura de mensagens. A presença dos registros e do script **não prova a recuperação** nem valida seus digests.

O script de referência `deploy/chat-readiness-preflight.sh` existe somente no código da PR; imprime estados sanitizados, sem segredos, e não realiza cópia, restauração ou reinício. Não executar novamente sem necessidade; a verificação de estado já foi feita.

### Ensaio de recuperação isolada na VPS — 08/11/2026

O administrador executou manualmente no terminal da VPS um roteiro de teste com `Python sqlite3`, acesso **somente leitura** ao banco FUNIX, backup online para diretório temporário privado, restauração **somente para outra cópia temporária** e comparação de uma cópia temporária de `/etc/funix/runtime.env`. Não executou rollback, deploy, restart nem acesso à Evolution. A saída intermediária do comando colado no terminal contém texto truncado/embaralhado; os **resultados finais** informados foram:

```text
RESTAURACAO_CONFIGURACAO: OK
BACKUP_SQLITE: OK
RESTAURACAO_ISOLADA: OK
INTEGRIDADE_SQLITE: OK
RELACOES_SQLITE: OK
RESULTADO: TESTE_CONCLUIDO
```

**Interpretação limitada e correta:** o roteiro concluiu com êxito cópia e comparação da configuração, backup SQLite, abertura da cópia restaurada, `PRAGMA integrity_check` e `PRAGMA foreign_key_check`. Nenhum conteúdo privado, caminho temporário específico ou segredo foi divulgado. O teste **não** valida restauração *sobre* o banco de produção, disponibilidade após rollback de imagem, integridade de imagens/digests, cópia de segurança persistente nem disaster recovery. A limpeza dos arquivos temporários foi prevista pelo `trap` do roteiro; não houve conferência independente posterior do diretório. A política permanece: não solicitar dados de clientes, não reexecutar testes desnecessariamente, não ativar Chat sem aprovação específica.

### Verificação somente leitura de revisões/digests na VPS — 08/11/2026

O administrador executou um comando Python de inspeção local, sem revelar SHA/digests e **sem realizar rollback**. Os estados sanitizados retornados foram:

```text
REGISTRO_CURRENT: FORMATO_OK
RELEASE_CURRENT: COERENTE
REGISTRO_PREVIOUS: FORMATO_OK
RELEASE_PREVIOUS: COERENTE
VERSOES_DISTINTAS: SIM
CONTAINER_API: ALINHADO
CONTAINER_WEB: ALINHADO
IMAGEM_ANTERIOR_API: CACHE_PRESENTE
IMAGEM_ANTERIOR_WEB: CACHE_PRESENTE
ROLLBACK_EXECUTADO: NAO
RESULTADO: VERIFICACAO_SOMENTE_LEITURA
```

**Interpretação:** `current.env` e `previous.env` são estruturalmente válidos e idênticos aos registros de release associados; os contêineres FUNIX usam as imagens declaradas na versão atual; o Docker dispõe localmente das imagens da revisão anterior. Nenhuma imagem foi baixada, iniciada ou restaurada. Isso **não verifica o funcionamento de um rollback real** nem garante a restauração de dados/configurações, e não constitui autorização de deploy.

O `main` pode avançar independentemente desta cadeia de PRs. **Antes de qualquer merge**, reconfirmar base atual, conflitos e CI integrados (#86 → #88 → #90). Se houver conflito ou alteração de código central, resolver em branch e refazer os testes; não usar aprovações de uma base antiga.

### Gate C — implantação inativa no FunixApp atual (aprovação explícita de merge e deploy)

1. Somente após Gate A e B, submeter a sequência das PRs a revisão/merge **autorizados**, com CI final contra a base vigente.
2. Fazer deploy **manual autorizado** das imagens do FunixApp atual com flag Evolution **ausente ou `false`**; a operação deve limitar-se aos serviços `funixapp-api`/`funixapp-web`.
3. Verificar `/api/ready` e release web/backend, navegação, Funil, login, Chat legado e disponibilidade **404** da rota experimental para sessão autenticada (a 404 é esperada quando desabilitada). Sem consulta à Evolution.
4. Se falhar, restaurar imagem/revisão anteriores pelo fluxo de rollback existente e conferir de novo a prontidão. Não tocar Evolution, PostgreSQL, Redis, n8n, webhook ou sessão WhatsApp.

### Achado da revisão de código — bloqueio para leitura real

**Issue #94:** detectamos originalmente que `findChats` rejeitava toda a página quando a Evolution apresentava JIDs de grupo ou broadcast. **Correção proposta, ainda sujeita ao CI e à revisão:** `findChatsPage` filtra apenas formatos explicitamente reconhecidos como não individuais (`@g.us`, `@broadcast`, `@newsletter`), mantém falha fechada para PN/LID malformados e devolve `sourceCount` bruto para a ponte calcular `nextSkip` pelo número de registros consumidos na fonte. Incluímos testes sintéticos de páginas mistas e exclusivamente de grupos, limites de offset e dados privados não projetados. **A compatibilidade com payload real da Evolution permanece NÃO HOMOLOGADA; o Gate D continua bloqueado até revisão, CI e autorização de ensaio real.**

**Revisão humana:** em 08/11/2026, as PRs #86, #88 e #90 não continham review formal submetida no GitHub. Os checks automáticos não substituem revisão do fluxo de autenticação, compatibilidade de API e segurança antes de merge.

**Integração:** a PR temporária #93 testou o conjunto #86 → #88 → #90 contra a `main` vigente com mergeabilidade sem conflito e CI geral/Chromium sintéticos aprovados. Isso não valida individualmente cada merge da cadeia ou sua base futura. **Não mesclar a #93**: retomar a sequência #86, depois #88, depois #90, com revisão e testes finais; somente então submeter Gate C à autorização explícita.

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
| CI da HEAD e QA Chromium | Aprovados no commit anterior; reconfirmar contra a HEAD de cada merge. |
| ID técnico da instância confere por metadado? | SIM para existência e formato (08/11/2026). Valor não exibido; ainda não configurado no FunixApp. |
| Credencial provisionada em backend com proteção? | NÃO VERIFICADO |
| Cópia privada do `runtime.env` e restauração revisadas? | **SIM para ensaio isolado temporário**: cópia/restauração e comparação OK (08/11/2026). Sem teste de aplicação do arquivo em produção. |
| Revisão atual/digests e rollback verificados? | **SIM para coerência estática local**: current/previous válidos e coerentes com registros, contêineres atuais alinhados, imagens anteriores no cache (08/11/2026). **Rollback real NÃO EXECUTADO.** |
| Backup/restauração SQLite FUNIX verificados? | **SIM para ensaio isolado na VPS**: backup, abertura da cópia, integridade e chaves estrangeiras OK (08/11/2026). Sem backup permanente ou restauração sobre produção. |
| Deploy **com flag off** autorizado e realizado? | NÃO |
| Leitura com JID sintético pós-deploy autorizada? | NÃO |
| Leitura real autorizada separadamente? | NÃO |
| Evolution/n8n/WhatsApp produtivos modificados? | NÃO |

**Decisão nesta entrega:** preparação documental, auditoria estática, ensaio de recuperação isolada na VPS e verificação de reversão estática. O rollback efetivo e a homologação da Evolution não foram executados. Não há evidência de homologação real nem autorização implícita para executá-la.
