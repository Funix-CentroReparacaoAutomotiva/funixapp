# Chat somente leitura — Issue #56

Data: **05/11/2026 (America/Sao_Paulo)**. Branch/worktree: `feat/issue-56-chat-readonly`, base `main` `ecb678b`, após integração das PRs #51/#54. Fontes: [descoberta](WHATSAPP_DISCOVERY.md), [base local](WHATSAPP_BASE_LOCAL.md) e [Issue #56](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/56).

## Comportamento entregue

A aba Chat do Atendimento consulta mensagens realmente vinculadas no SQLite próprio e apresenta entrada/saída, horário de Brasília e status apenas quando há evidência persistida. Texto é renderizado como texto, sem HTML ou conversão automática em links. Foto/áudio/vídeo/documento têm fallback explícito de mídia indisponível, sem retrieval, preview, download ou URLs externas.

`ChatPanel` e seu CSS ficam em `src/chat/`; `App.tsx` somente integra o componente no slot de Chat existente e estabiliza o callback de sessão. Cabeçalho/resumo do Atendimento, rail V20 desabilitado, navegação Chat/Diagnósticos/Mapa, financeiro e Copiloto único permanecem. Nenhum arquivo do Copiloto, motor, orçamento, schema ou migração foi alterado.

Estados: carregando, vazio (“Nenhuma mensagem disponível neste Atendimento”), erro inicial com retry e erro de paginação preservando linhas já carregadas. A interface indica “Chat · somente leitura” e “Recebimento WhatsApp ainda não conectado”. Compositor, anexos, áudio e enviar permanecem desabilitados. `capabilities.messages=false`; não foi necessária capability adicional para a leitura local.

Paginação: primeiras 50 mensagens em ordem cronológica, botão “Carregar próximas mensagens” continua pelo cursor do repositório. “Atualizar mensagens” reinicia a leitura; não há polling, importação de histórico ou promessa de conexão ativa. Não se infere origem celular/Web/App a partir de `fromMe`.

O componente é montado com chave do Atendimento, sem cache de mensagens em storage/global. Requisições são canceladas ao trocar de Atendimento/aba, atualizar ou desmontar; respostas canceladas são ignoradas. Um 401 limpa a leitura e aciona a expiração de sessão já existente no App. A expiração é detectada na próxima requisição, sem timer novo de sessão.

## Endpoint e limites

`GET /api/atendimentos/:id/messages?limit=50&cursor=...`

Sessão de operador existente é verificada **antes** de interpretar ID/query ou consultar mensagens. O modelo atual possui um operador autenticado com acesso aos Atendimentos locais; esta PR não cria regras por usuário/tenant. Escopo SQL é o UUID do Atendimento conhecido e os vínculos explícitos persistidos, nunca telefone/nome/JID ou etapa comercial.

| Resultado | Contrato |
|---|---|
| 200 | `{items,nextCursor}` do repositório; conhecido sem mensagens retorna lista vazia |
| 400 `CHAT_INVALID_QUERY` | UUID malformado, parâmetros desconhecidos/repetidos, limite inválido ou cursor estruturalmente inválido/de outro Atendimento |
| 401 `AUTH_REQUIRED` | Sessão ausente, expirada ou revogada; sem conteúdo/identidade vazados no erro |
| 404 `CHAT_NOT_FOUND` | UUID válido não encontrado |
| 405 `METHOD_NOT_ALLOWED` | Escrita/HEAD/outro método no endpoint; nenhuma mutação |
| 500 `INTERNAL_ERROR` | Erro interno sanitizado pelo handler existente |

`limit` é inteiro decimal de 1–100; cursor usa base64url limitado a 600 caracteres. Somente `limit` e `cursor` são aceitos, uma vez cada. Cursor não é credencial nem assinatura: bounds adulterados com estrutura válida podem navegar somente nas mensagens do próprio Atendimento; o filtro de Atendimento nunca é removido. O cursor preserva teto e desempate da base, sem snapshot entre requisições. Mensagens pendentes e conteúdo vinculado a períodos de outro Atendimento não são devolvidos.

Todas as respostas mantêm `Cache-Control: no-store`, `X-Request-Id` e erros sanitizados. GET não escreve no banco nem marca mensagem como lida no WhatsApp. Nenhum payload/query/telefone/JID é adicionado a logs; o cliente já redige UUID/query nos diagnósticos de transporte, coberto por teste.

Não foram criados endpoints de inbox global, pendências, vínculo, ingestão, assinatura, envio ou mídia. A aplicação normal não registra instância, insere fixture, cria Atendimento por mensagem ou associa conversa automaticamente.

## Testes e evidências

```sh
npm run check
python tests/browser/chat_local_base.py
docker build --target api -t funix-api:ci .
bash deploy/test-containers.sh
git diff --check
```

Testes próprios em `server/tests/chat-read.test.ts`: sessão ausente/expirada/revogada, `no-store`, paginação, mesmo telefone, períodos distintos da mesma conversa, pendências invisíveis, UUID/query/cursor inválidos, cursor forjado sem escape de escopo, métodos proibidos, ausência de rotas de ingestão/vínculo, zero escritas e diagnóstico sem identificadores sensíveis. A suíte completa inclui regressões financeiras e do Copiloto.

Resultado local: **486/486 testes** em `npm run check` (build, TypeScript, testes e lint sem erros; avisos preexistentes, nenhum nos módulos Chat novos), **9/9 grupos Chromium** nos três tamanhos, zero requisições externas/erros de página e smoke Docker aprovado. Os quatro testes novos de API/diagnóstico estão incluídos no total. JSON/links deste relatório e `git diff --check` também foram verificados.

Chromium com SQLite temporário, **54 mensagens sintéticas de A**, saída/status/mídias, B com o mesmo telefone e período posterior da mesma conversa, C vazio e uma conversa pendente privada. Em **320×740, 390×844 e 1440×900**: A→B→A, resposta atrasada A enquanto B está aberto, conteúdo e alinhamento/direção, horários/status verdadeiros, texto escapado, mídias indisponíveis, paginação com falha/retry sem duplicatas, erro inicial, vazio e expiração real da sessão por relógio exclusivo da fixture. Troca das três abas e abertura/fechamento do Copiloto sem duplicá-lo. Nenhuma chamada a provedor; requisições externas bloqueadas e contabilizadas.

O script substitui o smoke da primeira base, que esperava Chat indisponível. Fixtures estão somente em `server/tests/fixtures/chat-readonly.ts`, sem import no bootstrap. Novo workflow `Chat read-only Chromium` repete o teste em PRs e publica artefatos. [Resultados sintéticos](evidencias/issue56-chat/results.json) e capturas: [320](evidencias/issue56-chat/chat-320.png), [390](evidencias/issue56-chat/chat-390.png), [1440](evidencias/issue56-chat/chat-1440.png), [erro](evidencias/issue56-chat/chat-error-390.png), [vazio](evidencias/issue56-chat/chat-empty-390.png).

Empacotamento API: `server/chat/read.ts` já é incluído pelo `COPY server/chat/*.ts` e allowlist do `.dockerignore` corrigidos na PR #54. O smoke Docker foi estendido com leitura autenticada vazia, 401 sem sessão e capability false dentro da imagem. A validação local reconstrói API; o smoke local usa a imagem web de teste já disponível. O CI completo reconstrói ambos os targets da revisão e repete o smoke sem serviços produtivos.

## Limitações e próximo passo

Recepção real, relay assinado, identidade do provedor, modalidade Evolution, coexistência celular/Web, retenção e piloto continuam pendentes de evidência/autorização. Vínculos só existem se previamente explícitos na base; sem vínculo, a UI não mostra mensagem. Gestão de pendências e vinculação manual devem ter PR própria com sessão/Origin/revisão/idempotência. Ciclo de vida separado do funil e conciliação da criação ERP permanecem diretrizes futuras, sem implementação nesta etapa.

Não há migração nova. A necessidade de backup/autorização/plano de reversão para uma futura instalação com V14 permanece, pois a base já integrada aplica essa versão ao abrir banco antigo. Nenhum banco real foi aberto, nenhum serviço produtivo foi conectado e nenhum workflow/número/ERP foi alterado. Sem merge/deploy. Esta entrega não encerra a Issue #53 nem o M3.
