# FUNIX — Transporte HTTP de leitura Evolution, sem novo ambiente

**Status:** implementação experimental isolada; **não habilitado no FunixApp e não implantado**. Desenvolvido para funcionar futuramente no **FunixApp atual** (piloto na mesma VPS), sem segunda instalação, segunda VM ou novo PostgreSQL.

## Decisão operacional da direção — 07/11/2026

A instalação atual de `app.funix.com.br` é o ambiente de teste e homologação do FunixApp, ainda não lançado oficialmente. **Não criar ambiente separado.** Porém a Evolution `funix_comercial`, a sessão WhatsApp e o n8n já suportam operações comerciais reais. Modificar/applicar um deploy do FunixApp exige cuidado para não afetar esses serviços.

Esta entrega adiciona somente `server/experimental/evolution-read/http-transport.ts`, com transporte HTTP de leitura injetável na POC #73. **Não** altera `server/index.ts`, `server/app.ts`, rotas, UI, Compose, variáveis de produção, imagens, `capabilities.messages=false`, n8n, Redis, webhook ou volumes. Não há abertura de rede quando o módulo é importado.

## Especificação do transporte

- Requer explicitamente `origin` do serviço (sem segredo na URL), `apiKey` somente em memória backend e `fetcher` opcional para testes; não lê `.env` e não carrega chaves automaticamente.
- Aceita exclusivamente `POST /chat/findChats/:instance` ou `POST /chat/findMessages/:instance`, com alias de instância limitado. Não possui rotas de envio.
- `redirect:'error'`, `cache:'no-store'`, propagação de `AbortSignal`, JSON serializado com limite de 2 KiB e resposta JSON de no máximo 1 MiB. Falha de status não inclui corpo do fornecedor. Nenhuma credencial vai para o navegador.
- A validação semântica dos registros, escopo de JID/instância e paginação continuam responsabilidade do `EvolutionReadPoc` e da camada backend futura.
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

Os testes em `server/tests/evolution-http-transport.test.ts` usam apenas `Response` e `fetch` simulados, sem rede/segredos reais. Não existe teste de HTTP à Evolution nesta PR, e o status 200 da Issue #76 não demonstra compatibilidade de todos os payloads.

Dependências: Issue #71, Issue #76, PRs #73 e #83. O modelo de autorização da PR #83 foi simplificado pela direção para **um único operador**.
