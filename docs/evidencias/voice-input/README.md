# Evidências — Copiloto PR 2

Tudo local e sintético. Nenhuma chamada OpenAI real, chave real, VPS ou Coda. Chromium emulado **não** equivale a homologação no Samsung físico.

- [npm-check.txt](npm-check.txt): build, TypeScript, 407 testes Node, lint (sete avisos preexistentes).
- [voice-unit-api.txt](voice-unit-api.txt): 34 testes de captura, HTTP real local, provider/contrato, 30 oráculos de ditado.
- [browser.txt](browser.txt) e `*-results.json`: 30 grupos nos três tamanhos.
- [regressions.json](regressions.json) e [regressions.txt](regressions.txt): 129 grupos dos três roteiros atuais.
- Screenshots `desktop-*`, `mobile390-*`, `mobile320-*`: Chat/Diagnósticos/Mapa com painel financeiro recolhido e expandido, captura e resultado sintético no painel.

Reprodução:

```sh
npm run check
node --test --test-isolation=none server/tests/voice-input.test.ts server/tests/voice-capture.test.ts
python3 tests/browser/voice_input.py
```

Browser requer Python Playwright/Chromium e loopback livre em 5173/8787/8788. Cria SQLite temporário por dispositivo e encerra somente os próprios processos. A fixture `voice-browser.ts` injeta o provider mock exclusivamente no servidor de QA; não há chave/test switch de IA mock no app normal.

Regressões foram chamadas por import dos módulos `fase5_gestures`, `fase4_recommendations`, `pdf_emission`, redirecionando `ARTIFACTS` para `.runtime/voice2-regressions/<suite>`, preservando evidências históricas. O roteiro legado `etapa5_rodape` espera rótulo anterior à base atual e não foi contabilizado como aprovado. Detalhes no [relatório](../../COPILOTO_VOZ_PR2.md).
