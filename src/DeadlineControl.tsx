import{useEffect,useEffectEvent,useRef,useState}from'react'
import type{CommercialWorkspace,Scenario}from'../shared/commercial'
import{executionDeadline}from'../shared/budget-terms'
import type{ScenarioDeadline}from'../shared/budget-terms'
import{api}from'./api'
import{ApprovedIcon}from'./ApprovedIcon'
import './budget-terms.css'
const setting=(s:Scenario)=>s.deadline??{mode:'automatic' as const,manualDays:null}
const signature=(s:ScenarioDeadline)=>JSON.stringify(s)
const days=(v:string)=>/^\d+$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null
export function DeadlineControl({at,scenario,technicalDays,paintingIncluded,externalBusy,onDirty,onBusy,onSync,onAuthRequired}:{at:string;scenario:Scenario;technicalDays:string|null;paintingIncluded:boolean;externalBusy:boolean;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onSync:()=>Promise<CommercialWorkspace|void>;onAuthRequired:()=>void}){
 const [baseline,setBaseline]=useState(()=>setting(scenario)),[draft,setDraft]=useState(()=>({mode:setting(scenario).mode,text:setting(scenario).manualDays?.toString()??''})),[busy,setBusy]=useState(false),[error,setError]=useState(''),[blocked,setBlocked]=useState(false),[recovered,setRecovered]=useState<number|null>(null)
 const running=useRef(false),desired:ScenarioDeadline={mode:draft.mode,manualDays:draft.mode==='manual'?days(draft.text):null},valid=draft.mode==='automatic'||desired.manualDays!==null,dirty=!valid||signature(desired)!==signature(baseline)
 const effective=executionDeadline(desired,technicalDays,paintingIncluded)
 const origin=desired.mode==='manual'?'Prazo manual':paintingIncluded&&effective.effectiveDays!==null&&technicalDays!==null&&effective.effectiveDays>Number(technicalDays)?'Piso de 5 dias úteis por Pintura':'Cálculo técnico'
 const sourceDetail=desired.mode==='manual'
  ?'Informado manualmente'+(paintingIncluded?' · Pintura habilitada':' · Sem piso por Pintura')
  :'Prazo técnico: '+(technicalDays??'indisponível')+' dia(s) útil(eis) · Pintura habilitada: '+(paintingIncluded?'sim':'não')

 const incoming=setting(scenario),syncIncoming=useEffectEvent(()=>{if(!dirty&&!blocked){setBaseline(incoming);setDraft({mode:incoming.mode,text:incoming.manualDays?.toString()??''})}})
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)syncIncoming()});return()=>{active=false}},[scenario.revision,incoming.mode,incoming.manualDays])
 useEffect(()=>{onDirty(dirty||blocked);return()=>onDirty(false)},[dirty,blocked,onDirty])
 function accept(value:ScenarioDeadline){setBaseline(value);setDraft({mode:value.mode,text:value.manualDays?.toString()??''});setBlocked(false);setRecovered(null);setError('')}
 async function save(revision=scenario.revision){
  if(running.current||externalBusy||!valid||!dirty)return
  const sent={...desired};running.current=true;setBusy(true);onBusy(true);setError('')
  try{
   const ack=await api<Scenario>(`/api/atendimentos/${at}/cenarios/${scenario.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,deadline:sent})})
   const w=await onSync(),saved=w?.scenarios.find(s=>s.id===scenario.id)
   if(!saved||saved.revision!==ack.revision||signature(setting(saved))!==signature(sent))throw new Error('Não foi possível confirmar o prazo salvo. O valor digitado foi preservado.')
   accept(setting(saved))
  }catch(e){setBlocked(true);setRecovered(null);setError((e as Error).message);if((e as{status?:number}).status===401)onAuthRequired()}
  finally{running.current=false;setBusy(false);onBusy(false)}
 }
 const autosave=useEffectEvent(()=>{void save()})
 useEffect(()=>{if(!dirty||!valid||busy||blocked||externalBusy)return;const timer=setTimeout(()=>autosave(),450);return()=>clearTimeout(timer)},[dirty,valid,draft.mode,draft.text,busy,blocked,externalBusy,scenario.revision])
 async function recover(){
  if(running.current||externalBusy)return
  if(recovered!==null){await save(recovered);return}
  running.current=true;setBusy(true);onBusy(true)
  try{
   const w=await onSync(),saved=w?.scenarios.find(s=>s.id===scenario.id);if(!saved)throw new Error('Cenário indisponível. Prazo digitado preservado.')
   if(valid&&signature(setting(saved))===signature(desired))accept(setting(saved))
   else{setBaseline(setting(saved));setRecovered(saved.revision);setError('Confira o prazo digitado antes de mantê-lo sobre a versão salva.')}
  }catch(e){setError((e as Error).message);if((e as{status?:number}).status===401)onAuthRequired()}
  finally{running.current=false;setBusy(false);onBusy(false)}
 }
 async function loadSaved(){
  if(running.current||externalBusy)return
  running.current=true;setBusy(true);onBusy(true)
  try{const w=await onSync(),saved=w?.scenarios.find(s=>s.id===scenario.id);if(!saved)throw new Error('Cenário indisponível. Prazo digitado preservado.');accept(setting(saved))}
  catch(e){setError((e as Error).message);if((e as{status?:number}).status===401)onAuthRequired()}
  finally{running.current=false;setBusy(false);onBusy(false)}
 }
 return <section className="execution-deadline" aria-label="Prazo de execução" aria-busy={busy}><div className="deadline-heading"><span>Prazo de execução</span><button type="button" className="deadline-toggle" aria-label="Cálculo automático" aria-pressed={draft.mode==='automatic'} disabled={busy||externalBusy||blocked} onClick={()=>{setDraft(draft.mode==='automatic'?{mode:'manual',text:effective.effectiveDays!==null?String(effective.effectiveDays):''}:{mode:'automatic',text:''})}}><ApprovedIcon name={draft.mode==='automatic'?'toggle':'off'}/><span>Cálculo automático</span></button></div>{draft.mode==='automatic'?<p className="deadline-value">{effective.effectiveDays!==null?effective.effectiveDays+' dias úteis':'Prazo pendente'}</p>:<label className="deadline-manual"><span>Dias úteis</span><input aria-label="Prazo manual em dias úteis" inputMode="numeric" value={draft.text} disabled={busy||externalBusy} aria-invalid={!valid} onChange={e=>setDraft({...draft,text:e.target.value})} onBlur={()=>{if(!blocked)void save()}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!blocked)void save()}}}/></label>}<p className="deadline-source" role="status">Origem: {origin}. {sourceDetail}.</p>{effective.warning&&<p className="deadline-notice" role="status">{effective.warning}</p>}{!valid&&<p className="deadline-notice" role="status">Informe dias úteis inteiros positivos.</p>}{error&&<div role="alert"><p>{error}</p><button disabled={busy||externalBusy||!valid} onClick={()=>void recover()}>{recovered===null?'Atualizar prazo':'Salvar meu prazo'}</button><button disabled={busy||externalBusy} onClick={()=>void loadSaved()}>Carregar prazo salvo</button></div>}</section>
}
