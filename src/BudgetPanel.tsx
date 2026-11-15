import {useCallback,useEffect,useEffectEvent,useLayoutEffect,useState} from 'react'
import type {BudgetPreview,BudgetVersion} from '../shared/pricing'
import type {WorkOrder} from '../shared/work-order'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
import{budgetHistory}from'../shared/budget-history'
import './budget-experience.css'
import {DocumentButton} from './BudgetDocumentActions'
type VersionMeta=Omit<BudgetVersion,'snapshot'>&{total:string;scenarioName?:string;scenarioId?:string;serial?:number;workOrderNumber?:string|null;cancelledAt?:string|null;cancelReason?:string|null}
export async function downloadIssuedPdf(at:string,version:Pick<BudgetVersion,'id'|'label'|'filename'>){
 const response=await fetch(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(version.id)}/pdf`,{credentials:'same-origin'})
 if(!response.ok||!response.headers.get('content-type')?.includes('application/pdf'))throw Object.assign(new Error('Não foi possível baixar o PDF.'),{status:response.status})
 const url=URL.createObjectURL(await response.blob())
 try{
  const link=document.createElement('a')
  link.href=url;link.download=version.filename??`FUNIX-orcamento-${version.label}.pdf`
  document.body.appendChild(link);link.click();link.remove()
 }finally{setTimeout(()=>URL.revokeObjectURL(url),5000)}
}

export function BudgetPanel({at,onBusy,onAuthRequired,externalBusy,versionId,onTitle,onOpenVersion}:{at:string;onBusy:(v:boolean)=>void;onAuthRequired:()=>void;externalBusy:boolean;versionId:string|null;onOpenVersion:(id:string)=>void;onTitle:(title:string)=>void}){
 const [versions,setVersions]=useState<VersionMeta[]>([]),[version,setVersion]=useState<BudgetVersion|null>(null),[order,setOrder]=useState<WorkOrder|null>(null),[checkingOrder,setCheckingOrder]=useState(false),[error,setError]=useState(''),[ownBusy,setBusy]=useState(false)
 const requireAuth=useEffectEvent(onAuthRequired)
 const selected=version?.id===versionId?version:null
 const busy=ownBusy||externalBusy
 useLayoutEffect(()=>{onTitle(versionId?selected?'Orçamento '+(selected.documentNumber??selected.label):'Orçamento emitido':'Orçamentos emitidos')},[versionId,selected,onTitle])
 useEffect(()=>{
  if(!versionId)return
  const controller=new AbortController();setCheckingOrder(true);setOrder(null);setVersion(null)
  Promise.all([
    api<BudgetVersion>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(versionId)}`,{signal:controller.signal}),
    api<WorkOrder>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(versionId)}/os`,{signal:controller.signal}).catch(e=>{
      if((e as RequestFailure).status===404&&(e as RequestFailure).code==='OS_NOT_FOUND')return null
      throw e
    })
  ]).then(([v,os])=>{if(!controller.signal.aborted){setError('');setVersion(v);setOrder(os)}})
    .catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e.status===401)requireAuth()}})
    .finally(()=>{if(!controller.signal.aborted)setCheckingOrder(false)})
  return()=>controller.abort()
 },[at,versionId])
 const load=useCallback(async()=>{setVersions(await api<VersionMeta[]>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos`))},[at])
 useEffect(()=>{let active=true;Promise.resolve().then(load).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[load])
 const budgetUrl=(id:string)=>`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/pdf?view=1`
 const orderUrl=(id:string)=>`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/os/pdf`
 async function operation(action:()=>Promise<void>){if(busy)return;setBusy(true);onBusy(true);setError('');try{await action()}catch(e){setError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired()}finally{setBusy(false);onBusy(false)}}
 async function createOrder(id:string){
  if(busy||checkingOrder)return
  const entry=versions.find(v=>v.id===id)
  if(entry?.cancelledAt||selected?.id===id&&selected.cancellation)return
  if(!window.confirm('Criar ordem de serviço para este orçamento emitido? Confirme que ele foi autorizado para execução.'))return
  await operation(async()=>{
   const os=await api<WorkOrder>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/os`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorized:true})})
   setOrder(os);await load()
  })
 }
 async function cancelBudget(id:string){
  if(busy)return
  const entry=versions.find(v=>v.id===id)
  if(entry?.cancelledAt||selected?.id===id&&selected.cancellation)return
  const reason=window.prompt('Motivo do cancelamento (mínimo de 5 caracteres):')
  if(reason===null)return
  const clean=reason.trim()
  if(clean.length<5||clean.length>500){setError('Informe um motivo entre 5 e 500 caracteres.');return}
  if(!window.confirm('Confirmar cancelamento do orçamento e de sua OS vinculada, caso exista? Os documentos continuarão disponíveis apenas com marca d’água CANCELADO. Esta ação não pode ser desfeita.'))return
  await operation(async()=>{
   const cancellation=await api<{cancelledAt:string;reason:string}>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/cancelamento`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:clean})})
   if(selected?.id===id)setVersion({...selected,cancellation})
   if(order?.budgetVersionId===id)setOrder({...order,cancellation})
   await load()
  })
 }
 const formatDate=(date:string)=>new Date(date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
 return <section aria-label="Orçamentos emitidos">{error&&<p role="alert" className="form-error">{error}</p>}
 {selected?<div className="budget-version-details">
  <p>Emitido em {formatDate(selected.createdAt)}. Documento original preservado.</p>
  {selected.cancellation&&<p role="status" className="budget-cancelled-status">Cancelado em {formatDate(selected.cancellation.cancelledAt)} · Motivo: {selected.cancellation.reason}</p>}
  <div className="budget-detail-actions">
   <DocumentButton kind="or" href={budgetUrl(selected.id)} state="view" title="Visualizar orçamento"/>
   {checkingOrder?<span role="status">Consultando OS…</span>:order?<DocumentButton kind="os" href={orderUrl(selected.id)} state="view" title="Visualizar OS"/>:<DocumentButton kind="os" onClick={()=>createOrder(selected.id)} state="create" disabled={busy||!!selected.cancellation} title="Criar OS"/>}
   <DocumentButton kind="cancel" onClick={()=>cancelBudget(selected.id)} disabled={busy||!!selected.cancellation} title={selected.cancellation?'Orçamento já cancelado':'Cancelar orçamento e OS'}/>
  </div>
  {order&&<p className="at-form-hint">{order.number} · {order.scope.lines.length} itens · {order.cancellation?'OS cancelada':'OS autorizada'}</p>}
 </div>:versionId?<p className="at-form-hint">{error?'Versão indisponível. Use Voltar para retornar.':'Carregando documento…'}</p>:<>
 {budgetHistory(versions).map(group=><section key={group.id} className="budget-history-group" aria-label={group.name}>
 <h2>{group.name}</h2>
 {group.versions.map(v=><div className="budget-history-row" key={v.id}>
  <button className="budget-history-open" disabled={busy} onClick={()=>onOpenVersion(v.id)} aria-label={`Consultar orçamento ${v.documentNumber??v.label}, versão ${v.scenarioVersion}`}>
   <span className={`budget-history-letter${v.cancelledAt?' is-cancelled':''}`}>{v.scenarioVersion}</span>
   <span className="budget-history-identity">
    <strong>{v.documentNumber??'Orçamento '+v.label}</strong>
    <span className="budget-history-total">{money(v.total)}</span>
    <time dateTime={v.createdAt}>{formatDate(v.createdAt)}</time>
   </span>
  </button>
  <div className="budget-history-actions">
   <DocumentButton kind="or" href={budgetUrl(v.id)} state="view" title={`Visualizar orçamento ${v.documentNumber??v.label}`}/>
   <DocumentButton kind="os" href={v.workOrderNumber?orderUrl(v.id):undefined} onClick={v.workOrderNumber?undefined:()=>createOrder(v.id)} state={v.workOrderNumber?'view':'create'} disabled={busy||!!v.cancelledAt&&!v.workOrderNumber} title={v.workOrderNumber?'Visualizar '+v.workOrderNumber:'Criar OS'}/>
   <DocumentButton kind="cancel" onClick={()=>cancelBudget(v.id)} disabled={busy||!!v.cancelledAt} title={v.cancelledAt?'Orçamento cancelado':'Cancelar orçamento e OS'}/>
  </div>
 </div>)}
 </section>)}{!versions.length&&<p className="at-form-hint">Nenhuma versão emitida.</p>}
 </>}
 </section>
}

export function CalculationView({preview,scenarioName}:{preview:BudgetPreview;scenarioName?:string}){
 const c=preview.snapshot.calculation,errors=[...c.errors,...(preview.snapshot.pdfPresentation?.errors??[])]
 return <section className="budget-preview" aria-label="Prévia de orçamento"><h3>{scenarioName??c.scenarioName}</h3>{errors.length>0&&<ul className="form-error">{errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
 {c.lines.map(l=><article className={`diagnosis-card ${l.included?'':'excluded'}`} key={l.id}><strong>{l.pieceName} · {l.name}</strong><p>{l.dimension} {l.diagnosis} {l.notes}</p>{l.included?<p>{l.billing==='not_billed'?`${l.quantity} · Sem cobrança`:<>{l.quantity} × {money(l.finalUnit)} = {money(l.total)}</>}</p>:<p>{l.quantity} · Fora deste cenário: não integra totais ou PDF.</p>}{l.finalUnit!==l.unit&&<small>Unitário de referência: {money(l.unit)}</small>}</article>)}
 <dl className="budget-summary"><div><dt>Serviços originais</dt><dd>{money(c.originalServiceSubtotal)}</dd></div><div><dt>Serviços efetivos</dt><dd>{money(c.serviceSubtotal)}</dd></div><div><dt>Desconto em serviços</dt><dd>{money(c.discount)}</dd></div><div><dt>Componentes</dt><dd>{money(c.componentSubtotal)}</dd></div><div><dt>Total efetivo</dt><dd>{money(c.total)}</dd></div><div><dt>Energia / dias técnicos</dt><dd>{c.energy??'Pendente'} / {c.days??'Pendente'}</dd></div></dl>
 {preview.snapshot.requestedTotal!==undefined&&<p>Total final desejado: {money(preview.snapshot.requestedTotal)}.</p>}
 {c.target!==null&&<p>{preview.snapshot.requestedTotal!==undefined?'Meta do subtotal de serviços':'Subtotal de serviços informado'}: {money(c.target)}. Resíduo (informado − efetivo): {money(c.residual)}.</p>}
 {preview.snapshot.executionDeadline&&<><p>Prazo de execução: {preview.snapshot.executionDeadline.effectiveDays===null?'Pendente':preview.snapshot.executionDeadline.effectiveDays+' dias úteis'}.</p>{preview.snapshot.executionDeadline.warning&&<p role="status">{preview.snapshot.executionDeadline.warning}</p>}</>}<p className="at-form-hint">Dias técnicos são estimativa de escopo, não data de entrega nem autorização de execução.</p><p>{preview.snapshot.conditions||'Condições comerciais ainda não informadas.'}</p></section>
}
