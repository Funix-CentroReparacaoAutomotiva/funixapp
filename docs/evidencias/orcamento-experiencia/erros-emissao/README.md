# Correção de erros — PR #41

Somente dados sintéticos e SQLite temporário. 315 testes Node e 66 grupos de navegador aprovados, em 1440×1000, 390×844 e 320×844. Mesmos 7 avisos preexistentes de lint.

Logs: [npm run check](npm-check.txt), [navegador](browser-pdf.txt). JSONs por largura: [desktop](desktop-resultados.json), [390](mobile390-resultados.json), [320](mobile320-resultados.json). Todos os grupos aprovados, sem erros JS ou chamadas externas.

| Estado | Desktop | 390 px | 320 px |
|---|---|---|---|
| Falha conhecida: Voltar/Confirmar disponíveis | [imagem](desktop-falha-renderizador.png) | [imagem](mobile390-falha-renderizador.png) | [imagem](mobile320-falha-renderizador.png) |
| Depois de Voltar: edição e navegação liberadas | [imagem](desktop-voltar-apos-falha-conhecida.png) | [imagem](mobile390-voltar-apos-falha-conhecida.png) | [imagem](mobile320-voltar-apos-falha-conhecida.png) |

Renderer HTTP local autenticado de teste; nenhum acesso ao jsreport/VPS instalado. O PDF da fixture não reproduz o layout do template produtivo. As screenshots evidenciam estados e controles, sem alteração de layout.

Comandos:

```bash
npm run check
PYTHONPATH=tests/browser python3 - <<'PY'
import asyncio
import pdf_emission as suite
suite.ARTIFACTS = suite.ROOT / 'docs/evidencias/orcamento-experiencia/erros-emissao'
suite.ARTIFACTS.mkdir(parents=True, exist_ok=True)
asyncio.run(suite.run())
PY
git diff --check
```

A execução original utilizou `python3 tests/browser/pdf_emission.py`, e seus resultados foram separados neste diretório, preservando as evidências já auditadas. O comando acima reproduz a mesma suíte diretamente neste destino. Requer Python Playwright e Chromium, portas loopback 5173/8787/8788 livres. Não executar suítes simultaneamente.
