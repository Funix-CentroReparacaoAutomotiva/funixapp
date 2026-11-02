# Fase 3 — intensidade do diagnóstico e dados de recomendação

Base: `main`/`0a7644b21293c64e95d459082c41b7dd3e4bebda`, com Fases 1 e 2 homologadas. Branch exclusiva: `feature/fase3-intensidade-recomendacoes`. Implementação local, exclusivamente bancos/dados sintéticos. Sem merge, deploy, VPS, SQLite instalado, coleta Coda ou uso da exportação comercial privada.

## Entrega e limite da fonte

A intensidade agora pertence ao diagnóstico mestre da peça e é persistida por autosave, compartilhada entre cenários. Leve/Moderado/Severo e null são os únicos valores. Habilitações continuam independentes por cenário. Alterar diagnóstico/intensidade não cria, remove nem altera serviços, dimensões, quantidades ou componentes.

Foi implementada a carga controlada de relações por IDs e a consulta autenticada somente leitura para a Fase 4. Não há aplicação automática/assistida nem nova lista de sugestões. A composição comercial só continua sendo alterada pelas ações já existentes do operador.

**O arquivo `funix-fase3-regras-coda.json` não foi disponibilizado entre os anexos acessíveis nem encontrado nos arquivos do workspace/repositório. A solicitação contém somente o texto do escopo.** Foi utilizada a alternativa explicitamente autorizada: implementar/testar o contrato com fixtures sintéticas. Não foi feita nova coleta, reconstrução da fonte privada ou associação por nomes.

| Fonte real mencionada pela direção | Resultado desta execução |
| --- | --- |
| 77 relações, sendo 61 true e 16 false | Contagens informadas na solicitação; **não conferidas no arquivo real** |
| 74 relações potencialmente coerentes | **Pendentes de validação integral**, não importadas |
| 3 Desalinhamento → Alinhamento, dimensões de Montagem | Divergências informadas pela direção; mecanismo de detecção/retenção testado sinteticamente, sem declarar seus IDs reais validados |
| Arquivo original e seu SHA-256 | Indisponíveis; nenhuma integridade real afirmada |

Não se deve carregar uma fonte real antes de confirmar seu contrato/IDs, integridade e relatório. Não há aqui um arquivo contendo 77 relações inventadas. O JSON estrutural documentado não é uma exportação real nem está aprovado para carga.

## Persistência e migração

Migração incremental **V8 → V9**, na transação existente de migrações:

- Acrescenta `diagnosis_items.intensity` nullable, com CHECK do enum, sem valores presumidos nos registros anteriores.
- Acrescenta `diagnosis_recommendations`, FKs para catálogo, unicidade de origem e da combinação diagnóstico/intensidade/serviço/dimensão, boolean de seleção padrão, status e motivo de pendência.
- Preserva registros/IDs/flags/configurações financeiras, MR percentual, serviços/componentes e snapshots/PDFs existentes.
- Falha na migração reverte também a coluna acrescentada; teste inicia de SQL V8 congelado com orçamento/PDF e compara os registros antes/depois/reinício.

A intensidade integra assinaturas de edição/reconciliação e o PATCH auditado do editor; revisão otimista continua obrigatória. Omitir preserva; null limpa. Snapshots antigos sem intensidade permanecem legíveis; novas emissões podem guardá-la na composição congelada. Motor de cálculo e template de PDF não foram modificados.

O importador comercial existente foi apenas revisado para aceitar V8/V9 com sequência de migrações contínua, sem migrar alvo ou tocar recomendações. Sua versão antiga recusa V9 pelo guard V8 anterior. Não há novo importador de preços, cadastros duplicados ou alterações de fórmulas. A recuperação para imagem V8 exige banco V8 compatível; não iniciar API antiga sobre V9.

## Regras e consulta

Contrato normalizado explícito em `docs/API.md`, sem presumir o formato do original ausente. Usa o mesmo `sourceId`/documento/tabelas do importador comercial. IDs do diagnóstico, serviço e dimensão precisam existir com tipos corretos; dimensão deve pertencer ao serviço. Nome, semelhança textual ou preço nunca são chaves de associação.

O dry-run valida a fonte completa. Ausência/tipo inválido de referência, ID/semântica duplicada, intensidade/boolean inválidos e conflito com regra local bloqueiam toda a transação. Vínculos serviço–dimensão incompatíveis ficam armazenados como pendências com os IDs originais e motivo, sem substituição de dimensão. O restante pode ser preparado/carregado por plano explicitamente confirmado. As pendências não são consideradas recomendações válidas.

A consulta por `diagnosisId + intensity` retorna serviço/dimensão, boolean de seleção padrão e IDs de rastreabilidade. Revalida atividade/tipos e pertencimento atual da dimensão: alterações posteriores de catálogo não tornam um vínculo inválido utilizável. `selectedByDefault=false` continua consultável, sem aplicação automática. Dados de recomendação não afirmam que preço/energia estão completos nem dispensam a política comercial existente.

O plano usa hashes da fonte, do estado alvo e das regras. Aplicação refaz o plano sob `BEGIN IMMEDIATE`, exige o mesmo hash e não sobrescreve divergências. Uma segunda carga não duplica nem altera registros. Nenhuma chamada automática ao Coda, escrita em Atendimentos ou hook de startup.

## Interface — somente o cabeçalho autorizado

A primeira linha atual já é o cabeçalho contextual com Voltar/nome da peça. Anotações foi deslocado para sua direita, usando um slot/portal React como o padrão de slots existente; o editor continua controlando a anotação e seu autosave. Não se duplicou o título nem se criou navegação nova.

A segunda linha contém toggle, Diagnóstico e Intensidade. O novo seletor usa os mesmos estilos, altura, borda, cor e tipografia dos controles existentes. Apenas larguras/gaps indispensáveis foram ajustados nessa linha para 320/390 px. Campo não preenchido mostra Selecionar…; não há intensidade padrão.

Não foram modificados painel financeiro, Mapa circular, lista de peças, Copiloto, swipe, conteúdos das linhas ou ações comerciais. Os testes antigos foram adaptados para localizar Anotações na nova linha e para reconhecer a coluna/schema adicionados; as verificações dos campos antigos continuam comparando seus valores integrais.

## Arquivos/módulos

| Arquivos | Justificativa |
| --- | --- |
| `shared/commercial.ts` | Enum/tipos de intensidade e retorno de recomendação; leitura histórica opcional |
| `server/migrations.ts` | V9 aditiva |
| `server/commercial.ts`, `src/calculation-state.ts` | Leitura/gravação e assinaturas do autosave/reconciliação |
| `src/DiagnosisEditor.tsx`, `src/diagnosis-editor.css` | Intensidade e organização autorizada das duas linhas |
| `src/App.tsx`, `src/CommercialPanel.tsx` | Slot da anotação no cabeçalho contextual existente |
| `server/diagnosis-recommendations.ts`, `server/import-recommendations.ts` | Plano/validação/transação/consulta e CLI explícito |
| `server/app.ts` | GET autenticado; sem endpoint de escrita para regras |
| `server/coda-import.ts`, `server/import-coda.ts` | Compatibilidade V8/V9; restante da importação comercial preservado |
| `server/tests/*`, fixtures, `tests/browser/*` | Upgrade V8 real sintético, API, importação, regressões e responsividade |
| `docs/API.md`, `AGENTS.md`, este relatório/evidências | Contrato vigente, dependência da fonte e reprodução |

## Matriz dos 20 critérios

| Critério | Situação/evidência |
| --- | --- |
| 1–2 Opções e ausência inicial | Aprovado no backend e nos três viewports |
| 3 Reload/reinício | Aprovado, banco de arquivo e API reiniciada |
| 4–5 Mestre compartilhado/flags independentes | Aprovado, dois cenários com máscaras distintas |
| 6–8 Preservação de serviços, diagnóstico, observações e componentes | Aprovado por comparação de IDs/atributos/valores |
| 9 Autosave sem duplicidade | Aprovado, uma gravação por escolha confirmada e últimas intenções durante resposta atrasada |
| 10 Resposta perdida/concorrência | Aprovado, leitura antes de repetição e recuperação explícita sem sobrescrita |
| 11 IDs da fonte | Validação implementada/testada sinteticamente; **IDs do arquivo real bloqueados por ausência da fonte** |
| 12 Importação idempotente | Aprovado com fixtures; carga real não executada |
| 13 Dezesseis false preservados | Aprovado com 16 regras explicitamente sintéticas; **as 16 reais ainda não conferidas** |
| 14 Três divergências | Aprovado mecanismo com três vínculos sintéticos incompatíveis; **os três registros reais dependem do arquivo** |
| 15 Recusa de vínculo incorreto | Aprovado: pendente/não consultável, sem substituir dimensão |
| 16 Consulta por diagnóstico/intensidade | Aprovado em função e API autenticada, incluindo false |
| 17 Nenhuma inclusão automática | Aprovado: sem mudança nas linhas e sem UI de sugestões |
| 18 Fases 1 e 2 | Regressões executadas; resultados finais nas evidências |
| 19 Histórico/PDF | Aprovado, snapshots e bytes antes/depois/reinício/migração |
| 20 Cabeçalho responsivo | Aprovado com medidas, screenshots 1440/390/320 e ausência de sobreposição/overflow |

## Testes e evidências

- `npm run check`: build/Vite, TypeScript frontend/backend e **217 testes Node aprovados**. Lint sem erros/avisos novos, com quatro advertências preexistentes em efeitos de `App.tsx`.
- `python -m unittest discover -s deploy/tests`: **23 aprovados**; `bash -n` dos quatro scripts versionados: aprovado.
- `python tests/browser/fase3_diagnosis.py`: **27 grupos aprovados** em 1440/390/320; inclui teclado, limpeza explícita, medidas geométricas, concorrência e resposta perdida.
- `python tests/browser/fase3_regressions.py`: **280 grupos aprovados em 18 suítes**, incluindo Fases 1/2 e todas as regressões anteriores. A execução foi retomada em `etapa_b_navigation` após corrigir um seletor de teste do botão Anotações agora localizado no cabeçalho; os resultados finais foram conferidos individualmente. A suíte `etapa3_editor` foi repetida após o ajuste final da tipografia original no cabeçalho.
- Total navegador: **307 grupos**, mobile emulado em Chromium. Não é teste em dispositivo físico nem homologação na VPS.
- `importacao-sintetica.json`: fixture de seis regras, três coerentes e três pendentes por vínculo incorreto; segunda carga com zero inserções. Teste independente preserva e consulta **16 regras false inteiramente sintéticas**, sem gerar serviços.

Resultados/logs/screenshot e matriz agregada em `docs/evidencias/fase3/`; `fonte-pendente.json` distingue as contagens informadas das relações reais não verificadas. Nenhuma fonte privada ou banco é versionado. Smoke tests de imagens Docker/Compose serão executados pela CI existente do PR; não foram alterados workflows nem executado deploy.

## Procedimento futuro de carga — não executado

**Pré-condições obrigatórias:** auditoria/aprovação/publicação separadas; API desta entrega e SQLite V9; arquivo original disponibilizado em canal privado, SHA conferido e contrato/IDs validados. Se o JSON real divergir do contrato documentado, parar e adaptar/testar a leitura antes de qualquer carga. Não renomear campos ou reatribuir referências por aproximação.

1. Disponibilizar o arquivo aprovado em `/var/lib/funix/app-data/funix-fase3-regras-coda.json`, por canal privado, proprietário UID/GID 1000 e modo 0600 para acesso do contêiner, sem Git/servidor público. Esse diretório já corresponde a `/data`; não adicionar volume nem serviço.
2. No terminal administrativo autorizado, executar **dry-run**:

```bash
sudo docker compose --project-name funixapp \
  --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml \
  exec -T api node server/import-recommendations.ts \
  --source /data/funix-fase3-regras-coda.json --database /data/funix.sqlite
```

3. Revisar SHA do arquivo, IDs, contagens, `pending`, `conflicts` e `planHash`. Expectativa informada pela direção: 77 relações/61 true/16 false, sendo 74 coerentes e três vínculos de Desalinhamento pendentes; **não é resultado comprovado desta execução**. Qualquer divergência inesperada, referência ausente ou conflito: interromper. Pendências não podem ser convertidas em sugestões válidas por aproximação.
4. Somente após autorização da carga e validação do relatório, repetir o mesmo comando com o hash efetivo:

```bash
sudo docker compose --project-name funixapp \
  --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml \
  exec -T api node server/import-recommendations.ts \
  --source /data/funix-fase3-regras-coda.json --database /data/funix.sqlite \
  --confirm-plan HASH_DO_DRY_RUN_EFETIVO
```

5. Repetir o dry-run: nenhuma inserção/duplicação nova. Conferir consulta autenticada no app/API, incluindo relações false e ausência das pendentes. Selecionar diagnóstico/intensidade ainda **não** adiciona serviços nesta fase. Não se executa importação comercial completa para isso; catálogo ausente é conflito a tratar separadamente.

O CLI não migra, cria banco, troca permissões, reinicia contêineres ou altera arquivos fonte. As instruções acima são futuras, não autorização ou execução produtiva nesta tarefa.

## Pendências reais

A única dependência de dados desta entrega é o arquivo original de regras e a conferência de seu formato/77 relações. Não há preço, dimensão alternativa, intensidade ou regra comercial a inferir. Fases 4 e 5 permanecem fora de escopo. Parar no PR para auditoria; sem merge/deploy.
