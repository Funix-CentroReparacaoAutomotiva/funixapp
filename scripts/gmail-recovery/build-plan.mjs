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
  ,{keyName:'last_error_code',condition:"={{ $json.expectedLastError ? 'eq' : 'isEmpty' }}",keyValue:'={{ $json.expectedLastError }}'}
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
const finalReceipt = node(worker, 'Validar recibo final sem conteudo');
finalReceipt.parameters.jsCode = finalReceipt.parameters.jsCode.replace('decisionRecorded:false',
  "errorCode:$('Preparar recibo conservador').first().json.errorCode,decisionRecorded:false");
node(worker, 'Conciliar ledger pelo ID apos ACK').parameters.columns.value.last_error_code =
  "={{ $json.errorCode || ($json.queueState === 'blocked' ? 'QUEUE_BLOCKED' : $json.queueState === 'retry' ? 'QUEUE_RETRY' : '') }}";
const incidentLookup = structuredClone(node(feeder, 'Ler pendencias registradas'));
incidentLookup.id = 'gmail-auth-incident-check'; incidentLookup.name = 'Verificar incidente de autenticacao';
incidentLookup.parameters = {...incidentLookup.parameters,returnAll:false,limit:1,orderBy:false,matchType:'anyCondition',
  filters:{conditions:['INTEGRATION_AUTH_INTAKE','INTEGRATION_ROUTE_INTAKE'].map(keyValue=>({keyName:'last_error_code',condition:'eq',keyValue}))}};
incidentLookup.alwaysOutputData = true;
worker.nodes.push(incidentLookup, {id:'gmail-auth-pause',name:'Pausar por incidente de integracao',type:'n8n-nodes-base.code',typeVersion:2,
  position:[120,-200],parameters:{mode:'runOnceForAllItems',language:'javaScript',jsCode:
    "const incident=$input.all().find(i=>['INTEGRATION_AUTH_INTAKE','INTEGRATION_ROUTE_INTAKE'].includes(i.json.last_error_code));if(incident){$execution.customData?.setAll({component:'gmail',code:incident.json.last_error_code});console.error(JSON.stringify({component:'gmail',code:'INTEGRATION_PAUSED',executionId:$execution.id}));return [];}return [{json:{}}];"}});
for(const trigger of ['Iniciar ensaio manual','Receber acionamento do alimentador','Recuperar pendencias a cada hora'])
  worker.connections[trigger]={main:[[link('Verificar incidente de autenticacao')]]};
worker.connections['Verificar incidente de autenticacao']={main:[[link('Pausar por incidente de integracao')]]};
worker.connections['Pausar por incidente de integracao']={main:[[link('Trava de processamento (OFF)')]]};
// Technical diagnostics contain only fixed codes and execution correlation, never payloads.
for(const [graph,after,name] of [[feeder,'Conferir recibo do enqueue','Registrar diagnostico de entrega'],[worker,'Validar recibo final sem conteudo','Registrar diagnostico do worker']]){
  graph.nodes.push({id:name,name,type:'n8n-nodes-base.code',typeVersion:2,position:[2100,0],parameters:{mode:'runOnceForAllItems',language:'javaScript',jsCode:
    "const x=$input.first().json,code=x.lastError||x.errorCode||'OK';if(code!=='OK'||!$execution.customData?.get('code'))$execution.customData?.setAll({component:'gmail',code,state:x.queueState});console.log(JSON.stringify({component:'gmail',executionId:$execution.id,state:x.queueState,code}));return [{json:x,pairedItem:{item:0}}];"}});
  graph.connections[name]=graph.connections[after];graph.connections[after]={main:[[link(name)]]};
}
const gmailRead = node(worker,'Ler unica mensagem reivindicada');
gmailRead.onError = 'continueRegularOutput';
const candidate = node(worker,'Preparar candidato minimalista');
candidate.parameters.jsCode = "if($input.first()?.json?.error){$execution.customData?.setAll({component:'gmail',code:'GMAIL_QUERY_UNCONFIRMED'});throw Error('GMAIL_QUERY_UNCONFIRMED');}" + candidate.parameters.jsCode;
const claimValidation = node(worker,'Validar concessao e excluir homologacoes');
claimValidation.parameters.jsCode = "try {" + claimValidation.parameters.jsCode + "}catch{const s=Number($input.first()?.json?.statusCode??0);const code=[400,401,403,404,408,409,422,429,500,502,503,504].includes(s)?'QUEUE_CLAIM_HTTP_'+s:'CLAIM_UNCONFIRMED';console.error(JSON.stringify({component:'gmail',executionId:$execution.id,code}));throw Error(code);}";
for(const [graph,after,name,stop] of [[feeder,'Marcar ledger apos recibo confirmado','Conferir gravacao do ledger',false],[worker,'Conciliar ledger pelo ID apos ACK','Conferir conciliacao do ledger',true]]){
  const updated = node(graph,after);updated.onError='continueRegularOutput';updated.alwaysOutputData=true;
  graph.nodes.push({id:name,name,type:'n8n-nodes-base.code',typeVersion:2,position:[2300,0],parameters:{mode:'runOnceForAllItems',language:'javaScript',jsCode:
    "if($input.first()?.json?.error){console.error(JSON.stringify({component:'gmail',code:'LEDGER_UPDATE_UNCONFIRMED',executionId:$execution.id}));"+(stop?"throw Error('LEDGER_UPDATE_UNCONFIRMED');":"")+"}return $input.all().map((i,index)=>({json:i.json,pairedItem:{item:index}}));"}});
  graph.connections[name]=graph.connections[after];graph.connections[after]={main:[[link(name)]]};
}
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
