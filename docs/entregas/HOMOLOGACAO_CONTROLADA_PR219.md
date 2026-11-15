# PR #219 — homologação controlada em desenvolvimento

Base técnica: `85dae9a`, já revisada, com dez workflows aprovados. Este incremento prepara homologação e exercita somente recursos locais/sintéticos; não repete a auditoria. Experiência V7/V10, backend comercial e migração permanecem inalterados. Novos arquivos: verificador offline `scripts/verify-v18-copy.ts` e ensaio `server/tests/customer-homologation.test.ts`.

## Situação e recursos

| Etapa | Recurso disponível | Situação nesta execução |
|---|---|---|
| Backup V17, migração V18, falha, retomada e restauração | SQLite temporário sintético, inclusive WAL e PDF gerado com renderer de teste | Executada |
| Inbound, snapshot, concorrência, PN/LID, nomes, foto e segurança de envio | Fixtures, HMAC e transportes mock existentes | Executada localmente; não prova o contrato instalado |
| Troca de Contatos, seleção N:N, rascunhos e envio confirmado | Chromium local, três viewports, remetente mock | Executada; não equivale a aparelho físico |
| Migração sobre cópia de desenvolvimento representativa | Nenhum arquivo/caminho de cópia autorizado foi fornecido | Preparada, não executada |
| Recepção, nomes e foto pela Evolution instalada | Sem sessão/configuração de homologação autorizada nesta tarefa | Preparada, não executada |
| Android Chrome / iOS Safari reais e WhatsApp controlado | Nenhum aparelho, número ou janela de teste autorizado | Preparada, não executada |

| Verificação local executada | Resultado |
|---|---|
| Servidor direcionado: migração/backup, inbound/snapshot/concorrência, aliases, HTTP, ingestão, gates e envio mock | 47 testes passaram, zero falhas |
| Ensaio V18 final após acrescentar falha DDL no clone | Dois testes novos passaram novamente; contidos nos 47 cenários, não 49 testes distintos |
| `npm run check:server` e `npm run lint` | Exit 0; warnings existentes preservados, sem warning dos novos arquivos |
| `node scripts/customer-experience-browser.mjs` | Exit 0 em 320/390/1440: troca de Contato, seleção, rascunho preservado após placa, novo compositor vazio e confirmação com mock |
| `python3 tests/browser/chat_v20_conversations.py` | Exit 0 em 320/390/1440: contexto/histórico, polling, mídia e remetente sintéticos |
| `python3 tests/browser/chat_v20_links.py` | Exit 0 em 320/390/1440: N:N, seleção, conflitos e desvinculação confirmada |
| Blocos Bash documentados, em outra origem exclusivamente sintética | Exit 0: backup/hash, V17→V18, preservação em 28 tabelas e recuperação para arquivo novo V17 |
| `git diff --check` | Passou |

Evidências desta rodada: [manifesto](../evidencias/homologacao-pr219/resultados.json) e [comparação de preservação sintética](../evidencias/homologacao-pr219/preservacao-sintetica.json). Resultados da revisão anterior continuam no [relatório técnico](REVISAO_FINAL_PR219.md); não são apresentados como novas execuções locais. PDF, motor financeiro, Mapa e build completo não foram repetidos localmente neste incremento, pois não houve alteração de produto. A integração contínua executa os workflows existentes após o envio; seu resultado terminal para o commit novo será informado na entrega.

## Procedimento para uma cópia autorizada de desenvolvimento

**Ainda não executado com cópia representativa.** O responsável deve identificar o arquivo, proveniência, versão e autorização para sua utilização. Uma cópia de produção contendo dados reais também exige autorização específica para esses dados; a palavra “cópia” não concede permissão. Preferir conjunto sintético/anonimizado aprovado. Nenhum comando abaixo aponta para o banco instalado.

1. Registrar SHA do código, Node 24/npm 11, responsável, origem autorizada, classificação dos dados e diretório de evidências com acesso restrito. Manter a cópia de desenvolvimento sem escritores durante o ensaio. Não iniciar API, workers, importadores ou replay antes da comparação. Não interromper serviços produtivos para este roteiro.
2. Usar caminhos absolutos explícitos. Nunca abrir a origem com `openDatabase`: essa função migra automaticamente. O CLI `server/backup.ts` abre a origem somente para leitura e usa a API SQLite de backup, incluindo dados confirmados em WAL. Não copiar apenas o arquivo principal com `cp` enquanto houver WAL ativo.
3. Criar **backup anterior imutável** e um segundo arquivo de trabalho. O exemplo abaixo é para Bash/Linux e usa diretamente Node, sem carregar `.env` ou credenciais. Substituir o caminho da cópia somente após a autorização; o placeholder não é um destino real.

```bash
set -euo pipefail
umask 077
mkdir -p .runtime
qa_dir="$(mktemp -d "$PWD/.runtime/homolog219.XXXXXX")"
qa_copy='/CAMINHO/DA/COPIA-DEV-AUTORIZADA.sqlite'
env -i PATH="$PATH" FUNIX_DATABASE_PATH="$qa_copy" node server/backup.ts "$qa_dir/pre.sqlite"
sha256sum "$qa_dir/pre.sqlite" > "$qa_dir/pre.sha256"
env -i PATH="$PATH" FUNIX_DATABASE_PATH="$qa_dir/pre.sqlite" node server/backup.ts "$qa_dir/trabalho.sqlite"
```

4. Conferir versão e integridade do backup, **sem startup da aplicação**. Exigir histórico contíguo e `integrity_check=ok`, zero violações de FK. Versão 17 exercita upgrade; versão 18 exercita reinício/idempotência. Outra versão exige plano específico; nunca usar o helper de downgrade de fixtures sobre a cópia.

```bash
env -i PATH="$PATH" node --input-type=module - "$qa_dir/pre.sqlite" <<'JS'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
const db=new DatabaseSync(process.argv[2],{readOnly:true})
try {
  const versions=db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>r.version)
  assert(versions.every((v,i)=>v===i+1)&&[17,18].includes(versions.length))
  assert(db.prepare('PRAGMA integrity_check').all().every(r=>r.integrity_check==='ok'))
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  console.log(JSON.stringify({version:versions.length,integrity:true,foreignKeys:true}))
} finally {db.close()}
JS
```

5. Migrar **somente o arquivo de trabalho**, em processo offline; comparar antes de receber eventos ou editar fichas. O comando abaixo usa apenas a migração existente e não inicia HTTP ou transportes.

```bash
env -i PATH="$PATH" node --input-type=module - "$qa_dir/trabalho.sqlite" <<'JS'
import {openDatabase} from './server/database.ts'
const db=openDatabase(process.argv[2]);db.close()
JS
env -i PATH="$PATH" node scripts/verify-v18-copy.ts "$qa_dir/pre.sqlite" "$qa_dir/trabalho.sqlite" > "$qa_dir/preservacao.json"
sha256sum -c "$qa_dir/pre.sha256"
```

6. O verificador retorna exit 0 somente para V17/V18 → V18, arquivos distintos, histórico contíguo, integridade/FKs válidas e preservação de todas as linhas/colunas anteriores, incluindo UUIDs, referências antigas, mensagens, snapshots e bytes de PDF. Compara hashes de linhas em memória e contagens, sem emitir conteúdo pessoal. Na V17 permite adições apenas no histórico de migrações e nas tabelas técnicas promovidas pela V18; permite avanço de `v20_conversations.revision`. Não permite cadastro comercial, snapshot inicial, leituras ou encerramentos retroativos pela migração. Na V18 exige preservação integral das tabelas existentes. Não altera os arquivos nem importa serviços da aplicação.
7. Inspecionar separadamente os vínculos promovidos: cada `chat_links` ativo deve corresponder à mesma conversa/Atendimento na projeção N:N; históricos encerrados e `chat_messages.link_id` permanecem. Vínculos locais previamente confirmados e conflitos pendentes devem conservar sua origem. Handles incompatíveis devem bloquear/ficar pendentes, nunca ser corrigidos por nome, foto ou telefone semelhante. O verificador não certifica a semântica de novos vínculos, capacidades externas ou volume/desempenho de uma base representativa. Qualquer divergência técnica não prevista exige análise, sem ignorar o erro para aprovar o ensaio.
8. Reabrir o trabalho com o mesmo comando offline, fechá-lo e repetir a comparação. Não pode haver nova ficha, novo vínculo ou alteração de PDF. Só depois, em cópia de trabalho separada, iniciar QA funcional com armazenamento/autoridade local e integrações externas desligadas. Registrar contagens antes/depois de cada evento sintético, snapshot inicial, decisão e identificadores; não publicar dados pessoais em Git/PR.

### Falha e recuperação

- Se a migração ou comparação falhar, interromper esse ensaio, fechar todos os processos da cópia e preservar o arquivo de trabalho com seus eventuais WAL/SHM para análise. Não executar DDL de correção, apagar tabelas, editar `schema_migrations` ou reaplicar eventos por tentativa.
- Validar o hash e integridade do backup anterior. Restaurar para **um caminho novo**, evitando sobrescrever um banco aberto ou combinar o principal com WAL/SHM antigos:

```bash
env -i PATH="$PATH" FUNIX_DATABASE_PATH="$qa_dir/pre.sqlite" node server/backup.ts "$qa_dir/recuperacao.sqlite"
```

- Repetir a verificação somente leitura do passo 4 sobre `recuperacao.sqlite`. Com backup V17, deve continuar V17, com UUIDs, mensagens, PDFs e vínculos anteriores. Não abrir a recuperação com o binário novo para “conferir a V17”: ele a migraria. Rollback de binário requer backup compatível com aquele binário; não há downmigration operacional V18.
- Escritas posteriores ao backup não são recuperadas por essa restauração. Arquivá-las para avaliação e não tentar uma fusão automática. Esta restauração é do ensaio DEV; restauração operacional/deploy exige plano e autorização próprios.

O teste novo executa este ciclo com arquivos sintéticos: fonte V17 com WAL e orçamento emitido; backup pelo CLI existente; colisão DDL proposital só no clone; rollback atômico da V18; remoção apenas da falha injetada; upgrade/reabertura; preservação dos dados; inbound repetido após reinício reutilizando ficha; recuperação para arquivo novo V17. Não aplica a injeção de falha ou o helper de fixtures a qualquer dado externo.

## Integração Evolution — roteiro preparado, não executado

Antes de operações reais, aprovar separadamente ambiente DEV de destino, instância/número controlado, participantes, janela, operações de leitura/foto/inbound/envio permitidas, retenção de evidências e responsável. Confirmar versão/capacidades instaladas sem modificar Evolution. Se o roteamento existente só entrega em produção, **a etapa fica pendente**; este roteiro não autoriza mudar webhook, criar instância, conectar telefone, espelhar tráfego real ou reprocessar histórico.

Usar sessão de operador e origem DEV autorizada. Credenciais ficam somente no backend/arquivo de ingestão com permissão 0600, nunca no navegador, URL, screenshot ou Git. O caminho recebido continua sendo o contrato autenticado `POST /api/integrations/whatsapp/events`, via envelope/relay suportado pelo app; não presumir que um webhook nativo arbitrário é compatível. Validar esse contrato e o roteamento antes de qualquer mensagem controlada.

Flags para revisão pelo responsável, sem alterá-las na instalação: `FUNIX_CHAT_AUTONOMOUS_ENABLED`, `FUNIX_CHAT_LOCAL_ENABLED`, `FUNIX_CHAT_LOCAL_READ_ENABLED`; ingestão por `FUNIX_WHATSAPP_INGEST_ENABLED`/`FUNIX_WHATSAPP_INGEST_CONFIG_FILE`; leitura por `FUNIX_EVOLUTION_READ_ENABLED` e credenciais server-side existentes. **Leitura também pode consultar nomes/fotos**: requer autorização própria. Envio e mídia (`FUNIX_EVOLUTION_SEND_ENABLED`/`FUNIX_EVOLUTION_MEDIA_ENABLED`) ficam OFF até autorização específica. Nunca herdar `.env` instalado para executar fixtures.

| Caso | Ação futura / resultado exigido | Evidência mínima |
|---|---|---|
| E01 — PN novo | Uma mensagem controlada pelo caminho autorizado: mensagem persistida e uma ficha/Contato, PN confiável e nome inicial; nenhum envio automático | Recibo 202, decisão `created`, contagens e snapshot sanitizados |
| E02 — retry/concorrência | Em DEV autorizado, repetir o mesmo evento com autenticação válida; mesma identidade/evento, sem inventar nova mensagem | Mesmo recibo; uma ficha, uma mensagem por ID e uma inicialização |
| E03 — preenchimento único | Editar nome/telefone na ficha, alterar nome no canal e receber outra mensagem | Snapshot original e campos do vendedor preservados |
| E04 — LID sem PN | Mensagem cuja origem real só ofereça LID; não fabricar essa condição no canal instalado | Mensagem/ficha parcial, telefone vazio, envio bloqueado sem PN confiável |
| E05 — confirmação PN/LID | Evidência exata fornecida pelo canal; abrir pelos dois identificadores | Uma conversa pública, mesmo telefone técnico, histórico/prévia/não lidas e apelido; sem terceira ficha ou fusão comercial |
| E06 — leitura por alias | Ler pelo alias confirmado e retornar à lista/outro alias | Não lidas coerentes, horário da última mensagem e histórico preservados |
| E07 — nomes/terceiros | Maria fala sobre Pedro; selecionar explicitamente Entidade de Pedro; definir/remover apelido do Contato | Apelido tem precedência; sem apelido aparecem nomes distintos, selos individuais só nas associações explícitas; selo não prova identidade |
| E08 — conflito/ambiguidade | Manter casos contraditórios em fixtures/DEV isolado; não adulterar identidade instalada para forçar conflito | Mensagem preservada; leitura/mídia/envio recusados, sem telefone inferido ou seleção automática |
| E09 — múltiplos vínculos | Associar dois Atendimentos e selecionar um explicitamente; depois trocar/remover Contato | Histórico pertence ao canal; contexto/token anterior revogado; retomada exige seleção explícita |
| E10 — encerrado/ativo | Receber com um ativo inequívoco e depois em caso encerrado | Reutiliza o ativo; não reabre encerrado nem cria ciclo automaticamente |
| E11 — fotos | Consultar foto autorizada, ausência, privacidade e repetição com cache; demais falhas por mock | Foto ou avatar de fallback; sem credenciais/URL privada no cliente; versão/host/formato suportado registrados |
| E12 — autenticação | HMAC inválido, instância fora da allowlist e corpo inválido somente contra DEV com fixtures | Recusa, zero mensagem/ficha nova; cookie do operador não substitui HMAC |
| E13 — resposta/entrega | Só com autorização de envio: cancelar confirmação, depois enviar uma mensagem controlada e observar entrega/resposta | Cancelar produz zero envio; confirmar produz um recibo; distinguir aceito, entregue e respondido de identidade civil |

Payloads/casos de referência: [ingestão autenticada](../../server/tests/chat-ingest.test.ts), [inbound autônomo](../../server/tests/customer-inbound.test.ts), [aliases/Contatos](../../server/tests/customer-alias-review.test.ts) e [foto com cache/fallback](../../server/tests/customer-http.test.ts). São fixtures; não trazem credenciais ou mensagens da instalação.

Replays de mensagens reais, mesmo para DEV, exigem autorização expressa para essa operação. Se PN/LID/foto não puderem ser obtidos com segurança pelo canal instalado, registrar “não exercitado”, mantendo a cobertura sintética e a pendência; não substituir evidência real por um payload fabricado.

## Aparelhos reais — roteiro preparado, não executado

Pré-condições: aparelho/OS/navegador e escala de fonte registrados; acesso a endpoint **DEV** já autorizado, com autenticação e HTTPS quando necessário para mídia/microfone; sem expor porta pública, criar túnel ou usar a aplicação produtiva para representar esta branch. Sem endpoint/aparelho disponível, a etapa permanece pendente. Começar com base e remetente sintéticos; autorizar WhatsApp real em etapa separada.

| Caso | Passos no aparelho | Resultado esperado |
|---|---|---|
| A01 — navegação V7/V10 | Android Chrome e iOS Safari; retrato/paisagem; Funil/Conversas e Chat/Diagnóstico/Mapa | Lanes horizontais, nomes numa linha/detalhes completos, telefone e contadores legíveis; sem aba Dados, colisões ou controles inacessíveis |
| A02 — teclado/toque | Abrir edição, preencher nome parcial, telefone, veículo, placa e dois anos; teclado aberto, zoom de texto e safe-area | Foco/rolagem corretos, salvar/fechar acessíveis, cadastro progressivo sem Entidade obrigatória |
| A03 — referência reconhecida | Digitar sugestão, selecionar registro, abrir lápis e trocar seleção | Linha reconhecida bloqueada; ficha compartilhada explícita; sem associação automática por nome |
| A04 — rascunho do Chat | Digitar mensagem sem enviar; editar só placa/notas/pagador, aguardar autosave, fechar edição | Mensagem digitada preservada; nenhum envio e relógio comercial inalterado |
| A05 — troca de Contato | Com rascunho no Chat, trocar/remover Contato e salvar; selecionar a nova conversa | Compositor/contexto antigos limpos; rascunho não migra ao destinatário novo; histórico anterior preservado; nova leitura somente por seleção explícita |
| A06 — N:N e retorno | Selecionar entre dois contatos/Atendimentos, A→B→A; desvincular com confirmação e motivo | Sem mistura de mensagens; comandos antigos recusados; desvínculo auditável sem apagar mensagens |
| A07 — falha de autosave | Em DEV simular rede perdida/409; voltar ao formulário e recuperar explicitamente | Dados de ficha preservados, estado de erro verdadeiro, sem retry cego ou gravação fictícia |
| A08 — envio confirmado | Com mock primeiro; WhatsApp real somente após autorização: cancelar, confirmar uma vez, observar ACK/resposta | Cancelamento não envia; recibo único; falha incerta não vira reenvio automático |
| A09 — gestos/retorno | Swipe entre abas, toque no Mapa, fechar diálogo, voltar do navegador e reautenticar | Sem gesto vertical interpretado como troca; edições pendentes da ficha protegidas pelos avisos existentes; sessão expirada não exibe conteúdo privado |
| A10 — regressão comercial | Diagnóstico, Mapa, cenários alternativos e prévia de orçamento sintético | Composição persistida, faixa mínima–máxima sem somar cenários; PDF existente preservado |

Os 320/390/1440 px executados nesta rodada são viewports Chromium; registrar a largura real de cada aparelho sem declarar equivalência com essas emulações. O plano não promete persistência de rascunho de mensagem após recarga completa/fechamento do navegador; a garantia exercitada é a edição da ficha já salva sem troca de destinatário.

## Critérios de avanço e próximas ações

1. Revisar esta documentação e o resultado do CI da nova SHA, mantendo PR aberta, sem merge/deploy.
2. Disponibilizar e autorizar explicitamente uma cópia DEV representativa (ou confirmar que apenas dados sintéticos serão utilizados); executar o procedimento offline e guardar backup/verificação restritos. Sem esse recurso, escala e conflitos da base instalada seguem não homologados.
3. Autorizar a consulta/recepção no canal controlado e confirmar o roteamento já existente para DEV, sem tocar a instalação nesta tarefa. Executar E01–E12 conforme capacidades reais, registrando casos não exercitados.
4. Disponibilizar aparelhos/endpoint DEV e executar A01–A10 com mock. Depois autorizar separadamente envio/mídia controlados e executar E13/A08 reais, se necessário.
5. Interromper a etapa ao detectar destinatário inesperado, histórico misturado, duplicação, sobrescrita de dados ou divergência de preservação. Corrigir somente defeito reproduzido em DEV com regressão antes de retomar. O aceite de homologação não equivale a autorização de implantação.

Nenhum defeito novo de produto foi comprovado nesta rodada. O risco restante está na representatividade da cópia, contrato/roteamento/capacidades da Evolution instalada e comportamento físico dos aparelhos. Não houve acesso ao banco produtivo, migração de dados reais, operação na Evolution instalada ou envio real de WhatsApp.
