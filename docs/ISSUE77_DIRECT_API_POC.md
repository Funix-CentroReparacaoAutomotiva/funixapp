# Issue #77 — POC A/B direto na API OpenAI sem testes manuais no aplicativo

## Proposta
Execução isolada no contêiner da API existente, mas **fora** do servidor HTTP FUNIX. Importa o mesmo contrato do modelo, instruções e projeção de catálogo. Usa catálogo e recomendações reais de `/data/funix.sqlite` aberto em modo `readOnly:true`; **não lê Atendimentos**, nomes de clientes, cenários reais ou históricos. Para o modelo é criado um cenário estritamente fictício em memória, com `items=[]`. Compara o contexto padrão com a cópia do mesmo objeto sem `recommendations`.

## Segurança
- Sem áudio/transcrição. Três ditados fixos fictícios: `Inclua o capô.`, `Acrescente uma porta.`, `No capô, acrescente pintura parcial.`
- Máximo de seis chamadas pagas à Responses API com `gpt-6.1-terra`, pelo provedor existente. Ordem alternada por caso para reduzir influência de cache.
- Nenhum dado comercial ou conteúdo do prompt/da resposta, ID de catálogo ou credencial é impresso. Somente status, contagens e uso informado pela OpenAI; sem persistência no banco.
- A POC interrompe no primeiro erro, resposta fora do contrato ou timeout. Nunca executa `/copiloto/aplicar`.
- Um processo separado requer `FUNIX_VOICE_POC_RUN=1` para executar. Sem a variável termina em `DRY_RUN` sem chamadas pagas.
- Requer que `FUNIX_DATABASE_PATH` seja `/data/funix.sqlite` e que o banco exista sem ser link simbólico.
- Uso de credencial exclusivamente pelo ambiente já configurado da API, sem copiá-la, exportá-la ou colocá-la em logs.
- Este código não deve ser implantado como parte da aplicação: a imagem de produção não copia `scripts/`.

## Como executar com acesso SSH existente
Baixar `scripts/voice-context-poc.mjs` deste branch em sua estação local autenticada no GitHub. Então, a partir do terminal local (com acesso SSH à VPS):

```bash
ssh root@srv2060217 'docker exec -i funixapp-api-1 node --use-env-proxy --input-type=module' < voice-context-poc.mjs
# O comando anterior é DRY_RUN, sem custo
ssh root@srv2060217 'docker exec -i -e FUNIX_VOICE_POC_RUN=1 funixapp-api-1 node --use-env-proxy --input-type=module' < voice-context-poc.mjs
```

Alternativamente, copiar o arquivo para /root da VPS e executar `docker exec -i ... < /root/voice-context-poc.mjs`.

**Não colar o arquivo /etc/funix/runtime.env nem imprimir a chave.**

## Custo e validação
O campo `usage` da Responses API retorna tokens efetivamente contabilizados pela resposta, incluindo cache. Não há valor de cobrança por requisição diretamente nesta resposta. A POC calcula **estimativa** em dólares segundo preços padrão usados para GPT-6.1 Terra em 07/11/2026 (USD/milhão de tokens: entrada 1, entrada em cache 0,05, saída 5), conforme https://platform.openai.com/pricing. Para fatura real consultar a OpenAI Costs API e reconciliar no nível do projeto/tempo; cobrança por chamada não está garantida. O script imprime as duas variantes e checagens semânticas mínimas, mas não comprova a qualidade para toda a produção.

**Não automatizar deployment, ativar flag do Copiloto ou alterar dados após a POC.**
