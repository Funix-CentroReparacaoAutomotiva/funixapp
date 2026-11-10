import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { UpdatePackageIngest } from '../shared/update-packages.ts'
import { ServiceError } from './errors.ts'
import type { UpdatePackageRepository } from './update-packages.ts'

const invalid=(code:string,msg:string,status=400):never=>{throw new ServiceError(status,code,msg)}

/**
 * Independent machine-to-machine receiver. Disabled unless BOTH storage and
 * explicit ingestion flag are configured; uses a separate shared secret.
 * Signature: lowercase hex HMAC-SHA256(secret, `timestamp.rawBody`).
 */
export function createUpdatePackageIngest(
  repo: UpdatePackageRepository,
  secret: string | undefined,
  enabled: boolean,
  now: () => number = Date.now
) {
  return async (req:IncomingMessage,res:ServerResponse) => {
    if(req.method!=='POST')invalid('METHOD_NOT_ALLOWED','Método não permitido.',405)
    if(!enabled || !secret || secret.length<32)invalid('PACKAGE_INGEST_DISABLED','Recepção de pacotes desabilitada.',503)
    if(req.headers['content-type']!=='application/json')invalid('JSON_REQUIRED','Envie JSON.',415)
    const ts=req.headers['x-funix-updates-timestamp']
    const signature=req.headers['x-funix-updates-signature']
    if(typeof ts!=='string' || !/^[0-9]{13}$/.test(ts) || typeof signature!=='string' || !/^[a-f0-9]{64}$/.test(signature))
      invalid('PACKAGE_UNAUTHORIZED','Assinatura ausente.',401)
    const observed=now(),timestamp=Number(ts)
    if(!Number.isSafeInteger(timestamp)||Math.abs(observed-timestamp)>300_000)invalid('PACKAGE_EXPIRED','Evento expirado.',401)
    let size=0
    const chunks:Buffer[]=[]
    for await(const chunk of req.iterator({destroyOnReturn:false})){
      const part=Buffer.from(chunk);size+=part.length
      if(size>65536){req.resume();invalid('PACKAGE_TOO_LARGE','Evento maior que 64 KB.',413)}
      chunks.push(part)
    }
    const raw=Buffer.concat(chunks)
    const expected=createHmac('sha256',secret as string).update(String(ts)+'.').update(raw).digest()
    const actual=Buffer.from(signature as string,'hex')
    if(actual.length!==expected.length || !timingSafeEqual(actual,expected))invalid('PACKAGE_UNAUTHORIZED','Assinatura inválida.',401)
    let payload:unknown
    try{payload=JSON.parse(raw.toString('utf8'))}catch{invalid('INVALID_JSON','JSON inválido.')}
    const result=repo.ingest(payload as UpdatePackageIngest)
    res.setHeader('Cache-Control','no-store')
    return {packageId:result.id,revision:result.revision,snapshotHash:result.snapshotHash,status:result.status}
  }
}
