import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewMaterialHash, signReviewAttestation, verifyReviewAttestation } from '../update-packages-attestation.ts'

const secret='synthetic-secret-review-only-for-testing-0123456789'
const now=1794172800000
const material=()=>({
 eventKey:'gmail:abcdef0123456789:v1',subject:'XP1234',
 body:'Documento sem autorização comercial.',
 attachments:[{id:'attachment_0',sha256:'a'.repeat(64)}],
 fragments:[{part:'identity',sourceReference:'abcdef0123456789'}]
})
test('atestado autentica o conteúdo e os hashes de anexos',()=>{
 const input=material()
 const proof=signReviewAttestation(input,'review:synthetic-001',secret,now)
 assert.equal(verifyReviewAttestation(input,proof,secret,now),true)
 assert.equal(proof.contentHash,reviewMaterialHash(input))
 assert.equal(verifyReviewAttestation({...input,body:'Outro texto'},proof,secret,now),false)
 assert.equal(verifyReviewAttestation({...input,attachments:[{id:'attachment_0',sha256:'b'.repeat(64)}]},proof,secret,now),false)
 assert.equal(verifyReviewAttestation({...input,fragments:[{part:'commercial'}]},proof,secret,now),false)
})
test('rejeita assinatura inválida e atestado vencido',()=>{
 const proof=signReviewAttestation(material(),'review:synthetic-001',secret,now)
 assert.equal(verifyReviewAttestation(material(),proof,'wrong-secret-value-at-least-32-chars-001',now),false)
 assert.equal(verifyReviewAttestation(material(),proof,secret,now+300001),false)
 assert.equal(verifyReviewAttestation(material(),{...proof,signature:'0'.repeat(64)},secret,now),false)
})
test('rejeita duplicações e hashes de anexos inválidos',()=>{
 const input=material()
 assert.throws(()=>reviewMaterialHash({...input,attachments:[input.attachments[0]!,input.attachments[0]!]}),/REVIEW_MATERIAL_INVALID/)
 assert.throws(()=>reviewMaterialHash({...input,attachments:[{id:'attachment_0',sha256:'not-a-hash'}]}),/REVIEW_MATERIAL_INVALID/)
})
