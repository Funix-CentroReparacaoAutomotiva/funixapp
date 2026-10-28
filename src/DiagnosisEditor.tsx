import {useEffect,useEffectEvent,useLayoutEffect,useRef,useState} from 'react'
import type {DiagnosisItem,CatalogItem,CommercialWorkspace} from '../shared/commercial'
import {catalogItemUsable} from '../shared/commercial'
import type {ComponentItem} from '../shared/pricing'
import {api} from './api'
import {diagnosisPending,servicePending} from './calculation-state'
import type {CalculationState} from './calculation-state'
import {money} from './money'
import {ApprovedIcon as I} from './ApprovedIcon'
import './approved.css'
type Part=ComponentItem&{local?:boolean;enabled:boolean}
const decimal=(s:string)=>s.trim().replace(',','.')
const positive=(s:string)=>/^\d{1,9}(?:\.\d{1,6})?$/.test(decimal(s))&&/[1-9]/.test(s)
const validPrice=(s:string|null)=>s===null||/^\d{1,12}(?:\.\d{1,6})?$/.test(decimal(s))
const signature=(v:unknown)=>JSON.stringify(v)
const canonical=(s:string)=>decimal(s).replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')
const display=(s:string)=>{const [whole,fraction='']=s.replace(',','.').split('.');return whole+','+fraction.padEnd(2,'0')}
const partSignature=(p:Part)=>signature({...p,local:undefined,quantity:canonical(p.quantity),manualPrice:p.manualPrice===null?null:canonical(p.manualPrice)})
const pieceSignature=(p:DiagnosisItem)=>signature({...p,services:p.services.map(l=>({...l,quantity:canonical(l.quantity)}))})
function SelectControl({label,value,items,onChange,top=false}:{label:string;value:string;items:CatalogItem[];onChange:(v:string)=>void;top?:boolean}){return <label className={top?'top-select':'select-box'}><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">Selecionar…</option>{items.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><span className="chev"><I name="chevron"/></span></label>}
function ToggleControl({label,on,onChange,top=false}:{label:string;on:boolean;onChange:()=>void;top?:boolean}){return <button type="button" className={top?'piece-toggle':'toggle'} aria-label={label} aria-pressed={on} onClick={onChange}><I name={on?'toggle':'off'}/></button>}
export function DiagnosisEditor({initial,workspace,catalog,onDirty,onBusy,onSync,onAuthRequired,onCalculationState,parameterState}:{initial:DiagnosisItem;workspace:CommercialWorkspace;catalog:CatalogItem[];onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onSync:()=>Promise<void>;onAuthRequired:()=>void;onCalculationState:(state:CalculationState)=>void;parameterState:CalculationState}){
 const base='/api/atendimentos/'+initial.atendimentoId,scenario=workspace.selectedId
 const [piece,setPiece]=useState(()=>structuredClone(initial)),[parts,setParts]=useState<Part[]>(()=>workspace.components.filter(p=>p.pieceId===initial.id).map(p=>({...p,manualPrice:p.manualPrice===null?null:display(p.manualPrice),enabled:Boolean(workspace.scenarios.find(s=>s.id===scenario)?.componentFlags[p.id])})))
 const [serviceKeys,setServiceKeys]=useState<Record<string,string>>({})
 const [note,setNote]=useState(false),[generation,tick]=useState(0),[error,setError]=useState(''),[status,setStatus]=useState('Salvo')
 const live=useRef({piece,parts,generation});useLayoutEffect(()=>{live.current={piece,parts,generation}},[piece,parts,generation])
 const confirmed=useRef({piece:pieceSignature(initial),parts:new Map(parts.map(p=>[p.id,partSignature(p)]))}),running=useRef(false),mounted=useRef(true)
 const dirty=useRef(false),delay=useRef(450)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onDirty(false)}},[onDirty])
 const change=(action:()=>void)=>{action();dirty.current=true;onDirty(true);setStatus('Rascunho');tick(g=>g+1)}
 const focusNew=(selector:string)=>requestAnimationFrame(()=>document.querySelector<HTMLElement>(selector)?.focus())
 const patch=(value:Partial<DiagnosisItem>)=>change(()=>setPiece(p=>({...p,...value})))
 async function save(){
  if(running.current)return
  running.current=true;onBusy(true);setStatus('Salvando…')
  const sent=structuredClone(live.current);let incomplete=false
  try{
   const services=sent.piece.services.filter(l=>{
    const valid=Boolean(l.serviceId)&&positive(l.quantity);if(!valid)incomplete=true
    if(!valid&&!l.id.startsWith('new:'))throw new Error('Complete o serviço e a quantidade antes de salvar.')
    return valid
   })
   if(pieceSignature({...sent.piece,services})!==confirmed.current.piece){
    const w=await api<CommercialWorkspace>(base+'/cenarios?scenarioId='+encodeURIComponent(scenario))
    if(w.selectedId!==scenario)throw new Error('Cenário excluído. Seus campos foram preservados; reabra explicitamente após revisar.')
    const current=w.items.find(p=>p.id===initial.id)
    if(!current)throw new Error('A peça foi removida. Seus campos locais foram preservados.')
    const flags=(p:DiagnosisItem)=>signature({enabled:p.enabled,services:p.services.map(l=>({id:l.id,enabled:l.enabled}))})
    if(current.revision===sent.piece.revision&&flags(current)!==flags(JSON.parse(confirmed.current.piece)))throw new Error('As inclusões do cenário mudaram. Campos locais preservados; confira a versão salva antes de retomar.')
    const comparable=(p:DiagnosisItem)=>signature({diagnosisId:p.diagnosisId,notes:p.notes,enabled:p.enabled,services:p.services.map(l=>({serviceId:l.serviceId,dimensionId:l.dimensionId,quantity:canonical(l.quantity),enabled:l.enabled,diagnosisId:l.diagnosisId??null,notes:l.notes??''}))})
    if(current.revision!==sent.piece.revision&&comparable(current)!==comparable({...sent.piece,services}))throw new Error('Os dados salvos mudaram. Confira a versão salva antes de retomar; seus campos locais foram preservados.')
    const saved=current.revision!==sent.piece.revision?current:await api<DiagnosisItem>(base+'/diagnosticos/'+initial.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:sent.piece.revision,scenarioId:scenario,scenarioRevision:w.scenarios.find(s=>s.id===scenario)!.revision,diagnosisId:sent.piece.diagnosisId,notes:sent.piece.notes,enabled:sent.piece.enabled,services:services.map(l=>({...l,id:l.id.startsWith('new:')?undefined:l.id,quantity:decimal(l.quantity)}))})})
    const added=saved.services.filter(l=>!sent.piece.services.some(old=>old.id===l.id));const ids=new Map(services.filter(l=>l.id.startsWith('new:')).map((l,i)=>[l.id,added[i]?.id]))
    setServiceKeys(current=>{const next={...current};for(const [local,id] of ids)if(id)next[id]=current[local]??local;return next})
    setPiece(current=>({...current,revision:saved.revision,services:current.services.map(l=>({...l,id:ids.get(l.id)??l.id}))}))
    confirmed.current.piece=pieceSignature(saved)
   }
   for(const p of sent.parts){
    if(!p.name.trim()||!positive(p.quantity)||!validPrice(p.manualPrice)){incomplete=true;continue}
    if(partSignature(p)===confirmed.current.parts.get(p.id))continue
    const before=await api<CommercialWorkspace>(base+'/cenarios?scenarioId='+encodeURIComponent(scenario)),current=before.components.find(c=>c.id===p.id)
    const known=confirmed.current.parts.get(p.id),enabled=Boolean(before.scenarios.find(s=>s.id===scenario)?.componentFlags[p.id])
    if(known&&enabled!==JSON.parse(known).enabled&&enabled!==p.enabled)throw new Error('A inclusão do componente mudou no cenário. Campos locais preservados; confira a versão salva.')
    if(!p.local&&current&&current.revision!==p.revision&&(current.name!==p.name.trim()||current.quantity!==canonical(p.quantity)||current.manualPrice!==(p.manualPrice===null?null:canonical(p.manualPrice))||current.notes!==p.notes))throw new Error('Componente alterado na versão salva. Campos locais preservados; confira antes de retomar.')
    const saved=!p.local&&current&&current.revision!==p.revision?current:await api<ComponentItem>(base+'/componentes'+(p.local?'':'/'+p.id),{method:p.local?'POST':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(p.local?{clientId:p.id}:{}),revision:p.revision,pieceId:initial.id,name:p.name,quantity:decimal(p.quantity),manualPrice:p.manualPrice===null?null:decimal(p.manualPrice),notes:p.notes,scenarioId:scenario})})
    const w=await api<CommercialWorkspace>(base+'/cenarios?scenarioId='+encodeURIComponent(scenario)),s=w.scenarios.find(s=>s.id===scenario)
    if(!s)throw new Error('Cenário excluído. Campos preservados.')
    if(Boolean(s.componentFlags[p.id])!==p.enabled)await api(base+'/cenarios/'+scenario,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:s.revision,componentFlags:{[saved.id]:p.enabled}})})
    const final={...saved,enabled:p.enabled}
    confirmed.current.parts.set(p.id,partSignature(final));setParts(current=>current.map(v=>v.id===p.id?{...v,revision:saved.revision,local:undefined}:v))
   }
   await onSync()
   if(live.current.generation===sent.generation){dirty.current=incomplete;onDirty(incomplete);setStatus(incomplete?'Rascunho incompleto':'Salvo')}
  }catch(cause){if((cause as {status?:number}).status===401)onAuthRequired();setError((cause as Error).message);setStatus('Erro — campos preservados');dirty.current=true;onDirty(true)}
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
 return <section className="approved-editor" aria-label="Editor de diagnóstico" onChangeCapture={e=>{delay.current=e.target instanceof HTMLSelectElement?0:450}} onClickCapture={e=>{const b=(e.target as Element).closest('button');if(b?.matches('.toggle,.piece-toggle,.trash'))delay.current=0}}><header className="head"><div className="piece-row"><ToggleControl label="Incluir peça" on={piece.enabled} onChange={()=>patch({enabled:!piece.enabled})} top/><div className="piece-name">{catalog.find(c=>c.id===piece.pieceId)?.name.replace(/\s*·\s*/g,' ')}</div><button className="plain-action" aria-label="Observação da peça" aria-expanded={note} style={piece.notes?{color:'#62e5cc'}:undefined} onClick={()=>setNote(v=>!v)}><I name="note"/></button></div><SelectControl label="Diagnóstico da peça" value={piece.diagnosisId??''} items={options('diagnostico',piece.diagnosisId)} onChange={v=>patch({diagnosisId:v||null})} top/>{note&&<textarea className="piece-note" maxLength={8000} aria-label="Observação da peça" value={piece.notes} onChange={e=>patch({notes:e.target.value})}/>}</header><div className="content">
 <div className="section-bar"><div className="title">Serviços <span className="count">{piece.services.length}</span></div><button className="add" aria-label="Adicionar serviço" disabled={piece.services.length>=50} onClick={()=>{patch({services:[...piece.services,{id:'new:'+crypto.randomUUID(),serviceId:'',dimensionId:null,quantity:'1',enabled:true}]});focusNew('.approved-editor .service:last-of-type select')}}><I name="plus"/><I name="wrench"/></button></div>
 {piece.services.map((l,i)=><section className="service" key={serviceKeys[l.id]??l.id} aria-label={`Serviço ${i+1}`}><div className="field-line"><SelectControl label="Serviço" value={l.serviceId} items={options('servico',l.serviceId)} onChange={v=>patch({services:piece.services.map(c=>c.id===l.id?{...c,serviceId:v,dimensionId:null}:c)})}/><SelectControl label="Dimensão" value={l.dimensionId??''} items={options('dimensao',l.dimensionId).filter(c=>c.serviceId===l.serviceId)} onChange={v=>patch({services:piece.services.map(c=>c.id===l.id?{...c,dimensionId:v||null}:c)})}/></div><div className="detail-line"><ToggleControl label="Incluir serviço" on={l.enabled} onChange={()=>patch({services:piece.services.map(c=>c.id===l.id?{...c,enabled:!c.enabled}:c)})}/><label className="qty">Qtd.<input aria-label="Quantidade do serviço" inputMode="decimal" value={l.quantity} onChange={e=>patch({services:piece.services.map(c=>c.id===l.id?{...c,quantity:e.target.value}:c)})}/></label><div className="calculated"><small>Valor calculado</small><strong aria-live="polite" data-state={servicePending(piece,l,savedPiece)?error?'error':'pending':parameterState}>{servicePending(piece,l,savedPiece)||parameterState!=='current'?error||parameterState==='error'?'Valor não atualizado':'Calculando…':calc?.lines.find(c=>c.id===l.id)?.total==null?'—':money(calc.lines.find(c=>c.id===l.id)!.total)}</strong></div><button className="trash" aria-label="Excluir serviço" onClick={()=>{if(l.id.startsWith('new:')||window.confirm('Excluir este serviço de TODOS os cenários?'))patch({services:piece.services.filter(c=>c.id!==l.id)})}}><I name="trash"/></button></div></section>)}
 <div className="section-bar component-title"><div className="title">Componentes <span className="count">{parts.length}</span></div><button className="add" aria-label="Adicionar componente" onClick={()=>{change(()=>setParts(v=>[...v,{id:crypto.randomUUID(),atendimentoId:initial.atendimentoId,pieceId:initial.id,name:'',quantity:'1',manualPrice:null,notes:'',revision:1,enabled:true,local:true}]));focusNew('.approved-editor .component:last-of-type .name')}}><I name="plus"/><I name="cube"/></button></div>
 {parts.map(p=><section className="component" key={p.id}><input className="name" maxLength={250} aria-label="Descrição do componente" value={p.name} onChange={e=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,name:e.target.value}:c)))}/><div className="detail-line"><ToggleControl label="Incluir componente" on={p.enabled} onChange={()=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,enabled:!c.enabled}:c)))}/><label className="qty">Qtd.<input aria-label="Quantidade do componente" inputMode="decimal" value={p.quantity} onChange={e=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,quantity:e.target.value}:c)))}/></label><label className="price-input">Preço unitário (R$)<input aria-label="Preço unitário do componente" inputMode="decimal" value={p.manualPrice??''} onChange={e=>change(()=>setParts(v=>v.map(c=>c.id===p.id?{...c,manualPrice:e.target.value===''?null:e.target.value}:c)))}/></label><button className="trash" aria-label="Excluir componente" onClick={()=>removePart(p)}><I name="trash"/></button></div></section>)}
 <div className="bottom-label" role="status"><I name="cloud"/>Salvamento automático · {status}</div>{error&&<div role="alert"><p>{error}</p><button onClick={()=>{setError('');tick(g=>g+1)}}>Tentar novamente</button><button onClick={async()=>{if(!window.confirm('Descartar os campos locais e carregar a versão salva?'))return;onBusy(true);try{const w=await api<CommercialWorkspace>(base+'/cenarios?scenarioId='+encodeURIComponent(scenario)),saved=w.items.find(p=>p.id===initial.id);if(!saved)throw new Error('Peça removida. Campos locais mantidos.');const parts=w.components.filter(c=>c.pieceId===initial.id).map(c=>({...c,enabled:Boolean(w.scenarios.find(s=>s.id===scenario)?.componentFlags[c.id])}));setPiece(saved);setParts(parts);confirmed.current={piece:pieceSignature(saved),parts:new Map(parts.map(c=>[c.id,partSignature(c)]))};dirty.current=false;onDirty(false);setStatus('Salvo');setError('');await onSync()}catch(e){setError((e as Error).message)}finally{onBusy(false)}}}>Carregar versão salva</button></div>}</div></section>
}
