# Fase 3 — intensidade do diagnóstico e dados de recomendação

Base: `main`/`0a7644b21293c64e95d459082c41b7dd3e4bebda`, com Fases 1 e 2 homologadas. Branch exclusiva: `feature/fase3-intensidade-recomendacoes`. Implementação/regressões com dados sintéticos; complementação posterior com relações e catálogos reais exclusivamente em SQLite V9 novo e isolado. Sem merge, deploy, VPS, SQLite instalado ou nova coleta Coda. Arquivos de origem privados foram somente lidos, nunca alterados ou versionados.

## Entrega e limite da fonte

A intensidade agora pertence ao diagnóstico mestre da peça e é persistida por autosave, compartilhada entre cenários. Leve/Moderado/Severo e null são os únicos valores. Habilitações continuam independentes por cenário. Alterar diagnóstico/intensidade não cria, remove nem altera serviços, dimensões, quantidades ou componentes.

Foi implementada a carga controlada de relações por IDs e a consulta autenticada somente leitura para a Fase 4. Não há aplicação automática/assistida nem nova lista de sugestões. A composição comercial só continua sendo alterada pelas ações já existentes do operador.

**A pendência de fonte da primeira entrega foi resolvida.** A direção forneceu `funix-fase3-regras-importacao-v9.json`, já convertido para o contrato `funix-diagnosis-recommendations-v1` e previamente conferido contra a exportação original. Nesta complementação, seu conteúdo foi validado pelo importador existente e pelas referências dos catálogos reais em um **SQLite V9 novo e isolado**, sem clientes ou Atendimentos. Nenhuma adaptação de código ou correção de origem foi necessária.

| Verificação real no banco isolado | Resultado observado |
| --- | --- |
| Arquivo de recomendações | 23.798 bytes; SHA-256 `bcc58f8242825cae68486a61b4cdb40751c80977f0c9c6a3424692a2490da8af` |
| Exportação comercial privada usada para os catálogos | SHA-256 `76698e523f4d497d417dcb0d9cccb19c635d412d0eba9337a63b01bf9717a35a` |
| Catálogos existentes antes da carga de recomendações | 163 peças, 28 serviços, 16 diagnósticos e 75 dimensões |
| Dry-run de recomendações | 77 relações: **74 válidas, três pendentes, 16 false, zero conflitos** |
| Aplicação do plano confirmado | 77 registros conservados: 74 valid / três pending; nenhuma referência corrigida |
| Consultas de repositório e API autenticada | 28 combinações diagnóstico + intensidade conferidas em cada camada; 74 relações únicas retornadas, incluindo as 16 false |
| Pendências oferecidas como válidas | **Zero**, nas duas camadas |
| Segundo dry-run | **Zero inserções, 77 inalteradas, zero conflitos**, mesmas 74 válidas/três pendentes/16 false |
| Integridade | SQLite `ok`, zero erros de FK, schema V9 |
| Preservação | Dry-run sem alteração de bytes/permissões do banco; todos os registros das demais tabelas inalterados após a carga; hashes dos dois arquivos de origem preservados |
| Atendimentos/cenários/orçamentos/linhas/componentes | Zero antes/depois; nenhuma composição foi criada ou alterada |

As três pendências são exatamente Desalinhamento → Alinhamento, com dimensões ainda vinculadas a Montagem:

| ID original da relação | Intensidade | Dimensão original (ID Coda) | Motivo |
| --- | --- | --- | --- |
| `i-9oEY4LbHDG` | leve | M — `i-PlG9A_vqDj` | `DIMENSION_SERVICE_MISMATCH` |
| `i-a2r0X9YsT1` | moderado | G — `i-KJmrRf6yDy` | `DIMENSION_SERVICE_MISMATCH` |
| `i-cSTVgKIpv3` | severo | GG — `i-vG6AqHxqTg` | `DIMENSION_SERVICE_MISMATCH` |

Diagnóstico: `coda:2zsjI-nqWr:grid-2ANpptuaKz:i-3vCNEjmS7V`. Serviço recomendado Alinhamento: `coda:2zsjI-nqWr:grid-lhdFxol6x-:i-6tWzUWof8c`. Serviço ao qual as dimensões pertencem, Montagem: `coda:2zsjI-nqWr:grid-lhdFxol6x-:i-vmJ3Org23i`. Os IDs completos das dimensões/relações e as evidências agregadas estão em `docs/evidencias/fase3/validacao-fonte-real.json`.

**Não houve divergência adicional.** Os três vínculos permanecem pendentes, rastreáveis e fora da consulta, sem associação por nome, troca de dimensão ou alteração do catálogo. Validade estrutural das demais 74 relações não dispensa a curadoria operacional nem a configuração técnica/comercial necessária na futura Fase 4.

A exportação comercial, o anexo original, o SQLite e os logs privados com dados comerciais não foram versionados. O relatório público contém somente hashes, contagens e os IDs das três pendências. A carga ocorreu exclusivamente na cópia isolada, nunca na VPS.

## Persistência e migração

Migração incremental **V8 → V9**, na transação existente de migrações:

- Acrescenta `diagnosis_items.intensity` nullable, com CHECK do enum, sem valores presumidos nos registros anteriores.
- Acrescenta `diagnosis_recommendations`, FKs para catálogo, unicidade de origem e da combinação diagnóstico/intensidade/serviço/dimensão, boolean de seleção padrão, status e motivo de pendência.
- Preserva registros/IDs/flags/configurações financeiras, MR percentual, serviços/componentes e snapshots/PDFs existentes.
- Falha na migração reverte também a coluna acrescentada; teste inicia de SQL V8 congelado com orçamento/PDF e compara os registros antes/depois/reinício.

A intensidade integra assinaturas de edição/reconciliação e o PATCH auditado do editor; revisão otimista continua obrigatória. Omitir preserva; null limpa. Snapshots antigos sem intensidade permanecem legíveis; novas emissões podem guardá-la na composição congelada. Motor de cálculo e template de PDF não foram modificados.

O importador comercial existente foi apenas revisado para aceitar V8/V9 com sequência de migrações contínua, sem migrar alvo ou tocar recomendações. Sua versão antiga recusa V9 pelo guard V8 anterior. Não há novo importador de preços, cadastros duplicados ou alterações de fórmulas. A recuperação para imagem V8 exige banco V8 compatível; não iniciar API antiga sobre V9.

## Regras e consulta

Contrato normalizado explícito em `docs/API.md`, conferido contra o arquivo convertido fornecido pela direção. Usa o mesmo `sourceId`/documento/tabelas do importador comercial. IDs do diagnóstico, serviço e dimensão precisam existir com tipos corretos; dimensão deve pertencer ao serviço. Nome, semelhança textual ou preço nunca são chaves de associação.

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
| 11 IDs da fonte | Aprovado: 77 IDs de relações e referências reais validados contra os catálogos importados |
| 12 Importação idempotente | Aprovado com fixtures e fonte real em SQLite isolado; segundo dry-run com zero inserções e 77 inalteradas |
| 13 Dezesseis false preservados | Aprovado com fixtures e as 16 regras reais false, todas conservadas e retornadas nas consultas |
| 14 Três divergências | Aprovado com os três IDs reais acima: pending e jamais oferecidos como válidos |
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

Resultados/logs/screenshot e matriz agregada em `docs/evidencias/fase3/`; `fonte-validada.json` e `validacao-fonte-real.json` registram a validação posterior das relações reais, separada das suítes sintéticas. Nenhuma fonte privada ou banco é versionado. Smoke tests de imagens Docker/Compose serão executados pela CI existente do PR; não foram alterados workflows nem executado deploy.

## Procedimento futuro de carga — não executado

**Pré-condições obrigatórias:** auditoria/aprovação/publicação separadas; API desta entrega e SQLite V9; arquivo validado disponibilizado em canal privado com o SHA-256 acima. A validação isolada não autoriza carga na VPS. Não renomear campos ou reatribuir referências por aproximação. O destino efetivo exige seu próprio dry-run e hash; o hash do ensaio isolado não deve ser reutilizado.

1. Disponibilizar o arquivo aprovado em `/var/lib/funix/app-data/funix-fase3-regras-importacao-v9.json`, por canal privado, proprietário UID/GID 1000 e modo 0600 para acesso do contêiner, sem Git/servidor público. Esse diretório já corresponde a `/data`; não adicionar volume nem serviço.
2. No terminal administrativo autorizado, executar **dry-run**:

```bash
sudo docker compose --project-name funixapp \
  --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml \
  exec -T api node server/import-recommendations.ts \
  --source /data/funix-fase3-regras-importacao-v9.json --database /data/funix.sqlite
```

3. Revisar SHA do arquivo, IDs, contagens, `pending`, `conflicts` e `planHash`. Resultado comprovado na cópia isolada: 77 relações/61 true/16 false, sendo 74 válidas e os três vínculos de Desalinhamento pendentes. Esses resultados devem ser novamente conferidos no destino efetivo antes de qualquer carga. Qualquer divergência inesperada, referência ausente ou conflito: interromper. Pendências não podem ser convertidas em sugestões válidas por aproximação.
4. Somente após autorização da carga e validação do relatório, repetir o mesmo comando com o hash efetivo:

```bash
sudo docker compose --project-name funixapp \
  --env-file /var/lib/funix/current.env -f /opt/funix/compose.yaml \
  exec -T api node server/import-recommendations.ts \
  --source /data/funix-fase3-regras-importacao-v9.json --database /data/funix.sqlite \
  --confirm-plan HASH_DO_DRY_RUN_EFETIVO
```

5. Repetir o dry-run: nenhuma inserção/duplicação nova. Conferir consulta autenticada no app/API, incluindo relações false e ausência das pendentes. Selecionar diagnóstico/intensidade ainda **não** adiciona serviços nesta fase. Não se executa importação comercial completa para isso; catálogo ausente é conflito a tratar separadamente.

O CLI não migra, cria banco, troca permissões, reinicia contêineres ou altera arquivos fonte. As instruções acima são futuras, não autorização ou execução produtiva nesta tarefa.

## Pendências reais

A pendência de acesso/validação das 77 relações foi resolvida sem alterar o código funcional. Permanecem os três vínculos incompatíveis identificados, que exigem decisão de origem posterior antes de se tornarem recomendações válidas; não impedem a preparação das outras 74. Não há preço, dimensão alternativa ou regra comercial a inferir. Publicação e carga na VPS continuam sem autorização nesta tarefa. Fases 4 e 5 permanecem fora de escopo; aguardar auditoria do mesmo PR #35, sem merge/deploy.

## Complementação de validação — reprodução

Código funcional utilizado: `ed18900764a229fbbf922a7be87d640ec37c9447`, inalterado. Banco novo em diretório privado `.runtime/fase3-validacao-real-*`, modo 0600/diretório 0700, schema V9 criado pela aplicação. A exportação comercial privada de hash conhecido foi lida pelo `server/import-coda.ts`: dry-run sem conflitos, seguido de aplicação **somente nesse banco isolado**, antes de validar as recomendações.

Foram executados os comandos reais abaixo com caminhos explícitos privados; stdout/stderr completos permanecem fora do Git:

```bash
node server/import-coda.ts --source EXPORTACAO_COMERCIAL_PRIVADA --database SQLITE_V9_ISOLADO
node server/import-coda.ts --source EXPORTACAO_COMERCIAL_PRIVADA --database SQLITE_V9_ISOLADO --confirm-plan HASH_COMERCIAL_ISOLADO
node server/import-recommendations.ts --source ARQUIVO_ANEXO_VALIDADO --database SQLITE_V9_ISOLADO
node server/import-recommendations.ts --source ARQUIVO_ANEXO_VALIDADO --database SQLITE_V9_ISOLADO --confirm-plan HASH_RECOMENDACOES_ISOLADO
node server/import-recommendations.ts --source ARQUIVO_ANEXO_VALIDADO --database SQLITE_V9_ISOLADO
```

Entre preparação/aplicação/leitura, foram conferidos hash/permissão do banco no dry-run, hashes dos arquivos originais e digest das demais tabelas. As consultas foram executadas com `DatabaseSync(...,{readOnly:true})` e pelo handler real autenticado (`GET /api/recomendacoes`), sem abrir porta ou contêiner: 28 grupos por camada, correspondência exata de IDs/serviço/dimensão/boolean, 74 retornos únicos e 16 false. GET sem sessão retorna 401; POST retorna 405. A API e as consultas não alteraram os bytes do SQLite.

Nenhum código, interface, cálculo ou regra foi modificado nesta complementação. Os 217 testes Node, 23 de implantação e 307 grupos de navegador da entrega anterior permanecem como evidência do código inalterado; a nova evidência é a validação real isolada descrita acima. A CI do commit documental será conferida no mesmo PR.
