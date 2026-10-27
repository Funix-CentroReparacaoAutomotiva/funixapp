# Issue #15 — Diagnósticos, cenários e negociação comercial

Base: `main` em `a26fb413e9e9ddbea3fd0efb92903160448070f0` (PR #14 integrado). Branch: `feat/issue-15-diagnosticos`. Escopo: [Issue #15](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/issues/15). Sem merge, deploy ou acesso à produção.

## Implementação

- Cenários no botão de camadas e número após Chat / Diagnósticos / Mapa. Menu disponível nas três visões, seleção com fechamento, N variações por cópia de flags, comparação existente, teclado e exclusão com confirmação. A barra horizontal permanente foi retirada.
- `DELETE /api/atendimentos/:at/cenarios/:id` exige autenticação, origem e revisão. A transação recusa o último cenário e IDs de outro Atendimento; as FKs excluem apenas as flags daquele cenário. Composição mestre, componentes e versões emitidas permanecem intactos. Se o ativo é excluído, a interface seleciona outro existente.
- Migração **V6 aditiva**, sem recriar tabelas: contador `commercial_state.next_scenario_position`, inicializado após o maior número existente. Cenários remanescentes não são renumerados e números excluídos não são reutilizados, inclusive quando o maior cenário é removido.
- Consulta de um cenário excluído retorna um cenário existente. Se isso acontece enquanto há edição local, a interface conserva os campos, avisa sobre a exclusão e bloqueia gravações até a escolha explícita de cenário, com confirmação antes de descartar rascunhos. Nunca aplica silenciosamente o formulário a outra máscara.
- Linhas de peças: nome/posição sem separador, dois-pontos e diagnóstico na mesma linha; contagens apenas com ícones de serviço/componente e rótulos acessíveis; inclusão exclusiva no cenário ativo. O subtotal à direita vem de `Calculation.pieceTotals`, somando exatamente as linhas efetivamente incluídas no backend. `—` indica preço pendente; zero calculado continua `R$ 0,00`. Nenhum rateio da negociação global é aplicado à peça.
- Exclusão de peça fica somente dentro da edição, com confirmação de alcance sobre todos os cenários. O backend existente continua preservando versões emitidas.
- Resumo: Serviços, Componentes, disclosure **Negociação comercial** recolhido por padrão e Total de referência / Total final. Um seletor de modalidade, nenhum radio e um campo monetário apenas quando necessário. O acesso a configuração, componentes detalhados, emissão e histórico permanece no fluxo de orçamento, com retorno direto aos Diagnósticos; removida a duplicação do acesso no card.
- Negociação compartilhada entre Diagnósticos e emissão. Campos/prévia permanecem ao transitar entre as três visões e voltar do orçamento. São rascunhos locais até emitir, protegidos ao trocar cenário, sair do Atendimento ou recarregar. Não são gravados como condição comercial definitiva ao digitar.
- **Atualizar prévia** consulta a API existente, sem emitir documento. Edição do valor ou alteração de contexto invalida a prévia anterior. Falha conserva os campos e permite nova tentativa explícita. A emissão mantém token de prévia, revisão e chave idempotente existentes.
- Consentimento residual só é oferecido para uma prévia correspondente aos campos e contexto atuais; alterações de composição/configuração invalidam a ciência anterior. O total efetivo calculado é mostrado, com resíduo e impedimentos, sem prometer correspondência exata ao alvo digitado.

## Contrato financeiro e compatibilidade

O motor continua usando `none`, `discount` e `adjust`, com as fórmulas, quantidades e arredondamentos aprovados. `discount.value` é desconto absoluto em reais sobre serviços.

A API existente de prévia/emissão aceita a indicação opcional `negotiation.valueIncludesComponents: true` **somente com `mode: "adjust"`**. Nesse caso, `value` é o total final desejado. Dentro da mesma transação, o backend calcula:

`meta de serviços = total informado − subtotal atual dos componentes`

A conversão usa aritmética racional exata (`Q`/BigInt), rejeita alvo abaixo dos componentes e preço de componente pendente e passa a meta ao `adjust` existente. Não há cálculo de precificação no cliente nem modalidade nova no motor. Requisições anteriores sem a indicação continuam tratando `adjust.value` como meta do subtotal de serviços. O snapshot novo registra também `requestedTotal`, sem alterar snapshots/PDFs existentes.

Valores derivados podem ter mais de seis casas (ex.: componente `0.000001 × 0.05 = 0.00000005`); a meta gerada preserva esses dígitos. A validação pública dos valores informados continua limitada como antes. `pieceTotals` é opcional no contrato de snapshots para compatibilidade com emissões históricas.

## Testes e evidências

**Resultado: build e TypeScript aprovados, 67 testes Node, 23 testes dos scripts de implantação e 75 grupos de navegador aprovados.** Lint sem erros ou novos avisos; permanecem os quatro avisos preexistentes de efeitos em `App.tsx`.

Comandos:

```sh
npm run check
python3 -m unittest discover -s deploy/tests -v
python3 tests/browser/issue15_regressions.py
```

- Node: CRUD/exclusão com revisão, último cenário, origem/autenticação, preservação de máscaras/composição, atualização do SQL V5 congelado, persistência em arquivo e reinício, sequência monotônica, snapshot/PDF imutáveis mesmo após exclusão do cenário, valores por peça, zero/pendência, desconto, total negociado maior/menor, componente intocado, impossibilidades, frações além de seis casas, resíduo/consentimento, prévia obsoleta e contrato legado de `adjust`.
- Navegador real com API/SQLite temporários e dados sintéticos, **1440×960** e **390×844**: menu nas três visões, comparação, contexto/rascunhos, preços por flags, emissão manual, exclusão do cenário de orçamento emitido com comparação do hash PDF, prévia e consentimento concorrentes, falha de prévia, resposta DELETE perdida após commit real, último cenário, edição após exclusão concorrente e reinício.
- Regressão dos percursos anteriores de Atendimentos, catálogos, cenários, orçamento/PDF, interface compacta, V20 e Issue #12. Os seletores de navegador foram adaptados ao menu aprovado e à exclusão dentro da edição; as verificações de integridade não foram retiradas. As capturas anteriores permanecem nas pastas históricas.

[Resumo de validação](evidencias/issue15/validacao.json) · [Resultados da Issue](evidencias/issue15/resultados.json) · [Log npm](evidencias/issue15/npm-run-check.txt) · [Log navegador](evidencias/issue15/browser-regressoes.txt) · [Galeria desktop/mobile](evidencias/issue15/index.html).

O fixture `server/tests/fixtures/m1_5_migrations.ts` é o SQL/código de migração original da base acima, com apenas comentário de origem e caminho do import ajustados; permite comprovar o upgrade a partir da estrutura V5, não de uma estrutura nova recriada como V6.

## Limites e implantação futura

Sem alteração da hierarquia, catálogo, seletor circular, serviços/fatores especiais/energia, autenticação, dependências, Docker, workflow, Coda ou VPS. Preservadas as correções da Issue #12, inclusive GET atrasado, confirmação POST separada de GET e ausência de repetição automática de gravação.

A V6 foi aplicada somente em bancos temporários de teste. Em eventual implantação autorizada, é necessário preservar um backup prévio do SQLite pelo procedimento já existente. O aplicativo antigo rejeita um banco V6 pelo guard de compatibilidade; rollback para o código V5 exige uma versão compatível ou avaliar o backup anterior, sem sobrescrever lançamentos posteriores. Nenhuma infraestrutura de backup ou procedimento produtivo foi executado nesta tarefa.

Não há regra comercial pendente inventada ou integração simulada. Homologação visual/funcional e publicação dependem da auditoria e autorização da direção.
