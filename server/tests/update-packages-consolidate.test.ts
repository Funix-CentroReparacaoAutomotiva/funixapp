import test from 'node:test'
import assert from 'node:assert/strict'
import { consolidateUpdatePackageFragments as consolidate, PackageConsolidationError } from '../update-packages-consolidate.ts'
import type { UpdatePackageFragment } from '../update-packages-consolidate.ts'

const base = (part: string, actionId: string): UpdatePackageFragment => ({
  part,
  proposal: {
    source:'gmail',
    sourceReference:'message-synthetic-009',
    experienceId:'XP1001',
    plate:'ABC1D23',
    title:'Rascunho de '+part,
    summary:'Resumo '+part,
    actions:[{id:actionId,type:part==='documents'?'drive_archive':'other',title:'Revisar '+part,detail:'Somente proposta'}],
    missingFields:[]
  }
})
function errorCode(fn:()=>unknown, code:string) {
  assert.throws(fn,(error:unknown)=>error instanceof PackageConsolidationError && error.code===code)
}

test('combina partes de um evento em um único pacote sem gravar ou executar',()=>{
  const result=consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[
    base('identity','review:identity'),base('documents','drive:archive')
  ])
  assert.equal(result.proposal.actions.length,2)
  assert.equal(result.proposal.experienceId,'XP1001')
  assert.equal(result.proposal.plate,'ABC1D23')
  assert.equal(result.proposal.sourceReference,'message-synthetic-009')
  assert.equal(result.eventKey,'gmail:message-synthetic-009:v1')
})
test('partes ausentes ou repetidas impedem pacote parcial',()=>{
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[base('identity','identity')]),'EVENT_INCOMPLETE')
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[base('identity','identity'),base('identity','again')]),'FRAGMENT_INVALID')
})
test('XP e placa conflitantes bloqueiam consolidação',()=>{
  const identity=base('identity','review:identity')
  const document=base('documents','drive:archive')
  document.proposal.experienceId='XP9001'
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document]),'IDENTITY_CONFLICT')
  document.proposal.experienceId='XP1001'
  document.proposal.plate='ZZZ9Z99'
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document]),'IDENTITY_CONFLICT')
})
test('recusa mistura de fontes ou mensagens',()=>{
  const identity=base('identity','review:identity')
  const document=base('documents','drive:archive')
  document.proposal.sourceReference='message-synthetic-010'
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document]),'SOURCE_CONFLICT')
  document.proposal.sourceReference=identity.proposal.sourceReference
  document.proposal.source='whatsapp'
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document]),'SOURCE_CONFLICT')
})
test('deduplica ações idênticas e bloqueia mesmo ID com conteúdo diferente',()=>{
  const identity=base('identity','review:identity')
  const document=base('documents','review:identity')
  document.proposal.actions=[{...identity.proposal.actions[0]!}]
  assert.equal(consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document]).proposal.actions.length,1)
  document.proposal.actions[0]!.detail='Outra alteração'
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document]),'ACTION_CONFLICT')
})
test('pendências sobrevivem à identificação parcial, sem desbloqueio automático',()=>{
  const identity=base('identity','review:identity')
  identity.proposal.experienceId=null
  identity.proposal.missingFields=[{key:'experienceId',label:'Confirmar experiência',hint:'Revalidar no Coda'}]
  const document=base('documents','drive:archive')
  const result=consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,document])
  assert.equal(result.proposal.experienceId,'XP1001')
  assert.equal(result.proposal.missingFields.length,1)
  const other=base('documents','drive:archive')
  other.proposal.missingFields=[{key:'experienceId',label:'Outra seleção',hint:'Divergente'}]
  errorCode(()=>consolidate('gmail:message-synthetic-009:v1',['identity','documents'],[identity,other]),'FIELD_CONFLICT')
})
