import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { openDatabase } from '../database.ts'
import { createUpdatePackageSchema } from '../update-packages-schema.ts'
import { UpdatePackageRepository } from '../update-packages.ts'
import { createUpdatePackageIngest } from '../update-packages-ingest.ts'
import { createSignedUpdatePackageRequest } from '../update-packages-publish.ts'

const secret='synthetic-secret-for-signed-publisher-test-12345'
const instant=1794172800000
const envelope=()=>({
 eventKey:'gmail:abcdef0123456789:v1',
 proposal:{
   source:'gmail' as const,sourceReference:'abcdef0123456789',
   experienceId:'XP1234',plate:'ABC1D23',
   title:'XP1234 - teste',summary:'Um evento, sem escrita',
   actions:[{id:'review:identity',type:'other' as const,title:'Conferir identificação',detail:'Somente teste'}],
   missingFields:[]
 }
})
test('assinatura do produtor corresponde ao receptor HMAC sem rede',async()=>{
 const db=openDatabase(':memory:')
 try{
  createUpdatePackageSchema(db)
  const repo=new UpdatePackageRepository(db)
  const signed=createSignedUpdatePackageRequest(envelope(),secret,instant)
  const req=Object.assign(Readable.from([signed.body]),{
   method:'POST',headers:{
     'content-type':signed.headers['Content-Type'],
     'x-funix-updates-timestamp':signed.headers['X-Funix-Updates-Timestamp'],
     'x-funix-updates-signature':signed.headers['X-Funix-Updates-Signature']
   }
  }) as unknown as IncomingMessage
  const res={setHeader:()=>{}} as unknown as ServerResponse
  const ingest=createUpdatePackageIngest(repo,secret,true,()=>instant)
  const receipt=await ingest(req,res)
  assert.equal(receipt.status,'awaiting_review')
  assert.equal(repo.list('open','XP1234').total,1)
  assert.equal(repo.list('closed','').total,0)
 }finally{db.close()}
})
test('produtor recusa credencial curta e payload além de 64 KB',()=>{
 assert.throws(()=>createSignedUpdatePackageRequest(envelope(),'curta',instant),/PACKAGE_PUBLISH_SECRET_INVALID/)
 const large=envelope()
 large.proposal.summary='A'.repeat(65536)
 assert.throws(()=>createSignedUpdatePackageRequest(large,secret,instant),/PACKAGE_PUBLISH_TOO_LARGE/)
})
