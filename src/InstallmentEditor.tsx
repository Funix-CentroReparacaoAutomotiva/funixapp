import{useEffect,useRef,useState}from'react'
import type{InstallmentConfiguration}from'../shared/budget-terms'
import{INSTALLMENT_PLANS}from'../shared/budget-terms'
import{api}from'./api'
import './budget-terms.css'
export function InstallmentEditor({onDirty,onBusy,onAuthRequired}:{onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onAuthRequired:()=>void}){
 const [saved,setSaved]=useState<InstallmentConfiguration|null>(null),[rates,setRates]=useState<InstallmentConfiguration['rates']|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const running=useRef(false),dirty=Boolean(saved&&rates&&JSON.stringify(saved.rates)!==JSON.stringify(rates))
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false)},[dirty,onDirty])
 useEffect(()=>{const controller=new AbortController();api<InstallmentConfiguration>('/api/parcelamento',{signal:controller.signal}).then(c=>{setSaved(c);setRates(c.rates)}).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e.status===401)onAuthRequired()}});return()=>controller.abort()},[onAuthRequired])
 async function operation(write:boolean){
  if(running.current)return
  running.current=true;setBusy(true);onBusy(true);setError('')
  try{
   const c=await api<InstallmentConfiguration>('/api/parcelamento',write?{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:saved?.revision,rates})}:undefined)
   setSaved(c);setRates(c.rates)
  }catch(e){setError((e as Error).message);if((e as{status?:number}).status===401)onAuthRequired()}
  finally{running.current=false;setBusy(false);onBusy(false)}
 }
 return <section aria-label="Parcelamento global"><h2>Parcelamento</h2><p className="at-form-hint">Acréscimos sobre o total à vista. Alterações valem para as próximas emissões; PDFs anteriores permanecem intactos.</p>{error&&<p role="alert" className="form-error">{error}</p>}{rates&&<form onSubmit={e=>{e.preventDefault();void operation(true)}}><table className="installment-rates"><thead><tr><th>Parcelamento</th><th>Acréscimo (%)</th></tr></thead><tbody>{INSTALLMENT_PLANS.map(([key,count])=><tr key={key}><th>{count}x</th><td><input aria-label={`Acréscimo ${count}x (%)`} inputMode="decimal" autoComplete="off" value={rates[key]} disabled={busy} onChange={e=>{setRates({...rates,[key]:e.target.value.replace(',','.')})}}/></td></tr>)}</tbody></table><button className="primary-btn" disabled={busy||!dirty} type="submit">Salvar parcelamento</button></form>}<button className="fh-filter" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Descartar as taxas digitadas e carregar a configuração salva?'))void operation(false)}}>Recarregar parcelamento</button></section>
}
