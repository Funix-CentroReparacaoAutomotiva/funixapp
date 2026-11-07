import{createHash}from'node:crypto'
import type{QuoteQuery,QuoteResult,QuoteMetrics}from'../shared/component-quote.ts'
import type{QuoteProvider}from'./component-quote-provider.ts'
import{ServiceError}from'./errors.ts'
export interface QuoteService{run(query:QuoteQuery,session:string,signal:AbortSignal):Promise<QuoteResult>}
export function createQuoteService(provider:QuoteProvider,options:{timeoutMs?:number;cacheMs?:number;maxAttempts?:number;now?:()=>number;observe?:(metrics:QuoteMetrics)=>void}={}):QuoteService{
 const now=options.now??Date.now,timeout=Math.min(30000,Math.max(1,options.timeoutMs??20000)),ttl=Math.min(600000,Math.max(0,options.cacheMs??600000)),maximum=Math.min(10,Math.max(1,options.maxAttempts??10))
 let attempts=0
 const cache=new Map<string,QuoteResult>(),pending=new Map<string,Promise<QuoteResult>>()
 return{async run(query,session,signal){
  signal.throwIfAborted()
  const key=createHash('sha256').update(session+'\0'+JSON.stringify(query)).digest('hex')
  for(const [k,v]of cache)if(Date.parse(v.expiresAt)<=now())cache.delete(k)
  const cached=cache.get(key);if(cached)return{...structuredClone(cached),cached:true}
  const running=pending.get(key);if(running)return structuredClone(await running)
  if(attempts>=maximum)throw new ServiceError(429,'QUOTE_BUDGET','Limite do piloto atingido.')
  attempts++
  const controller=new AbortController(),abort=()=>controller.abort(new ServiceError(499,'QUOTE_CANCELLED','Consulta cancelada.'))
  signal.addEventListener('abort',abort,{once:true})
  const start=now(),timer=setTimeout(()=>controller.abort(new ServiceError(504,'QUOTE_TIMEOUT','Consulta não concluída.')),timeout)
  const work=(async()=>{
   try{
    const cancelled=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))
    const value=await Promise.race([provider.search(query,controller.signal),cancelled]);controller.signal.throwIfAborted()
    const result:QuoteResult={status:value.offers.length?'found':'empty',offers:value.offers,observedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+ttl).toISOString(),cached:false}
    cache.set(key,result);if(cache.size>100)cache.delete(cache.keys().next().value!)
    options.observe?.({...value.metrics,elapsedMs:now()-start})
    return structuredClone(result)
   }catch(error){options.observe?.({elapsedMs:now()-start,webSearchCalls:null,inputTokens:null,outputTokens:null,estimatedUsd:null,rejected:0,status:error instanceof ServiceError?error.code:'QUOTE_FAILED'});throw error}
   finally{clearTimeout(timer);signal.removeEventListener('abort',abort);pending.delete(key)}
  })()
  pending.set(key,work);return work
 }}
}
