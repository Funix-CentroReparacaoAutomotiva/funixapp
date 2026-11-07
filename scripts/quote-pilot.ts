// Default: offline harness. --live is a deliberate isolated operator action, never
// called by app startup, dictation or CI. No automatic env-file/key discovery.
import{writeFileSync}from'node:fs'
import{performance}from'node:perf_hooks'
import{quotePilotCases}from'./quote-pilot-cases.ts'
import{saneQuoteQuery}from'../server/component-quote-query.ts'
import{openAIQuoteProvider,validateQuoteResponse}from'../server/component-quote-provider.ts'
import{quoteFixtureResponse,quoteFixtureOffer}from'../server/tests/fixtures/component-quote.ts'
import{QUOTE_MODEL,QUOTE_RESERVE_USD}from'../server/component-quote-budget.ts'
import{ServiceError}from'../server/errors.ts'
const live=process.argv.includes('--live'),path=process.argv.indexOf('--out'),destination=path>=0?process.argv[path+1]:undefined
const ready=live&&process.env.NODE_ENV!=='production'&&process.env.FUNIX_QUOTE_PILOT_LIVE==='authorized'&&Boolean(process.env.OPENAI_API_KEY)&&Boolean(process.env.FUNIX_QUOTE_LEDGER)
const provider=ready?openAIQuoteProvider({key:process.env.OPENAI_API_KEY!,ledger:process.env.FUNIX_QUOTE_LEDGER!}):undefined
const records=[]
for(const test of quotePilotCases){
 const query=saneQuoteQuery(test),start=performance.now()
 const base={id:test.id,syntheticInput:test,query,manualPreparedUrl:query?'https://www.google.com/search?q='+encodeURIComponent([query.brand,query.model,query.year,query.component].filter(Boolean).join(' ')):null}
 if(live&&!ready){records.push({...base,status:'real_execution_pending',latencyMs:null,inputTokens:null,outputTokens:null,webSearchCalls:null,costUsd:null,offers:[]});continue}
 if(!query){records.push({...base,status:'needs_details',latencyMs:Math.round(performance.now()-start),inputTokens:0,outputTokens:0,webSearchCalls:0,costUsd:0,offers:[]});continue}
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
  let result
  try{
   result=provider?await provider.search(query,controller.signal):validateQuoteResponse(quoteFixtureResponse([{...quoteFixtureOffer,category:'economica',brand:query.brand,model:query.model,title:query.component+' '+query.model,yearFrom:query.year??2017,yearTo:query.year??2023,side:query.side,sourceQuote:`${query.component} ${query.model} ${query.year??2017} a ${query.year??2023} novo R$ 39,90`,origin:'parallel',officialEvidence:''}]),query)
  }finally{clearTimeout(timer)}
  records.push({...base,status:result.offers.length?'found':'empty',latencyMs:Math.round(performance.now()-start),inputTokens:ready?result.metrics.inputTokens:null,outputTokens:ready?result.metrics.outputTokens:null,webSearchCalls:ready?result.metrics.webSearchCalls:0,costUsd:ready?result.metrics.estimatedUsd:0,offers:result.offers,simulation:!ready,simulatedUsage:ready?undefined:result.metrics})
 }catch(error){records.push({...base,status:error instanceof ServiceError?error.code:'QUOTE_FAILED',latencyMs:Math.round(performance.now()-start),inputTokens:null,outputTokens:null,webSearchCalls:null,costUsd:null,offers:[]})}
}
const report={mode:live?ready?'live':'real_execution_pending':'mock_only',model:QUOTE_MODEL,maximumInitialSearches:10,maximumReservedUsd:10*QUOTE_RESERVE_USD,actualPaidSearches:ready?null:0,note:ready?'Consumo estimado; reconcilie tentativas com ledger e faturamento.':'Sem execução real. Preços/URLs de fixtures são fictícios e não são fontes de cotação.',records}
if(destination)writeFileSync(destination,JSON.stringify(report,null,2)+'\n')
else process.stdout.write(JSON.stringify(report,null,2)+'\n')
