import{useEffect,useRef,useState}from'react'
import{ApprovedIcon}from'./ApprovedIcon'
import{api}from'./api'
import{QUOTE_CATEGORIES,quoteNames}from'../shared/component-quote'
import type{QuoteResult}from'../shared/component-quote'
import{componentDecimal}from'../shared/voice-components'

export interface QuotationContext{atendimentoId:string;scenarioId:string;resolutionId:string}
export function ComponentQuotation({command,value,enabled,parentEnabled,busy,context,quoteEnabled,onChange,onRevise,onToggle,onSelect}:{command:string;value:{quantity:string;manualPrice:string};enabled:boolean;parentEnabled:boolean;busy:boolean;context?:QuotationContext;quoteEnabled:boolean;onChange:(v:{quantity:string;manualPrice:string})=>void;onRevise?:()=>void;onToggle:()=>void;onSelect:(price:string)=>void}){
 const[result,setResult]=useState<QuoteResult|null>(null),[loading,setLoading]=useState(false)
 const epoch=useRef(0),controller=useRef<AbortController|null>(null)
 const cancel=()=>{epoch.current++;controller.current?.abort();controller.current=null}
 const invalidate=()=>{cancel();setLoading(false);setResult(null)}
 // Parent keys this view by server resolution + command: a replacement plan
 // remounts empty state and aborts the previous lookup without effect setters.
 useEffect(()=>cancel,[])
 useEffect(()=>{
  if(!result?.offers.length)return
  const delay=Date.parse(result.expiresAt)-Date.now()
  const timer=setTimeout(()=>setResult(null),Number.isFinite(delay)?Math.max(0,delay):0)
  return()=>clearTimeout(timer)
 },[result])
 const change=(next:{quantity:string;manualPrice:string})=>{invalidate();onChange(next)}
 async function search(){
  if(!quoteEnabled||!context||busy||controller.current)return
  const revision=++epoch.current,abort=new AbortController();controller.current=abort;setLoading(true);setResult(null)
  try{
   const reply=await api<QuoteResult>(`/api/atendimentos/${context.atendimentoId}/copiloto/cotar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:context.scenarioId,resolutionId:context.resolutionId,commandId:command}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])})
   if(revision===epoch.current&&!abort.signal.aborted)setResult(reply)
  }catch{if(revision===epoch.current&&!abort.signal.aborted)setResult({status:'unavailable',offers:[],observedAt:'',expiresAt:'',cached:false})}
  finally{if(revision===epoch.current){controller.current=null;setLoading(false)}}
 }
 const price=(raw:string)=>{if(!componentDecimal(raw))return raw;const[w,f='']=raw.split('.');return w+','+f.padEnd(2,'0')}
 return <div className="voice-component-values">
  <div className="voice-component-line">
   <button type="button" className="voice-component-switch" role="switch" aria-label="Habilitar componente neste cenário" aria-checked={enabled&&parentEnabled} aria-description={!parentEnabled?'Peça desabilitada neste cenário; componente fora do cálculo.':undefined} disabled={busy||!parentEnabled} onClick={()=>{invalidate();onToggle()}}><span aria-hidden="true"/></button>
   <label>Qtd.<input aria-label="Quantidade do componente" inputMode="decimal" disabled={busy} value={value.quantity} onChange={e=>change({...value,quantity:e.target.value})}/></label>
   <label>Preço base (R$)<input aria-label="Preço unitário do componente" aria-description="Preço unitário base, antes da Margem de Referência" inputMode="decimal" disabled={busy} value={value.manualPrice} onChange={e=>change({...value,manualPrice:e.target.value})}/></label>
   <button type="button" className="voice-component-quote" aria-label="Cotar componente" aria-busy={loading} title={!quoteEnabled?'Cotação indisponível nesta etapa':loading?'Consultando':'Cotar componente'} disabled={!quoteEnabled||busy||loading||!context} onClick={()=>void search()}><ApprovedIcon name="receipt-text"/></button>
  </div>
  {(result||loading)&&<div className="component-quote-options" aria-label="Cotações do componente">
   {QUOTE_CATEGORIES.map((category,index)=>{
    const offer=result?.offers.find(o=>o.category===category),name=quoteNames[category]
    return <span className="component-quote-option" key={category}><button type="button" disabled={busy||loading||!offer} aria-label={name+(offer?', R$ '+price(offer.price):', não encontrado nesta consulta')} title={name+(offer?'':' — não encontrado nesta consulta')} onClick={()=>{if(offer&&result&&Date.parse(result.expiresAt)>Date.now())onSelect(offer.price)}}><QuoteIcon index={index}/>{offer?'R$ '+price(offer.price):'—'}</button>{offer&&<a href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={'Abrir anúncio de origem: '+name} title={'Abrir anúncio de origem: '+name}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3M10 3H3v18h18v-7"/></svg></a>}</span>
   })}
   <span className="quote-sr" role="status">{loading?'Consultando':result?.status==='needs_details'?'Dados de compatibilidade insuficientes':result?.offers.length?'Consulta concluída':'Não encontrado nesta consulta'}</span>
  </div>}
  {onRevise&&<button className="voice-component-revise" disabled={busy} onClick={()=>{invalidate();onRevise()}}>Revisar valores</button>}
 </div>
}
function QuoteIcon({index}:{index:number}){return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{index===0?<><path d="M20 7H4V4h14v3M4 7v13h16V7M16 11h5v5h-5z"/></>:index===1?<><path d="M12 3v18M5 21h14M4 7h16M4 7l-3 7h6zM20 7l-3 7h6z"/></>:<path d="M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/>}</svg>}
