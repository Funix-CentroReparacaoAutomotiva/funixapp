# Evidências — experiência de orçamentos

Dados exclusivamente sintéticos; SQLite temporário V12. Nenhuma chamada a VPS/Coda/jsreport instalado. Chromium 154, desktop 1440×1000, mobile emulado 390×844 e 320×844.

| Execução | Resultado |
|---|---|
| `npm run check` | 310 testes Node, build e TypeScript aprovados; 7 avisos preexistentes do lint |
| `python3 -m unittest discover -s deploy/tests -v` | 23 testes aprovados, sem operações produtivas |
| `python3 tests/browser/pdf_emission.py` | 57 grupos aprovados (19 por largura) |
| `python3 tests/browser/stage_clusters.py` | 9 grupos aprovados (3 por largura) |
| `fase5_gestures.py`, execução abaixo | 30 grupos aprovados (10 por largura) |
| `git diff --check` | Aprovado |

Logs completos: [check](npm-check.txt), [implantação sintética](deploy-tests.txt), [PDF/histórico/prazo/navegação](browser-pdf.txt), [categorias](browser-categorias.txt), [gestos/autosave](browser-gestos.txt). Os JSONs `*-resultados.json` listam cada grupo e confirmam ausência de requisições externas e de erros JS.

A fixture HTTP local autentica o transporte do backend e retorna PDF válido. A prévia sintética exibe o conteúdo do DTO, **não o template produtivo**. A comparação comercial prévia/oficial e a imutabilidade são verificadas no Node/API e no SQLite dos testes. Não afirmar homologação com o serviço instalado a partir dessas imagens.

| Tela | 1440 px | 390 px | 320 px |
|---|---|---|---|
| Prévia PDF | [desktop](desktop-previa-pdf.png) | [390](mobile390-previa-pdf.png) | [320](mobile320-previa-pdf.png) |
| Histórico | [desktop](desktop-historico-por-cenario.png) | [390](mobile390-historico-por-cenario.png) | [320](mobile320-historico-por-cenario.png) |
| Prazo na barra | [desktop](desktop-prazo-barra.png) | [390](mobile390-prazo-barra.png) | [320](mobile320-prazo-barra.png) |
| Prazo indisponível | [desktop](desktop-prazo-indisponivel.png) | [390](mobile390-prazo-indisponivel.png) | [320](mobile320-prazo-indisponivel.png) |
| Diagnósticos | [desktop](desktop-diagnosticos.png) | [390](mobile390-diagnosticos.png) | [320](mobile320-diagnosticos.png) |
| Mapa | [desktop](desktop-mapa.png) | [390](mobile390-mapa.png) | [320](mobile320-mapa.png) |
| Chat | [desktop](desktop-chat.png) | [390](mobile390-chat.png) | [320](mobile320-chat.png) |
| Pendência de categoria | [desktop](categorias/desktop-categoria-pendente.png) | [390](categorias/mobile390-categoria-pendente.png) | [320](categorias/mobile320-categoria-pendente.png) |
| Swipe da linha | [desktop](gestos/desktop-swipe-revelado.png) | [390](gestos/mobile390-swipe-revelado.png) | [320](gestos/mobile320-swipe-revelado.png) |

As verificações geométricas conferem a ordem das cinco métricas e das colunas do histórico. Gestos físicos CDP aguardam a transição nativa antes de iniciar toque na nova superfície. A preferência de movimento reduzido é testada e não chama a API de animação. Trocas concorrentes não deixam rota/aba divergentes.

Para reproduzir as regressões sem sobrescrever evidências históricas:

```bash
PYTHONPATH=tests/browser python3 - <<'PY'
import asyncio
import fase5_gestures as suite
suite.ARTIFACTS = suite.ROOT / 'docs/evidencias/orcamento-experiencia/gestos'
suite.ARTIFACTS.mkdir(parents=True, exist_ok=True)
asyncio.run(suite.run())
PY
```

Requer Python Playwright e Chromium em `/usr/bin/chromium`, como nas demais suítes existentes. Não executar suítes concorrentes: portas loopback 5173/8787/8788 compartilhadas. O harness recusa portas ocupadas e encerra apenas seus próprios processos.
