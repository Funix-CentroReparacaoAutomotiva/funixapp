import test from 'node:test'
import assert from 'node:assert/strict'
import { triageCommercialEmail } from '../update-packages-commercial.ts'

const base=()=>({
  messageId:'abcdef0123456789',subject:'Processo XP1234',body:'Bom dia, seguem os anexos para conferência.',
  bodyComplete:true,experienceId:'XP1234',plate:'ABC1D23'
})
test('indícios de aprovação e valor não são convertidos em autorização de ERP',()=>{
  const r=triageCommercialEmail({...base(),body:'Autorizado o complemento de R$ 1.250,00.'})
  assert.equal(r.status,'requires_review')
  assert.ok(r.signals.some(s=>s.kind==='possible_authorization'))
  assert.ok(r.signals.some(s=>s.kind==='possible_amount'))
  assert.equal(r.fragment.proposal.actions[0]?.type,'other')
  assert.equal(r.fragment.proposal.missingFields[0]?.key,'commercialReview')
  assert.equal(r.fragment.proposal.actions.some(a=>a.type==='erp_update'),false)
})
test('texto incompleto exige revisão mesmo sem indícios financeiros',()=>{
  const r=triageCommercialEmail({...base(),bodyComplete:false})
  assert.equal(r.status,'requires_review')
  assert.equal(r.fragment.proposal.missingFields.length,1)
})
test('texto simples completo e sem palavras-chave não cria mudanças comerciais',()=>{
  const r=triageCommercialEmail(base())
  assert.equal(r.status,'no_commercial_signals')
  assert.equal(r.fragment.proposal.actions.length,0)
  assert.equal(r.fragment.proposal.missingFields.length,0)
})
test('corpo ausente permanece pendente de verificação',()=>{
  const r=triageCommercialEmail({...base(),body:null})
  assert.equal(r.status,'requires_review')
})
test('identificação da mensagem Gmail inválida é rejeitada',()=>{
  assert.throws(()=>triageCommercialEmail({...base(),messageId:'invalida'}),/COMMERCIAL_INPUT_INVALID/)
})

test('reconhece alteração, revisão e participação em português com acentos',()=>{
 const r=triageCommercialEmail({...base(),body:'Solicitamos alteração e revisão da participação.'})
 assert.equal(r.status,'requires_review')
 assert.ok(r.signals.some(s=>s.kind==='possible_change'))
})
