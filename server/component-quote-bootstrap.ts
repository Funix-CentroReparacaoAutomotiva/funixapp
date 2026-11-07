import{lstatSync,statSync}from'node:fs'
import{dirname,isAbsolute,resolve}from'node:path'
import{createQuoteService}from'./component-quote-service.ts'
import{openAIQuoteProvider}from'./component-quote-provider.ts'
import{createQuoteMetricsObserver}from'./component-quote-observability.ts'
import type{QuoteService}from'./component-quote-service.ts'

// The existing FUNIX database volume is the source of persistence for this
// explicitly opt-in pilot. No new VM, API or storage service is required.
export function loadQuotePilot(env:NodeJS.ProcessEnv,databasePath:string):QuoteService|undefined{
 if(env.FUNIX_QUOTE_ENABLED!=='true')return undefined
 const key=env.OPENAI_API_KEY?.trim()
 if(!key)throw new Error('Cotação habilitada, mas OPENAI_API_KEY não está configurada no backend.')
 if(!databasePath||databasePath===':memory:')throw new Error('Cotação exige banco em armazenamento persistente.')
 const database=resolve(databasePath)
 const ledger=env.FUNIX_QUOTE_LEDGER?.trim()||resolve(dirname(database),'funix-quote-pilot-ledger.json')
 if(!isAbsolute(ledger)||resolve(ledger)===database)throw new Error('Caminho persistente do ledger de cotação inválido.')
 const folder=dirname(ledger)
 try{
  if(!statSync(folder).isDirectory())throw Error()
  const current=statSync(folder)
  if(current.mode&0o002)throw Error()
 }catch{throw new Error('Diretório do ledger indisponível ou com permissão insegura.')}
 try{
  if(lstatSync(ledger).isSymbolicLink())throw new Error('Ledger de cotação não pode ser link simbólico.')
 }catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
 }
 return createQuoteService(openAIQuoteProvider({key,ledger}),{observe:createQuoteMetricsObserver(env.FUNIX_QUOTE_METRICS_ENABLED==='true')})
}
