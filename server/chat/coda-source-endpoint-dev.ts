import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ServiceError } from '../errors.ts'
import type { DevelopmentSourceLedger } from './coda-source-storage-dev.ts'
import type { ImmutableWhatsAppSource } from './coda-source-ledger-dev.ts'

const maxBodyBytes = 2048
const maxSkewSeconds = 300
function reject(status:number, code:string):never {
  throw new ServiceError(status,code,'Solicitação da integração rejeitada.')
}
export type DevelopmentSourceIntakeConfig = {
  ledger: DevelopmentSourceLedger
  secret: Buffer
  now?:()=>number
}
export function parseDevelopmentSourceSecret(env:NodeJS.ProcessEnv):Buffer|null {
  if(env.FUNIX_SOURCE_LEDGER_ENABLED!=='true') return null
  const text=env.FUNIX_SOURCE_LEDGER_HMAC_KEY_BASE64??''
  if(!/^[A-Za-z0-9+/]{43,88}={0,2}$/.test(text))throw Error('SOURCE_LEDGER_KEY_INVALID')
  const key=Buffer.from(text,'base64')
  if(key.length<32||key.length>64||key.toString('base64')!==text)
    throw Error('SOURCE_LEDGER_KEY_INVALID')
  return key
}
export function createDevelopmentSourceIntake(config:DevelopmentSourceIntakeConfig) {
  const now=config.now??Date.now
  if(config.secret.length<32||config.secret.length>64)
    throw Error('SOURCE_LEDGER_KEY_INVALID')
  return async(req:IncomingMessage,res:ServerResponse,url:URL)=>{
    if(req.method!=='POST')return reject(405,'METHOD_NOT_ALLOWED')
    if(url.search||req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined)
      return reject(403,'SOURCE_LEDGER_BROWSER_DENIED')
    if(req.headers['content-encoding']!==undefined||
       !/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']??'')))
      return reject(415,'SOURCE_LEDGER_CONTENT_TYPE')
    const header=(name:string):string=>{
      const count=req.rawHeaders?.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length
      const raw=req.headers[name]
      if((count!==undefined&&count!==1)||Array.isArray(raw))
        return reject(401,'SOURCE_LEDGER_AUTH')
      return raw??''
    }
    const stamp=header('x-funix-timestamp')
    const signature=header('x-funix-signature')
    if(!/^(0|[1-9]\d{0,11})$/.test(stamp) ||
       !/^sha256=[a-f0-9]{64}$/.test(signature) ||
       Math.abs(Math.floor(now()/1000)-Number(stamp))>maxSkewSeconds)
      return reject(401,'SOURCE_LEDGER_AUTH')
    const length=header('content-length')
    if(length && (!/^(0|[1-9]\d*)$/.test(length)||Number(length)>maxBodyBytes))
      return reject(413,'SOURCE_LEDGER_SIZE')
    const body=await new Promise<Buffer>((resolve,rejectPromise)=>{
      let size=0,finished=false
      const chunks:Buffer[]=[]
      const cleanup=()=>{
        clearTimeout(timeout)
        req.off('data',onData)
        req.off('end',onEnd)
        req.off('aborted',onAbort)
        req.off('error',onAbort)
        req.pause()
      }
      const fail=(status:number,code:string)=>{
        if(finished)return
        finished=true
        cleanup()
        rejectPromise(new ServiceError(status,code,'Solicitação da integração rejeitada.'))
      }
      const onData=(chunk:Buffer)=>{
        const part=Buffer.from(chunk)
        size+=part.length
        if(size>maxBodyBytes)return fail(413,'SOURCE_LEDGER_SIZE')
        chunks.push(part)
      }
      const onEnd=()=>{
        if(finished)return
        finished=true
        cleanup()
        resolve(Buffer.concat(chunks,size))
      }
      const onAbort=()=>fail(400,'SOURCE_LEDGER_BODY')
      const timeout=setTimeout(()=>fail(408,'SOURCE_LEDGER_TIMEOUT'),5000)
      req.on('error',()=>{})
      req.on('data',onData)
      req.once('end',onEnd)
      req.once('aborted',onAbort)
      req.once('error',onAbort)
    })
    const expected=createHmac('sha256',config.secret)
      .update('whatsapp-source-v1\n'+stamp+'\n').update(body).digest()
    if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))
      return reject(401,'SOURCE_LEDGER_AUTH')
    let parsed:unknown
    try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))}
    catch{return reject(422,'SOURCE_LEDGER_JSON')}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
      return reject(422,'SOURCE_LEDGER_INVALID')
    try{
      const state=config.ledger.append(parsed as ImmutableWhatsAppSource,now())
      res.setHeader('Cache-Control','no-store')
      return {status:202,state}
    }catch(error){
      if(error instanceof Error && error.message==='SOURCE_LEDGER_CONFLICT')
        return reject(409,'SOURCE_LEDGER_CONFLICT')
      return reject(422,'SOURCE_LEDGER_INVALID')
    }
  }
}
