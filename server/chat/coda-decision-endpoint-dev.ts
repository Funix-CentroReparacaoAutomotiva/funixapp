import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ServiceError } from '../errors.ts'
import type { DevelopmentDecisionLedger, ConfirmedWhatsAppDecision } from './coda-decision-ledger-dev.ts'

/**
 * Separate authenticated DEV-only write path for post-Coda classification
 * decisions. It shares the source-ledger TRUST DOMAIN but signs a different
 * domain prefix. A decision cannot by itself create an Atendimento.
 */
export type DevelopmentDecisionIntakeConfig={
  ledger:DevelopmentDecisionLedger
  secret:Buffer
  now?:()=>number
}
function failure(status:number,code:string):never{
  throw new ServiceError(status,code,'Solicitação da integração rejeitada.')
}
export function createDevelopmentDecisionIntake(config:DevelopmentDecisionIntakeConfig){
  const now=config.now??Date.now
  if(config.secret.length<32||config.secret.length>64)throw Error('DECISION_KEY_INVALID')
  return async(req:IncomingMessage,res:ServerResponse,url:URL)=>{
    if(req.method!=='POST')return failure(405,'METHOD_NOT_ALLOWED')
    if(url.search||req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined)
      return failure(403,'DECISION_BROWSER_DENIED')
    if(req.headers['content-encoding']!==undefined ||
       !/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']??'')))
      return failure(415,'DECISION_CONTENT_TYPE')
    const header=(name:string):string=>{
      const count=req.rawHeaders?.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length
      const value=req.headers[name]
      if((count!==undefined&&count!==1)||Array.isArray(value))
        return failure(401,'DECISION_AUTH')
      return value??''
    }
    const stamp=header('x-funix-timestamp')
    const signature=header('x-funix-signature')
    if(!/^(0|[1-9]\d{0,11})$/.test(stamp) ||
       !/^sha256=[a-f0-9]{64}$/.test(signature) ||
       Math.abs(Math.floor(now()/1000)-Number(stamp))>300)
      return failure(401,'DECISION_AUTH')
    const len=header('content-length')
    if(len && (!/^(0|[1-9]\d*)$/.test(len)||Number(len)>1024))
      return failure(413,'DECISION_SIZE')
    const bytes=await new Promise<Buffer>((resolve,reject)=>{
      let size=0,done=false
      const chunks:Buffer[]=[]
      const clean=()=>{
        clearTimeout(timer)
        req.off('data',onData)
        req.off('end',onEnd)
        req.off('aborted',onAbort)
        req.off('error',onAbort)
        req.pause()
      }
      const fail=(status:number,code:string)=>{
        if(done)return
        done=true;clean()
        reject(new ServiceError(status,code,'Solicitação da integração rejeitada.'))
      }
      const onData=(chunk:Buffer)=>{
        const buf=Buffer.from(chunk)
        size+=buf.length
        if(size>1024)return fail(413,'DECISION_SIZE')
        chunks.push(buf)
      }
      const onEnd=()=>{
        if(done)return
        done=true;clean()
        resolve(Buffer.concat(chunks,size))
      }
      const onAbort=()=>fail(400,'DECISION_BODY')
      const timer=setTimeout(()=>fail(408,'DECISION_TIMEOUT'),5000)
      req.on('error',()=>{})
      req.on('data',onData)
      req.once('end',onEnd)
      req.once('aborted',onAbort)
      req.once('error',onAbort)
    })
    const digest=createHmac('sha256',config.secret)
      .update('whatsapp-decision-v1\n'+stamp+'\n').update(bytes).digest()
    if(!timingSafeEqual(digest,Buffer.from(signature.slice(7),'hex')))
      return failure(401,'DECISION_AUTH')
    let parsed:unknown
    try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
    catch{return failure(422,'DECISION_JSON')}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      return failure(422,'DECISION_INVALID')
    try{
      const state=config.ledger.append(parsed as ConfirmedWhatsAppDecision,now())
      res.setHeader('Cache-Control','no-store')
      return {status:202,state}
    }catch(e){
      if(e instanceof Error && e.message==='DECISION_CONFLICT')
        return failure(409,'DECISION_CONFLICT')
      return failure(422,'DECISION_INVALID')
    }
  }
}
