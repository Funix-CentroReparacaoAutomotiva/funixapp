# FUNIX — Transporte HTTP de leitura Evolution, sem novo ambiente

**Status na PR #90 (branch empilhada):** transporte e rotas opcionais preparados na #86, inicializador **opt-in desligado por padrão** na #88 e tela de leitura na #90. **Nada implantado; nenhum histórico real consultado nesta cadeia de PRs.** A conexão será testada futuramente no **FunixApp atual**, sem segunda instalação, segunda VM ou novo PostgreSQL. Antes de qualquer piloto, seguir `docs/WHATSAPP_CHAT_V20_PILOT_READINESS.md`.

## Decisão operacional da direção — 07/11/2026

A instalação atual de `app.funix.com.br` é o ambiente de teste e homologação do FunixApp, ainda não lançado oficialmente. **Não criar ambiente separado.** Porém a Evolution `funix_comercial`, a sessão WhatsApp e o n8n já suportam operações comerciais reais. Modificar/applicar um deploy do FunixApp exige cuidado para não afetar esses serviços.

Esta entrega adiciona `server/experimental/evolution-read/http-transport.ts` (HTTP somente leitura), `server/chat/evolution-bridge.ts` (IDs de conversa opacos e efêmeros em memória) e **rotas opcionais em `server/app.ts`**. A aplicação só expõe essas rotas se receber `evolutionChat` por injeção explícita. **Na #88, `server/index.ts` passa a injetar a dependência somente quando `FUNIX_EVOLUTION_READ_ENABLED=true`, com credencial e ID técnico válidos**; sem a flag, as rotas permanecem indisponíveis. Nenhuma dessas alterações foi implantada no aplicativo instalado. Não modifica UI, Compose, variáveis de produção, imagens, `capabilities.messages=false`, n8n, Redis, webhook ou volumes. Importar o módulo não abre rede.

## Especificação do transporte

- Requer explicitamente `origin` do serviço (sem segredo na URL), `apiKey` somente em memória backend e `fetcher` opcional para testes; não lê `.env` e não carrega chaves automaticamente.
- Aceita exclusivamente `POST /chat/findChats/:instance` ou `POST /chat/findMessages/:instance`, com alias de instância limitado. Não possui rotas de envio.
- `redirect:'error'`, `cache:'no-store'`, propagação de `AbortSignal`, JSON serializado com limite de 2 KiB e resposta JSON de no máximo 1 MiB. Falha de status não inclui corpo do fornecedor. Nenhuma credencial vai para o navegador.
- A validação semântica dos registros, escopo de JID/instância e paginação continuam responsabilidade de `EvolutionReadPoc`. A ponte expõe identificadores opacos temporários em memória; ela **não substitui** as associações N:N permanentes do Chat V20, nem garante identidade persistente entre reinícios.
- O transporte não é um verificador de DNS/rede, não prova conectividade entre os contêineres, nem garante histórico completo. A origem precisa ser escolhida pelo backend a partir de configuração estritamente controlada, não pelo usuário/URL do navegador.
- O limite de 1 MiB protege memória por resposta mas pode ser pequeno para algumas páginas reais com dados incorporados; ajustar **apenas mediante evidências** e sem deixar payload bruto em logs.
- Os erros de transporte/abortamento não devem ser serializados para clientes; a camada de serviço deve convertê-los para erros genéricos antes de retornar HTTP.

## Topologia atual e verificação mínima antes de ligar no FunixApp

A Compose vigente do FunixApp usa a rede externa `traefik_default` para `funixapp-api-1`; a Evolution é outro projeto Docker. Estar na mesma VPS **não demonstra resolução DNS nem conectividade entre contêineres**.

Antes de habilitar a integração:
1. Confirmar a rede real de ambos os contêineres via `docker inspect` com saída **somente dos nomes das redes**, sem campos de configuração/segredo;
2. Se compartilham rede, confirmar DNS/porta por uma única solicitação interna de saúde/rota não sensível e com timeout. Não modificar redes sem aprovação e plano de rollback.
3. Definir o nome/host interno estável da Evolution e comprovar a origem aprovada; não apontar API key para host arbitrário.
4. Confirmar o `instanceId` técnico necessário ao validador, **sem imprimir contato/mensagem**.
5. Adicionar integração ao bootstrap somente com configuração explícita e desabilitada por padrão, mantendo a sessão do operador único e scoping da instância.
6. Revisar contrato V20 N:N e preservação do endpoint antigo; não habilitar leitura de clientes reais antes de validar as regras.
7. Usar o pipeline atual: PR/CI → merge autorizado → imagem publicada → **deploy manual autorizado** do FunixApp existente, com verificação de readiness, logs sanitizados e rollback da versão anterior.
8. Nenhuma intervenção no webhook, triagem, envio ou banco da Evolution é necessária para a fase experimental de leitura.

**Nota:** não há necessidade de outra VPS, outro Docker Compose ou outro banco apenas para realizar essa validação. O único serviço que poderá receber código/atualização em etapa posterior é o **FunixApp existente**.

## Evidência e testes

Os testes em `server/tests/evolution-http-transport.test.ts` e `server/tests/chat-evolution-bridge.test.ts` usam apenas respostas sintéticas e transporte simulado, sem rede/segredos reais. A suíte da ponte cobre login, escopo da sessão, rejeição de JID arbitrário, resposta com ID opaco, erro 503 sanitizado, expiração e inatividade por padrão. Rotas propostas: `GET /api/chat/conversations?skip=0` e `GET /api/chat/conversations/:conversationId/messages?page=1`; exigem sessão do único operador. **Não** oferecem persistência N:N, descoberta de instância automática, envio, eventos push nem histórico comprovadamente completo. Não existe teste de HTTP à Evolution nesta PR, e o status 200 da Issue #76 não demonstra compatibilidade de todos os payloads.

Dependências: Issue #71, Issue #76, PRs #73 e #83. O modelo de autorização da PR #83 foi simplificado pela direção para **um único operador**.
