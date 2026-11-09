import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { AtendimentoRepository } from '../atendimentos.ts'
import { UpdatePackageRepository } from '../update-packages.ts'
import { createUpdatePackageSchema } from '../update-packages-schema.ts'
import { createRequestHandler } from '../app.ts'
import { syntheticRenderer } from './fixtures/budget-renderer.ts'

const origin='http://localhost:5173'
test('Atualizações: sessão exigida, consulta vazia e nenhuma execução por aprovação desabilitada',async()=>{
 const db=openDatabase(':memory:')
 try{
  const handler=createRequestHandler({atendimentos:new AtendimentoRepository(db),password:'test-only-password-123',origin,budgetRenderer:syntheticRenderer,voiceProvider:null})
  async function send(path:string, method='GET', cookie='', data?:unknown){
   const req=Object.assign(Readable.from(data===undefined?[]:[JSON.stringify(data)]),{url:path,method,headers:{
    ...(cookie?{cookie}:{}),...(method==='POST'?{origin,'content-type':'application/json'}:{})
   },socket:{remoteAddress:'127.0.0.1'}}) as unknown as IncomingMessage
   let status=200,body='',headers:Record<string,string>={}
   const res={setHeader:(key:string,value:string)=>{headers[key.toLowerCase()]=value},writeHead:(value:number)=>{status=value},end:(value:string)=>{body=value}} as unknown as ServerResponse
   await handler(req,res)
   return {status,body:JSON.parse(body),headers}
  }
  assert.equal((await send('/api/atualizacoes')).status,401)
  const session=await send('/api/session','POST','',{password:'test-only-password-123'})
  assert.equal(session.status,200)
  const cookie=session.headers['set-cookie']!.split(';')[0]!
  const empty=await send('/api/atualizacoes?visao=open','GET',cookie)
  assert.equal(empty.status,200)
  assert.equal(empty.body.total,0)
  assert.equal(empty.body.decisionsEnabled,false)
  createUpdatePackageSchema(db)
  const pkg=new UpdatePackageRepository(db).createProposal({
   source:'gmail',sourceReference:'synthetic-email',experienceId:'XP1234',plate:'ABC1D23',
   title:'Pacote sintético',summary:'Nenhum sistema externo será alterado',
   actions:[{id:'one',type:'drive_archive',title:'Arquivar documento',detail:'Somente teste'}],
   missingFields:[]
  })
  assert.equal((await send('/api/atualizacoes?visao=open','GET',cookie)).body.items.length,1)
  const attempt=await send('/api/atualizacoes/'+pkg.id+'/decisao','POST',cookie,{revision:1,snapshotHash:pkg.snapshotHash,decision:'approve',requestId:randomUUID()})
  assert.equal(attempt.status,503)
  assert.equal(attempt.body.error.code,'PACKAGE_DECISIONS_DISABLED')
  assert.equal(new UpdatePackageRepository(db).get(pkg.id).status,'awaiting_review')
  assert.equal((await send('/api/atualizacoes?visao=invalid','GET',cookie)).status,400)
 }finally{db.close()}
})
