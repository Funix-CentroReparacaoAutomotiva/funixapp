import{syntheticRenderer}from'./fixtures/budget-renderer.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createRequestHandler } from '../app.ts'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import {commercialFixture} from './fixtures/commercial.ts'

const origin = 'http://localhost:5173'
const password = 'test-only-password-123'

function start(secret: string | undefined = password, now?: () => number, appOrigin = origin, revision?: string) {
  const db = openDatabase(':memory:')
  const repository = new AtendimentoRepository(db)
  const handler = createRequestHandler({budgetRenderer:syntheticRenderer, atendimentos: repository, password: secret, origin: appOrigin, now, revision })
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const req = Object.assign(Readable.from(init?.body ? [String(init.body)] : []), {
      url: path, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers)), socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    const headers = new Headers()
    let status = 200
    let body = ''
    const res = {
      setHeader(name: string, value: string) { headers.set(name, value) },
      writeHead(value: number) { status = value },
      end(value: string) { body = value },
    } as unknown as ServerResponse
    await handler(req, res)
    return new Response(body, { status, headers })
  }
  const login = () => request('/api/session', { method: 'POST', headers: { Origin: appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
  const write = async (path: string, method: string, body: unknown, cookie: string, writeOrigin = appOrigin) => request(path, { method, headers: { Origin: writeOrigin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { db, repository, request, login, write, close: () => db.close() }
}

async function authenticate(app: ReturnType<typeof start>) {
  const login = await app.login()
  assert.equal(login.status, 200)
  return login.headers.get('set-cookie')!.split(';')[0]!
}

test('Issue20 authenticated configuration flags drive preview and discount emission guards through the actual HTTP handler',async()=>{
 const app=start()
 try{
  const f=commercialFixture(app.db),cookie=await authenticate(app),path='/api/atendimentos/'+f.at.id
  const config=structuredClone(f.config);config.services[0]!.colorFactorEnabled=false;config.services[0]!.discountable=false;config.colors=[]
  const saved=await app.write('/api/precificacao','PATCH',{revision:f.pricing.get().revision,config},cookie)
  assert.equal(saved.status,200);assert.equal((await saved.json()).config.services[0].discountable,false)
  const request={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const normal=await app.write(path+'/orcamentos/previa','POST',request,cookie),p=await normal.json()
  assert.equal(normal.status,200);assert.equal(p.canEmit,true);assert.equal(p.snapshot.calculation.total,'300.15')
  const deal={...request,negotiation:{mode:'discount',value:'1',acknowledgeResidual:false}}
  const blocked=await app.write(path+'/orcamentos/previa','POST',deal,cookie),preview=await blocked.json()
  assert.equal(preview.canEmit,false);assert.equal(preview.snapshot.calculation.discountEligibleSubtotal,'0')
  const emit=await app.write(path+'/orcamentos','POST',{...deal,previewToken:preview.token,idempotencyKey:'issue20-blocked-discount'},cookie)
  assert.equal(emit.status,422)
  assert.equal((await app.write('/api/precificacao','PATCH',{revision:f.pricing.get().revision,config},cookie,'https://invalid.example')).status,403)
  const invalid=structuredClone(config);Object.assign(invalid.services[0]!,{discountable:'true'})
  assert.equal((await app.write('/api/precificacao','PATCH',{revision:f.pricing.get().revision,config:invalid},cookie)).status,400)
 }finally{app.close()}
})

test('health reflects local SQLite and protected reads/writes require authentication', async () => {
  const app = start()
  try {
    const health = await app.request('/api/health')
    assert.equal(health.status, 200)
    const body = await health.json()
    assert.equal(body.source.system, 'app')
    assert.equal(body.source.storage, 'sqlite')
    assert.equal(body.capabilities.erp, false)
    for (const method of ['GET', 'POST', 'PATCH']) {
      const response = await app.request('/api/atendimentos', { method })
      assert.equal(response.status, 401)
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED')
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  } finally { app.close() }
})

test('session is HttpOnly, expires, and deletion revokes it', async () => {
  let current = 1000
  const app = start(password, () => current)
  try {
    const login = await app.login()
    const cookieHeader = login.headers.get('set-cookie')!
    assert.match(cookieHeader, /HttpOnly; SameSite=Strict; Path=\/api/)
    const cookie = cookieHeader.split(';')[0]!
    assert.equal((await (await app.request('/api/session', { headers: { Cookie: cookie } })).json()).authenticated, true)
    assert.equal((await app.request('/api/atendimentos', { headers: { Cookie: cookie } })).status, 200)
    current += 8 * 60 * 60 * 1000 + 1
    assert.equal((await app.request('/api/atendimentos', { headers: { Cookie: cookie } })).status, 401)
    const secondCookie = await authenticate(app)
    assert.equal((await app.request('/api/session', { method: 'DELETE', headers: { Cookie: secondCookie, Origin: origin } })).status, 200)
    assert.equal((await app.request('/api/atendimentos', { headers: { Cookie: secondCookie } })).status, 401)
  } finally { app.close() }
})

test('rejects cross-origin login and locks excessive login failures', async () => {
  const app = start()
  try {
    assert.equal((await app.request('/api/session', { method: 'POST', headers: { Origin: 'https://invalid.example' } })).status, 403)
    for (let index = 0; index < 8; index++) {
      const response = await app.request('/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })
      assert.equal(response.status, 401)
    }
    assert.equal((await app.login()).status, 429)
  } finally { app.close() }
})

test('creates, searches, edits and reopens local Atendimento without any Coda or network call', async () => {
  const app = start()
  const oldFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('No network permitted in local commercial') }
  try {
    const cookie = await authenticate(app)
    const created = await app.write('/api/atendimentos', 'POST', { phone: '+55 (11) 99999-1000' }, cookie)
    assert.equal(created.status, 201)
    const record = await created.json()
    assert.match(record.id, /^[\da-f-]{36}$/)
    assert.equal(record.phoneNormalized, '+5511999991000')
    assert.equal(record.name, '')
    const update = await app.write(`/api/atendimentos/${record.id}`, 'PATCH', { revision: record.revision, name: 'Contato de teste', plate: 'TESTE01', notes: 'Primeira revisão' }, cookie)
    assert.equal(update.status, 200)
    const updated = await update.json()
    assert.equal(updated.revision, 2)
    const headers = { Cookie: cookie }
    const list = await (await app.request('/api/atendimentos?q=TESTE01', { headers })).json()
    assert.equal(list.total, 1)
    assert.equal(list.items[0].id, record.id)
    const opened = await (await app.request(`/api/atendimentos/${record.id}`, { headers })).json()
    assert.equal(opened.phone, record.phone)
    assert.equal(opened.notes, 'Primeira revisão')
    assert.equal((await app.request('/api/workspace', { headers })).status, 410)
    assert.equal((await app.request('/api/experiencias/i-test', { headers })).status, 410)
    assert.equal(networkCalls, 0)
  } finally { globalThis.fetch = oldFetch; app.close() }
})

test('writes require origin and JSON; reject malformed payloads, readonly fields and oversized bodies', async () => {
  const app = start()
  try {
    const cookie = await authenticate(app)
    assert.equal((await app.write('/api/atendimentos', 'POST', { phone: '1' }, cookie, 'https://invalid.example')).status, 403)
    assert.equal((await app.request('/api/atendimentos', { method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: '{}' })).status, 415)
    assert.equal((await app.request('/api/atendimentos', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{' })).status, 400)
    for (const body of [{}, { phone: '   ' }, { phone: 12 }, { phone: 'abc' }, { phone: '1', id: 'chosen' }, { phone: '1', stage: 'Agendado' }, { phone: '1', notes: 10 }]) {
      assert.equal((await app.write('/api/atendimentos', 'POST', body, cookie)).status, 400)
    }
    assert.equal((await app.write('/api/atendimentos', 'POST', { phone: '1', notes: 'x'.repeat(70_000) }, cookie)).status, 413)
    assert.equal((await app.request('/api/atendimentos?limit=999', { headers: { Cookie: cookie } })).status, 400)
    assert.equal((await app.request('/api/atendimentos/not-an-id', { headers: { Cookie: cookie } })).status, 404)
    assert.equal((await app.write('/api/atendimentos', 'DELETE', {}, cookie)).status, 405)
    assert.equal(app.repository.list().total, 0)
  } finally { app.close() }
})

test('stale editing and rejected stage need explicit review; neither silently changes data', async () => {
  const app = start()
  try {
    const cookie = await authenticate(app)
    const original = await (await app.write('/api/atendimentos', 'POST', { phone: '1', name: 'Original' }, cookie)).json()
    const path = `/api/atendimentos/${original.id}`
    assert.equal((await app.write(path, 'PATCH', { revision: 1, stage: 'rejeitados' }, cookie)).status, 400)
    assert.equal((await app.write(path, 'PATCH', { revision: 1, stage: 'aguardando-dados' }, cookie)).status, 200)
    const stale = await app.write(path, 'PATCH', { revision: 1, name: 'Stale' }, cookie)
    assert.equal(stale.status, 409)
    assert.equal((await stale.json()).error.code, 'VERSION_CONFLICT')
    assert.equal(app.repository.get(original.id).name, 'Original')
    assert.equal((await app.write(path, 'PATCH', { revision: 2, stage: 'rejeitados', explicitRefusal: true, rejectionReason: 'Recusa explícita de teste' }, cookie)).status, 200)
  } finally { app.close() }
})

test('short/unconfigured password leaves access closed and readiness reflects database failures', async () => {
  const app = start('short')
  try {
    assert.deepEqual(await (await app.request('/api/session')).json(), { authenticated: false, configured: false })
    assert.equal((await app.login()).status, 503)
    assert.equal((await app.request('/api/ready')).status, 503)
  } finally { app.close() }
  const unavailable = start()
  unavailable.close()
  const ready = await unavailable.request('/api/ready')
  assert.equal(ready.status, 503)
  assert.equal((await ready.json()).error.code, 'DATABASE_UNAVAILABLE')
})

test('HTTPS production origin keeps secure cookies and reports readiness without exposing credentials', async () => {
  const revision = 'a'.repeat(40)
  const app = start(password, undefined, 'https://app.funix.com.br', revision)
  try {
    const ready = await app.request('/api/ready')
    assert.equal(ready.status, 200)
    assert.deepEqual(await ready.json(), { status: 'ready', revision, source: 'app', storage: 'sqlite' })
    const login = await app.login()
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie')!, /; Secure$/)
    assert.equal((await app.request('/api/session', { method: 'DELETE', headers: { Origin: 'http://app.funix.com.br' } })).status, 403)
  } finally { app.close() }
})


test('commercial APIs enforce authentication/origin/JSON and operate entirely locally with encoded V2 identifiers', async () => {
  const app = start()
  const oldFetch = globalThis.fetch
  let network = 0
  globalThis.fetch = async () => { network++; throw new Error('External network forbidden') }
  try {
    for (const path of ['/api/catalogos', '/api/catalogos/v2%3Acapo', '/api/atendimentos/synthetic/diagnosticos']) {
      assert.equal((await app.request(path)).status, 401)
    }
    const cookie = await authenticate(app), headers = { Cookie: cookie }
    const at = app.repository.create({ phone: '123' })
    const path = `/api/atendimentos/${at.id}/diagnosticos`
    const catalog = await (await app.request('/api/catalogos', { headers })).json()
    assert.equal(catalog.items.length, 163)
    const piece = catalog.items.find((item: { code: string }) => item.code === 'capo')
    const itemPath = `/api/catalogos/${encodeURIComponent(piece.id)}`
    assert.equal((await app.request(itemPath, { headers })).status, 200)
    assert.equal((await app.request('/api/catalogos/%FF', { headers })).status, 400)
    assert.equal((await app.write(path, 'POST', { pieceCodes: ['capo'] }, cookie)).status, 200)
    assert.equal((await app.write(itemPath, 'PATCH', { revision: 1, name: 'Capô sintético' }, cookie, 'https://other.example')).status, 403)
    assert.equal((await app.request(itemPath, { method: 'PATCH', headers: { ...headers, Origin: origin }, body: '{}' })).status, 415)
    assert.equal((await app.write(itemPath, 'PATCH', { revision: 1, name: 'Capô sintético' }, cookie)).status, 200)
    assert.equal((await (await app.request(itemPath + '/historico', { headers })).json()).length, 2)
    assert.equal((await app.write(itemPath, 'DELETE', {}, cookie)).status, 405)
    const add = await app.write(path, 'POST', { pieceCodes: ['capo'] }, cookie)
    assert.equal(add.status, 200)
    const item = (await add.json())[0]
    const createdService = await app.write('/api/catalogos', 'POST', { kind: 'servico', name: 'Serviço sintético' }, cookie)
    assert.equal(createdService.status, 201)
    const service = await createdService.json()
    const itemUrl = `${path}/${item.id}`
    assert.equal((await app.write(itemUrl, 'PATCH', { revision: 1, notes: 'Teste', services: [{ serviceId: service.id, quantity: '2' }] }, cookie)).status, 200)
    assert.equal((await app.write(itemUrl, 'PATCH', { revision: 1, notes: 'Stale' }, cookie)).status, 409)
    assert.equal((await app.write(itemUrl, 'PATCH', { revision: 2, notes: 'x'.repeat(70000) }, cookie)).status, 413)
    assert.equal((await app.write(itemUrl, 'DELETE', { revision: 2 }, cookie, 'https://other.example')).status, 403)
    assert.equal((await (await app.request(path, { headers })).json())[0].services.length, 1)
    assert.equal((await app.write(itemUrl, 'DELETE', { revision: 2,compositionRevision:Number(app.db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(at.id)!.revision),scenarios:new (await import('../scenarios.ts')).ScenarioRepository(app.db).list(at.id).map(s=>({id:s.id,revision:s.revision})) }, cookie)).status, 200)
    assert.deepEqual(await (await app.request(path, { headers })).json(), [])
    assert.equal(network, 0)
  } finally { globalThis.fetch = oldFetch; app.close() }
})

test('pricing, components, scenarios and immutable PDF APIs retain auth/origin protections and have no external transport',async()=>{
 const app=start()
 const oldFetch=globalThis.fetch;let calls=0
 globalThis.fetch=async()=>{calls++;throw new Error('External transport forbidden')}
 try {
  for(const path of ['/api/precificacao','/api/atendimentos/test/cenarios','/api/atendimentos/test/orcamentos'])assert.equal((await app.request(path)).status,401)
  const cookie=await authenticate(app),headers={Cookie:cookie}
  const {commercialFixture}=await import('./fixtures/commercial.ts')
  const f=commercialFixture(app.db),path=`/api/atendimentos/${f.at.id}`
  assert.equal((await app.write('/api/precificacao','PATCH',{revision:2,config:f.config},cookie,'https://invalid.example')).status,403)
  const workspace=await(await app.request(path+'/cenarios',{headers})).json()
  assert.equal(workspace.calculations[0].total,'300.15')
  const input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  const preview=await(await app.write(path+'/orcamentos/previa','POST',input,cookie)).json()
  assert.equal(preview.canEmit,true)
  assert.equal((await app.write(path+'/orcamentos','POST',{...input,previewToken:preview.token,idempotencyKey:'synthetic-api-request'},cookie,'https://invalid.example')).status,403)
  const issued=await app.write(path+'/orcamentos','POST',{...input,previewToken:preview.token,idempotencyKey:'synthetic-api-request'},cookie)
  assert.equal(issued.status,201)
  const version=await issued.json(),pdfUrl=path+'/orcamentos/'+version.id+'/pdf'
  assert.equal((await app.request(pdfUrl)).status,401)
  const pdf=await app.request(pdfUrl,{headers});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf')
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,8).toString(),'%PDF-1.7')
  assert.equal((await app.write(path+'/orcamentos/'+version.id,'DELETE',{},cookie)).status,405)
  assert.equal((await(await app.request(path+'/orcamentos',{headers})).json()).length,1)
  assert.equal(calls,0)
 }finally{globalThis.fetch=oldFetch;app.close()}
})

test('scenario DELETE requires auth/origin/revision, protects last scenario and GET safely falls back after deletion',async()=>{
 const app=start()
 try{
  const at=app.repository.create({phone:'123'}),path=`/api/atendimentos/${at.id}/cenarios`,cookie=await authenticate(app)
  const get=async(url=path)=>{const r=await app.request(url,{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json()}
  const original=await get(),one=original.scenarios[0]
  const created=await app.write(path,'POST',{name:'Cópia',duplicateFrom:one.id,sourceRevision:one.revision},cookie);assert.equal(created.status,201)
  const two=await created.json(),url=path+'/'+two.id
  assert.equal((await app.request(url,{method:'DELETE'})).status,401)
  assert.equal((await app.write(url,'DELETE',{revision:two.revision},cookie,'https://invalid.example')).status,403)
  assert.equal((await app.write(url,'DELETE',{},cookie)).status,400)
  assert.equal((await app.write(url,'DELETE',{revision:two.revision+1},cookie)).status,409)
  assert.equal((await app.write(url,'DELETE',{revision:two.revision},cookie)).status,200)
  const fallback=await get(path+'?scenarioId='+encodeURIComponent(two.id));assert.equal(fallback.selectedId,one.id);assert.equal(fallback.scenarios.length,1)
  const last=await app.write(path+'/'+one.id,'DELETE',{revision:one.revision},cookie);assert.equal(last.status,409);assert.equal((await last.json()).error.code,'LAST_SCENARIO')
 }finally{app.close()}
})

test('Issue22 opt-in save acknowledgements report actual scenario revision, default replies unchanged and stale writes atomic',async()=>{
 const app=start()
 try{
  const f=commercialFixture(app.db),cookie=await authenticate(app),base='/api/atendimentos/'+f.at.id
  const context=async(path:string,method:string,body:unknown)=>app.request(path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-Funix-Include-Revision':'1'},body:JSON.stringify(body)})
  const before=(await (await app.request(base+'/cenarios',{headers:{Cookie:cookie}})).json()).scenarios[0]
  const saved=await context(base+'/diagnosticos/'+f.item.id,'PATCH',{revision:f.item.revision,scenarioId:before.id,scenarioRevision:before.revision,notes:'Issue22 QA'})
  assert.equal(saved.status,200);const reply=await saved.json();assert.equal(reply.item.notes,'Issue22 QA');assert.equal(reply.scenarioRevision,before.revision+1)
  const stale=await context(base+'/diagnosticos/'+f.item.id,'PATCH',{revision:reply.item.revision,scenarioId:before.id,scenarioRevision:before.revision,notes:'must not overwrite'})
  assert.equal(stale.status,409);assert.equal(f.commercial.list(f.at.id)[0]!.notes,'Issue22 QA')
  const part=await context(base+'/componentes','POST',{pieceId:f.item.id,scenarioId:before.id,scenarioRevision:reply.scenarioRevision,name:'QA',quantity:'0.25',manualPrice:'10',notes:''})
  assert.equal(part.status,201);const p=await part.json();assert.equal(p.item.quantity,'0.25');assert.equal(p.scenarioRevision,reply.scenarioRevision+1)
  const ordinary=await app.write(base+'/componentes/'+p.item.id,'PATCH',{revision:p.item.revision,scenarioId:before.id,name:'QA normal',pieceId:f.item.id,quantity:'0.25',manualPrice:'10',notes:''},cookie)
  const plain=await ordinary.json();assert.equal(plain.name,'QA normal');assert.equal(plain.item,undefined)
  const workspace=await (await app.request(base+'/cenarios',{headers:{Cookie:cookie}})).json();assert.equal(workspace.scenarios[0].revision,p.scenarioRevision+1)
 }finally{app.close()}
})

test('Issue22 acknowledgement revision is captured inside the write transaction, before a subsequent writer',async()=>{
 const app=start(),exec=app.db.exec.bind(app.db)
 try{
  const f=commercialFixture(app.db),cookie=await authenticate(app),base='/api/atendimentos/'+f.at.id,s=f.scenarios.list(f.at.id)[0]!
  let armed=true
  app.db.exec=(sql)=>{const result=exec(sql);if(armed&&sql==='COMMIT'){armed=false;app.db.prepare('UPDATE scenarios SET revision=revision+1 WHERE id=?').run(s.id)}return result}
  const response=await app.request(base+'/diagnosticos/'+f.item.id,{method:'PATCH',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-Funix-Include-Revision':'1'},body:JSON.stringify({revision:f.item.revision,scenarioId:s.id,scenarioRevision:s.revision,notes:'QA atomic acknowledgement'})})
  assert.equal(response.status,200);const saved=await response.json()
  assert.equal(saved.scenarioRevision,s.revision+1);assert.equal(f.scenarios.list(f.at.id)[0]!.revision,s.revision+2)
  const stale=await app.write(base+'/cenarios/'+s.id,'PATCH',{revision:saved.scenarioRevision,pieceFlags:{[f.item.id]:false}},cookie)
  assert.equal(stale.status,409)
 }finally{app.db.exec=exec;app.close()}
})

test('Stage2 authenticated batch DELETE guards origin, all scenario revisions and atomicity; replay never deletes another identity',async()=>{
 const app=start();try{
  const f=commercialFixture(app.db),cookie=await authenticate(app),headers={Cookie:cookie},path='/api/atendimentos/'+f.at.id
  f.commercial.add(f.at.id,{pieceCodes:['alma_para_choque_dianteiro']})
  const read=async()=>await(await app.request(path+'/cenarios',{headers})).json()
  const w=await read(),pieces=w.items.map((p:{id:string;revision:number})=>({id:p.id,revision:p.revision})),request={pieces,compositionRevision:w.revision,scenarios:w.scenarios.map((s:{id:string;revision:number})=>({id:s.id,revision:s.revision}))}
  assert.equal((await app.request(path+'/diagnosticos',{method:'DELETE'})).status,401)
  assert.equal((await app.write(path+'/diagnosticos','DELETE',request,cookie,'https://wrong.example')).status,403)
  assert.equal((await app.write(path+'/diagnosticos','DELETE',{pieces},cookie)).status,400)
  const s=w.scenarios[0];f.scenarios.update(f.at.id,s.id,{revision:s.revision,pieceFlags:{[f.item.id]:false}})
  assert.equal((await app.write(path+'/diagnosticos','DELETE',request,cookie)).status,409);assert.equal((await read()).items.length,2)
  const current=await read();const fresh={...request,scenarios:current.scenarios.map((s:{id:string;revision:number})=>({id:s.id,revision:s.revision}))}
  const deleted=await app.write(path+'/diagnosticos','DELETE',fresh,cookie);assert.equal(deleted.status,200);assert.deepEqual((await deleted.json()).removedIds.sort(),pieces.map((p:{id:string})=>p.id).sort());assert.equal((await read()).items.length,0)
  f.commercial.add(f.at.id,{pieceCodes:['capo']});assert.equal((await app.write(path+'/diagnosticos','DELETE',fresh,cookie)).status,409);const after=await read();assert.equal(after.items.length,1);assert.notEqual(after.items[0].id,f.item.id)
 }finally{app.close()}
})

test('curation confirmation HTTP rejects auth/origin/scope/mask bypass, persists exact scenario authority and blocks hidden new inclusions',async()=>{
 const{curationFixture}=await import('./fixtures/curation.ts'),{ScenarioRepository}=await import('../scenarios.ts'),{executionScope}=await import('../../shared/commercial-curation.ts')
 const app=start()
 try{const f=curationFixture(app.db),cookie=await authenticate(app),at='/api/atendimentos/'+f.at.id,item=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,services:[{serviceId:f.ids.third,dimensionId:f.dimensions.third,quantity:'1'}]}),line=item.services[0]!,scenarios=new ScenarioRepository(app.db),s=scenarios.list(f.at.id)[0]!,path=at+'/cenarios/'+s.id+'/servicos/'+line.id+'/confirmacao',payload={revision:s.revision,pieceRevision:item.revision,scope:executionScope(line),confirmed:true}
  assert.equal((await app.write(path,'PATCH',payload,'')).status,401)
  assert.equal((await app.write(path,'PATCH',payload,cookie,'https://invalid.example')).status,403)
  assert.equal((await app.write(path,'PATCH',{...payload,scope:'stale'},cookie)).status,409)
  assert.equal((await app.write(path,'PATCH',payload,cookie)).status,200)
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM scenario_service_confirmations').get()!.n,1)
  assert.equal((await app.write(path,'PATCH',payload,cookie)).status,409)
  const current=scenarios.list(f.at.id)[0]!
  assert.equal((await app.write(at+'/cenarios/'+s.id,'PATCH',{revision:current.revision,serviceConfirmations:{[line.id]:payload.scope}},cookie)).status,400)
  const copy=scenarios.create(f.at.id,{name:'Copy',duplicateFrom:current.id,sourceRevision:current.revision});assert(!copy.serviceConfirmations)
  const denied=await app.write(at+'/diagnosticos/'+item.id,'PATCH',{revision:item.revision,services:[{serviceId:f.ids.hidden,dimensionId:f.dimensions.hidden,quantity:'1'}]},cookie);assert.equal(denied.status,409)
  assert.equal(f.commercial.list(f.at.id)[0]!.services[0]!.serviceId,f.ids.third)
  const readonly=await app.write(at+'/diagnosticos/'+item.id,'PATCH',{revision:item.revision,services:[{...line,executionConfirmed:true}]},cookie);assert.equal(readonly.status,400)
 }finally{app.close()}
})

test('Fase2 HTTP percentage persistence/guards and explicit one-time initialization never mutate through GET',async()=>{
 const app=start()
 try{
  const f=commercialFixture(app.db),cookie=await authenticate(app),path='/api/atendimentos/'+f.at.id+'/parametros'
  app.db.prepare('UPDATE commercial_state SET settings_json=? WHERE atendimento_id=?').run('{}',f.at.id)
  const before=String(app.db.prepare('SELECT settings_json FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!.settings_json)
  const read=await app.request(path,{headers:{Cookie:cookie}});assert.equal(read.status,200)
  assert.equal(String(app.db.prepare('SELECT settings_json FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!.settings_json),before)
  assert.equal((await app.write(path+'/inicializar','POST',{},'')).status,401)
  assert.equal((await app.write(path+'/inicializar','POST',{},cookie,'https://invalid.example')).status,403)
  const initialized=await app.write(path+'/inicializar','POST',{},cookie);assert.equal(initialized.status,200);const current=await initialized.json();assert.equal(current.settings.mrPercent,'20')
  const again=await app.write(path+'/inicializar','POST',{},cookie);assert.deepEqual(await again.json(),current)
  for(const mrPercent of['','-1','NaN','Infinity','25,5',20])assert.equal((await app.write(path,'PATCH',{revision:current.revision,mrPercent},cookie)).status,400)
  const saved=await app.write(path,'PATCH',{revision:current.revision,mrPercent:'25.5'},cookie);assert.equal(saved.status,200);assert.equal((await saved.json()).settings.mrPercent,'25.5')
  assert.equal((await app.write(path,'PATCH',{revision:current.revision,mrPercent:'0'},cookie)).status,409)
  const latest=await(await app.request(path,{headers:{Cookie:cookie}})).json();assert.equal(latest.settings.mrPercent,'25.5')
 }finally{app.close()}
})

test('Fase3 authenticated intensity persistence and read-only recommendation lookup preserve composition; invalid and stale writes rejected',async()=>{
 const app=start()
 try{
  const{recommendationsFixture}=await import('./fixtures/recommendations.ts'),{planRecommendations,applyRecommendations}=await import('../diagnosis-recommendations.ts')
  const f=commercialFixture(app.db),rules=recommendationsFixture(app.db),plan=planRecommendations(app.db,rules.source);applyRecommendations(app.db,rules.source,plan.planHash)
  const cookie=await authenticate(app),path='/api/atendimentos/'+f.at.id+'/diagnosticos/'+f.item.id
  const route='/api/recomendacoes?diagnosisId='+encodeURIComponent(rules.diagnosisId)+'&intensity=moderado'
  assert.equal((await app.request(route)).status,401)
  const query=await app.request(route,{headers:{Cookie:cookie}});assert.equal(query.status,200);const data=await query.json();assert.equal(data.items.length,1);assert.equal(data.items[0].selectedByDefault,false)
  assert.equal((await app.write('/api/recomendacoes','POST',{},cookie)).status,405)
  for(const q of['?intensity=extremo','?intensity=leve&diagnosisId=x&diagnosisId=y','?diagnosisId=x&intensity=leve&apply=true'])assert.equal((await app.request('/api/recomendacoes'+q,{headers:{Cookie:cookie}})).status,400)
  const before=f.commercial.list(f.at.id)[0]!,saved=await app.write(path,'PATCH',{revision:before.revision,intensity:'leve'},cookie);assert.equal(saved.status,200);const item=await saved.json();assert.equal(item.intensity,'leve');assert.deepEqual(item.services,before.services)
  assert.equal((await app.write(path,'PATCH',{revision:before.revision,intensity:'severo'},cookie)).status,409)
  assert.equal((await app.write(path,'PATCH',{revision:item.revision,intensity:'improvável'},cookie)).status,400)
  const again=await app.request('/api/atendimentos/'+f.at.id+'/cenarios',{headers:{Cookie:cookie}});assert.equal((await again.json()).items[0].intensity,'leve')
 }finally{app.close()}
})

test('Fase4 recommendation batch endpoint enforces session/origin/JSON/revisions and replays the same verified receipt without duplicates',async()=>{
 const app=start()
 try{
  const{fase4Fixture}=await import('./fixtures/fase4.ts'),f=fase4Fixture(app.db),p=f.commercial.updateDiagnosis(f.at.id,f.item.id,{revision:f.item.revision,diagnosisId:f.diagnosis.id,intensity:'leve'}),s=f.scenarios.list(f.at.id)[0]!,path='/api/atendimentos/'+f.at.id+'/diagnosticos/'+p.id+'/recomendacoes',input={revision:p.revision,scenarioId:s.id,scenarioRevision:s.revision,diagnosisId:p.diagnosisId,intensity:p.intensity,mode:'automatic',idempotencyKey:'fase4-api-stable-key'}
  assert.equal((await app.write(path,'POST',input,'')).status,401);const cookie=await authenticate(app);assert.equal((await app.write(path,'POST',input,cookie,'https://invalid.example')).status,403);assert.equal((await app.request(path,{headers:{Cookie:cookie}})).status,405)
  assert.equal((await app.write(path,'POST',{...input,revision:input.revision-1},cookie)).status,409)
  for(const mode of[['automatic'],null,true,'other'])assert.equal((await app.write(path,'POST',{...input,mode},cookie)).status,400)
  const saved=await app.write(path,'POST',input,cookie);assert.equal(saved.status,200);const ack=await saved.json();assert.equal(ack.created.length,6);assert.equal(ack.idempotencyKey,input.idempotencyKey);assert.equal(ack.item.services.length,6)
  const replay=await app.write(path,'POST',input,cookie);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),ack);assert.equal(f.commercial.list(f.at.id)[0]!.services.length,6)
 }finally{app.close()}
})

test('PDF configuration API is global, authenticated, validates revision and cannot be written through Atendimento parameters',async()=>{
 const app=start();try{
  assert.equal((await app.request('/api/parcelamento')).status,401);const cookie=await authenticate(app)
  const initial=await(await app.request('/api/parcelamento',{headers:{Cookie:cookie}})).json();assert.equal(initial.rates.tres,'6')
  assert.equal((await app.write('/api/parcelamento','PATCH',{revision:1,rates:initial.rates},cookie,'https://other.invalid')).status,403)
  const saved=await app.write('/api/parcelamento','PATCH',{revision:1,rates:{...initial.rates,tres:'7.5'}},cookie);assert.equal(saved.status,200)
  assert.equal((await app.write('/api/parcelamento','PATCH',{revision:1,rates:initial.rates},cookie)).status,409)
  assert.equal((await app.write('/api/parcelamento','PATCH',{revision:2,rates:{...initial.rates,tres:'-1'}},cookie)).status,400)
  const f=commercialFixture(app.db);assert.equal((await app.write(`/api/atendimentos/${f.at.id}/parametros`,'PATCH',{revision:f.pricing.settings(f.at.id).revision,rates:initial.rates},cookie)).status,400)
  const scene=f.scenarios.list(f.at.id)[0]!,path=`/api/atendimentos/${f.at.id}/cenarios/${scene.id}`
  assert.equal((await app.write(path,'PATCH',{revision:scene.revision,deadline:{mode:'manual',manualDays:0}},cookie)).status,400)
  const deadline=await app.write(path,'PATCH',{revision:scene.revision,deadline:{mode:'manual',manualDays:7}},cookie);assert.equal(deadline.status,200);assert.deepEqual((await deadline.json()).deadline,{mode:'manual',manualDays:7})
  assert.equal((await app.write(path,'PATCH',{revision:scene.revision,deadline:{mode:'automatic',manualDays:null}},cookie)).status,409)
 }finally{app.close()}
})

test('real PDF preview endpoint is authenticated, same-origin, inline/no-store and has no durable side effects',async()=>{
 const app=start()
 try{
  const f=commercialFixture(app.db),path='/api/atendimentos/'+f.at.id+'/orcamentos',input={scenarioId:f.scenario.id,negotiation:{mode:'none'}}
  assert.equal((await app.request(path+'/previa-pdf',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401)
  const cookie=await authenticate(app),p=await(await app.write(path+'/previa','POST',input,cookie)).json(),body={...input,previewToken:p.token}
  assert.equal((await app.write(path+'/previa-pdf','POST',body,cookie,'https://elsewhere.invalid')).status,403)
  assert.equal((await app.request(path+'/previa-pdf',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'text/plain'},body:'{}'})).status,415)
  const response=await app.write(path+'/previa-pdf','POST',body,cookie)
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf')
  assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition')!,/^inline/)
  assert.match(Buffer.from(await response.arrayBuffer()).toString('latin1'),/^%PDF/)
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM budget_emission_attempts').get()!.n,0)
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM budget_versions').get()!.n,0)
 }finally{app.close()}
})
