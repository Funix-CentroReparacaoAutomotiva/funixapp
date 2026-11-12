import type {IncomingMessage,ServerResponse} from 'node:http'
import type {GmailQueueAck} from '../shared/gmail-intake-queue.ts'
import {ServiceError} from './errors.ts'
import {GmailIntakeQueue} from './gmail-intake-queue.ts'
import {verifySignedGmailPayload} from './gmail-intake-ingest.ts'

const fail=(status:number,code:string,message:string):never=>{throw new ServiceError(status,code,message)}
const messagePattern=/^[0-9a-f]{15,25}$/i
const requestPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Action='enqueue'|'claim'|'ack'|'status'
export function createGmailQueueEndpoint(
  queue:GmailIntakeQueue,secret:string|undefined,enabled:boolean,now:()=>number=Date.now
){
  return async (req:IncomingMessage,res:ServerResponse,action:Action)=>{
    // A dedicated HMAC key and independent feature flag prevent intake credentials from claiming queue work.
    const raw=await verifySignedGmailPayload(req,secret,enabled,now)
    if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'GMAIL_QUEUE_PAYLOAD_INVALID','Corpo inválido.')
    const input=raw as Record<string,unknown>
    let result:unknown
    if(action==='enqueue'){
      if(Object.keys(input).sort().join(',')!=='messageId'||
        typeof input.messageId!=='string'||!messagePattern.test(input.messageId))
        fail(400,'GMAIL_QUEUE_PAYLOAD_INVALID','Identificador de mensagem inválido.')
      result=queue.enqueue(input.messageId as string)
    }else if(action==='status'){
      if(Object.keys(input).sort().join(',')!=='messageId'||
        typeof input.messageId!=='string'||!messagePattern.test(input.messageId))
        fail(400,'GMAIL_QUEUE_PAYLOAD_INVALID','Identificador de mensagem inválido.')
      result=queue.status(input.messageId)
    }else if(action==='claim'){
      if(Object.keys(input).sort().join(',')!=='limit,requestId'||
        typeof input.limit!=='number'||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>25||
        typeof input.requestId!=='string'||!requestPattern.test(input.requestId))
        fail(400,'GMAIL_QUEUE_PAYLOAD_INVALID','Solicitação de lote inválida.')
      result={claims:queue.claim(input.limit as number,input.requestId as string)}
    }else if(action==='ack'){
      if(Object.keys(input).sort().join(',')!=='errorCode,leaseToken,messageId,noticeId,result')
        fail(400,'GMAIL_QUEUE_PAYLOAD_INVALID','Recibo inválido.')
      result=queue.acknowledge(input as GmailQueueAck)
    }else{
      fail(404,'GMAIL_QUEUE_NOT_FOUND','Ação inexistente.')
    }
    res.setHeader('Cache-Control','no-store')
    return result
  }
}
