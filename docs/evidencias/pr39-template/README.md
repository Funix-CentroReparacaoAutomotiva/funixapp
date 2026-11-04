# PR39 — template fornecido pela direção

HTML de referência preservado em `docs/referencias/pdf/`. Screenshots e PDF são renderizações **locais**, com dados sintéticos e uma logo **FUNIX QA** substituta; não são resultados do jsreport instalado.

- `resultados.json`: dez casos, incluindo orçamento de 21 peças em três páginas; nenhum acesso externo.
- `*-template.png`: screenshots do HTML fornecido, sem alterar seu layout.
- `desconto-sintetico-local.pdf`: PDF A4 local do caso de desconto; Serviços líquido no quadro da soma, detalhes brutos preservados.
- `template-render.log`, `template-browser.log`: Handlebars 4.7.9 e Chromium/PDF/texto.
- `check.log`: `npm run check` final, 265 testes Node.
- `browser-emissao.log`: nova execução dos 33 grupos em 1440/390/320 px, com API, SQLite e HTTP jsreport sintéticos.

Quantidades de alta precisão e arredondamento independente podem produzir R$ 0,01 de diferença na soma visual, conforme caso `fractional` e relatório. Nenhum ajuste financeiro foi inventado. A amostra de dados recebida do proprietário não foi publicada.
