# Issue #66 — revisão compacta de componentes

Base: `b3244d1e9638cb683ff727099975a8b370bd81c3` (main, PR #65). Branch exclusiva `feat/issue66-compact-voice-review`. Escopo conforme [Issue #66](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/66) e [último encaminhamento](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/66#issuecomment-6692080455).

## Implementação

A linha tem exatamente quatro controles: switch acessível à esquerda, quantidade, preço unitário **base** e ícone `receipt-text`. Grid com colunas flexíveis e alvos de 44 px, sem cartão ou legenda adicional. Cotação tem `disabled`, nome acessível e descrição/tooltip de indisponibilidade; não executa pesquisa, consulta, simulação ou API. Pesquisa fica para a Issue #67.

Removidas somente a legenda “Dados compartilhados; habilitação por cenário.” e a mensagem neutra “Confira as alterações antes de aplicar.” quando a revisão está pronta e sem pendências. Alertas operacionais, pendências, conflitos, exclusões globais, falhas e instruções de revisão de edições continuam visíveis. O botão Revisar valores aparece apenas quando há edição local; fica fora da fileira dos quatro controles.

Peças e componentes aparecem em formato de frase, incluindo componentes mantidos e candidatos de duplicação. A função de apresentação preserva siglas técnicas reconhecidas e códigos alfanuméricos. Não altera o catálogo, nome persistido, transcrição, plano, histórico detalhado ou documentos. Os testes usam nomes em maiúsculas e verificam apresentação normalizada e persistência original.

O switch usa o `POST /copiloto/revisar` já existente. A única extensão é `enabled?: boolean` para a intenção de inclusão do componente. O servidor só aceita comando de componente da resolução efêmera autorizada, valida quantidade/preço e booleano, replaneja o lote e invalida a chave anterior, mantendo expiração e guardas de contexto/sessão/cenário. O contrato do modelo permanece fechado: a IA não passa a controlar flags ou decisões de duplicação.

O toque pode revisar quantidade/preço editados **da mesma linha** no mesmo pedido; edições de outras linhas continuam pendentes e bloqueiam Apply. Estado visual vem da resposta do servidor, sem sucesso otimista. Apenas Apply grava o novo componente e suas máscaras na transação existente; não há novo endpoint de persistência, alteração em SQL, migração ou motor. Desligar preserva a inclusão mestre, com flag falso no cenário ativo e exclusão do cálculo oficial. Outros cenários recebem o padrão falso para o novo componente; flags de registros existentes não são tocados.

Quando o pai está desligado, o switch mostra desligado/indisponível e o alerta existente informa que o componente está fora do cálculo. Seu flag próprio continua preservado; não se habilita o pai implicitamente. Referências ainda pendentes também não exibem inclusão efetiva.

## Validação reproduzível

```sh
npm run check
FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-browser-review.mjs
FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-resolution-browser.mjs
FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-clarification-browser.mjs
FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-components-browser.mjs
```

- `npm run check`: build, TypeScript do servidor, **550 testes aprovados**, zero falhas; lint sem erros (avisos preexistentes).
- Quatro roteiros Chromium em 320, 390 e 1440 px, bancos SQLite sintéticos e provedores simulados. MediaRecorder real com áudio sintético; o helper existente verifica bytes, hash do upload, decodificação, duração e RMS não zero no conteúdo recebido pelo backend.
- Regressões específicas: on/off/on, estado falso preservado ao editar quantidade/preço, ausência de escrita durante replanejamento, rejeição de booleanos inválidos e sessão/contexto incompatíveis, revisões simultâneas com um único vencedor e duas confirmações com recibo único.
- Ambos com componentes independentes e flags distintos, pai desabilitado, MR oficial e componente desligado com subtotal zero; registros e máscaras existentes preservados. Rollback da última operação inclui componente desligado; suíte preserva expiração, reinício/recibo, snapshots/PDFs e exclusões globais.
- Chromium mede os quatro controles na mesma linha, altura mínima de 44 px e ausência de overflow. Exercita teclado, estado acessível do switch, ícone de cotação indisponível, edição simultânea de quantidade/preço, persistência de zero, ambos/lados/Falar, duplicatas, negociação R$ 123,45 e privacidade do diagnóstico. Não há POST independente de componentes.

Capturas e árvore de acessibilidade da linha: [evidências sintéticas](evidencias/issue66-revisao-compacta). Os demais artefatos completos são gerados em `artifacts/` e publicados pelo workflow existente.

## Limitações e recomendação

Acessibilidade verificada por papéis/estados/nome/descrição na árvore Chromium e operação de teclado; não houve leitor de tela real ou aparelho Android físico nesta entrega. A próxima homologação deve confirmar TalkBack, teclado decimal e toque em aparelho real. A lista de siglas é conservadora; códigos alfanuméricos preservam a grafia original. Preço de venda e MR permanecem exclusivamente no motor oficial.

Sem acesso a dados reais, VPS ou banco publicado; sem alterações em Chat/WhatsApp, negociação, cálculos, snapshots/PDFs, captura de áudio, transações ou recibos. Sem merge/deploy. Entrega para revisão técnica antes da homologação no celular.
