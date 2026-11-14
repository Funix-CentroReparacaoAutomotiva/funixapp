// Disposable lab ONLY. Real FUNIX queue/HMAC handlers; synthetic Gmail and faults.
import {createServer} from 'node:http'
import {openDatabase} from '../../server/database.ts'
import {createGmailIntakeSchema} from '../../server/gmail-intake-schema.ts'
import {createGmailIntakeQueueSchema} from '../../server/gmail-intake-queue-schema.ts'
import {GmailIntakeQueue} from '../../server/gmail-intake-queue.ts'
import {GmailIntakeRepository} from '../../server/gmail-intake.ts'
import {createGmailQueueEndpoint} from '../../server/gmail-intake-queue-endpoint.ts'
import {createGmailCandidateIngest,createGmailIntakeIngest} from '../../server/gmail-intake-ingest.ts'

export const queueKey='synthetic-runtime-queue-key-not-for-production'
export const intakeKey='synthetic-runtime-intake-key-not-for-production'
type Fault={before?:number;lost?:number;status?:number;malformed?:number}
export async function startMock(path:string){
  const db=openDatabase(path)
  createGmailIntakeSchema(db);createGmailIntakeQueueSchema(db)
  let offset=0
  const queue=new GmailIntakeQueue(db,()=>Date.now()+offset)
  const notices=new GmailIntakeRepository(db)
  const endpoint=createGmailQueueEndpoint(queue,queueKey,true)
  const intake=createGmailCandidateIngest(notices,intakeKey,true)
  const intakeProbe=createGmailIntakeIngest(notices,intakeKey,true)
  const faults:Record<string,Fault>={}
  const reads:string[]=[],calls:Record<string,number>={}
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url??'/','http://127.0.0.1')
    const action=url.pathname.split('/').pop()!
    calls[action]=(calls[action]??0)+1
    const fault=faults[action]
    try{
      if(fault?.before){fault.before--;req.resume();res.writeHead(fault.status??503,{'content-type':'application/json'}).end('{}');return}
      let result:unknown,status=200
      if(url.pathname.startsWith('/synthetic-gmail/')){
        reads.push(action)
        result={id:action,subject:action.endsWith('0')?'Newsletter semanal':'Autorização do reparo do veículo',snippet:action.endsWith('0')?'Promoção de marketing digital':'Reparo autorizado para análise humana.'}
      }else if(action==='intake-candidates'){
        result=await intake(req,res);status=202
      }else if(action==='intake-notices'){
        result=await intakeProbe(req,res);status=202
      }else if(['enqueue','claim','ack','status','overview'].includes(action)){
        result=await endpoint(req,res,action as 'enqueue'|'claim'|'ack'|'status'|'overview')
      }else {res.writeHead(404).end();return}
      if(fault?.lost){fault.lost--;req.socket.destroy();return}
      if(fault?.malformed){fault.malformed--;result={incomplete:true}}
      res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(result))
    }catch(error){
      const e=error as {status?:number;code?:string}
      res.writeHead(e.status??500,{'content-type':'application/json'}).end(JSON.stringify({error:{code:e.code??'SYNTHETIC_HANDLER_ERROR'}}))
    }
  })
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address()
  if(!address||typeof address==='string')throw Error('LAB_BIND_FAILED')
  return {base:'http://127.0.0.1:'+address.port,db,queue,notices,faults,reads,calls,
    advance:(ms:number)=>{offset+=ms},
    close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close()}}
}
