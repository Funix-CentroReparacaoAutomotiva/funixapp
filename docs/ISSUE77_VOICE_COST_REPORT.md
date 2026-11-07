# FUNIX — Relatório offline de consumo do Copiloto (Issue #77)

## Finalidade
Ferramenta **offline e somente de leitura** para analisar as linhas `funix_voice_usage` introduzidas na PR #78. Não executa chamadas OpenAI, não acessa contas, SQLite ou serviços de produção e não exige Codex.

## Pré-condições e controles
1. A versão da PR #78 precisa estar implantada e a medição **explicitamente habilitada** na VPS (`FUNIX_VOICE_USAGE_ENABLED=true`). Na ausência de log real, não se conhece o consumo.
2. Um administrador autorizado exporta **apenas** linhas de metadados para um arquivo local protegido; nunca usar logs contendo segredos, áudio ou transcrição. Não enviar esse arquivo ao GitHub.
3. Criar um JSON local com as tarifas vigentes **verificadas na conta e na data do teste**. A ferramenta não traz preços predefinidos, porque isso poderia gerar estimativas incorretas. Unidade: USD por 1.000.000 tokens, ou USD por minuto de áudio.

## Exemplo de esquema de tarifas (valores ilustrativos, NÃO tarifas vigentes)
```json
{
  "models": {
    "modelo-exemplo-transcricao": {"billing": "audio_minutes", "usdPerMinute": 0.006},
    "modelo-exemplo-interpretacao": {
      "billing": "tokens",
      "inputUsdPerMillion": 1,
      "outputUsdPerMillion": 5,
      "cachedInputUsdPerMillion": 0.1
    }
  }
}
```
Os números são **fictícios para demonstrar a estrutura** e não devem ser copiados para uma avaliação financeira sem reconfirmação.

```sh
node scripts/voice-cost-report.mjs --input /local/uso-sanitizado.log --tariffs /local/tarifas-validadas.json
```

Saída: JSON agregado por etapa e modelo, quantidade de respostas do transporte, erros, abortos, duração média, chamadas com custo estimável e sem dados suficientes, subtotal estimado USD. Quando nenhuma chamada for estimável, `estimatedUsd: null` e `estimateCoverage: "unavailable"` (custo desconhecido, **não** zero). Um subtotal com chamadas pendentes de estimação é `"partial"`.

## Limitações importantes
- `status=response` significa resposta JSON recebida; **não comprova** aceitação dos comandos nem confirmação no orçamento.
- A telemetria da PR #78 não possui um identificador de correlação entre as etapas. Este relatório **não fornece custo por ditado concluído**.
- Se o modelo de transcrição cobrar por tokens, e não por duração, esta versão não deve estimar seu custo a partir de segundos. O relatório marcará a chamada como não estimável até incluir um contrato validado com as unidades corretas.
- Chamadas interrompidas, erros e respostas sem `usage` podem ser cobradas; nunca tratar dados ausentes como custo zero. `estimatedUsd` é **subtotal somente das chamadas estimáveis**, não uma despesa total.
- O custo de tokens de raciocínio está incluído em `outputTokens` se o provedor assim o informar; o relatório **não soma reasoningTokens uma segunda vez**.
- A estimativa pressupõe que `cachedInputTokens` esteja incluído em `inputTokens`, como no contrato da API. Contagem de cache ausente é custo desconhecido; se houver tokens em cache, sua tarifa precisa estar informada para evitar cobrança incorreta.
- O relatório não diferencia ambientes nem resolve duplicidades de logs. O operador deve fornecer somente o intervalo correto uma única vez; ele não estabelece uma fatura.
- Custo de API do Copiloto, consumo de Codex e custos/despesas operacionais do ERP são categorias distintas.

## Etapas seguintes
1. Revisar esta PR em separado, sem merge/deploy automáticos.
2. Quando houver autorização operacional e acesso adequado, ativar medição no **app de testes**, mantendo modelo Terra e cotação off.
3. Obter pequena amostra autorizada; reconciliar métricas com fatura API e avaliar latência e qualidade no fluxo real.
4. Só depois comparar Terra atual, Terra low e alternativa econômica com os mesmos casos.
