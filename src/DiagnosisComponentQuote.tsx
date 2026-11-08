import{useEffect,useRef,useState}from'react'
import{ApprovedIcon}from'./ApprovedIcon'
import{api}from'./api'
import{QUOTE_CATEGORIES,quoteNames}from'../shared/component-quote'
import type{QuoteResult}from'../shared/component-quote'

// Independent of the transient voice review. Search never writes a component.
// Explicit operator selection only edits the existing diagnosis form.
export function DiagnosisComponentQuote({atendimentoId,scenarioId,componentId,revision,enabled,onSelect}:{atendimentoId:string;scenarioId:string;componentId:string;revision:number;enabled:boolean;onSelect:(price:string)=>void}){
 const[result,setResult]=useState<QuoteResult|null>(null),[loading,setLoading]=useState(false)
 const controller=useRef<AbortController|null>(null),epoch=useRef(0)
 useEffect(()=>()=>{epoch.current++;controller.current?.abort();controller.current=null},[])
 useEffect(()=>{
  if(!result)return
  const delay=Date.parse(result.expiresAt)-Date.now()
  if(!Number.isFinite(delay)||delay<=0)return
  const timer=setTimeout(()=>setResult(null),delay)
  return()=>clearTimeout(timer)
 },[result])
 async function search(){
  if(!enabled||loading||controller.current)return
  const token=++epoch.current,abort=new AbortController();controller.current=abort;setLoading(true);setResult(null)
  try{
   const next=await api<QuoteResult>(`/api/atendimentos/${atendimentoId}/componentes/${componentId}/cotar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId,componentRevision:revision}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])})
   if(token===epoch.current&&!abort.signal.aborted)setResult(next)
  }catch{
   if(token===epoch.current&&!abort.signal.aborted)setResult({status:'unavailable',offers:[],observedAt:'',expiresAt:'',cached:false})
  }finally{if(token===epoch.current){controller.current=null;setLoading(false)}}
 }
 const feedback=result?.status==='needs_details'?'Dados técnicos insuficientes ou incompatíveis para cotar.'
  :result?.status==='empty'?'Pesquisa concluída sem ofertas verificáveis.'
  :result?.status==='unavailable'?'Falha na cotação. Confira as tentativas antes de repetir.':null
 const format=(raw:string)=>{const[a,b='']=raw.split('.');return a+','+b.padEnd(2,'0')}
 return <>
  <button type="button" className="diagnosis-quote-button" aria-label="Pesquisar preço do componente" aria-busy={loading} title={enabled?'Pesquisar preços para este componente salvo':'Salve o componente para habilitar a pesquisa'} disabled={!enabled||loading} onClick={()=>void search()}><ApprovedIcon name="receipt-text"/></button>
  {(result||loading)&&<div className="diagnosis-quote-options" role="group" aria-label="Preços pesquisados do componente">
   <div className="diagnosis-quote-prices">
    {QUOTE_CATEGORIES.map(category=>{
     const offer=result?.offers.find(o=>o.category===category),name=quoteNames[category]
     return <span className="diagnosis-quote-option" key={category}>
      <span className="diagnosis-quote-label">{name}</span>
      <button type="button" disabled={!enabled||loading||!offer||!result||Date.parse(result.expiresAt)<=Date.now()} title={offer?'Usar preço pesquisado neste campo':'Nenhuma oferta verificável'} aria-label={name+(offer?', R$ '+format(offer.price):', não encontrado')} onClick={()=>{if(offer&&result&&Date.parse(result.expiresAt)>Date.now())onSelect(offer.price)}}>{offer?'R$ '+format(offer.price):'—'}</button>
      {offer&&<a href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={'Abrir anúncio de origem: '+name}>Ver fonte</a>}
     </span>
    })}
   </div>
   <span role="status" className="diagnosis-quote-status">{loading?'Pesquisando preços…':feedback??'Consulta concluída; selecione um preço para preencher o campo.'}</span>
  </div>}
 </>
}
