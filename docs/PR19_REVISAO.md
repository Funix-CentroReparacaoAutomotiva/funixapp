# PR #19 — resposta à revisão independente

Revisão atendida: [parecer de direção](https://github.com/Funix-CentroReparacaoAutomotiva/funixapp/pull/19#pullrequestreview-5692251294). Mesmo PR/branch. Nenhuma gravação Coda, VPS, banco produtivo, merge ou deploy. Não foram modificados preços, regras do motor ou interface.

## 1. Exportação real reproduzível

**Caminho efetivamente validado: conector Coda/Superhuman Docs autenticado → captura bruta privada → normalizador versionado → bundle offline → dry-run V7.** O coletor REST original continua experimental: este ambiente não possui token REST provisionado nem rota HTTP Coda. Não se declara que o REST foi homologado e não é necessário usá-lo para a carga proposta.

`scripts/capture-coda-commercial.js` contém o roteiro executável da coleta pelo conector. Ele consulta somente os esquemas e as linhas das 15 tabelas da allowlist existente, paginando em até 100 linhas; da tabela operacional `grid-aHz1ZDVlfK`, lê **somente o esquema**, antes/depois, sem linhas. Exclui canvas e anexos. Salva as respostas originais, incluindo o envelope `content[].text → JSON {toolName,result}`, sem reconstruir referências por nomes nem reescrever fórmulas. Não lê/salva tokens.

`server/coda-connector-export.ts` extrai o formato observado, verifica IDs de tabelas, contagens antes/depois, colunas/fórmulas, offsets, fim da paginação e duplicidades. Recusa erro remoto, páginas ausentes e formato desconhecido. Preserva decimais lexicalmente, IDs de referência e fórmulas originais. Os seis fingerprints do importador permanecem **inalterados**.

Procedimento exato no mesmo ambiente de desenvolvimento com o plugin conectado:

1. Caso exista `.runtime/coda-export`, preservá-lo em outro caminho privado antes de uma coleta nova. O roteiro recusa sobrescrever `capture.json`. Não copiar dados para `docs/`/Git. Não editar os cadastros Coda durante a leitura.
2. No executor de ferramentas Codex (`functions.exec`), executar o arquivo versionado abaixo. Não é um script Node; `tools` é o transporte autenticado já disponível no Codex. Se o checkout estiver em outro caminho, ajustar apenas `repoPath` no roteiro.

```javascript
const r = await tools.exec_command({
  cmd: 'cat scripts/capture-coda-commercial.js',
  workdir: '/workspace/funixapp', max_output_tokens: 8000
});
if (r.exit_code !== 0) throw new Error('Falha ao ler roteiro');
await eval('(async()=>{\n' + r.output + '\n})()');
```

3. Normalizar pelo CLI, **sem token e sem completar valores manualmente**:

```bash
node scripts/export-coda-commercial.ts --connector-capture \
  .runtime/coda-export/capture.json .runtime/coda-export/export.json
```

4. Gerar um V7 **descartável**, exclusivo de QA, e executar a simulação. O comando de inicialização abaixo destina-se somente a este caminho de teste; nunca apontá-lo a produção:

```bash
node --input-type=module -e 'import{openDatabase}from"./server/database.ts";openDatabase(".runtime/coda-export/qa-v7.sqlite").close()'
node server/import-coda.ts --source .runtime/coda-export/export.json \
  --database .runtime/coda-export/qa-v7.sqlite > .runtime/coda-export/dry-run.json
node scripts/check-coda-import-cases.ts .runtime/coda-export/export.json .runtime/coda-export/matrix.json
```

A captura, o bundle, o relatório detalhado e o SQLite ficam em `.runtime/` ignorado, com diretório 0700; captura/bundle 0600. Conservar esses arquivos privadamente para a auditoria, sem anexar valores comerciais ao PR. O exportador recusa saída já existente. Não é necessário executar o REST nem obter seu token no servidor produtivo.

**Executado novamente, com leituras reais nesta revisão:** 15 tabelas, 479 linhas de configuração; captura → CLI de normalização → CLI de dry-run. Zero conflitos, 119 cadastros previstos; 44 dimensões com preço compatível, 51 com energia e 28 com ambos, mesmos resultados anteriores. Fonte normalizada: `sourceDigest=e3b76df494c2cd6c805106591a831db727b146250d373ae275ef86e18205f544`. Esse digest é da origem lógica do importador, não o hash dos bytes do arquivo. A contagem total não inclui linhas operacionais, que não foram coletadas.

Limitação preservada: leituras Coda não formam snapshot transacional. O normalizador detecta mudanças de esquema/contagem; mudanças de valores sem mudança de contagem exigem coleta sem edição simultânea e revisão da fonte. Não se contornou essa limitação com sincronização ou novas ferramentas.

## 2. Matriz mínima de aceite funcional

Gerada por `scripts/check-coda-import-cases.ts` a partir do novo bundle real. O script aplica o plano em **SQLite em memória**, seleciona cada dimensão de três serviços por **IDs Coda estáveis** e exercita os contratos existentes de composição, parâmetros e `BudgetRepository.preview`. Não emite versões nem abre o banco da aplicação/produção.

Condições: quantidade 1; tabela da linha; FC C0 e FR R0 reais; peça de QA; sem negociação e **sem componentes de revenda**. “Calculável” significa `canEmit=true` para esse escopo de serviços, com preço, etapas/energia e prazo completos. Não significa que todos os orçamentos, dimensões ou componentes estão liberados.

| Serviço | Tabela | Calculáveis | Bloqueados | Motivo |
|---|---|---:|---:|---|
| Funilaria | Padrão | 0 | 5 | FC condicional no Coda; base/FD não importados como globais V7 |
| Funilaria | Parceria | 0 | 5 | Base incompatível; adicionalmente FV derivado pendente |
| Funilaria | Nosso time | 0 | 5 | Base incompatível; adicionalmente FV derivado pendente |
| Funilaria | Retrabalho | 0 | 5 | Base incompatível; adicionalmente FV derivado pendente |
| Pintura | Padrão | 4 | 2 | Acessórios/Pincelada: conjunto de energia incompatível/incompleto |
| Pintura | Parceria | 0 | 6 | FV pendente; não converter percentuais/herança em FV global |
| Pintura | Nosso time | 0 | 6 | FV pendente |
| Pintura | Retrabalho | 0 | 6 | FV pendente |
| Montagem | Padrão | 4 | 0 | P, M, G e GG com preço e energia completos |
| Montagem | Parceria | 0 | 4 | FV pendente |
| Montagem | Nosso time | 0 | 4 | FV pendente |
| Montagem | Retrabalho | 0 | 4 | FV pendente |

**Total: 60 casos, 8 calculáveis, 52 bloqueados.** Pintura/Padrão calculável em Bumper Coating, Completa, Parcial e Peça Grande. Funilaria bloqueada em PP/P/M/G/GG. As 28 dimensões completas do relatório geral pertencem ao conjunto de todos os serviços; não são 28 casos aprovados dentro desta matriz reduzida. O JSON privado contém o motivo retornado pelo motor para cada dimensão, sem preços no resumo versionado. O motor pode apontar a primeira pendência (por exemplo, base antes de FV); isso não configura as demais automaticamente.

### MR e decisões da direção

MR continua ausente no bundle: nenhum significado de `fator_curadoria` foi presumido. Serviços sem componentes não exigem MR; componentes com revenda continuam bloqueados enquanto faltar multiplicador.

Caminho mínimo **após a direção informar e autorizar nome/fator de cada opção MR**:

1. Operador autenticado: **Configurações → Precificação → + Adicionar MR**. Preencher nome e fator decimal autorizados e salvar a configuração comercial já existente.
2. No Atendimento: painel financeiro → **MR**, selecionar a opção autorizada. Ela vale para todos os componentes desse Atendimento; não existe FCT individual. Conferir a prévia após o recálculo.
3. Alterações de configuração/parâmetros afetam rascunhos; orçamentos/PDFs emitidos continuam imutáveis. Esta revisão não preenche MR nem configura produção.

Para Parceria/Nosso time/Retrabalho, a direção precisa definir fatores V7 explicitamente aprovados e o tratamento das regras divergentes por serviço/tabela; **não basta copiar o fator da tabela Coda** para alegar equivalência. Até essa definição, usar apenas os casos comprovados de Padrão; demais tabelas permanecem pendentes. Funilaria e energias incompatíveis também exigem decisão/dados técnicos compatíveis antes de liberar orçamento. Não foi ampliado o motor para regras condicionais/percentuais.

## 3. Regressão de energia compensada

Novo caso automatizado: energia base **−1**, energia dimensional **6**, energia calculada da relação **5** e total da dimensão **5**. Apesar da soma coerente, o operando negativo é incompatível com V7. Teste comprova: preço/FD continuam preservados, nenhuma etapa é importada como completa, relatório mantém pendência, `preview.canEmit=false`, energia `null` e tentativa de emissão rejeitada, sem versão criada. Nenhuma mudança de regra foi necessária.

## Validação desta revisão

- `npm run check`: build/typecheck, **87 testes Node**, zero falhas; somente quatro avisos de lint anteriores.
- Novas regressões: envelope real do conector, paginação/erros/esquema, CLI de normalização com arquivo exclusivo 0600 e caso adversarial de energia compensada.
- CLI de exportação real normalizada e dry-run V7: zero conflitos; fonte e dados brutos não versionados.
- Matriz com fonte real: 60 prévias no motor existente, 12 grupos, nenhuma emissão.
- UI/motor/contratos HTTP não alterados. Evidências desktop/mobile anteriores continuam válidas para a interface inalterada; não foram apresentadas como nova homologação produtiva.
