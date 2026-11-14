import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {runInNewContext} from 'node:vm'
import {createHmac} from 'node:crypto'
import {createServer} from 'node:http'
import {openDatabase} from '../database.ts'
import {createGmailIntakeSchema} from '../gmail-intake-schema.ts'
import {createGmailIntakeQueueSchema} from '../gmail-intake-queue-schema.ts'
import {GmailIntakeQueue} from '../gmail-intake-queue.ts'
import {GmailIntakeRepository} from '../gmail-intake.ts'
import {createGmailQueueEndpoint} from '../gmail-intake-queue-endpoint.ts'
import {createGmailCandidateIngest} from '../gmail-intake-ingest.ts'

type Json = Record<string, any>
type Item = {json:Json}
type GraphNode = {name:string,type:string,parameters:Json,onError?:string,alwaysOutputData?:boolean}
type Graph = {nodes:GraphNode[],connections:Record<string,{main:Array<Array<{node:string}>>}>,settings:Json,versionId:string}
const fixture = new URL('./fixtures/gmail-recovery/published-sanitized.json',import.meta.url)
const baseline = JSON.parse(readFileSync(fixture,'utf8')) as Record<string,Graph>
const builder = fileURLToPath(new URL('../../scripts/gmail-recovery/build-plan.mjs',import.meta.url))
const plan = JSON.parse(execFileSync(process.execPath,[builder],{encoding:'utf8'})) as {
  deployable:boolean,workflows:Array<{workflowId:string,expectedVersionId:string,nodeChanges:GraphNode[],connections:Graph['connections'],settings:Json}>
}
const feederId='kOOWQripUr9BNy29',workerId='KQ6qkUfdvz6PApmt'
const graphs=structuredClone(baseline)
for(const change of plan.workflows){
  assert.equal(change.expectedVersionId,graphs[change.workflowId]!.versionId)
  for(const node of change.nodeChanges){
    const previous=graphs[change.workflowId]!.nodes.findIndex(n=>n.name===node.name)
    if(previous<0)graphs[change.workflowId]!.nodes.push(node)
    else graphs[change.workflowId]!.nodes[previous]=node
  }
  graphs[change.workflowId]!.connections=change.connections
  graphs[change.workflowId]!.settings=change.settings
}
const queueSecret='synthetic-gmail-queue-key-at-least-32-characters'
const intakeSecret='synthetic-gmail-intake-key-at-least-32-characters'
const stamp='2026-11-14T06:00:00.000Z'
const id=(n:number)=>(0x3000000000000000n+BigInt(n)).toString(16)
const row=(n:number,extra:Json={}):Json=>({id:n,message_id:id(n),source:'gmail',state:'received',first_seen_at:stamp,last_checked_at:null,last_error_code:'',...extra})

// Executes the actual Code source/graph with synthetic DataTable/Gmail/child-workflow
// adapters and real loopback HMAC endpoints/SQLite. This is not the n8n runtime:
// native pagination, item linking, and scheduling still require isolated n8n validation.
async function harness(rows:Json[],options:{published?:boolean}={}){
  const db=openDatabase(':memory:')
  createGmailIntakeSchema(db);createGmailIntakeQueueSchema(db)
  let clock=Date.parse('2026-11-14T08:00:00.000Z')
  const queue=new GmailIntakeQueue(db,()=>clock),notices=new GmailIntakeRepository(db)
  const queueApi=createGmailQueueEndpoint(queue,queueSecret,true,()=>clock)
  const intake=createGmailCandidateIngest(notices,intakeSecret,true,()=>clock)
  const failures={loseEnqueue:0,loseAck:0,loseIntake:0,loseClaim:0,update:0,workerUpdate:0,wake:0,intakeStatus:0,wrongReceipt:0}
  const reads:string[]=[],errors:string[]=[],calls:string[]=[]
  const selected=options.published?baseline:graphs
  const server=createServer(async(req,res)=>{
    try{
      const action=new URL(req.url??'/','http://localhost').pathname.split('/').pop()!
      calls.push(action)
      let result:unknown
      if(action==='intake-candidates'){
        if(failures.intakeStatus){req.resume();res.writeHead(failures.intakeStatus,{'content-type':'application/json'}).end('{}');return}
        result=await intake(req,res)
      }else result=await queueApi(req,res,action as 'enqueue'|'claim'|'ack'|'status')
      const lost=action==='enqueue'?'loseEnqueue':action==='ack'?'loseAck':action==='claim'?'loseClaim':action==='intake-candidates'?'loseIntake':null
      if(lost&&failures[lost]>0){failures[lost]--;req.socket.destroy();return}
      if(failures.wrongReceipt&&action==='enqueue'){
        failures.wrongReceipt--;result={messageId:id(9999),state:'notified'}
      }
      res.writeHead(action==='intake-candidates'?202:200,{'content-type':'application/json'}).end(JSON.stringify(result))
    }catch(error){
      const e=error as {status?:number,code?:string}
      res.writeHead(e.status??500,{'content-type':'application/json'}).end(JSON.stringify({code:e.code??'TEST_ERROR'}))
    }
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();assert.ok(address&&typeof address!=='string')
  const base='http://127.0.0.1:'+address.port
  const children:Promise<void>[]=[]
  async function run(graph:Graph,start:string,initial:Json){
    const outputs=new Map<string,Item[]>()
    let current=start,items:Item[]=[{json:initial}],batch:Item[]|undefined
    let steps=0
    const context=(input:Item[])=>({
      $input:{all:()=>input,first:()=>input[0],item:input[0]},$json:input[0]?.json,
      $:(name:string)=>({first:()=>outputs.get(name)?.[0],item:outputs.get(name)?.[0]}),
      $now:{toISO:()=>new Date(clock).toISOString()},
      Date:class extends Date {static override now(){return clock}}
    })
    const expression=(value:unknown,input:Item[]):any=>typeof value==='string'&&value.startsWith('={{')
      ?runInNewContext(value.slice(3,-2),context(input),{timeout:1000}):value
    while(current){
      assert.ok(++steps<1000,'unexpected graph loop')
      const node=graph.nodes.find(n=>n.name===current);assert.ok(node)
      const p=node.parameters
      let result:Item[]=items,branch=0
      try{
        if(node.type==='n8n-nodes-base.code'){
          const output=runInNewContext('(function(){'+p.jsCode+'\n})()',context(items),{timeout:1000})
          result=JSON.parse(JSON.stringify(Array.isArray(output)?output:[output]))
        }else if(node.type==='n8n-nodes-base.dataTable'){
          const matches=(r:Json)=>p.filters.conditions.every((c:Json)=>
            r[expression(c.keyName,items)]===expression(c.keyValue,items))
          if(p.operation==='get'){
            let found=rows.filter(matches)
            if(p.orderBy)found.sort((a,b)=>String(b[p.orderByColumn]??'').localeCompare(String(a[p.orderByColumn]??'')))
            if(!p.returnAll)found=found.slice(0,p.limit)
            result=found.map(json=>({json:structuredClone(json)}))
          }else{
            if(node.name==='Conciliar ledger pelo ID apos ACK'&&failures.workerUpdate){failures.workerUpdate--;throw Error('SYNTHETIC_LEDGER_UNAVAILABLE')}
            if(failures.update){failures.update--;throw Error('SYNTHETIC_LEDGER_UNAVAILABLE')}
            result=rows.filter(matches).map(r=>{
              for(const [key,value] of Object.entries(p.columns.value))r[key]=expression(value,items)
              return {json:structuredClone(r)}
            })
          }
        }else if(node.type==='n8n-nodes-base.splitInBatches'){
          batch??=[...items]
          const next=batch.shift();result=next?[next]:[];branch=next?1:0
        }else if(node.type==='n8n-nodes-base.if'){
          branch=expression(p.conditions.conditions[0].leftValue,items)===true?0:1
        }else if(node.type==='n8n-nodes-base.crypto'){
          const secret=p.dataPropertyName==='intakeSignature'?intakeSecret:queueSecret
          result=items.map(item=>({json:{...item.json,[p.dataPropertyName]:createHmac('sha256',secret).update(expression(p.value,[item])).digest('hex')}}))
        }else if(node.type==='n8n-nodes-base.httpRequest'){
          const target=new URL(expression(p.url,items))
          assert.equal(target.hostname,'app.funix.com.br')
          const headers:Record<string,string>={'Content-Type':'application/json'}
          for(const header of p.headerParameters.parameters)headers[header.name]=expression(header.value,items)
          const response=await fetch(base+target.pathname,{method:'POST',headers,body:expression(p.body,items)})
          result=[{json:{statusCode:response.status,body:await response.json()}}]
        }else if(node.type==='n8n-nodes-base.gmail'){
          const messageId=expression(p.messageId,items);reads.push(messageId)
          result=[{json:{id:messageId,subject:'Autorização do reparo do veículo',snippet:'Reparo de para-choque autorizado para análise.'}}]
        }else if(node.type==='n8n-nodes-base.executeWorkflow'){
          if(failures.wake){failures.wake--;throw Error('SYNTHETIC_CHILD_CALL_FAILED')}
          const promise=run(selected[workerId]!,'Receber acionamento do alimentador',{}).catch(()=>{errors.push('WORKER_INTERRUPTED')})
          children.push(promise)
          // The live caller does not wait for its child.
        }
      }catch(error){
        if(node.onError!=='continueRegularOutput')throw error
        result=[{json:{error:'SYNTHETIC_ERROR'}}]
      }
      if(!result.length&&node.alwaysOutputData)result=[{json:{}}]
      outputs.set(current,result)
      if(!result.length&&node.type!=='n8n-nodes-base.splitInBatches')return
      const edges=graph.connections[current]?.main[branch]??[]
      assert.ok(edges.length<=1,'test adapter only supports serial graph branches')
      current=edges[0]?.node??'';items=result
    }
  }
  return {db,queue,notices,failures,reads,errors,calls,rows,
    advance:(ms:number)=>{clock+=ms},
    cycle:async(messageId?:string)=>{
      try{await run(selected[feederId]!,'Trava de publicacao (OFF)',messageId===undefined?{}:{message_id:messageId})}
      finally{await Promise.all(children.splice(0))}
    },
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close()}
  }
}

test('published feeder reproduces 100-row event window and one-per-recovery defect',async()=>{
  const h=await harness(Array.from({length:125},(_,n)=>row(n)),{published:true})
  try{
    // Equal timestamps retain original ordering in the synthetic native-node adapter.
    await h.cycle(id(124));assert.equal(h.reads.length,0)
    await h.cycle();assert.equal(h.reads.length,1)
  }finally{await h.close()}
})
test('corrected event lookup reaches an ID outside the old window; hourly recovery drains bounded batches',async()=>{
  const h=await harness(Array.from({length:126},(_,n)=>row(n)))
  try{
    await h.cycle(id(125));assert.equal(h.queue.status(id(125)).state,'notified')
    await h.cycle();assert.equal(h.reads.length,26)
    for(let n=0;n<4;n++)await h.cycle()
    assert.equal(h.reads.length,126)
    assert.equal(h.queue.overview().states.notified,126)
    await h.cycle();assert.equal(h.reads.length,126)
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM gmail_intake_decisions').get()!.n,0)
  }finally{await h.close()}
})
test('cutover, exclusions, invalid event and terminal ledger never dispatch unrelated work',async()=>{
  const h=await harness([row(1,{first_seen_at:'2026-11-14T05:00:00Z'}),row(2,{message_id:'1a1d87af83b6c00a'}),row(3,{first_seen_at:'invalid'}),row(4,{source:'other'}),row(5,{state:'notified'}),row(6)])
  try{
    await assert.rejects(h.cycle('invalid'),/GMAIL_EVENT_ID_INVALID/)
    assert.equal(h.reads.length,0)
    await h.cycle();assert.deepEqual(h.reads,[id(6)])
  }finally{await h.close()}
})
test('lost enqueue response and lost child call converge through hourly recovery',async()=>{
  const h=await harness([row(1),row(2)])
  try{
    h.failures.loseEnqueue=1;h.failures.wake=1
    await h.cycle()
    assert.equal(h.reads.length,0)
    assert.equal(h.rows[0]!.state,'received')
    assert.match(h.rows[0]!.last_error_code,/QUEUE_RESPONSE_UNCONFIRMED/)
    await h.cycle()
    assert.equal(h.queue.overview().states.notified,2)
    assert.equal(new Set(h.reads).size,2)
  }finally{await h.close()}
})
test('lost ACK response reconciles queued ledger with terminal queue without another Gmail read',async()=>{
  const h=await harness([row(1)])
  try{
    h.failures.loseAck=1;await h.cycle()
    assert.equal(h.queue.status(id(1)).state,'notified');assert.equal(h.rows[0]!.state,'queued')
    const notice=h.notices.list('all').items[0]!
    h.notices.decide(notice.id,{decision:'deny',revision:notice.revision,snapshotHash:notice.snapshotHash,requestId:'00000000-0000-4000-8000-000000000001'},'synthetic-operator')
    await h.cycle()
    assert.equal(h.rows[0]!.state,'notified');assert.equal(h.reads.length,1)
    assert.ok(h.calls.includes('status'));assert.equal(h.notices.get(notice.id).status,'denied')
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM gmail_intake_delivery_queue_attempts').get()!.n,1)
  }finally{await h.close()}
})
test('lost intake response reuses immutable notice after backoff, no duplicated notice or decision',async()=>{
  const h=await harness([row(1)])
  try{
    h.failures.loseIntake=1;await h.cycle()
    assert.equal(h.queue.status(id(1)).state,'retry')
    h.advance(3600000);await h.cycle()
    assert.equal(h.queue.status(id(1)).state,'notified')
    assert.equal(h.notices.list('all').total,1)
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM gmail_intake_decisions').get()!.n,0)
  }finally{await h.close()}
})
test('lost claim response expires safely; five failures block and ledger exposes terminal state',async()=>{
  const h=await harness([row(1)])
  try{
    h.failures.loseClaim=1;await h.cycle();assert.equal(h.queue.status(id(1)).state,'leased')
    h.advance(3600000);h.failures.intakeStatus=503;await h.cycle()
    assert.equal(h.queue.status(id(1)).attempts,2)
    for(let n=0;n<3;n++){h.advance(3600000);await h.cycle()}
    assert.equal(h.queue.status(id(1)).state,'blocked')
    assert.equal(h.rows[0]!.last_error_code,'QUEUE_BLOCKED')
    const reads=h.reads.length;await h.cycle();assert.equal(h.reads.length,reads)
  }finally{await h.close()}
})
test('permanent intake failure blocks once; partial feeder failure does not stop other messages',async()=>{
  const h=await harness([row(1),row(2)])
  try{
    h.failures.intakeStatus=409;h.failures.update=1
    await h.cycle()
    assert.equal(h.queue.overview().states.blocked,2)
    await h.cycle()
    assert.ok(h.rows.every(r=>r.state==='blocked'))
    assert.equal(h.reads.length,2)
  }finally{await h.close()}
})
test('duplicate ledger rows and concurrent callers create one notice and do not regress terminal state',async()=>{
  const h=await harness([row(1),row(1,{id:2})])
  try{
    await Promise.all([h.cycle(id(1)),h.cycle(id(1))])
    await h.cycle()
    assert.equal(h.notices.list('all').total,1)
    assert.equal(h.reads.length,1)
    assert.ok(h.rows.every(r=>r.state==='notified'))
    assert.equal(h.queue.status(id(1)).attempts,1)
  }finally{await h.close()}
})
test('mismatched receipt never marks a message delivered and failed row does not poison batch',async()=>{
  const h=await harness([row(1),row(2)])
  try{
    h.failures.wrongReceipt=1;await h.cycle()
    // The second wake may legitimately claim the first (oldest) queue entry.
    // Only that real intake+ACK may mark it notified; the fabricated receipt cannot.
    assert.equal(h.queue.overview().states.notified,1)
    assert.deepEqual(h.reads,[id(1)])
    assert.equal(h.notices.list('all').items[0]!.messageId,id(1))
    assert.equal(h.rows[1]!.state,'queued')
    await h.cycle();assert.equal(h.queue.overview().states.notified,2)
  }finally{await h.close()}
})
test('ACK committed but ledger update failed is repaired without recreating notice',async()=>{
  const h=await harness([row(1)])
  try{
    h.failures.workerUpdate=1;await h.cycle()
    assert.equal(h.queue.status(id(1)).state,'notified');assert.equal(h.rows[0]!.state,'queued')
    await h.cycle()
    assert.equal(h.rows[0]!.state,'notified');assert.equal(h.reads.length,1)
  }finally{await h.close()}
})
test('twenty-five outstanding leases cannot starve a later received ledger row',async()=>{
  const rows=Array.from({length:26},(_,n)=>row(n,{state:n<25?'leased':'received'}))
  const h=await harness(rows)
  try{
    for(let n=0;n<25;n++)h.queue.enqueue(id(n))
    h.queue.claim(25)
    await h.cycle();assert.equal(h.reads.length,0)
    await h.cycle();assert.deepEqual(h.reads,[id(25)])
  }finally{await h.close()}
})
test('intake receipt preserves transient/permanent semantics and bounded JSON stream compatibility',()=>{
  const code=graphs[workerId]!.nodes.find(n=>n.name==='Preparar recibo conservador')!.parameters.jsCode
  const run=(response:Json)=>{
    const result=runInNewContext('(function(){'+code+'})()',{
      $input:{first:()=>({json:response})},
      $:()=>({first:()=>({json:{messageId:id(1),leaseToken:'00000000-0000-4000-8000-000000000001'}})})
    },{timeout:1000})
    return JSON.parse(result[0].json.rawBody) as Json
  }
  for(const statusCode of [400,401,403,404,409,422])assert.equal(run({statusCode,body:{}}).result,'blocked')
  for(const statusCode of [408,429,500,503])assert.equal(run({statusCode,body:{}}).result,'retry')
  assert.equal(run({statusCode:202,body:{status:'authorized',noticeId:'wrong'}}).result,'retry')
  const body={status:'denied',noticeId:'00000000-0000-4000-8000-000000000002'}
  const streamed={_readableState:{buffer:[{type:'Buffer',data:Array.from(Buffer.from(JSON.stringify(body)))}]}}
  assert.equal(run({statusCode:202,body:streamed}).result,'notified')
  assert.equal(run({statusCode:202,body:streamed}).noticeId,body.noticeId)
})
test('local plan is reproducible, credential-free and leaves monitor/publication untouched',()=>{
  assert.equal(plan.deployable,false)
  assert.equal(plan.workflows.length,2)
  assert.equal(JSON.stringify(plan),JSON.stringify(JSON.parse(readFileSync(new URL('../../docs/integracoes/gmail-recovery/local-review-plan.json',import.meta.url),'utf8'))))
  assert.equal(JSON.stringify(plan).includes('"credentials"'),false)
  for(const change of plan.workflows){
    assert.equal(change.settings.saveDataErrorExecution,'none')
    assert.equal(change.nodeChanges.some(n=>/gmailTrigger/.test(n.type)),false)
  }
})
