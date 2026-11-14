import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {createRequestHandler} from '../app.ts'
import {analysisDemo,analysisDemoFlags} from '../../scripts/gmail-analysis-demo.ts'
const origin='http://localhost:5173'
test('API: autenticação, origem, autorização persistida, recuperação e decisão sem execução externa',async()=>{
 const keys=['FUNIX_UPDATES_STORAGE_ENABLED','FUNIX_UPDATES_DECISIONS_ENABLED','FUNIX_UPDATES_CLARIFICATIONS_ENABLED','FUNIX_GMAIL_INTAKE_STORAGE_ENABLED','FUNIX_GMAIL_INTAKE_DECISIONS_ENABLED']
 const saved=keys.map(k=>[k,process.env[k]] as const);analysisDemoFlags();const demo=analysisDemo()
 try{
  const handler=createRequestHandler({atendimentos:demo.atendimentos,gmailAnalysis:demo.service,password:'synthetic-api-password-0123',origin,voiceProvider:null})
  async function send(path:string,method='GET',cookie='',data?:unknown,requestOrigin=origin){
   const req=Object.assign(Readable.from(data===undefined?[]:[JSON.stringify(data)]),{url:path,method,headers:{...(cookie?{cookie}:{}),...(method==='POST'?{origin:requestOrigin,'content-type':'application/json'}:{})},socket:{remoteAddress:'127.0.0.1'}}) as unknown as IncomingMessage
   let status=200,body='';const headers:Record<string,string>={}
   const res={setHeader:(k:string,v:string)=>{headers[k.toLowerCase()]=v},writeHead:(v:number)=>{status=v},end:(v:string)=>{body=v}} as unknown as ServerResponse
   await handler(req,res);return {status,body:JSON.parse(body),headers}
  }
  assert.equal((await send('/api/atualizacoes/analises-gmail')).status,401)
  const login=await send('/api/session','POST','',{password:'synthetic-api-password-0123'}),cookie=login.headers['set-cookie']!.split(';')[0]!
  assert.equal((await send('/api/atualizacoes/analises-gmail?ids=','GET',cookie)).status,200)
  assert.equal((await send('/api/atualizacoes/analises-gmail?ids=wrong','GET',cookie)).status,422)
  const n=demo.notice,retry=`/api/atualizacoes/avisos-gmail/${n.id}/analisar`
  const token={revision:n.revision,snapshotHash:n.snapshotHash,requestId:randomUUID()}
  assert.equal((await send(retry,'POST',cookie,token)).status,403)
  assert.equal((await send(retry,'POST',cookie,token,'http://untrusted.invalid')).status,403)
  assert.equal(demo.service.get(n.id),null)
  const authorized=await send(`/api/atualizacoes/avisos-gmail/${n.id}/decisao`,'POST',cookie,{...token,decision:'authorize'})
  assert.equal(authorized.status,200);await demo.service.drain()
  const analysis=(await send(`/api/atualizacoes/analises-gmail?ids=${n.id}`,'GET',cookie)).body.items[0]
  assert.equal(analysis.state,'ready');assert.equal(analysis.proposal.reviewOnly,true)
  assert.equal((await send('/api/atualizacoes?visao=open','GET',cookie)).body.total,0)
  assert.equal((await send('/api/atualizacoes/avisos-gmail?visao=open','GET',cookie)).body.total,1)
  assert.equal((await send(retry,'POST',cookie,token)).status,409)
  const p=analysis.proposal,route=`/api/atualizacoes/${p.id}/decisao`,input={revision:p.revision,snapshotHash:p.snapshotHash,requestId:randomUUID(),decision:'approve'}
  assert.equal((await send(route,'POST','',input)).status,401)
  assert.equal((await send(route,'POST',cookie,input,'http://untrusted.invalid')).status,403)
  const approved=await send(route,'POST',cookie,input);assert.equal(approved.status,200);assert.equal(approved.body.status,'approved_pending_execution')
  assert.equal((await send(route,'POST',cookie,input)).body.revision,approved.body.revision)
  assert.equal((await send(route,'POST',cookie,{...input,requestId:randomUUID()})).status,409)
  assert.equal(demo.db.prepare('SELECT COUNT(*) AS n FROM update_package_decisions').get()!.n,1)
  assert.equal(demo.db.prepare("SELECT COUNT(*) AS n FROM update_packages WHERE status='executed'").get()!.n,0)
 }finally{await demo.service.stop();demo.db.close();for(const [k,v] of saved)if(v===undefined)delete process.env[k];else process.env[k]=v}
})
