import test from 'node:test'
import assert from 'node:assert/strict'
import {api} from '../../src/api.ts'
import type {RequestFailure} from '../../src/api.ts'

test('client transport failures identify GET/POST and redacted routes, disable cache and never retry a mutation',async()=>{
 const original=globalThis.fetch,calls:RequestInit[]=[]
 globalThis.fetch=async(_url,init)=>{calls.push(init!);throw new TypeError('Failed to fetch')}
 try {
  for(const method of ['GET','POST']){
   await assert.rejects(api('/api/atendimentos/private-contact-id/diagnosticos/private-line?q=private-phone',{method}),cause=>{
    const e=cause as RequestFailure
    assert.equal(e.kind,'network');assert.equal(e.method,method)
    assert.equal(e.endpoint,'/api/atendimentos/:id/diagnosticos/:id')
    assert(!JSON.stringify(e).includes('private'));assert.equal(e.status,undefined)
    assert(Number.isFinite(e.elapsedMs));assert.match(e.message,/FUNIX/);return true
   })
  }
  assert.equal(calls.length,2)
  assert(calls.every(c=>c.cache==='no-store'&&c.credentials==='same-origin'))
 }finally{globalThis.fetch=original}
})

test('client keeps HTTP conflict distinct from connection failures and captures existing request reference',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'VERSION_CONFLICT',message:'Registro mudou',requestId:'synthetic-request-id'}}),{status:409,headers:{'Content-Type':'application/json'}})
 try {
  await assert.rejects(api('/api/atendimentos/private-id/diagnosticos',{method:'POST'}),cause=>{
   const e=cause as RequestFailure
   assert.equal(e.status,409);assert.equal(e.code,'VERSION_CONFLICT');assert.equal(e.kind,'http');assert.equal(e.requestId,'synthetic-request-id');assert.equal(e.message,'Registro mudou');return true
  })
 }finally{globalThis.fetch=original}
})

test('client distinguishes unreadable HTTP200 response from a POST without HTTP response, without inferring write success',async()=>{
 const original=globalThis.fetch
 globalThis.fetch=async()=>new Response('truncated JSON',{status:200,headers:{'X-Request-Id':'synthetic-response-id'}})
 try {
  await assert.rejects(api('/api/atendimentos/private-id/diagnosticos',{method:'POST'}),cause=>{
   const e=cause as RequestFailure
   assert.equal(e.kind,'response');assert.equal(e.status,200);assert.equal(e.method,'POST');assert.equal(e.requestId,'synthetic-response-id');return true
  })
 }finally{globalThis.fetch=original}
})

test('intentional fetch/body cancellation remains AbortError rather than a connection warning',async()=>{
 const original=globalThis.fetch,abort=new DOMException('Aborted','AbortError')
 try {
  globalThis.fetch=async()=>{throw abort}
  await assert.rejects(api('/api/catalogos'),cause=>cause===abort)
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.error(abort)}}))
  await assert.rejects(api('/api/catalogos'),cause=>cause===abort)
 }finally{globalThis.fetch=original}
})
