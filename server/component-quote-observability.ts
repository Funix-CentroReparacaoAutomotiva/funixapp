import{QUOTE_REJECTION_REASONS}from'../shared/component-quote.ts'
import type{QuoteMetrics}from'../shared/component-quote.ts'

// Backend-only opt-in: only bounded numeric aggregates and fixed codes.
// No source excerpts, prices, URLs, query, session, identifiers, transcript or secrets.
export function createQuoteMetricsObserver(enabled:boolean,emit:(line:string)=>void=(line)=>console.info(line)){
 if(!enabled)return undefined
 const integer=(v:unknown,max:number):number|null=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max?v:null
 return (metric:QuoteMetrics):void=>{
  try{
   const reasons:Record<string,number>={}
   for(const key of QUOTE_REJECTION_REASONS){
    const count=integer(metric.rejectionReasons?.[key],3)
    if(count!==null&&count>0)reasons[key]=count
   }
   const money=typeof metric.estimatedUsd==='number'&&Number.isFinite(metric.estimatedUsd)&&metric.estimatedUsd>=0&&metric.estimatedUsd<=5?metric.estimatedUsd:null
   const status=/^(found|empty|QUOTE_[A-Z_]{1,40})$/.test(metric.status)?metric.status:'QUOTE_FAILED'
   emit('funix_quote_metrics '+JSON.stringify({
    status,elapsedMs:integer(metric.elapsedMs,120000),webSearchCalls:integer(metric.webSearchCalls,1),
    inputTokens:integer(metric.inputTokens,400000),outputTokens:integer(metric.outputTokens,4096),
    estimatedUsd:money,proposedOffers:integer(metric.proposedOffers,3),acceptedOffers:integer(metric.acceptedOffers,3),
    rejected:integer(metric.rejected,3),rejectionReasons:metric.rejectionReasons===null?null:reasons,
    usableSources:integer(metric.usableSources,100),usableCitations:integer(metric.usableCitations,100)
   }))
  }catch{/* Logging must never change quote behavior. */}
 }
}
