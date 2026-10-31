import {useEffect,useEffectEvent,useLayoutEffect,useRef,useState} from 'react'
import type {DiagnosisItem,CatalogItem,CommercialWorkspace,CommercialSave,Scenario} from '../shared/commercial'
import {catalogItemUsable} from '../shared/commercial'
import {componentMR,componentResult} from './component-presentation'
import type {PricingConfiguration,ComponentItem} from '../shared/pricing'
import {api} from './api'
import {diagnosisPending,servicePending,pieceSignature,pieceDataSignature,partSignature,partDataSignature} from './calculation-state'
import type {CalculationState} from './calculation-state'
import {money} from './money'
import {ApprovedIcon as I} from './ApprovedIcon'
import './approved.css'
type Part=ComponentItem&{local?:boolean;enabled:boolean}
const decimal=(s:string)=>s.trim().replace(',','.')
const positive=(s:string)=>/^\d{1,9}(?:\.\d{1,6})?$/.test(decimal(s))&&/[1-9]/.test(s)
const validPrice=(s:string|null)=>s===null||/^\d{1,12}(?:\.\d{1,6})?$/.test(decimal(s))
const display=(s:string)=>{const [whole,fraction='']=s.replace(',','.').split('.');return whole+','+fraction.padEnd(2,'0')}
function SelectControl({label,value,items,onChange,top=false}:{label:string;value:string;items:CatalogItem[];onChange:(v:string)=>void;top?:boolean}){return <label className={top?'top-select':'select-box'}><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">Selecionar…</option>{items.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><span className="chev"><I name="chevron"/></span></label>}
function ToggleControl({label,on,onChange,top=false}:{label:string;on:boolean;onChange:()=>void;top?:boolean}){return <button type="button" className={top?'piece-toggle':'toggle'} aria-label={label} aria-pressed={on} onClick={onChange}><I name={on?'toggle':'off'}/></button>}
export function DiagnosisEditor({initial,workspace,catalog,onDirty,onBusy,onSync,onAuthRequired,onCalculationState,parameterState,pricingConfiguration}:{initial:DiagnosisItem;workspace:CommercialWorkspace;catalog:CatalogItem[];onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onSync:()=>Promise<void>;onAuthRequired:()=>void;onCalculationState:(state:CalculationState)=>void;parameterState:CalculationState;pricingConfiguration:PricingConfiguration|null}){
 const base='/api/atendimentos/'+initial.atendimentoId,scenario=workspace.selectedId
 const [piece,setPiece]=useState(()=>structuredClone(initial)),[parts,setParts]=useState<Part[]>(()=>workspace.components.filter(p=>p.pieceId===initial.id).map(p=>({...p,manualPrice:p.manualPrice===null?null:display(p.manualPrice),enabled:Boolean(workspace.scenarios.find(s=>s.id===scenario)?.componentFlags[p.id])})))
 const [serviceKeys,setServiceKeys]=useState<Record<string,string>>({})
 const [note,setNote]=useState(false),[generation,tick]=useState(0),[error,setError]=useState(''),[status,setStatus]=useState('Salvo')
 const live=useRef({piece,parts,generation});useLayoutEffect(()=>{live.current={piece,parts,generation}},[piece,parts,generation])
 const confirmed=useRef({piece:structuredClone(initial),parts:new Map(parts.map(p=>[p.id,structuredClone(p)]))}),scenarioRevision=useRef(workspace.scenarios.find(s=>s.id===scenario)!.revision),needsReconcile=useRef(false),running=useRef(false),mounted=useRef(true)
 const uncertainPiece=useRef<DiagnosisItem|null>(null),uncertainParts=useRef(new Map<string,Part>())
 const dirty=useRef(false),delay=useRef(450)
 useLayoutEffect(()=>{
  if(running.current||dirty.current||needsReconcile.current)return
  const current=workspace.items.find(p=>p.id===initial.id),s=workspace.scenarios.find(s=>s.id===scenario)
  const savedParts=workspace.components.filter(p=>p.pieceId===initial.id).map(p=>({...p,enabled:Boolean(s?.componentFlags[p.id])}))
  if(current&&s&&pieceSignature(current)===pieceSignature(confirmed.current.piece)&&savedParts.length===confirmed.current.parts.size&&savedParts.every(p=>{const known=confirmed.current.parts.get(p.id);return known&&partSignature(p)===partSignature(known)}))scenarioRevision.current=s.revision
  else needsReconcile.current=true
 },[workspace,initial.id,scenario])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onDirty(false)}},[onDirty])
 const change=(action:()=>void)=>{action();dirty.current=true;onDirty(true);setStatus('Rascunho');tick(g=>g+1)}
 const focusNew=(selector:string)=>requestAnimationFrame(()=>document.querySelector<HTMLElement>(selector)?.focus())
 const patch=(value:Partial<DiagnosisItem>)=>change(()=>setPiece(p=>({...p,...value})))
 // Only acknowledgements update the baseline. In-flight typing keeps its own values.
 function acceptPiece(saved:DiagnosisItem,sent:DiagnosisItem,acknowledged=sent){
  const added=saved.services.filter(l=>!acknowledged.services.some(old=>old.id===l.id))
  const ids=new Map(acknowledged.services.filter(l=>l.id.startsWith('new:')&&l.serviceId&&positive(l.quantity)).map((l,i)=>[l.id,added[i]?.id]))
  setServiceKeys(current=>{const next={...current};for(const [local,id]of ids)if(id)next[id]=current[local]??local;return next})
  setPiece(current=>({...current,revision:saved.revision,updatedAt:saved.updatedAt,services:current.services.map(l=>({...l,id:ids.get(l.id)??l.id}))}))
  sent.revision=saved.revision;sent.updatedAt=saved.updatedAt;sent.services=sent.services.map(l=>({...l,id:ids.get(l.id)??l.id}))
  confirmed.current.piece=structuredClone(saved)
 }
 function acceptPart(saved:ComponentItem,sent:Part,enabled:boolean){
  sent.revision=saved.revision;sent.local=undefined
  confirmed.current.parts.set(saved.id,{...saved,enabled})
  setParts(current=>current.map(p=>p.id===saved.id?{...p,revision:saved.revision,local:undefined}:p))
 }
 function savedItem<T>(reply:CommercialSave<T>){
  if(!reply?.item||!Number.isSafeInteger(reply.scenarioRevision)||reply.scenarioRevision<1)throw new Error('Confirmação de gravação inválida. Campos preservados; confira a versão salva antes de retomar.')
  scenarioRevision.current=reply.scenarioRevision;return reply.item
 }
 async function flags(value:Partial<Pick<Scenario,'pieceFlags'|'serviceFlags'|'componentFlags'>>){
  const saved=await api<Scenario>(base+'/cenarios/'+scenario,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:scenarioRevision.current,...value})})
  if(saved.id!==scenario||!Number.isSafeInteger(saved.revision)||saved.revision<1)throw new Error('Confirmação de inclusões inválida. Campos preservados; confira a versão salva.')
  scenarioRevision.current=saved.revision
 }
 async function save(){
  if(running.current)return
  running.current=true;onBusy(true);setStatus('Salvando…')
  const sent=structuredClone(live.current);let incomplete=false
  try{
   // After an uncertain response/conflict, inspect once before any retry. Never blind replay.
   if(needsReconcile.current){
    const w=await api<CommercialWorkspace>(base+'/cenarios?scenarioId='+encodeURIComponent(scenario)),s=w.scenarios.find(s=>s.id===scenario)
    if(w.selectedId!==scenario||!s)throw new Error('Cenário excluído. Campos locais preservados; reabra explicitamente após revisar.')
    const current=w.items.find(p=>p.id===initial.id)
    if(!current)throw new Error('A peça foi removida. Seus campos locais foram preservados.')
    const desired={...sent.piece,services:sent.piece.services.filter(l=>l.serviceId&&positive(l.quantity))}
    if(pieceSignature(current)!==pieceSignature(confirmed.current.piece)&&pieceSignature(current,false)!==pieceSignature(desired,false)&&(!uncertainPiece.current||pieceSignature(current,false)!==pieceSignature(uncertainPiece.current,false)))throw new Error('Os dados ou inclusões salvos mudaram. Campos locais preservados; confira a versão salva antes de retomar.')
    acceptPiece(current,sent.piece,uncertainPiece.current??sent.piece);uncertainPiece.current=null
    for(const p of sent.parts){
     const actual=w.components.find(c=>c.id===p.id),known=confirmed.current.parts.get(p.id)
     if(!actual){if(known)throw new Error('Componente removido na versão salva. Campos locais preservados.');continue}
     const stored={...actual,enabled:Boolean(s.componentFlags[p.id])}
     if((!known||partSignature(stored)!==partSignature(known))&&partSignature(stored)!==partSignature(p)&&(!uncertainParts.current.has(p.id)||partSignature(stored)!==partSignature(uncertainParts.current.get(p.id)!)))throw new Error('Componente ou inclusão alterados na versão salva. Campos locais preservados; confira antes de retomar.')
     acceptPart(actual,p,stored.enabled);uncertainParts.current.delete(p.id)
    }
    scenarioRevision.current=s.revision;needsReconcile.current=false
   }
   const services=sent.piece.services.filter(l=>{
    const valid=Boolean(l.serviceId)&&positive(l.quantity);if(!valid)incomplete=true
    if(!valid&&!l.id.startsWith('new:'))throw new Error('Complete o serviço e a quantidade antes de salvar.')
    return valid
   })
   const desired={...sent.piece,services}
   if(pieceSignature(desired)!==pieceSignature(confirmed.current.piece)){
    uncertainPiece.current=structuredClone(desired)
    if(pieceDataSignature(desired)!==pieceDataSignature(confirmed.current.piece)){
     const reply=await api<CommercialSave<DiagnosisItem>>(base+'/diagnosticos/'+initial.id,{method:'PATCH',headers:{'Content-Type':'application/json','X-Funix-Include-Revision':'1'},body:JSON.stringify({revision:sent.piece.revision,scenarioId:scenario,scenarioRevision:scenarioRevision.current,diagnosisId:sent.piece.diagnosisId,notes:sent.piece.notes,enabled:sent.piece.enabled,services:services.map(l=>({...l,id:l.id.startsWith('new:')?undefined:l.id,quantity:decimal(l.quantity)}))})})
     acceptPiece(savedItem(reply),sent.piece,uncertainPiece.current)
    }else{
     const known=confirmed.current.piece,serviceFlags=Object.fromEntries(services.filter(l=>known.services.find(k=>k.id===l.id)?.enabled!==l.enabled).map(l=>[l.id,l.enabled]))
     await flags({...(desired.enabled!==known.enabled?{pieceFlags:{[initial.id]:desired.enabled}}:{}),...(Object.keys(serviceFlags).length?{serviceFlags}:{})})
     confirmed.current.piece=structuredClone(desired)
    }
   }
   uncertainPiece.current=null
   for(const p of sent.parts){
    if(!p.name.trim()||!positive(p.quantity)||!validPrice(p.manualPrice)){incomplete=true;continue}
    let known=confirmed.current.parts.get(p.id)
    if(known&&partSignature(p)===partSignature(known))continue
    if(p.local||!known||partDataSignature(p)!==partDataSignature(known)){
     uncertainParts.current.set(p.id,structuredClone({...p,enabled:known?.enabled??true}))
     const reply=await api<CommercialSave<ComponentItem>>(base+'/componentes'+(p.local?'':'/'+p.id),{method:p.local?'POST':'PATCH',headers:{'Content-Type':'application/json','X-Funix-Include-Revision':'1'},body:JSON.stringify({...(p.local?{clientId:p.id}:{}),revision:p.revision,pieceId:initial.id,name:p.name,quantity:decimal(p.quantity),manualPrice:p.manualPrice===null?null:decimal(p.manualPrice),notes:p.notes,scenarioId:scenario,scenarioRevision:scenarioRevision.current})})
     acceptPart(savedItem(reply),p,known?.enabled??true);known=confirmed.current.parts.get(p.id);uncertainParts.current.delete(p.id)
    }
    if(known!.enabled!==p.enabled){uncertainParts.current.set(p.id,{...known!,enabled:p.enabled});await flags({componentFlags:{[p.id]:p.enabled}});confirmed.current.parts.set(p.id,{...known!,enabled:p.enabled});uncertainParts.current.delete(p.id)}
   }
   await onSync()
   if(live.current.generation===sent.generation){dirty.current=incomplete;onDirty(incomplete);setStatus(incomplete?'Rascunho incompleto':'Salvo')}
  }catch(cause){needsReconcile.current=true;if((cause as {status?:number}).status===401)onAuthRequired();setError((cause as Error).message);setStatus('Erro — campos preservados');dirty.current=true;onDirty(true)}
  finally{running.current=false;onBusy(false);if(mounted.current&&live.current.generation!==sent.generation)tick(g=>g+1)}
 }
 const saveLatest=useEffectEvent(()=>{void save()})
 useEffect(()=>{
  if(!generation||error)return
  const timer=setTimeout(()=>{saveLatest()},delay.current);return()=>clearTimeout(timer)
 },[generation,error])
 async function removePart(p:Part){
  if(running.current)return
  if(!p.local&&!window.confirm('Excluir este componente de TODOS os cenários? Orçamentos emitidos serão preservados.'))return
  if(p.local){change(()=>setParts(v=>v.filter(c=>c.id!==p.id)));return}
  if(running.current)return;running.current=true;onBusy(true)
  try{await api(base+'/componentes/'+p.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:p.revision})});setParts(v=>v.filter(c=>c.id!==p.id));confirmed.current.parts.delete(p.id);await onSync()}
  catch(cause){setError((cause as Error).message)}finally{running.current=false;onBusy(false);tick(g=>g+1)}
 }
 const options=(kind:string,current?:string|null)=>catalog.filter(c=>c.kind===kind&&(catalogItemUsable(c)||c.id===current))
 const savedPiece=workspace.items.find(p=>p.id===initial.id)
 const savedParts=workspace.components.filter(p=>p.pieceId===initial.id).map(p=>({...p,enabled:Boolean(workspace.scenarios.find(s=>s.id===scenario)?.componentFlags[p.id])}))
 const pending=diagnosisPending(piece,parts,savedPiece,savedParts)
 const calculationState:CalculationState=error?'error':pending?'pending':'current'
 useLayoutEffect(()=>{onCalculationState(calculationState)},[calculationState,onCalculationState])
 useEffect(()=>()=>onCalculationState('current'),[onCalculationState])
 const calc=workspace.calculations.find(c=>c.scenarioId===scenario)
 const mr=componentMR(workspace,pricingConfiguration)
 const saveState=error?'error':status==='Salvo'?'confirmed':status==='Salvando…'?'saving':status==='Rascunho incompleto'?'incomplete':'draft'
 return <section className="approved-editor" aria-label="Editor de diagnóstico" data-save-state={saveState} aria-busy={saveState==='saving'} onChangeCapture={e=>{delay.current=e.target instanceof HTMLSelectElement?0:450}} onClickCapture={e=>{const b=(e.target as Element).closest('button');if(b?.matches('.toggle,.piece-toggle,.trash'))delay.current=0}}><header className="head"><div className="piece-row"><ToggleControl label="Habilitar peça neste cenário" on={piece.enabled} onChange={()=>patch({enabled:!piece.enabled})} top/><div className="piece-name">{catalog.find(c=>c.id===piece.pieceId)?.name.replace(/\s*·\s*/g,' ')}</div><button className="plain-action" aria-label="Observação da peça" aria-expanded={note} style={piece.notes?{color:'#62e5cc'}:undefined} onClick={()=>setNote(v=>!v)}><I name="note"/></button></div><SelectControl label="Diagnóstico da peça" value={piece.diagnosisId??''} items={options('diagnostico',piece.diagnosisId)} onChange={v=>patch({diagnosisId:v||null})} top/>{note&&<textarea className="piece-note" maxLength={8000} aria-label="Observação da peça" value={piece.notes} onChange={e=>patch({notes:e.target.value})}/>}</header><div className="content">
 <div className="section-bar"><div className="title">Serviços <span className="count">{piece.services.length}</span></div><button className="add" aria-label="Adicionar serviço" disabled={piece.services.length>=50} onClick={()=>{patch({services:[...piece.services,{id:'new:'+crypto.randomUUID(),serviceId:'',dimensionId:null,quantity:'1',enabled:true}]});focusNew('.approved-editor .service:last-of-type select')}}><I name="plus"/><I name="wrench"/></button></div>
 {piece.services.map((l,i)=><section className="service" key={serviceKeys[l.id]??l.id} aria-label={`Serviço ${i+1}`}><div className="field-line"><SelectControl label="Serviço" value={l.serviceId} items={options('servico',l.serviceId)} onChange={v=>patch({services:piece.services.map(c=>c.id===l.id?{...c,serviceId:v,dimensionId:null}:c)})}/><SelectControl label="Dimensão" value={l.dimensionId??''} items={options('dimensao',l.dimensionId).filter(c=>c.serviceId===l.serviceId)} onChange={v=>patch({services:piece.services.map(c=>c.id===l.id?{...c,dimensionId:v||null}:c)})}/></div><div className="detail-line"><ToggleControl label="Habilitar serviço neste cenário" on={l.enabled} onChange={()=>patch({services:piece.services.map(c=>c.id===l.id?{...c,enabled:!c.enabled}:c)})}/><label className="qty">Qtd.<input aria-label="Quantidade do serviço" inputMode="decimal" value={l.quantity} onChange={e=>patch({services:piece.services.map(c=>c.id===l.id?{...c,quantity:e.target.value}:c)})}/></label><div className="calculated"><small>Valor calculado</small><strong aria-live="polite" data-state={servicePending(piece,l,savedPiece)?error?'error':'pending':parameterState}>{servicePending(piece,l,savedPiece)||parameterState!=='current'?error||parameterState==='error'?'Valor não atualizado':'Calculando…':calc?.lines.find(c=>c.id===l.id)?.total==null?'—':money(calc.lines.find(c=>c.id===l.id)!.total)}</strong></div><button className="trash" aria-label="Excluir serviço" onClick={()=>{if(l.id.startsWith('new:')||window.confirm('Excluir este serviço de TODOS os cenários?'))patch({services:piece.services.filter(c=>c.id!==l.id)})}}><I name="trash"/></button></div></section>)}
 <div className="section-bar component-title"><div className="title">Componentes <span className="count">{parts.length}</span></div><button className="add" aria-label="Adicionar componente" onClick={()=>{change(()=>setParts(v=>[...v,{id:crypto.randomUUID(),atendimentoId:initial.atendimentoId,pieceId:initial.id,name:'',quantity:'1',manualPrice:null,notes:'',revision:1,enabled:true,local:true}]));focusNew('.approved-editor .component:last-of-type .name')}}><I name="plus"/><I name="cube"/></button></div>
 {parts.map(p=>{const result=componentResult(p,piece,workspace,parameterState,Boolean(error),pricingConfiguration);return <section className="component" key={p.id} data-component-id={p.id} data-included={piece.enabled&&p.enabled}>
 <div className="component-first-line"><ToggleControl label="Habilitar componente neste cenário" on={p.enabled} onChange={()=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,enabled:!c.enabled}:c)))}/><input className="name" maxLength={250} aria-label="Descrição do componente" value={p.name} onChange={e=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,name:e.target.value}:c)))}/><button className="trash" aria-label="Excluir componente" onClick={()=>removePart(p)}><I name="trash"/></button></div>
 <div className="component-values"><label className="qty">Qtd.<input aria-label="Quantidade do componente" inputMode="decimal" value={p.quantity} onChange={e=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,quantity:e.target.value}:c)))}/></label><label className="price-input">Preço unitário (R$)<input aria-label="Preço unitário do componente" inputMode="decimal" value={p.manualPrice??''} onChange={e=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,manualPrice:e.target.value===''?null:e.target.value}:c)))}/></label><div className="component-mr"><span>MR</span><output role="note" aria-label="MR do componente" title={mr.factor===null?'Selecione um MR válido no painel financeiro':`Multiplicador do Atendimento: ${mr.factor.replace('.',',')}`}>{parameterState==='pending'?'Calculando…':parameterState==='error'?'Não atualizado':mr.label}</output></div><div className="component-total"><span>Total</span><output role="note" aria-label="Total do componente" data-state={result.state} aria-live="polite">{result.value===null?result.text:money(result.value)}</output></div></div></section>})}
 {!error&&saveState!=='confirmed'&&<div className={'unsaved'+(saveState==='incomplete'?'':' selection-announcement')} role="status">{saveState==='saving'?'Salvando alterações…':saveState==='incomplete'?'Rascunho incompleto — complete os campos pendentes.':'Alterações ainda não confirmadas.'}</div>}{error&&<div role="alert"><p>{error}</p><button onClick={()=>{setError('');tick(g=>g+1)}}>Tentar novamente</button><button onClick={async()=>{if(!window.confirm('Descartar os campos locais e carregar a versão salva?'))return;onBusy(true);try{const w=await api<CommercialWorkspace>(base+'/cenarios?scenarioId='+encodeURIComponent(scenario)),saved=w.items.find(p=>p.id===initial.id);if(!saved)throw new Error('Peça removida. Campos locais mantidos.');const parts=w.components.filter(c=>c.pieceId===initial.id).map(c=>({...c,enabled:Boolean(w.scenarios.find(s=>s.id===scenario)?.componentFlags[c.id])}));setPiece(saved);setParts(parts);confirmed.current={piece:structuredClone(saved),parts:new Map(parts.map(c=>[c.id,structuredClone(c)]))};scenarioRevision.current=w.scenarios.find(s=>s.id===scenario)!.revision;needsReconcile.current=false;uncertainPiece.current=null;uncertainParts.current.clear();dirty.current=false;onDirty(false);setStatus('Salvo');setError('');await onSync()}catch(e){setError((e as Error).message)}finally{onBusy(false)}}}>Carregar versão salva</button></div>}</div></section>
}
