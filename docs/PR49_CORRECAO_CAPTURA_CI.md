# PR #49 — captura Chromium determinística

## Diagnóstico

Execução investigada: [42074181991](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/actions/runs/42074181991), revisão `b64e130879679be17f2d1ad635bfee5b0594ffc2`.

A API do Actions confirmou sucesso do roteiro antigo e falha no novo. O download integral do log foi recusado pelo proxy no domínio de resultados do Actions; o erro detalhado de gravação vazia informado na revisão foi reproduzido localmente com as APIs nativas.

O `record()` antigo do resolvedor soltava o botão 800 ms após pointerdown. O gesto consome 350 ms antes de chamar getUserMedia; restam apenas 450 ms para abrir o dispositivo e começar a produzir frames. Nem a abertura do microfone nem a entrega de áudio pelo MediaRecorder eram aguardadas. O roteiro anterior tinha a mesma fragilidade (750 ms), com até três tentativas que podiam ocultar a corrida. Falar também era encerrado por tempo fixo de 250 ms.

Duas reproduções locais, sem alterar a aplicação:

1. MediaRecorder nativo recebendo uma MediaStream de um AudioContext propositalmente suspenso, portanto sem frames disponíveis. O helper antigo terminou com **“A gravação ficou vazia. Pressione e segure novamente.”**, zero chamadas de interpretação e timeout aguardando a revisão. Para reproduzir a fonte: num init script de teste, substituir getUserMedia por uma função que cria `new AudioContext()`, aguarda `suspend()` e retorna `createMediaStreamDestination().stream`. O gravador continua nativo.
2. Fonte WAV real no Chrome e atraso controlado de 700 ms antes de devolver a stream de getUserMedia. O helper antigo soltou antes da abertura e terminou com **“Permissão recebida. Pressione e segure novamente para gravar.”**, também sem interpretar. O roteiro corrigido passou no mesmo atraso, nas três larguras.

Conclusão no escopo testado: corrida do roteiro com a inicialização da fonte de áudio simulada, não regressão demonstrada da captura. A aplicação rejeitou corretamente a gravação sem bytes e não iniciou gravação escondida depois da soltura. A latência exata do dispositivo no job original não pôde ser medida retroativamente. Não foi necessário mudar captura, aplicação, resolvedor ou persistência de produção.

## Correção restrita aos testes

- Helper compartilhado `scripts/browser/voice-audio.mjs` gera WAV PCM mono de 48 kHz com sinal sintético não silencioso e usa `--use-file-for-fake-audio-capture`.
- Ambos os roteiros continuam usando getUserMedia, MediaRecorder, Blob, fetch e a API reais. A instrumentação apenas observa eventos nativos e, no teste de atraso, posterga a devolução da stream; não fabrica WebM, resultado da captura ou resposta de áudio.
- O botão só é solto depois de o gravador iniciar **e produzir bytes**. A mesma regra vale para Enviar esclarecimento. Não há retry cego nem aumento de um sleep para presumir que o áudio ficou pronto.
- Cada gravação é decodificada no Chromium: deve ter frames, duração maior que 0,1 segundo e RMS não silencioso. O SHA-256 dos bytes nativos é comparado com o SHA-256 do áudio efetivamente recebido pelo provedor sintético no backend, exatamente uma vez por tentativa. Isso evita depender de `postDataBuffer()`, que pode ser null para uploads Blob no Playwright.
- Status HTTP esperado e transição done/error também são exigidos. Falhas incluem diagnóstico de início, parada, chunks, bytes e mensagem visível, sem despejar o áudio.
- O workflow executa o resolvedor com `FUNIX_TEST_MIC_STARTUP_MS=700`, maior que o orçamento antigo de 450 ms. A espera por dados, e não o relógio do gesto, permite passar nesse caso.
- O WAV temporário é removido após fechar o navegador. Nenhuma verificação de áudio vazio foi removida da aplicação ou da suíte.

## Validação local

- `npm run check`: **451 testes aprovados**, zero falhas/ignorados; build, tipos e lint aprovados (avisos anteriores da base permanecem).
- `node scripts/voice-browser-review.mjs`: aprovado em 320/390/1440 px, agora com validação de áudio nativo, revisão, erro HTTP controlado, negociação de R$ 123,45 e exclusão global.
- `node scripts/voice-resolution-browser.mjs`: aprovado em 320/390/1440 px com a fonte WAV.
- `FUNIX_TEST_MIC_STARTUP_MS=700 node scripts/voice-resolution-browser.mjs`: aprovado em 320/390/1440 px, incluindo Falar válido/inválido, ambos, opções, aplicação segura e negociação.
- Amostras observadas: cerca de 8.423 bytes por gravação, 1,02 segundo decodificado e RMS entre 0,20 e 0,26, com hashes coincidentes no browser/backend. Esses valores são evidências, não expectativas rígidas de codec/tamanho.

O aceite remoto depende dos três workflows na revisão final da PR: PR3 Chromium voice UX, PR3 voice checks e FUNIX CI and delivery. Os resultados devem ser consultados nos checks da PR para o SHA final; não usar o verde de uma revisão anterior.

Sem merge, deploy, mudança de dados publicados ou alteração funcional da Issue #48. A emulação não substitui homologação de aparelhos físicos/microfones reais.
