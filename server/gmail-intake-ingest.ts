import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GmailIntakeNoticeInput } from '../shared/gmail-intake.ts'
import { ServiceError } from './errors.ts'
import type { GmailIntakeRepository } from './gmail-intake.ts'
import { classifyGmailCandidate } from './gmail-intake-classifier.ts'

const fail=(status:number,code:string,message:string):never=>{throw new ServiceError(status,code,message)}

/** Verify signed raw request before looking at any user-supplied email data. */
async function verifiedPayload(req:IncomingMessage,secret:string|undefined,enabled:boolean,now:()=>number):Promise<unknown>{
  if(req.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','Método não permitido.')
  if(!enabled||!secret||secret.length<32)fail(503,'GMAIL_INTAKE_INGEST_DISABLED','Recepção de avisos desabilitada.')
  if(req.headers['content-type']!=='application/json')fail(415,'JSON_REQUIRED','Envie JSON.')
  const ts=req.headers['x-funix-updates-timestamp']
  const signature=req.headers['x-funix-updates-signature']
  if(typeof ts!=='string'||!/^[0-9]{13}$/.test(ts)||
    typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))
    fail(401,'GMAIL_INTAKE_UNAUTHORIZED','Assinatura ausente.')
  if(!Number.isSafeInteger(Number(ts))||Math.abs(now()-Number(ts))>300000)
    fail(401,'GMAIL_INTAKE_EXPIRED','Evento expirado.')
  const pieces:Buffer[]=[]
  let total=0
  for await (const chunk of req.iterator({destroyOnReturn:false})){
    const b=Buffer.from(chunk);total+=b.length
    if(total>16384){req.resume();fail(413,'GMAIL_INTAKE_TOO_LARGE','Aviso maior que 16 KB.')}
    pieces.push(b)
  }
  const raw=Buffer.concat(pieces)
  const expected=createHmac('sha256',secret as string).update(ts+'.').update(raw).digest()
  const actual=Buffer.from(signature as string,'hex')
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))
    fail(401,'GMAIL_INTAKE_UNAUTHORIZED','Assinatura inválida.')
  try{return JSON.parse(raw.toString('utf8'))}
  catch{fail(400,'INVALID_JSON','JSON inválido.')}
}

/** Existing prepared notice receiver. Never records a human decision. */
export function createGmailIntakeIngest(
  repo:GmailIntakeRepository,secret:string|undefined,enabled:boolean,now:()=>number=Date.now
) {
  return async (req:IncomingMessage,res:ServerResponse)=>{
    const parsed=await verifiedPayload(req,secret,enabled,now)
    const notice=repo.ingest(parsed as GmailIntakeNoticeInput)
    res.setHeader('Cache-Control','no-store')
    return {noticeId:notice.id,status:notice.status,revision:notice.revision,snapshotHash:notice.snapshotHash}
  }
}

/** Classify signed, minimal email evidence. Irrelevant mail creates no notice. */
export function createGmailCandidateIngest(
  repo:GmailIntakeRepository,secret:string|undefined,enabled:boolean,now:()=>number=Date.now
) {
  return async (req:IncomingMessage,res:ServerResponse)=>{
    const parsed=await verifiedPayload(req,secret,enabled,now)
    const result=classifyGmailCandidate(parsed)
    res.setHeader('Cache-Control','no-store')
    if(result.relevance==='irrelevant')return {status:'ignored' as const,reason:result.reason}
    const notice=repo.ingest(result.notice)
    return {status:'awaiting_authorization' as const,noticeId:notice.id,
      revision:notice.revision,snapshotHash:notice.snapshotHash,relevance:result.relevance}
  }
}
