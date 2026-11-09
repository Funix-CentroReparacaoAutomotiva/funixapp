import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * An attestation binds a reviewed proposal to the exact source and fragment
 * source text and attachment digests presented to the trusted reviewer. It is NOT proof of a
 * customer's or association's commercial authorization.
 */
export type ReviewMaterial = {
  eventKey: string
  body: string
  subject: string
  attachments: Array<{id:string;sha256:string}>
  fragments: unknown[]
}
export type ReviewAttestation = {
  reviewId: string
  reviewedAt: number
  contentHash: string
  signature: string
}
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,119}$/
export function reviewMaterialHash(input:ReviewMaterial):string {
  if (!input || !idPattern.test(input.eventKey) ||
    typeof input.body!=='string' || typeof input.subject!=='string' ||
    !Array.isArray(input.attachments) || !Array.isArray(input.fragments) ||
    input.attachments.length>40 ||
    input.attachments.some(a=>!a || typeof a.id!=='string' || !idPattern.test(a.id) ||
      typeof a.sha256!=='string' || !/^[a-f0-9]{64}$/.test(a.sha256)) ||
    new Set(input.attachments.map(a=>a.id)).size!==input.attachments.length) {
    throw new Error('REVIEW_MATERIAL_INVALID')
  }
  const attachments=[...input.attachments].sort((a,b)=>a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify({
    eventKey:input.eventKey,body:input.body,subject:input.subject,
    attachments,fragments:input.fragments
  })).digest('hex')
}
/** Only call from a trusted verifier; never from n8n extraction or browser. */
export function signReviewAttestation(
  material:ReviewMaterial,reviewId:string,secret:string,reviewedAt=Date.now()
):ReviewAttestation {
  if (!idPattern.test(reviewId) || secret.length<32 ||
    !Number.isSafeInteger(reviewedAt) || reviewedAt<1_000_000_000_000) {
    throw new Error('REVIEW_SIGN_INPUT_INVALID')
  }
  const contentHash=reviewMaterialHash(material)
  const message=`${reviewId}.${reviewedAt}.${contentHash}`
  return {reviewId,reviewedAt,contentHash,
    signature:createHmac('sha256',secret).update(message).digest('hex')}
}
export function verifyReviewAttestation(
  material:ReviewMaterial,proof:ReviewAttestation,secret:string,now=Date.now()
):boolean {
  if (!proof || !secret || secret.length<32 ||
    !idPattern.test(proof.reviewId) ||
    !Number.isSafeInteger(proof.reviewedAt) ||
    Math.abs(now-proof.reviewedAt)>300_000 ||
    !/^[a-f0-9]{64}$/.test(proof.contentHash) ||
    !/^[a-f0-9]{64}$/.test(proof.signature)) return false
  const contentHash=reviewMaterialHash(material)
  if (contentHash!==proof.contentHash) return false
  const expected=createHmac('sha256',secret)
    .update(`${proof.reviewId}.${proof.reviewedAt}.${contentHash}`).digest()
  const actual=Buffer.from(proof.signature,'hex')
  return actual.length===expected.length && timingSafeEqual(actual,expected)
}
