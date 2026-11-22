# PR #220 — ensaio no runtime n8n real

Data: 14/11/2026. Continuação da mesma branch, sem desenvolvimento funcional do MVP.
Evidência agregada: [runtime-evidence.json](runtime-evidence.json).

## A. Resultado e alcance

Executados os nós reais DataTable 1.1, SplitInBatches 3, Code 2, Crypto 2,
HTTP Request 4.3, If 2.3 e Execute Workflow 1.4 no n8n **2.47.7**, Node 24.22.1.
Gmail foi substituído exclusivamente no laboratório por HTTP sintético. Fila,
HMAC, classificador, avisos e SQLite usam os módulos existentes do FunixApp.
Não foi criada outra fila. O DataTable e o encadeamento são os do runtime real.
Resultado final: **33 cenários passaram** na instância nova e descartável; rejeições
e interrupções esperadas contam como aprovação do comportamento verificado.
`npm run check` passou com 975 testes de servidor, 8 de custos/voz, build, tipos e lint.
Avisos preexistentes fora dos arquivos alterados permanecem. O lint isolado dos
arquivos desta entrega não apresentou avisos. Dois testes adicionais confirmaram
que o guard rejeita TCP e DNS lookup externos antes de efetuar a conexão.

| Área | Evidência |
|---|---|
| Busca e paginação | DataTable nativo retornou 1.303 registros, ultrapassando sua página interna de 1.000; ID fora dos 100 antigos foi localizado diretamente |
| Lotes e vinculação | 25 itens, 26 passagens no Loop (incluindo Done), processamento no ciclo seguinte e conferência individual ledger ↔ fila |
| Resultados distintos | Bloqueio, sucesso e falha Gmail no mesmo lote; nenhuma atualização cruzada; referências `.item`/`.first` e `pairedItem` executadas pelo n8n |
| Falhas de transporte | Antes/depois de enqueue, claim, classificação e ACK; recibos perdidos não inventam entrega nem duplicam aviso |
| Recuperação | Lease expirado, falha Gmail, falha de DataTable antes/depois do ACK, subworkflow ausente, interrupção no meio do lote e chamadas concorrentes |
| Decisão humana | Recusa registrada por operador sintético preservada após reentrega/conciliação; nenhum workflow decide pelo operador |
| Agendamento | Caminho horário original executado; timer real ensaiado com intervalo de 1 segundo exclusivamente na cópia descartável |
| Diagnóstico | Código persistido no ledger; resumo técnico no stdout real sem payload; retenção desligada verificada no banco n8n sintético |

O timer acelerado testa o mecanismo, não mede uma hora de operação. O intervalo
original de uma hora permanece no plano. A interrupção foi do workflow; não se
afirma ensaio de pane do host. Reinício/arquivo/handles SQLite continuam cobertos
pelas regressões existentes, sem extrapolar para disponibilidade da VPS.

## B. Defeitos/limitações encontrados

1. **Alta — 401/403 eram bloqueio terminal de mensagem.** Erro de credencial não
   prova defeito no e-mail. Agora produz retry e marcador `INTEGRATION_AUTH_INTAKE`;
   o worker consulta o ledger antes do claim e pausa novos claims até intervenção.
   Seis ciclos posteriores foram ensaiados sem consumir novas tentativas.
2. **Alta — 404 do endpoint classificador também era terminal.** Não equivale a
   Gmail inexistente. Agora pausa por `INTEGRATION_ROUTE_INTAKE`, com a mesma
   intervenção explícita. Não se presume correção do conteúdo da mensagem.
3. **Média — desligar retenção não preserva custom metadata.** O runtime descarta
   esses metadados junto da execução; não são um registro durável nessas condições.
   Ledger e fila continuam sendo os registros duráveis. Resumos técnicos de stdout
   foram comprovados, mas sua habilitação produtiva é um gate separado abaixo.
4. **Média — falha de DataTable podia ficar sem diagnóstico técnico específico.**
   Adicionada checagem após a gravação, emitindo somente
   `LEDGER_UPDATE_UNCONFIRMED`. O alimentador continua o lote; no worker, erro após
   ACK interrompe com código fixo e a próxima conciliação usa `status`, sem reler Gmail.
5. **Publicação tem dependência real.** O n8n recusou ativar o alimentador da cópia
   enquanto o subworkflow não estava publicado. O ensaio e o plano passam a exigir
   worker antes de alimentador. Só versões da instância descartável foram publicadas.

Não foi encontrada divergência de associação de itens no plano ensaiado, inclusive
com erro/retorno vazio de Update. O simulador anterior não comprovava esse fato;
agora há execução nativa. Nenhum vazamento ou perda definitiva em produção foi inferido.

## C. Correções e contratos

Arquivos: `build-plan.mjs`, `intake-ack.cjs`, `receipt.cjs`, `select.cjs`, plano JSON,
teste de regressão existente e os quatro arquivos `runtime-*`/runner do laboratório.

- Gate de incidente usa **a coluna existente** `last_error_code`. Não há tabela,
  estado de fila, endpoint, migração ou segundo mecanismo de leasing novo.
- Atualização do alimentador compara também o código observado; uma resposta
  concorrente não pode apagar o incidente recém-registrado mantendo o mesmo estado.
- Classificação de erros: 400/422 → entrada inválida/revisão; 409 → conflito/revisão;
  401/403 → pausa de autenticação; 404 do classificador → pausa de rota;
  408/429/5xx → retry limitado/backoff; resposta incompleta → não confirma entrega.
- 404 de `queue/status` indica divergência ou rota incorreta, registrado como erro
  técnico; não cria item nem marca sucesso. Falha Gmail deixa o lease recuperável;
  erro de transporte não é interpretado como e-mail inexistente ou irrelevante.
- Resumos têm somente componente, código fixo, estado e ID da execução n8n.
  Nunca assunto, snippet, corpo, remetente, anexos, assinatura, chave ou token de lease.
- Nenhuma autorização comercial, decisão humana, fórmula ou snapshot foi alterado.

Liberação de pausa: corrigir/verificar a configuração por procedimento autorizado;
consultar fila/aviso e revisar os registros do incidente; limpar somente o marcador
de incidente aplicável no ledger e retomar. O laboratório realiza essa intervenção
em dados sintéticos. Não há reset de tentativas, apagamento ou retry ilimitado.

## D. Reprodução e isolamento

O pull da imagem oficial falhou por falta de espaço no armazenamento do Docker.
O runtime foi instalado em prefixo descartável fora do repositório. Não é serviço
permanente nem dependência nova do FunixApp. Namespace de rede adicional não estava
disponível (`uid_map` somente leitura); o isolamento usado é de processos, dados,
credenciais e destinos, não um container nem uma sandbox contra código malicioso.

O runner cria usuário, chaves e bancos sintéticos, preserva só variáveis selecionadas,
escuta em loopback e aplica `runtime-network-guard.cjs` aos processos n8n/runner.
O guard bloqueia conexões TCP e lookup DNS fora de loopback; tentativas de telemetria
do próprio n8n foram bloqueadas. Não há credencial ou endpoint produtivo nos grafos
convertidos. O driver recusa destinos que não sejam `127.0.0.1`.
O processo é encerrado por trap; os arquivos sintéticos permanecem para inspeção.

```bash
npm install --prefix /tmp/funix-n8n-runtime --cache /tmp/funix-n8n-cache \
  --no-audit --no-fund --omit=optional --legacy-peer-deps n8n@2.47.7
FUNIX_GMAIL_LAB_N8N=/tmp/funix-n8n-runtime/node_modules/n8n/bin/n8n \
  bash scripts/gmail-recovery/run-runtime-lab.sh
npm run check
```

O laboratório opt-in não é iniciado pela aplicação/CI normal. Não executar o driver
contra outra instância. O script só converte o plano para ensaio; não é publicador.
Resultados agregados não contêm payload de e-mail. Logs integrais do laboratório
contêm apenas dados sintéticos e não são versionados.

Compatibilidade: os tipos/versões dos nós usados coincidem com os grafos auditados;
a **versão exata do servidor ativo FUNIX não foi exposta pelo conector**. A aprovação
deste ensaio vale para 2.47.7. Antes de publicar, verificar versão instalada, runner e
política de logging; se divergirem, repetir o ensaio na versão correspondente.

## E. Riscos residuais e observabilidade

- A recuperação é horária. Não se promete SLA de um minuto em falhas.
- Há cinco tentativas no contrato existente. Um incidente detectado já na quinta,
  ou combinado com falha na gravação do marcador, ainda pode chegar a `blocked`.
  É identificável na fila/ledger; não há endpoint administrativo de reabertura.
  Uma reabertura auditável exigiria proposta/aprovação de contrato separada, não
  foi implementada nem substituída por SQL produtivo nesta tarefa.
- O gate não cancela workers que já obtiveram lease; eles continuam cercados pelo
  token, expiração e idempotência. O teste concorrente não representa carga ilimitada.
- Contagens de `overview`, `status`, tentativas/erros da fila e estado/código/
  `first_seen_at`/`last_checked_at` do ledger distinguem espera, lease, retry,
  conclusão, bloqueio, idade e divergência. Não foi criado dashboard novo.
- `CODE_ENABLE_STDOUT=true` foi usado **somente no laboratório**. É opção global:
  habilitá-la em produção sem revisar o que outros Code nodes imprimem pode expor
  conteúdo de outros fluxos. Precisa de aprovação após essa revisão ou de alternativa
  restrita. Não usar custom metadata descartável como substituto desse diagnóstico.
- Não foram ensaiadas credenciais Gmail/Evolution reais, VPS, Coda ou clientes.
  Nenhum resultado isolado substitui homologação com e-mail novo autorizado.

## F. Plano de publicação posterior — sujeito a aprovação

1. Conferir HEAD/CI da PR, versão n8n, runner, DataTable e os IDs/versões publicados
   do plano; interromper por divergência. Resolver o gate de diagnóstico acima.
2. Preservar grafos/versões anteriores e configuração privada, com acesso restrito.
   Não levar execuções, mensagens ou credenciais ao Git.
3. Após autorização específica, aplicar/publicar **worker primeiro**. Verificar
   DataTable, gate de incidente, HMAC e timer horário. O alimentador antigo continua
   compatível com esse worker; não alterar monitor ou integrações comerciais.
4. Aplicar/publicar alimentador; confirmar chamada ao worker e recuperação horária.
   Preservar corte histórico, exclusões, registros e decisões. Não resetar fila.
5. Homologar um e-mail novo controlado, enviado manualmente por pessoa autorizada:
   observar captura → ledger → fila → aviso/ignored → ACK → ledger; conferir ID e
   ausência de envio, criação comercial ou escrita ERP/Drive. Conservar evidência
   técnica mínima e não mudar autorização humana para validar o transporte.
6. Observar mais de um ciclo de recuperação, atrasos e incidentes. Não dar por
   concluído um percurso que terminou sem candidato/lease.
7. Em atualização cruzada, duplicidade, acesso indevido, aumento de bloqueios ou
   falha de HMAC/corte: suspender novos acionamentos conforme procedimento aprovado;
   voltar alimentador e depois worker às versões preservadas; verificar jobs/leases
   em andamento. Não apagar/restaurar bancos nem reprocessar histórico como rollback.

Esta etapa não autoriza esses passos operacionais. O desenvolvimento funcional do
MVP continua fora desta entrega; a homologação real e os gates residuais precedem
qualquer declaração de prontidão produtiva.
