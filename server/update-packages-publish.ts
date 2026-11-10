import { createHmac } from 'node:crypto'
import type { UpdatePackageIngest } from '../shared/update-packages.ts'

/**
 * Constructs a signed request, but deliberately does not perform HTTP.
 * Only a separately configured trusted sender may transport this request.
 */
export function createSignedUpdatePackageRequest(
  envelope: UpdatePackageIngest,
  secret: string,
  now: number = Date.now()
): {body:string;headers:Record<string,string>} {
  if (!secret || secret.length<32) throw new Error('PACKAGE_PUBLISH_SECRET_INVALID')
  if (!Number.isSafeInteger(now) || now<1_000_000_000_000 ||
    !envelope || typeof envelope.eventKey!=='string' ||
    !envelope.proposal || !Array.isArray(envelope.proposal.actions)) {
    throw new Error('PACKAGE_PUBLISH_INPUT_INVALID')
  }
  const timestamp=String(now)
  const body=JSON.stringify(envelope)
  if (Buffer.byteLength(body,'utf8')>65536) throw new Error('PACKAGE_PUBLISH_TOO_LARGE')
  const signature=createHmac('sha256',secret).update(timestamp+'.').update(body).digest('hex')
  return {
    body,
    headers:{
      'Content-Type':'application/json',
      'X-Funix-Updates-Timestamp':timestamp,
      'X-Funix-Updates-Signature':signature
    }
  }
}
