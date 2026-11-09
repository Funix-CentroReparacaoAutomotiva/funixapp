import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {createRequestHandler} from '../app.ts'
import {openDatabase} from '../database.ts'
import {AtendimentoRepository} from '../atendimentos.ts'

test('two forwarded visitors do not lock each other behind the approved Traefik peer',async()=>{
 const db=openDatabase(':memory:')
 let clock=1000
 const handler=createRequestHandler({atendimentos:new AtendimentoRepository(db),password:'test-only-password-123',
  origin:'https://app.funix.com.br',now:()=>clock,
  trustedLoginProxies:new Set(['172.20.0.5'])})
 const request=async(peer:string,xff:string,password:string)=>{
  const body=JSON.stringify({password})
  const req=Object.assign(Readable.from([body]),{url:'/api/session',method:'POST',headers:{
   origin:'https://app.funix.com.br','content-type':'application/json','x-forwarded-for':xff
  },socket:{remoteAddress:peer}}) as unknown as IncomingMessage
  let status=200,raw=''
  const res={setHeader(){},writeHead(value:number){status=value},end(value:string){raw=value}} as unknown as ServerResponse
  await handler(req,res)
  return {status,payload:JSON.parse(raw)}
 }
 try{
  for(let n=0;n<8;n++)assert.equal((await request('172.20.0.5','203.0.113.12','wrong')).status,401)
  assert.equal((await request('172.20.0.5','203.0.113.12','test-only-password-123')).status,429)
  assert.equal((await request('172.20.0.5','203.0.113.13','test-only-password-123')).status,200)
  // A forged header arriving directly at the API does not grant a new bucket.
  for(let n=0;n<8;n++)assert.equal((await request('198.51.100.20',String('203.0.113.'+(n+1)),'wrong')).status,401)
  assert.equal((await request('198.51.100.20','203.0.113.99','test-only-password-123')).status,429)
  clock+=15*60*1000+1
  assert.equal((await request('172.20.0.5','203.0.113.12','test-only-password-123')).status,200)
 }finally{db.close()}
})
