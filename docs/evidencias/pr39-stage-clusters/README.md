# PR39 — categorias das etapas

- `check.log`: 284 testes Node, build/tipos/lint; seis avisos preexistentes.
- `reference-audit.json`: auditoria dos 39/113 IDs e duas relações pendentes, sem dados privados.
- `interface/`: nove grupos e screenshots em 1440/390/320 px, categoria pendente → configuração explícita → emissão em duas categorias.
- `template/`: dez renderizações locais do HTML original, incluindo quatro páginas e 21 peças, logo sintética FUNIX QA, sem rede externa.
- `categorias-sintetico-local.pdf`: PDF A4 **local**, com agrupamento de um serviço em duas categorias. Não é saída do jsreport da VPS.
- `emissao.log` e `*-emissao-resultados.json`: 33 grupos de regressão de idempotência, falhas, recuperação, reinício e históricos.

Somente dados sintéticos, bancos temporários, mocks HTTP. Sem exportação comercial privada, credenciais produtivas, bancos versionados, merge, importação ou deploy. Parcelamento aprovado inalterado. Relatório: `docs/PR39_AGRUPAMENTO_ETAPAS.md`.
