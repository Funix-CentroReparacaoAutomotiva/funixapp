// Builds a LOCAL review plan only. No network, credentials, import or publication.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = new URL('../../', import.meta.url);
const baseline = JSON.parse(readFileSync(new URL('server/tests/fixtures/gmail-recovery/published-sanitized.json', root), 'utf8'));
const source = name => readFileSync(new URL(name + '.cjs', import.meta.url), 'utf8');
const feederId = 'kOOWQripUr9BNy29', workerId = 'KQ6qkUfdvz6PApmt';
const feeder = structuredClone(baseline[feederId]), worker = structuredClone(baseline[workerId]);
const node = (graph, name) => {
  const found = graph.nodes.find(n => n.name === name);
  if (!found) throw Error('BASELINE_NODE_MISSING');
  return found;
};
const link = name => ({node: name, type: 'main', index: 0});
node(feeder, 'Trava de publicacao (OFF)').parameters.jsCode = `const ENQUEUE_ENABLED=true;
if(!ENQUEUE_ENABLED)return [];
const src=$input.first()?.json??{};
const raw=src.message_id??src.messageId;
if(raw!==undefined&&!/^[a-f0-9]{15,25}$/i.test(String(raw)))throw Error('GMAIL_EVENT_ID_INVALID');
return [{json:{eventMessageId:raw===undefined?null:String(raw).toLowerCase()}}];`;
const lookup = node(feeder, 'Ler pendencias registradas');
// Native returnAll uses the node's pagination. Only the metadata ledger is read.
lookup.parameters = {...lookup.parameters, filters: {conditions: [
  {keyName: 'source', condition: 'eq', keyValue: 'gmail'},
  {keyName: "={{ $('Trava de publicacao (OFF)').first().json.eventMessageId ? 'message_id' : 'source' }}", condition: 'eq',
    keyValue: "={{ $('Trava de publicacao (OFF)').first().json.eventMessageId || 'gmail' }}"}
]}, returnAll: true};
delete lookup.parameters.limit;
node(feeder, 'Selecionar uma mensagem apos corte').parameters.jsCode = source('select');
feeder.nodes.push({id:'gmail-recovery-loop',name:'Processar mensagens individualmente',type:'n8n-nodes-base.splitInBatches',typeVersion:3,position:[850,0],parameters:{batchSize:1,options:{}}});
feeder.nodes.push({id:'gmail-recovery-prepare',name:'Preparar uma entrega ou conciliacao',type:'n8n-nodes-base.code',typeVersion:2,position:[900,0],parameters:{mode:'runOnceForAllItems',language:'javaScript',jsCode:source('prepare')}});
const http = node(feeder, 'Enfileirar ID (sem ler e-mail)');
http.parameters.url = "={{ 'https://app.funix.com.br/api/integrations/gmail/queue/' + $json.action }}";
http.onError = 'continueRegularOutput';
node(feeder, 'Conferir recibo do enqueue').parameters.jsCode = source('body-reader') + source('receipt');
const update = node(feeder, 'Marcar ledger apos recibo confirmado');
update.parameters.filters = {conditions:[
  {keyName:'message_id',condition:'eq',keyValue:'={{ $json.messageId }}'},
  {keyName:'state',condition:'eq',keyValue:'={{ $json.expectedState }}'}
]};
update.parameters.columns.value.last_error_code = '={{ $json.lastError }}';
update.onError = 'continueRegularOutput';
update.alwaysOutputData = true;
feeder.nodes.push({id:'gmail-recovery-wake',name:'Fila ainda requer worker',type:'n8n-nodes-base.if',typeVersion:2.3,position:[1800,0],parameters:{conditions:{combinator:'and',options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{leftValue:"={{ $('Conferir recibo do enqueue').item.json.wakeWorker }}",rightValue:true,operator:{type:'boolean',operation:'equals'}}]},options:{}}});
const wake = node(feeder, 'Acionar worker por mensagem enfileirada');
wake.onError = 'continueRegularOutput';
wake.alwaysOutputData = true;
feeder.connections['Selecionar uma mensagem apos corte'] = {main:[[link('Processar mensagens individualmente')]]};
feeder.connections['Processar mensagens individualmente'] = {main:[[],[link('Preparar uma entrega ou conciliacao')]]};
feeder.connections['Preparar uma entrega ou conciliacao'] = {main:[[link('Assinar enqueue com chave da fila')]]};
feeder.connections['Marcar ledger apos recibo confirmado'] = {main:[[link('Fila ainda requer worker')]]};
feeder.connections['Fila ainda requer worker'] = {main:[[link('Acionar worker por mensagem enfileirada')],[link('Processar mensagens individualmente')]]};
feeder.connections['Acionar worker por mensagem enfileirada'] = {main:[[link('Processar mensagens individualmente')]]};
node(worker, 'Preparar recibo conservador').parameters.jsCode = source('body-reader') + source('intake-ack');
node(worker, 'Enviar candidato para triagem (sem decidir)').onError = 'continueRegularOutput';
node(worker, 'Conciliar ledger pelo ID apos ACK').parameters.columns.value.last_error_code =
  "={{ $json.queueState === 'blocked' ? 'QUEUE_BLOCKED' : $json.queueState === 'retry' ? 'QUEUE_RETRY' : '' }}";
for (const graph of [feeder,worker]) graph.settings.saveDataErrorExecution = 'none';
export const graphs = {[feederId]: feeder, [workerId]: worker};
export const plan = {
  format:'funix-gmail-local-review-v1', deployable:false,
  note:'Review only: credentials omitted; validate node behavior and version preconditions before authorized application.',
  workflows:Object.values(graphs).map(graph => ({workflowId:graph.id,expectedVersionId:baseline[graph.id].versionId,
    settings:graph.settings,
    nodeChanges:graph.nodes.filter(n=>JSON.stringify(n)!==JSON.stringify(baseline[graph.id].nodes.find(b=>b.name===n.name))),
    connections:graph.connections}))
};
if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(JSON.stringify(plan,null,2)+'\n');
