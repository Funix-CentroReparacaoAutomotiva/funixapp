# Issue #77 — medição de custo do Copiloto de Voz (primeiro incremento)

## Estado e autorização
Implementação preparatória em branch isolada, **sem chamadas pagas, merge, deploy ou ativação**. O modelo padrão permanece `gpt-6.1-terra`; a transcrição permanece `gpt-transcribe`. Não afeta cotação (#70), WhatsApp, valores comerciais ou confirmação humana.

## Comportamento
- `FUNIX_VOICE_USAGE_ENABLED=true` (somente no backend e após autorização específica) registra uma linha por resposta ou falha do transporte OpenAI, no log padrão do serviço, com prefixo `funix_voice_usage`.
- São registrados somente: estágio, modelo saneado, status de transporte, latência, quantidade de tokens, tokens em cache/raciocínio/áudio e duração informada pelo provedor, **quando disponível**.
- Campos de uso ausentes são `null`, não zero. `status=response` indica corpo HTTP JSON recebido, **não** comandos validados, interpretação correta ou aplicação no banco.
- Nunca gravar áudio, texto transcrito, prompt, catálogo, resposta do modelo, Atendimento, sessão, placa, telefone ou credencial nesse log. Os logs do serviço ainda precisam seguir controles existentes de acesso, retenção e rotação.
- Erro na coleta de métrica não altera o resultado da chamada ao Copiloto.
- `FUNIX_VOICE_REASONING_EFFORT=low` acrescenta `reasoning.effort=low` **somente à interpretação** (não à transcrição), sem alterar modelo/prompt/schema. Variável ausente ou diferente de `low` mantém o request anterior.
- Nenhuma rota, UI, tabela SQLite ou migração nova.

## Interpretação econômica
Não converter estes metadados diretamente em faturamento: é preciso conciliar `usage` do provedor com tabela de tarifas atual, cache, duração de áudio, eventuais erros e fatura da conta. Resposta sem usage não é custo zero. Não confundir custo da API do aplicativo com créditos Codex/ChatGPT.

## Plano de homologação
1. Revisar PR, regressões e segurança dos logs; testar apenas transportes injetados e banco sintético.
2. Mediante aprovação posterior, habilitar **somente a medição** no aplicativo de testes e coletar pequena amostra autorizada, sem mudar o modelo. Proteger acesso ao log.
3. Medir custo por ditado concluído, falhas, necessidade de esclarecimentos e tempo total, separando transcrição e interpretação.
4. Comparar Terra padrão versus Terra low versus modelo econômico, em condições equivalentes, antes de implementar roteamento. Validação semântica precisa checar intenção real, não apenas JSON.
5. Definir orçamento máximo e política de fallback; mudar modelo de forma gradual e reversível apenas após comprovar resultado.

## Fora do escopo
Não otimizar contexto por heurística antes de medição; não ligar preço web; não inventar limiar de risco; não alterar fluxos de aplicação, confirmação, catálogo ou regras monetárias.
