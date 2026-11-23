import test from 'node:test'
import assert from 'node:assert/strict'
import {suggestCiliaServices} from '../cilia-service-rules.ts'
import type {CiliaServiceSource} from '../cilia-service-rules.ts'
const prefix='coda:2zsjI-nqWr:grid-lhdFxol6x-:'
const catalog=[...['capo','para_choque_traseiro','porta_traseira__motorista','farol__passageiro','longarina_dianteira__motorista','veiculo_completo'].map(code=>({id:code,kind:'peca',code,name:code,active:true})),...['i-vmJ3Org23i','i-q8IL0mnuIJ','i-XDTMBmueos','i-SW0n7TLbtf','i-5zkNjBv-Zg','i-6FW6UIOr8H','i-RoaRcVLUCo','i-6v-u7Wk73b','i-kNfje5jSDQ'].map(id=>({id:prefix+id,kind:'servico',code:null,name:id,active:true}))]
const op=(kind:'T'|'RI'|'R'|'P',hours:string|null='1',amount:string|null='50')=>({kind,hours,rate:'50',amount})
const row=(patch:Partial<CiliaServiceSource>={}):CiliaServiceSource=>({id:'qa',name:'CAPÔ',typeKind:'part',scope:'Impacto',removalKind:'Funilaria',netPrice:'300',supplyKind:'partner',rawFlags:{troca:true},operations:[op('T'),op('P','2','100')],...patch})
const suggest=(patch:Partial<CiliaServiceSource>={})=>suggestCiliaServices(row(patch),catalog,'left')
test('Cilia services preserve operation identity, exact values and partner part evidence',()=>{
 const p=suggest()
 assert.equal(p.canWrite,false);assert.equal(p.componentReview,true);assert.equal(p.source.supplyKind,'partner')
 assert.deepEqual(p.operations.map(o=>[o.sourceId,o.kind,o.amount,o.candidates[0]?.serviceId]),[['qa:op-1','T','50',prefix+'i-vmJ3Org23i'],['qa:op-2','P','100',prefix+'i-XDTMBmueos']])
 assert.ok(p.operations.every(o=>o.requiresOperatorReview&&o.state==='candidate'))
 assert.equal('quantity' in p.operations[0]!,false);assert.equal('dimensionId' in p.operations[0]!,false)
 const ri=suggest({operations:[op('RI')],rawFlags:{troca:false}})
 assert.equal(ri.componentReview,false);assert.equal(ri.operations[0]!.kind,'RI')
})
test('Cilia services distinguish blend, plastic repairs and structural work',()=>{
 assert.equal(suggest({name:'ABERTURA DE TINTA NA PORTA TRASEIRA ESQUERDA',operations:[op('P')]}).operations[0]!.candidates[0]!.serviceId,prefix+'i-SW0n7TLbtf')
 const p=suggest({name:'PARACHOQUE TRASEIRO',operations:[op('R')]})
 assert.equal(p.operations[0]!.state,'review');assert.equal(p.operations[0]!.candidates.length,2)
 assert.ok(suggest({name:'LONGARINA DIANTEIRA ESQ',operations:[op('R')]}).operations[0]!.issues.includes('STRUCTURAL_METHOD_REVIEW'))
 assert.ok(suggest({name:'DOBRADIÇA DIR DO CAPÔ'}).operations[0]!.issues.includes('GROUP_SCOPE_REVIEW'))
})
test('Cilia services keep specialties and manual lines pending, including zero and missing hours',()=>{
 const electric=suggest({name:'FAROL DIREITO',removalKind:'Elétrica',operations:[op('T','0','0')]})
 assert.ok(electric.operations[0]!.issues.includes('SPECIALTY_METHOD_REVIEW'));assert.ok(electric.operations[0]!.issues.includes('ZERO_TIME_SCOPE_REVIEW'))
 const manual=suggest({name:'REM E INST CONJUNTO MOTRIZ',typeKind:'service',netPrice:'900',operations:[],rawFlags:{troca:false}})
 assert.equal(manual.operations[0]!.kind,'manual');assert.equal(manual.operations[0]!.amount,'900');assert.equal(manual.operations[0]!.candidates[0]!.serviceId,prefix+'i-RoaRcVLUCo');assert.equal(manual.operations[0]!.state,'review')
 assert.ok(suggest({operations:[op('T',null,null)]}).operations[0]!.issues.includes('AMOUNT_UNKNOWN'))
 assert.ok(suggest({scope:'Sob análise'}).operations[0]!.issues.includes('SCOPE_REVIEW'))
})
test('Cilia services never infer absent catalog identity or merge repeated operations',()=>{
 const p=suggestCiliaServices(row(),catalog.filter(c=>c.id!==prefix+'i-vmJ3Org23i'),'left')
 assert.ok(p.operations[0]!.issues.includes('SERVICE_CATALOG_UNAVAILABLE:montagem'));assert.equal(p.operations[0]!.candidates.length,0)
 const repeated=suggest({operations:[op('T'),op('T')]})
 assert.equal(repeated.operations.length,2);assert.notEqual(repeated.operations[0]!.sourceId,repeated.operations[1]!.sourceId)
 assert.equal(suggest({name:'PEÇA DESCONHECIDA'}).operations[0]!.state,'review')
})
