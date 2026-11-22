// Opt-in real n8n runtime lab. Never connects to the FUNIX n8n instance.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {DatabaseSync} from 'node:sqlite'
import {startMock,queueKey,intakeKey} from './runtime-mock.ts'

type Json=Record<string,any>
const root=new URL('../../',import.meta.url)
const base=process.env.FUNIX_GMAIL_LAB_URL
assert.ok(base,'Use run-runtime-lab.sh with its fresh, disposable instance')
assert.equal(new URL(base).hostname,'127.0.0.1','Lab must use literal loopback')
const work=process.env.FUNIX_GMAIL_LAB_WORK
assert.ok(work,'A disposable evidence directory is required')
assert.ok(process.env.FUNIX_GMAIL_LAB_N8N,'An explicit isolated n8n binary is required')
const runtimeRequire=createRequire(process.env.FUNIX_GMAIL_LAB_N8N)
const decode=runtimeRequire('flatted').parse as (value:string)=>Json
mkdirSync(work,{recursive:true})
let mock=await startMock(work+'/funix-synthetic.sqlite')
let cookie=''
async function api(path:string,method='GET',body?:unknown):Promise<any>{
  const r=await fetch(base+'/rest'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)})
  const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0]!
  const d=await r.json() as Json
  if(!r.ok)throw Error('LAB_API_'+r.status+':'+path+':'+JSON.stringify(d).slice(0,700))
  return d.data??d
}
const owner={email:'owner@example.invalid',firstName:'Synthetic',lastName:'Lab',password:'Synthetic-Lab-Password-2026'}
const evidence:Json={runtime:'n8n 2.47.7',syntheticOnly:true,scenarios:[]}
const id=(n:number)=>(0x4000000000000000n+BigInt(n)).toString(16)
const row=(n:number,extra:Json={})=>({message_id:id(n),source:'gmail',state:'received',first_seen_at:'2026-11-14T06:00:00.000Z',last_checked_at:null,last_error_code:'',...extra})
let projectId='',tableId='',workerId=''
const plan=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('build-plan.mjs',import.meta.url))],{encoding:'utf8'}))
const baseline=JSON.parse(readFileSync(new URL('server/tests/fixtures/gmail-recovery/published-sanitized.json',root),'utf8'))
const graphs=structuredClone(baseline)
for(const patch of plan.workflows){
  const g=graphs[patch.workflowId]
  for(const node of patch.nodeChanges){const i=g.nodes.findIndex((n:Json)=>n.name===node.name);if(i<0)g.nodes.push(node);else g.nodes[i]=node}
  g.connections=patch.connections;g.settings=patch.settings
}
let queueCredential='',intakeCredential=''
async function createWorkflow(sourceId:string,input:Json={},mutate?:(graph:Json)=>void){
  const graph=structuredClone(graphs[sourceId]);graph.id=randomUUID().replaceAll('-','').slice(0,16)
  graph.name='GMAIL SYNTHETIC LAB '+graph.id
  graph.projectId=projectId
  graph.settings={...graph.settings,saveDataSuccessExecution:'all',saveDataErrorExecution:'all',saveManualExecutions:true,executionTimeout:180}
  delete graph.active;delete graph.versionId;delete graph.activeVersionId
  for(const n of graph.nodes){
    if(n.type==='n8n-nodes-base.dataTable')n.parameters.dataTableId={__rl:true,mode:'id',value:tableId}
    if(n.type==='n8n-nodes-base.crypto')n.credentials={crypto:{id:n.parameters.dataPropertyName==='intakeSignature'?intakeCredential:queueCredential,name:'synthetic'}}
    if(n.type==='n8n-nodes-base.httpRequest'){
      n.parameters.url=n.parameters.url.startsWith('={{')?n.parameters.url.replace('https://app.funix.com.br',mock.base):n.parameters.url.replace('https://app.funix.com.br',mock.base)
    }
    if(n.type==='n8n-nodes-base.gmail'){
      n.type='n8n-nodes-base.httpRequest';n.typeVersion=4.3
      n.parameters={method:'GET',url:'={{ "'+mock.base+'/synthetic-gmail/" + $json.messageId }}',options:{timeout:1500}}
    }
    if(n.type==='n8n-nodes-base.executeWorkflow')n.parameters.workflowId={__rl:true,mode:'id',value:workerId}
  }
  graph.pinData={'Iniciar ensaio manual':[{json:input}]}
  mutate?.(graph)
  // No production URLs, credential references or remote workflow/table IDs survive conversion.
  assert.equal(JSON.stringify(graph).includes('app.funix.com.br'),false)
  assert.equal(graph.nodes.some((n:Json)=>n.type==='n8n-nodes-base.gmail'||n.type==='n8n-nodes-base.gmailTrigger'),false)
  return await api('/workflows','POST',graph) as Json
}
async function waitExecution(executionId:string){
  for(let attempt=0;attempt<300;attempt++){
    const d=await api('/executions/'+executionId+'?includeData=true')
    if(['success','error','canceled','crashed'].includes(d.status)){if(typeof d.data==='string')d.data=decode(d.data);return d as Json}
    await new Promise(resolve=>setTimeout(resolve,200))
  }
  throw Error('LAB_EXECUTION_TIMEOUT')
}
async function cycle(input:Json={},mutate?:(graph:Json)=>void,allowFailure=false,trigger='Iniciar ensaio manual'){
  const wf=await createWorkflow('kOOWQripUr9BNy29',input,mutate)
  const started=await api('/workflows/'+wf.id+'/run','POST',{triggerToStartFrom:{name:trigger}})
  const result=await waitExecution(started.executionId)
  writeFileSync(work+'/last-execution.json',JSON.stringify(result,null,2))
  // Async children execute in the same runtime; wait for their terminal state too.
  for(let attempt=0;attempt<300;attempt++){
    const pending=await api('/executions?filter='+encodeURIComponent(JSON.stringify({workflowId:workerId})))
    if(!pending.results?.some((x:Json)=>['running','new'].includes(x.status)))break
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  if(result.status!=='success'&&!allowFailure)throw Error('LAB_EXECUTION_ERROR:'+JSON.stringify(result.data?.resultData?.error??result).slice(0,1200))
  return result
}
async function tableRows(){
  const data:Json[]=[]
  while(true){const page=await api('/projects/'+projectId+'/data-tables/'+tableId+'/rows?take=250&skip='+data.length);data.push(...page.data);if(data.length>=page.count)return data}
}
async function verifyLedger(){
  const rows=await tableRows()
  for(const r of rows){
    try{const state=mock.queue.status(r.message_id).state;if(['notified','ignored','blocked'].includes(state))assert.equal(r.state,state,'Cross-message ledger mismatch: '+r.message_id)}
    catch(error){if((error as {code?:string}).code!=='GMAIL_QUEUE_NOT_FOUND')throw error}
  }
  return rows
}
async function newCase(name:string,records:Json[],workerMutation?:(g:Json)=>void){
  await mock.close();mock=await startMock(work+'/'+name+'.sqlite')
  const table=await api('/projects/'+projectId+'/data-tables','POST',{name:'SYNTHETIC_'+name+'_'+Date.now(),columns:[
    {name:'message_id',type:'string'},{name:'source',type:'string'},{name:'state',type:'string'},
    {name:'first_seen_at',type:'date'},{name:'last_checked_at',type:'date'},{name:'last_error_code',type:'string'}
  ]});tableId=table.id
  await api('/projects/'+projectId+'/data-tables/'+tableId+'/insert','POST',{data:records})
  workerId=(await createWorkflow('KQ6qkUfdvz6PApmt',{},workerMutation)).id
}
function subworkflowOnly(g:Json){g.nodes=g.nodes.filter((n:Json)=>n.name!=='Recuperar pendencias a cada hora');delete g.connections['Recuperar pendencias a cada hora']}
async function publishLabWorker(){const w=await api('/workflows/'+workerId);await api('/workflows/'+workerId+'/activate','POST',{versionId:w.versionId})}
function record(name:string,execution:Json,extra:Json={}){evidence.scenarios.push({name,executionId:execution.id,status:execution.status,...extra})}
try{
  try{await api('/owner/setup','POST',owner)}catch{await api('/login','POST',{emailOrLdapLoginId:owner.email,password:owner.password})}
  const project=await api('/projects/personal');projectId=project.id
  const table=await api('/projects/'+projectId+'/data-tables','POST',{name:'GMAIL_SYNTHETIC_'+Date.now(),columns:[
    {name:'message_id',type:'string'},{name:'source',type:'string'},{name:'state',type:'string'},
    {name:'first_seen_at',type:'date'},{name:'last_checked_at',type:'date'},{name:'last_error_code',type:'string'}
  ]});tableId=table.id
  queueCredential=(await api('/credentials','POST',{name:'synthetic queue',type:'crypto',data:{hmacSecret:queueKey}})).id
  intakeCredential=(await api('/credentials','POST',{name:'synthetic intake',type:'crypto',data:{hmacSecret:intakeKey}})).id
  workerId=(await createWorkflow('KQ6qkUfdvz6PApmt')).id
  const records=Array.from({length:1301},(_,n)=>row(n))
  records.push(row(9001,{first_seen_at:'2026-11-14T05:00:00.000Z'}),row(9002,{message_id:'1a1d87af83b6c00a'}))
  for(let at=0;at<records.length;at+=250)await api('/projects/'+projectId+'/data-tables/'+tableId+'/insert','POST',{data:records.slice(at,at+250)})
  const direct=await cycle({message_id:id(1300)})
  evidence.scenarios.push({name:'direct-id-outside-100',executionId:direct.id,queue:mock.queue.overview()})
  assert.ok(['ignored','notified'].includes(mock.queue.status(id(1300)).state))
  const batch=await cycle()
  evidence.scenarios.push({name:'native-pagination-1303-and-batch',executionId:batch.id,queue:mock.queue.overview()})
  assert.equal(mock.queue.overview().total,26)
  const ledger=await verifyLedger()
  assert.equal(ledger.length,1303)
  assert.equal(batch.data.resultData.runData['Ler pendencias registradas'][0].data.main[0].length,1303)
  assert.equal(batch.data.resultData.runData['Processar mensagens individualmente'].length,26)
  const next=await cycle();assert.equal(mock.queue.overview().total,51);await verifyLedger();record('subsequent-cycle',next)
  writeFileSync(work+'/ledger.json',JSON.stringify(ledger,null,2))
  for(const fault of ['enqueue-before','enqueue-lost','claim-before','claim-lost','intake-lost','ack-lost','gmail-before']){
    await newCase(fault,[row(1),row(2)])
    const [kind,timing]=fault.split('-')
    const action=kind==='intake'?'intake-candidates':kind==='gmail'?id(1):kind!
    mock.faults[action]={[timing==='lost'?'lost':'before']:1,status:503}
    const first=await cycle();mock.advance(3600000)
    await cycle();mock.advance(3600000);const last=await cycle()
    assert.equal(mock.queue.overview().total,2)
    assert.equal(mock.queue.overview().states.notified+mock.queue.overview().states.ignored,2)
    await verifyLedger();assert.equal(mock.notices.list('all').total,2)
    assert.equal(mock.db.prepare('SELECT COUNT(*) n FROM gmail_intake_decisions').get()!.n,0)
    record(fault,last,{firstExecutionId:first.id,attempts:mock.queue.status(id(1)).attempts})
  }
  for(const status of [400,422,401,403,404,409,408,429,500,503]){
    await newCase('http-'+status,[row(1)])
    mock.faults['intake-candidates']={before:10,status}
    const first=await cycle()
    const state=mock.queue.status(id(1))
    assert.equal(state.state,[400,422,409].includes(status)?'blocked':'retry','HTTP category '+status)
    if([401,403,404].includes(status)){
      for(let i=0;i<6;i++){mock.advance(3600000);await cycle()}
      assert.equal(mock.queue.status(id(1)).attempts,1,'Auth incident must stop consuming attempts')
      const rows=await tableRows();assert.equal(rows[0]!.last_error_code,status===404?'INTEGRATION_ROUTE_INTAKE':'INTEGRATION_AUTH_INTAKE')
      mock.faults['intake-candidates']={}
      // Explicit synthetic operator intervention; same existing metadata column, no reset of queue/decision.
      await api('/projects/'+projectId+'/data-tables/'+tableId+'/rows','PATCH',{
        filter:{type:'and',filters:[{columnName:'message_id',condition:'eq',value:id(1)}]},data:{last_error_code:''}
      })
      mock.advance(3600000);await cycle();assert.equal(mock.queue.status(id(1)).state,'notified')
    }
    record('http-'+status,first,{firstState:state.state,firstAttempt:state.attempts})
  }
  await newCase('invalid-event',[row(1),row(2)])
  const invalid=await cycle({message_id:'invalid'},undefined,true)
  assert.equal(invalid.status,'error');assert.equal(mock.queue.overview().total,0)
  record('invalid-id-fails-closed',invalid)

  await newCase('malformed-response',[row(1),row(2)])
  mock.faults.enqueue={malformed:1}
  await cycle();const malformed=await cycle();await verifyLedger()
  assert.equal(mock.queue.overview().states.notified,2);record('malformed-receipt',malformed)

  await newCase('mixed-loop',[row(0),row(1),row(2)])
  mock.faults['intake-candidates']={before:1,status:409};mock.faults[id(1)]={before:1,status:503}
  const mixed=await cycle();await verifyLedger()
  assert.equal(mock.queue.status(id(0)).state,'blocked')
  assert.equal(mock.queue.status(id(1)).state,'leased')
  assert.equal(mock.queue.status(id(2)).state,'notified')
  record('mixed-results-item-association',mixed,{loopRuns:mixed.data.resultData.runData['Processar mensagens individualmente'].length})
  mock.advance(3600000);await cycle();await verifyLedger()

  await newCase('ledger-failure',[row(1),row(2)])
  const ledgerFailure=await cycle({},g=>{
    const n=g.nodes.find((x:Json)=>x.name==='Marcar ledger apos recibo confirmado')
    n.parameters.dataTableId.value="={{ $json.messageId === '"+id(1)+"' ? 'missinglabtable' : '"+tableId+"' }}"
  })
  await cycle();await verifyLedger();assert.equal(mock.queue.overview().states.notified,2)
  record('native-update-error-keeps-loop-running',ledgerFailure)

  await newCase('post-ack-ledger-failure',[row(1)],g=>{
    g.nodes.find((x:Json)=>x.name==='Conciliar ledger pelo ID apos ACK').parameters.dataTableId.value='missinglabtable'
  })
  await cycle();assert.equal(mock.queue.status(id(1)).state,'notified');assert.equal((await tableRows())[0]!.state,'queued')
  const repaired=await cycle();await verifyLedger();assert.equal(mock.reads.length,1)
  record('ack-committed-ledger-failed',repaired)

  await newCase('call-failure',[row(1),row(2)])
  const callFailure=await cycle({},g=>{
    g.nodes.find((x:Json)=>x.type==='n8n-nodes-base.executeWorkflow').parameters.workflowId.value=
      "={{ $json.message_id === '"+id(1)+"' ? 'missinglabworker' : '"+workerId+"' }}"
  })
  await cycle();await cycle();await verifyLedger();assert.equal(mock.queue.overview().states.notified,2)
  record('native-subworkflow-call-failure',callFailure)

  await newCase('interrupted-loop',[row(1),row(2),row(3)])
  const interrupted=await cycle({},g=>{
    g.nodes.find((x:Json)=>x.name==='Registrar diagnostico de entrega').parameters.jsCode="throw Error('SYNTHETIC_INTERRUPTION');"
  },true)
  assert.equal(interrupted.status,'error');assert.equal(mock.queue.overview().total,1)
  const recovered=await cycle();await verifyLedger();assert.equal(mock.queue.overview().states.notified,3)
  record('interrupted-batch-recovery',recovered,{interruptedExecutionId:interrupted.id})

  await newCase('concurrent',[row(1),row(2)])
  const both=await Promise.all([cycle(),cycle()]);await cycle();await verifyLedger()
  assert.equal(mock.notices.list('all').total,2);assert.equal(mock.queue.status(id(1)).attempts,1)
  record('concurrent-runtime-executions',both[0]!,{otherExecutionId:both[1]!.id})

  await newCase('denied-decision',[row(1)])
  mock.faults.ack={lost:1};await cycle()
  const notice=mock.notices.list('all').items[0]!
  mock.notices.decide(notice.id,{requestId:randomUUID(),revision:notice.revision,snapshotHash:notice.snapshotHash,decision:'deny'},'synthetic-owner')
  const denied=await cycle();assert.equal(mock.notices.get(notice.id).status,'denied');assert.equal(mock.reads.length,1)
  await verifyLedger();record('human-denial-preserved',denied)

  await newCase('expired-lease',[row(1,{state:'leased'})])
  mock.queue.enqueue(id(1));mock.queue.claim(1,randomUUID());mock.advance(180000)
  const expired=await cycle();await verifyLedger();assert.equal(mock.queue.status(id(1)).attempts,2)
  record('expired-lease',expired)

  await newCase('hourly-path',[row(1)])
  const hourly=await cycle({},undefined,false,'Recuperar registro recebido a cada hora')
  await verifyLedger();assert.equal(mock.queue.status(id(1)).state,'notified');record('real-schedule-node-manual-path',hourly)

  await newCase('timer',[row(1)],subworkflowOnly)
  await publishLabWorker()
  const timer=await createWorkflow('kOOWQripUr9BNy29',{},g=>{
    const schedule=g.nodes.find((n:Json)=>n.name==='Recuperar registro recebido a cada hora')
    schedule.parameters.rule={interval:[{field:'seconds',secondsInterval:1}]}
  })
  try{
    await api('/workflows/'+timer.id+'/activate','POST',{versionId:timer.versionId})
    for(let i=0;i<100;i++){
      if(mock.queue.overview().states.notified===1)break
      await new Promise(resolve=>setTimeout(resolve,100))
    }
  }finally{await api('/workflows/'+timer.id+'/deactivate','POST',{});await api('/workflows/'+workerId+'/deactivate','POST',{})}
  assert.equal(mock.queue.overview().states.notified,1)
  const timerRuns=await api('/executions?filter='+encodeURIComponent(JSON.stringify({workflowId:timer.id})))
  const triggered=timerRuns.results.find((r:Json)=>r.mode==='trigger')
  assert.ok(triggered,'Actual timer must create a trigger-mode execution')
  await waitExecution(triggered.id);await verifyLedger()
  assert.equal(mock.queue.status(id(1)).attempts,1)
  record('accelerated-real-timer',triggered,{secondsInterval:1,productionIntervalUnchanged:'1 hour'})

  await newCase('redacted-diagnostics',[row(1)],subworkflowOnly)
  await publishLabWorker()
  mock.faults.enqueue={before:100,status:503}
  const diagnostic=await createWorkflow('kOOWQripUr9BNy29',{},g=>{
    g.nodes.find((n:Json)=>n.name==='Recuperar registro recebido a cada hora').parameters.rule={interval:[{field:'seconds',secondsInterval:1}]}
    g.settings.saveDataSuccessExecution='none';g.settings.saveDataErrorExecution='none';g.settings.saveManualExecutions=false
  })
  try{
    await api('/workflows/'+diagnostic.id+'/activate','POST',{versionId:diagnostic.versionId})
    for(let i=0;i<100;i++){if((await tableRows())[0]!.last_error_code==='QUEUE_HTTP_503')break;await new Promise(resolve=>setTimeout(resolve,100))}
  }finally{await api('/workflows/'+diagnostic.id+'/deactivate','POST',{});await api('/workflows/'+workerId+'/deactivate','POST',{})}
  assert.equal((await tableRows())[0]!.last_error_code,'QUEUE_HTTP_503')
  await new Promise(resolve=>setTimeout(resolve,400))
  const runtimeLog=readFileSync(work+'/runtime.log','utf8')
  assert.ok(runtimeLog.includes('QUEUE_HTTP_503'),'Redacted diagnostic must reach actual production-mode stdout')
  const runtimeDb=new DatabaseSync(work+'/state/.n8n/database.sqlite',{readOnly:true})
  try{
    const last=runtimeDb.prepare('SELECT id,status FROM execution_entity WHERE workflowId=? ORDER BY CAST(id AS INTEGER) DESC LIMIT 1').get(diagnostic.id) as Json
    assert.equal(last.status,'success')
    const saved=runtimeDb.prepare('SELECT data FROM execution_data WHERE executionId=?').get(last.id) as Json|undefined
    if(saved){const executionData=decode(saved.data);assert.equal(Boolean(executionData.resultData?.runData&&Object.keys(executionData.resultData.runData).length),false)}
    const metadata=runtimeDb.prepare('SELECT COUNT(*) n FROM execution_metadata WHERE executionId=?').get(last.id) as Json
    assert.equal(metadata.n,0,'Do not rely on custom metadata when execution retention is disabled')
    record('redacted-diagnostics-without-payload',{id:last.id,status:last.status},{ledgerCode:'QUEUE_HTTP_503',stdout:true,customMetadataPersisted:false})
  }finally{runtimeDb.close()}
  console.log(JSON.stringify(evidence,null,2))
}finally{writeFileSync(work+'/evidence.json',JSON.stringify(evidence,null,2));await mock.close()}
