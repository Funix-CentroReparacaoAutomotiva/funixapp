import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareCompleteUpdateEvent as prepare, EventPreparationError } from '../update-packages-event.ts'
import type { EventPreparation } from '../update-packages-event.ts'
import type { UpdatePackageFragment } from '../update-packages-consolidate.ts'

const fragment=(part:string, actionId:string):UpdatePackageFragment=>({
  part,
  proposal:{
    source:'gmail',sourceReference:'msg-synthetic-001',experienceId:'XP1001',plate:'ABC1D23',
    title:'Rascunho '+part,summary:'Verificação '+part,
    actions:actionId?[{id:actionId,type:'other',title:'Conferir '+part,detail:'Sem execução'}]:[],
    missingFields:[]
  }
})
const example=():EventPreparation=>({
  inventory:{
    eventKey:'gmail:msg-synthetic-001:v1',source:'gmail',
    sourceReference:'msg-synthetic-001',bodyReviewed:true,commercialReviewed:true,
    attachmentIds:['attachment-1','attachment-2'],
    checkedAttachmentIds:['attachment-2','attachment-1']
  },
  fragments:[fragment('identity','review:identity'),fragment('documents','drive:archive'),fragment('commercial','')]
})
function errorCode(fn:()=>unknown, code:string) {
  assert.throws(fn,(error:unknown)=>error instanceof EventPreparationError&&error.code===code)
}
test('inventário completo produz um único pacote com três fragmentos e sem efeitos externos',()=>{
  const result=prepare(example())
  assert.equal(result.eventKey,'gmail:msg-synthetic-001:v1')
  assert.equal(result.proposal.actions.length,2)
  assert.equal(result.proposal.experienceId,'XP1001')
})
test('não consolida sem revisão do corpo ou conteúdo comercial',()=>{
  const a=example();a.inventory.bodyReviewed=false
  errorCode(()=>prepare(a),'EVENT_NOT_REVIEWED')
  a.inventory.bodyReviewed=true;a.inventory.commercialReviewed=false
  errorCode(()=>prepare(a),'EVENT_NOT_REVIEWED')
})
test('bloqueia anexos faltantes, duplicados ou extras',()=>{
  const a=example();a.inventory.checkedAttachmentIds=['attachment-1']
  errorCode(()=>prepare(a),'ATTACHMENTS_INCOMPLETE')
  a.inventory.checkedAttachmentIds=['attachment-1','attachment-1']
  errorCode(()=>prepare(a),'ATTACHMENTS_INCOMPLETE')
  a.inventory.checkedAttachmentIds=['attachment-1','attachment-2','attachment-3']
  errorCode(()=>prepare(a),'ATTACHMENTS_INCOMPLETE')
})
test('bloqueia terceiro fragmento ausente e origem divergente',()=>{
  const a=example();a.fragments.pop()
  errorCode(()=>prepare(a),'FRAGMENTS_INCOMPLETE')
  const b=example();b.fragments[0]!.proposal.sourceReference='outro-evento'
  errorCode(()=>prepare(b),'FRAGMENT_ORIGIN_CONFLICT')
})
test('não aceita identidade de evento dissociada de fonte e referência',()=>{
  const a=example();a.inventory.eventKey='gmail:outro-evento:v1'
  errorCode(()=>prepare(a),'INVENTORY_IDENTITY_INVALID')
})
