# PR #11 — interface compacta aprovada

Implementado na mesma branch `fix/catalogo-unificado`, após a simplificação auditável em `1213fb5b65758fb851f7e74bcf351f73d6683328`. Escopo autorizado pelo [comentário de direção](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/11#issuecomment-6408958801), expressamente invocado pelo proprietário. Este complemento substitui os limites anteriores sobre cabeçalho/cenários, sem autorizar merge ou deploy.

## Entrega

1. Removida a faixa `at-detail-tools`. A edição real do Atendimento fica no cabeçalho superior, com ícone de lápis e nome acessível **Editar Atendimento**. Preservados modal, salvamento e proteção contra descarte; conferidos Chat, Diagnósticos e Mapa.
2. Removida a barra de título duplicado e o botão Catálogos da operação. `CatalogManager` continua exportado no código, e todas as APIs/histórico administrativo permanecem existentes/autenticados. Não há nova tela Configurações, rota administrativa ou atalho de origem.
3. Cenários em uma linha de **38 px**, miniabas numéricas com ativo destacado, setas de navegação quando houver overflow e `+`/Comparação fixos. Uso direto por toque/clique e teclado (setas, Home/End, foco). Modelo sem limite novo; nove cenários foram exercitados em desktop/mobile. A página não rola horizontalmente; a matriz mantém sua rolagem própria.
4. `+` copia inclusões do cenário ativo por `duplicateFrom`/`sourceRevision`, seleciona a variação e não pede nome. Não cria composição independente nem clona peças/serviços. A UI não oferece cenário vazio ou renomeação. Atributos compartilhados continuam protegidos; dica fica no título da faixa, com o aviso contextual já existente na edição do diagnóstico.
5. Rótulos derivados de `position` estável: **Cenário 1, 2, 3…** nas miniabas, comparação, prévia e novas emissões/PDFs. Nomes internos existentes não foram migrados ou renomeados. Letras A,B,C… continuam identificando somente versões emitidas. A visualização de versões antigas usa numeração de cenário sem regravar snapshot/PDF; documentos antigos mantêm seus bytes e texto congelados.
6. Botão padrão **+ Adicionar peça / Fechar seleção**, busca compacta com lupa interna e nome acessível, sem parágrafo técnico. Opções mostram apenas o nome, com indicador discreto de grupo/indisponibilidade. Grid de duas colunas no desktop e uma no celular, mantendo hierarquia/Ambos/busca unificada.
7. Mantida integralmente a elegibilidade simplificada: ativo e identificado, sem aprovação manual ou distinção por origem/status. Peças sem código e itens inativos continuam bloqueados para novas seleções. Sem alterações em SQLite/esquema/seed, códigos, preços ou fórmulas.

## Recargas e medição

A chave anterior era `record.id:tab:commercialVersion`, causando desmontagem/montagem a cada troca Diagnósticos ↔ Mapa. A chave agora é `record.id:commercialVersion`. Só o estado visual do editor é reinicializado quando necessário; os dados comerciais já carregados permanecem no mesmo componente. Não foi adicionada biblioteca, cache global, armazenamento no navegador ou alteração de API para isso. Trocas de Atendimento, alterações/recargas e autenticação continuam usando seus ciclos próprios.

Na execução local final registrada:

- Primeira abertura comercial: **154,90 ms**, com um GET de catálogos e um GET de cenários em paralelo.
- Seis alternâncias Diagnósticos/Mapa: **zero GETs adicionais** de catálogos/cenários; aproximadamente 499,56 ms para a sequência automatizada, incluindo 150 ms de espera explícita do teste.
- Ambiente local Chromium/API Node/SQLite temporário, sem rede de produção. Essas medidas **não comprovam a causa dos ~15 s relatados no celular**, nem representam latência da VPS. A correção elimina a remontagem/requisições redundantes identificadas; não atribuímos o restante a servidor/rede sem evidência.

## Testes e evidências

| Verificação | Resultado |
|---|---|
| `npm run check` | Build/tipos, **54 testes Node** e lint aprovados; mesmos quatro avisos preexistentes em App.tsx |
| `python3 -m unittest discover -s deploy/tests -v` | **23 testes** aprovados, sem execução remota |
| `tests/browser/pr11_interface.py` | **6 grupos** desktop/mobile: cabeçalho/edição/guardas, requisições, seletor, nove cenários/variação/setas/teclado, comparação/contexto e recuperação após reinício |
| Regressão M1.1 | **19 grupos**, incluindo edição, retorno, busca e falhas |
| Catálogos/diagnósticos | **8 grupos**, APIs administrativas preservadas, Mapa/Ambos, ativos/inativos e nova peça na busca unificada |
| Cenários | **3 grupos**, serviços repetidos, flags, edição global e reinício/mobile |
| Orçamento integrado | **7 grupos**, configuração explícita, negociação/PDF, A/B/C/Z/AA e preservação de snapshots após edição/reinício |

Os 43 grupos de navegador usam API real e SQLite temporário, dados sintéticos e bloqueio de hosts externos. Não há resposta fictícia de sucesso. A regressão de falha continua simulando um 503; persistência, concorrência, reautenticação e PDFs são reais. Corrigido também o registro de falhas dos harnesses alterados para que um `AssertionError` sem mensagem nunca seja tratado como sucesso.

Reprodução sequencial, preservando evidências históricas:

```bash
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/pr11_interface.py
python3 - <<'PY'
import sys, asyncio
sys.path.insert(0, 'tests/browser')
import m1_atendimentos as m1
import m1_2_catalogos as catalogs
import issue7_scenarios as scenarios
import issue7_integrated as integrated
root = m1.ROOT/'docs/evidencias/pr11-interface'
for module, folder in [(m1,'m1'), (catalogs,'catalogos'), (scenarios,'cenarios'), (integrated,'integrado')]:
    module.ARTIFACTS = root/folder
    if module is m1: module.REPORT = module.ARTIFACTS/'resultados.json'
    asyncio.run(module.run())
PY
git diff --check
```

JSONs, logs, capturas desktop/mobile e textos extraídos dos PDFs em [evidências](evidencias/pr11-interface/). PDFs novos B/C foram lidos por `pdftotext` e confirmam letras de versão e cenário numérico; A continua byte a byte idêntico após mudanças/reinício. Harnesses exigem Chromium/Playwright e, no teste PDF, `pdftotext`, como nos ciclos anteriores. Esses comandos não são dependências novas da aplicação.

## Arquivos

- `src/App.tsx`, `src/App.css`: cabeçalho e chave do componente, estilos compactos V20.
- `src/CommercialPanel.tsx`: retirada do acesso administrativo operacional, seletor de peças e variação/comparação.
- `src/ScenarioTabs.tsx`: componente pequeno de miniabas, setas, foco/teclado e ações fixas.
- `src/BudgetPanel.tsx`, `shared/commercial.ts`, `server/pricing-engine.ts`, `server/budgets.ts`: rótulo numérico consistente, sem alterar matemática nem documentos existentes.
- `server/tests/budgets.test.ts`: numeração por ordem sem renomear dados legados, letras das emissões e imutabilidade.
- `tests/browser/pr11_interface.py`, `m1_2_catalogos.py`, `issue7_scenarios.py`, `issue7_integrated.py`: cenário novo e regressões adequadas à UI aprovada. Cadastros de QA agora são fornecidos explicitamente pela API, sem botão de catálogo na operação.
- `AGENTS.md`, `README.md`, `docs/API.md`, relatórios e evidências: escopo/documentação atuais. Nenhum arquivo de ambiente, banco real, credencial ou dado de cliente integra a entrega.

## Dependência objetiva para avaliação

Diagnósticos, Serviços e Dimensões comerciais **começam vazios** no banco original. Retirar o botão Catálogos não os configura. Peças codificadas podem ser selecionadas e observações podem ser salvas; para composição de serviços e orçamento completo, a direção ainda precisa fornecer/configurar esses cadastros e os dados de preço/energia pela capacidade administrativa existente. **Não há seed inventado, nova tela de configuração ou atalho oculto na operação.** O formulário de precificação já existente foi preservado, mas não cria esses cadastros comerciais.

Mantidos autenticação, proteção de origem, SQLite e toda a simplificação anterior do PR. Vinte fontes originais conferidas por SHA-256; migrações/seed, Dockerfile, Compose, workflows, dependências e scripts de implantação inalterados. Não houve acesso/alteração na VPS, Coda, DNS, Traefik, n8n ou Evolution API. Entrega permanece no PR #11 para auditoria antes de qualquer merge/deploy.
