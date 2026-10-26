# Catálogo único — simplificação para avaliação do proprietário

> Este relatório registra a primeira entrega do PR #11. O [complemento de interface aprovado](PR11_INTERFACE.md) remove o acesso operacional à manutenção de catálogos e compacta cabeçalho, cenários e seletor, preservando a regra de catálogo único documentada abaixo.

Base: main `a9b6707ab85c7f63d6fc4d36f7d93d491c8d6dfc`. Branch: `fix/catalogo-unificado`. A solicitação atual do proprietário substitui a exigência anterior de validar manualmente os cadastros. Sem merge, deploy ou acesso a sistemas produtivos.

## Resultado

- Um catálogo operacional para peças da árvore e peças cadastradas pelo operador. `status`, `source` e `suggestion` permanecem como metadados legados, sem governar seleção, composição ou cálculo.
- Item ativo e com nome é utilizável imediatamente; peça também precisa de código não vazio. Dimensão continua pertencendo a um serviço ativo. Tipo, pertencimento, unicidade física, revisões e quantidades fracionárias mantêm suas verificações.
- Retirados checkbox de validação, rótulos de proposta/sugestão/origem e bloco separado de peças próprias. A mesma busca encontra todas as peças por nome/código, sem duplicar peças que aparecem em mais de uma vista. Nomes atuais do catálogo também participam da busca.
- Navegação por regiões/grupos e seleção Ambos preservadas. Item inativo ou sem código continua indisponível. Referências históricas continuam visíveis/editáveis/removíveis; não são apagadas ao desativar um cadastro. Emissão exige referências efetivas ativas, identificação e configuração comercial completa, como antes.
- Nenhuma migração nova ou alteração de tabela, dados de catálogo, hierarquia, infraestrutura ou dependência. Não houve conversão em massa para `validado`; os registros existentes passam a funcionar com seus valores atuais. Snapshots emitidos continuam imutáveis.

## Arquivos de implementação

| Arquivo | Alteração |
|---|---|
| `shared/commercial.ts` | Predicado curto compartilhado de atividade/identificação, sem status/origem |
| `server/commercial.ts` | Elegibilidade de peças, diagnósticos, serviços e dimensões sem aprovação |
| `server/pricing-engine.ts` | Mesma elegibilidade no cálculo, sem mudar fórmulas/negociação |
| `src/CommercialPanel.tsx` | Busca unificada, remoção de rótulos/checkbox/bloco de origem, manutenção de active |
| `src/PricingEditor.tsx` | Serviços/dimensões ativos disponíveis para configurar preços sem validação |

Testes atualizados: `server/tests/app.test.ts`, `server/tests/commercial.test.ts`, `server/tests/pricing.test.ts`, `tests/browser/m1_2_catalogos.py` e `tests/browser/issue7_integrated.py`. Documentação atualizada: `AGENTS.md`, `README.md`, `docs/API.md` e este relatório. Evidências sintéticas em `docs/evidencias/catalogo-unificado/`; relatórios antigos preservados.

## Verificações executadas

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
git diff --check
```

- **53 testes Node aprovados**, build e tipos aprovados; lint sem erros, com os mesmos quatro avisos preexistentes em App.tsx.
- **23 testes Python aprovados**, incluindo instalador/recuperação e bloqueio de deploy automático por push. Sem execução remota.
- **8 grupos Chromium de catálogos/diagnósticos aprovados**: peças legadas e sugestões codificadas disponíveis sem aprovação; folhas sem código bloqueadas; criação de catálogos, navegação original do Mapa/Ambos, composição fracionária, falha/reauth/conflito, reinício/mobile, nova peça na busca única por nome/código e inativação sem perda de referência.
- **7 grupos Chromium integrados aprovados**: criação sem checkbox/status, configuração de serviços/dimensões, preço exato e emissão PDF real; inclusive A/Z/AA, parser independente, snapshot preservado após edição/reinício e nenhum acesso externo.
- Teste com SQLite em arquivo compara linhas completas do catálogo e esquema antes/depois de reabrir; código e metadados legados preservados. Suíte mantém os testes de atualização/rollback dos bancos anteriores.
- 20 documentos originais conferidos por SHA-256. Migrações, seed/árvore, Dockerfile, Compose e workflow sem alterações.

Reprodução dos navegadores, sequencialmente, com Playwright/Chromium já usados pelo projeto:

```bash
python3 - <<'PY'
import sys, asyncio
sys.path.insert(0, 'tests/browser')
import m1_2_catalogos as qa
qa.ARTIFACTS = qa.ROOT/'docs/evidencias/catalogo-unificado/catalogos'
asyncio.run(qa.run())
PY
python3 - <<'PY'
import sys, asyncio
sys.path.insert(0, 'tests/browser')
import issue7_integrated as qa
qa.ARTIFACTS = qa.ROOT/'docs/evidencias/catalogo-unificado/integrado'
asyncio.run(qa.run())
PY
```

Os harnesses usam API real, banco temporário próprio e somente dados sintéticos. O integrado usa `pdftotext` no QA; a aplicação não depende dele. Uma resposta 503 é simulada somente na regressão de erro; todas as gravações bem-sucedidas/PDFs são reais. A evidência versionada retém os JSONs, logs, duas capturas e textos extraídos dos PDFs; a reexecução também gera as demais capturas e PDFs sintéticos.

## Limites preservados

Peças novas são localizadas pela busca unificada; não recebem automaticamente uma posição inventada na árvore existente. As 23 folhas sem código continuam indisponíveis e não ganham códigos artificiais. O operador informa códigos reais para novos cadastros; códigos físicos já estabelecidos continuam imutáveis. Status/origem legados continuam aceitos pela API para compatibilidade, sem exigir preenchimento no formulário nem controlar elegibilidade. Configuração de preços/energias continua necessária para emitir, sem valores fictícios.

Cabeçalho, cenários, Funil, SVG do Mapa e organização geral de Diagnósticos não foram redesenhados. A correção fica para auditoria em PR; nenhum deploy ou merge está autorizado por esta tarefa.
