import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverDevelopmentPackage } from '../update-packages-dev-transport.ts'

const secret='synthetic-development-only-secret-0123456789'
const payload=()=>({
 eventKey:'gmail:abcdef0123456789:v1',
 proposal:{source:'gmail' as const,sourceReference:'abcdef0123456789',
  experienceId:'XP1234',plate:'ABC1D23',title:'XP1234',summary:'Teste sem gravação',
  actions:[{id:'review:identity',type:'other' as const,title:'Revisar',detail:'Somente demonstração'}],
  missingFields:[]}
})
const url='http://127.0.0.1:43123/api/integrations/updates/packages'
test('envio desabilitado não chama o adaptador',async()=>{
 let called=false
 await assert.rejects(()=>deliverDevelopmentPackage(payload(),{
   enabled:false,endpoint:url,secret,sender:async()=>{called=true;return {status:201}}
 }),/PACKAGE_DEV_TRANSPORT_DISABLED/)
 assert.equal(called,false)
})
test('rejeita destinos externos, https e caminhos arbitrários',async()=>{
 for(const endpoint of [
   'https://127.0.0.1/api/integrations/updates/packages',
   'http://example.com/api/integrations/updates/packages',
   'http://127.0.0.1:43123/api/outro'
 ]) {
  await assert.rejects(()=>deliverDevelopmentPackage(payload(),{
    enabled:true,endpoint,secret,sender:async()=>({status:200})
  }),/PACKAGE_DEV_ENDPOINT_INVALID/)
 }
})
test('constrói cabeçalhos assinados e usa transporte injetado em desenvolvimento',async()=>{
 const result=await deliverDevelopmentPackage(payload(),{
   enabled:true,endpoint:url,secret,now:1794172800000,
   sender:async request=>{
     assert.equal(request.url,url)
     assert.match(request.headers['X-Funix-Updates-Signature']!,/^[a-f0-9]{64}$/)
     assert.equal(request.headers['X-Funix-Updates-Timestamp'],'1794172800000')
     assert.equal(JSON.parse(request.body).eventKey,payload().eventKey)
     return {status:201,body:{packageId:'synthetic'}}
   }
 })
 assert.equal(result.status,201)
})
test('falha de destino não é anunciada como sucesso',async()=>{
 await assert.rejects(()=>deliverDevelopmentPackage(payload(),{
   enabled:true,endpoint:url,secret,sender:async()=>({status:409})
 }),/PACKAGE_DEV_DELIVERY_FAILED/)
})
