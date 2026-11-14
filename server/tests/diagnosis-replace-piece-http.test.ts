import test from 'node:test'
import assert from 'node:assert/strict'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import {createRequestHandler} from '../app.ts'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'
import {commercialFixture} from './fixtures/commercial.ts'

test('#168: rota exige sessão/origem, valida revisões e preserva composição em troca',async()=>{
 const db=openDatabase(':memory:')
 try{
  const f=commercialFixture(db)
  const origin='http://localhost:5173',password='synthetic-replace-secret'
  const handler=createRequestHandler({atendimentos:new AtendimentoRepository(db),origin,password})
  const request=async(path:string,method:string,body:unknown,headers:Record<string,string>={})=>{
   const payload=body===undefined?'':JSON.stringify(body)
   const req=Object.assign(Readable.from(payload?[payload]:[]),{url:path,method,headers,socket:{remoteAddress:'127.0.0.1'}})as unknown as IncomingMessage
   const responseHeaders=new Headers();let status=200,raw=''
   const res={setHeader(name:string,value:string){responseHeaders.set(name,value)},writeHead(s:number){status=s},end(data:string){raw=data??''}}as unknown as ServerResponse
   await handler(req,res)
   return {status,body:raw?JSON.parse(raw):null,headers:responseHeaders}
  }
  const login=await request('/api/session','POST',{password},{origin,'content-type':'application/json'})
  assert.equal(login.status,200)
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!
  const path='/api/atendimentos/'+f.at.id+'/diagnosticos/'+f.item.id+'/trocar-peca'
  const dest=f.commercial.catalogs().items.find(i=>i.code==='para_choque_traseiro')!
  const snapshot=()=>JSON.stringify({item:f.commercial.list(f.at.id),scenarios:f.scenarios.list(f.at.id)})
  const before=snapshot()
  const scenario=f.scenarios.list(f.at.id)[0]!
  const data={pieceId:dest.id,revision:f.item.revision,compositionRevision:Number(db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!.revision),scenarios:[{id:scenario.id,revision:scenario.revision}]}
  const json={'origin':origin,'content-type':'application/json'}
  assert.equal((await request(path,'POST',data,json)).status,401)
  assert.equal((await request(path,'POST',data,{...json,cookie,origin:'https://invalid.example'})).status,403)
  assert.equal((await request(path,'GET',undefined,{...json,cookie})).status,405)
  assert.equal(snapshot(),before)
  const done=await request(path,'POST',data,{...json,cookie})
  assert.equal(done.status,200)
  assert.equal(done.body.id,f.item.id)
  assert.equal(done.body.pieceId,dest.id)
  assert.equal(done.body.services[0].id,f.item.services[0]!.id)
  assert.equal(done.body.pieceReviewPending,true)
  const reviewPath='/api/atendimentos/'+f.at.id+'/diagnosticos/'+f.item.id+'/confirmar-revisao'
  const afterSwap=f.scenarios.list(f.at.id)[0]!
  const review={confirmed:true,revision:done.body.revision,compositionRevision:Number(db.prepare('SELECT revision FROM commercial_state WHERE atendimento_id=?').get(f.at.id)!.revision),scenarios:[{id:afterSwap.id,revision:afterSwap.revision}]}
  assert.equal((await request(reviewPath,'POST',review,json)).status,401)
  assert.equal((await request(reviewPath,'POST',review,{...json,cookie,origin:'https://invalid.example'})).status,403)
  assert.equal((await request(reviewPath,'POST',{...review,confirmed:false},{...json,cookie})).status,400)
  assert.equal(f.commercial.list(f.at.id)[0]!.pieceReviewPending,true)
  const verified=await request(reviewPath,'POST',review,{...json,cookie})
  assert.equal(verified.status,200)
  assert.equal(verified.body.pieceReviewPending,false)
  assert.equal(verified.body.revision,done.body.revision+1)
  assert.equal((await request(reviewPath,'POST',review,{...json,cookie})).status,409)
  
  const revisioned=await request(path,'POST',data,{...json,cookie})
  assert.equal(revisioned.status,409)
  assert.equal(f.commercial.list(f.at.id)[0]!.pieceId,dest.id)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})
