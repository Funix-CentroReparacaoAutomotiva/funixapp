import {useCallback,useEffect,useEffectEvent,useLayoutEffect,useRef,useState} from 'react'
import type {BudgetPreview,BudgetVersion} from '../shared/pricing'
import type {WorkOrder} from '../shared/work-order'
import {correctOpticalWorkOrderScope} from '../shared/optical-work-order'
import type {Atendimento} from '../shared/contracts'
import {deliveryDateLabel,validDeliveryDate} from '../shared/delivery-date'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
import{budgetHistory}from'../shared/budget-history'
import './budget-experience.css'
import './os-delivery-dialog.css'
import {DocumentButton} from './BudgetDocumentActions'
type VersionMeta=Omit<BudgetVersion,'snapshot'>&{total:string;scenarioName?:string;scenarioId?:string;serial?:number;workOrderNumber?:string|null;workOrderRevision?:number;workOrderNeedsReissue?:boolean;workOrderDeliveryDate?:string|null;deliveryDate?:string|null;cancelledAt?:string|null;cancelReason?:string|null}
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
 const [orderHistory,setOrderHistory]=useState<WorkOrder[]>([]),[deliveryPrompt,setDeliveryPrompt]=useState<{id:string;atRevision:number;revision?:number}|null>(null),[deliveryDraft,setDeliveryDraft]=useState('')
 const dialogRef=useRef<HTMLDialogElement>(null)
 useEffect(()=>{if(deliveryPrompt&&dialogRef.current&&!dialogRef.current.open)dialogRef.current.showModal()},[deliveryPrompt])
 const load=useCallback(async()=>{const entries=await api<VersionMeta[]>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos`);setVersions(entries);return entries},[at])
 const requireAuth=useEffectEvent(onAuthRequired)
 const selected=version?.id===versionId?version:null
 const busy=ownBusy||externalBusy
 useLayoutEffect(()=>{onTitle(versionId?selected?'Orçamento '+(selected.documentNumber??selected.label):'Orçamento emitido':'Orçamentos emitidos')},[versionId,selected,onTitle])
 useEffect(()=>{
  if(!versionId)return
  const controller=new AbortController();setCheckingOrder(true);setOrder(null);setOrderHistory([]);setVersion(null)
  Promise.all([
    api<BudgetVersion>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(versionId)}`,{signal:controller.signal}),
    load()
  ]).then(async([v,entries])=>{
    // The history metadata already says whether an OS was issued. Avoid an
    // expected OS_NOT_FOUND request (and browser console error) for an absent OS.
    const history=entries.find(entry=>entry.id===versionId)?.workOrderNumber
      ?await api<WorkOrder[]>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(versionId)}/os/revisoes`,{signal:controller.signal}):[]
    return [v,history] as const
  }).then(([v,history])=>{if(!controller.signal.aborted){setError('');setVersion(v);setOrderHistory(history);setOrder(history[0]??null)}})
    .catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e.status===401)requireAuth()}})
    .finally(()=>{if(!controller.signal.aborted)setCheckingOrder(false)})
  return()=>controller.abort()
 },[at,versionId,load])
 useEffect(()=>{if(versionId)return;let active=true;Promise.resolve().then(load).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[load,versionId])
 const budgetUrl=(id:string)=>`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/pdf?view=1`
 const osPath=(id:string)=>`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/os`
 const orderUrl=(id:string,revision=1)=>osPath(id)+(revision>1?'/revisoes/'+revision:'/')+(revision>1?'/pdf':'pdf')
 async function operation(action:()=>Promise<void>){if(busy)return;setBusy(true);onBusy(true);setError('');try{await action()}catch(e){setError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired()}finally{setBusy(false);onBusy(false)}}
 async function issue(id:string,atRevision:number,date:string|null,revision?:number){
  const payload=date===null?{authorized:true,deliveryChoice:'without',expectedAtendimentoRevision:atRevision}:{authorized:true,deliveryChoice:'with',deliveryDate:date,expectedAtendimentoRevision:atRevision}
  const os=await api<WorkOrder>(osPath(id)+(revision?'/revisoes':''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,...(revision?{expectedRevision:revision}:{})})})
  if(versionId===id){setOrder(os);setOrderHistory(await api<WorkOrder[]>(osPath(id)+'/revisoes'))}
  setDeliveryPrompt(null)
  await load()
 }
 async function createOrder(id:string,revision?:number){
  if(busy||checkingOrder||deliveryPrompt)return
  const entry=versions.find(v=>v.id===id)
  if(entry?.cancelledAt||selected?.id===id&&selected.cancellation)return
  await operation(async()=>{
   const record=await api<Atendimento>(`/api/atendimentos/${encodeURIComponent(at)}`)
   if(record.deliveryDate){
    if(!window.confirm((revision?'Emitir nova revisão da OS':'Criar ordem de serviço para este orçamento emitido')+' com entrega prevista em '+deliveryDateLabel(record.deliveryDate)+'? Confirme que o serviço foi autorizado para execução.'))return
    await issue(id,record.revision,record.deliveryDate,revision)
   }else{
    setDeliveryDraft('');setDeliveryPrompt({id,atRevision:record.revision,revision})
   }
  })
 }
 async function correctOpticalStages(id:string,current:WorkOrder){
  if(busy||checkingOrder||deliveryPrompt||current.cancellation)return
  if(!window.confirm('Corrigir as etapas de restauração de lentes para Lixamento, Envernização e Polimento? Uma nova revisão da OS será emitida; o orçamento e a data de entrega serão preservados.'))return
  await operation(async()=>{
   const os=await api<WorkOrder>(osPath(id)+'/revisoes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorized:true,expectedRevision:current.revision??1,correction:'optical-stages-v1'})})
   if(versionId===id){setOrder(os);setOrderHistory(await api<WorkOrder[]>(osPath(id)+'/revisoes'))}
   await load()
  })
 }
 async function confirmDelivery(withDate:boolean){
  if(busy||!deliveryPrompt)return
  if(withDate?!validDeliveryDate(deliveryDraft):deliveryDraft!=='')return
  const prompt=deliveryPrompt
  // Close only on successful issue. On failure leave the draft visible and allow cancellation.
  await operation(()=>issue(prompt.id,prompt.atRevision,withDate?deliveryDraft:null,prompt.revision))
 }
 async function cancelBudget(id:string){
  if(busy)return
  const entry=versions.find(v=>v.id===id)
  if(entry?.cancelledAt||selected?.id===id&&selected.cancellation)return
  if(!window.confirm('Confirmar cancelamento do orçamento e de sua OS vinculada, caso exista? Os documentos continuarão disponíveis apenas com marca d’água CANCELADO. Esta ação não pode ser desfeita.'))return
  await operation(async()=>{
   const cancellation=await api<{cancelledAt:string;reason:string}>(`/api/atendimentos/${encodeURIComponent(at)}/orcamentos/${encodeURIComponent(id)}/cancelamento`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})})
   if(selected?.id===id)setVersion({...selected,cancellation})
   if(order?.budgetVersionId===id){setOrder({...order,cancellation});setOrderHistory(previous=>previous.map(item=>({...item,cancellation})))}
   await load()
  })
 }
 const formatDate=(date:string)=>new Date(date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
 const selectedMeta=versions.find(v=>v.id===versionId)
 return <section aria-label="Orçamentos emitidos">{error&&!deliveryPrompt&&<p role="alert" className="form-error">{error}</p>}
 {deliveryPrompt&&<dialog ref={dialogRef} className="os-delivery-dialog" aria-labelledby="os-delivery-title" onCancel={event=>{event.preventDefault();if(!busy)setDeliveryPrompt(null)}}>
  <h2 id="os-delivery-title">{deliveryPrompt.revision?'Emitir nova revisão da OS':'Emitir Ordem de Serviço'}</h2>
  <p>Confirme a autorização de execução. Informe a data prevista de entrega, caso já esteja definida.</p>
  <div className="at-field"><label htmlFor="os-delivery-date">Data prevista de entrega (opcional)</label>
   <input id="os-delivery-date" type="date" value={deliveryDraft} onChange={event=>{setDeliveryDraft(event.target.value);setError('')}} disabled={busy} autoFocus/>
  </div>
  {error&&<p role="alert" className="form-error">{error}</p>}
  <div className="os-delivery-actions">
   <button type="button" disabled={busy||deliveryDraft!==''} onClick={()=>void confirmDelivery(false)}>Emitir sem data</button>
   <button type="button" className="primary-btn" disabled={busy||!validDeliveryDate(deliveryDraft)} onClick={()=>void confirmDelivery(true)}>Emitir com data</button>
  </div>
  <button type="button" className="os-delivery-cancel" disabled={busy} onClick={()=>{setDeliveryPrompt(null);setError('')}}>Cancelar</button>
 </dialog>}
 {selected?<div className="budget-version-details">
  <p>Emitido em {formatDate(selected.createdAt)}. Documento original preservado.</p>
  {selected.cancellation&&<p role="status" className="budget-cancelled-status">Cancelado em {formatDate(selected.cancellation.cancelledAt)}</p>}
  <div className="budget-detail-actions">
   <DocumentButton kind="or" href={budgetUrl(selected.id)} state="view" cancelled={!!selected.cancellation} title="Visualizar orçamento"/>
   {checkingOrder?<span role="status">Consultando OS…</span>:order?<DocumentButton kind="os" href={orderUrl(selected.id,order.revision??1)} state="view" cancelled={!!selected.cancellation} title={selectedMeta?.workOrderNeedsReissue?'Visualizar emissão anterior (desatualizada)':'Visualizar OS'}/>:<DocumentButton kind="os" onClick={selected.cancellation?undefined:()=>createOrder(selected.id)} state={selected.cancellation?'unavailable':'create'} disabled={busy||!!selected.cancellation} title={selected.cancellation?'OS não emitida; orçamento cancelado':'Criar OS'}/>}
   <DocumentButton kind="cancel" onClick={()=>cancelBudget(selected.id)} disabled={busy||!!selected.cancellation} title={selected.cancellation?'Orçamento já cancelado':'Cancelar orçamento e OS'}/>
  </div>
  {order&&<><p className="at-form-hint">{order.number} · R{String(order.revision??1).padStart(2,'0')} · {order.scope.lines.length} itens · Entrega: {deliveryDateLabel(order.scope.deliveryDate)} · {order.cancellation?'OS cancelada':selectedMeta?.workOrderNeedsReissue?'Reemissão necessária':'OS autorizada'}</p>
   {selectedMeta?.workOrderNeedsReissue&&!order.cancellation&&<><p role="status">A previsão do Atendimento mudou para {deliveryDateLabel(selectedMeta.deliveryDate)}. A OS anterior foi preservada.</p><button className="primary-btn" disabled={busy} onClick={()=>void createOrder(selected.id,order.revision??1)}>Emitir nova revisão</button></>}
   {!order.cancellation&&!selected.cancellation&&correctOpticalWorkOrderScope(order.scope,selected.snapshot)&&<button type="button" className="primary-btn" disabled={busy} onClick={()=>void correctOpticalStages(selected.id,order)}>Corrigir etapas da restauração óptica</button>}
    {orderHistory.length>1&&<details><summary>Histórico de emissões da OS</summary>{orderHistory.map((item,index)=><p key={item.revision??1}><a href={orderUrl(selected.id,item.revision??1)} target="_blank" rel="noopener noreferrer">R{String(item.revision??1).padStart(2,'0')} · {deliveryDateLabel(item.scope.deliveryDate)}</a> · {item.cancellation?'Cancelada':index===0?selectedMeta?.workOrderNeedsReissue?'Desatualizada':'Vigente':'Substituída'}</p>)}</details>}
  </>}
 </div>:versionId?<p className="at-form-hint">{error?'Versão indisponível. Use Voltar para retornar.':'Carregando documento…'}</p>:<>
 {budgetHistory(versions).map(group=><section key={group.id} className="budget-history-group" aria-label={group.name}>
 <h2>{group.name}</h2>
 {group.versions.map(v=><div className={`budget-history-row${v.cancelledAt?' is-cancelled':''}`} key={v.id}>
  <button className="budget-history-open" disabled={busy} onClick={()=>onOpenVersion(v.id)} aria-label={`Consultar orçamento ${v.documentNumber??v.label}, versão ${v.scenarioVersion}`}>
   <span className={`budget-history-letter${v.cancelledAt?' is-cancelled':''}`}>{v.scenarioVersion}</span>
   <span className="budget-history-identity">
    <strong>{v.documentNumber??'Orçamento '+v.label}</strong>
    <span className="budget-history-total">{money(v.total)}</span>
    <time dateTime={v.createdAt}>{formatDate(v.createdAt)}</time>
    {v.workOrderNeedsReissue&&<span className="budget-cancelled-status">OS: reemissão necessária</span>}
   </span>
  </button>
  <div className="budget-history-actions">
   <DocumentButton kind="or" href={budgetUrl(v.id)} state="view" cancelled={!!v.cancelledAt} title={`Visualizar orçamento ${v.documentNumber??v.label}`}/>
   <DocumentButton kind="os" href={v.workOrderNumber&&!v.workOrderNeedsReissue?orderUrl(v.id,v.workOrderRevision??1):undefined} onClick={v.workOrderNeedsReissue?()=>onOpenVersion(v.id):v.workOrderNumber||v.cancelledAt?undefined:()=>createOrder(v.id)} state={v.workOrderNumber?'view':v.cancelledAt?'unavailable':'create'} cancelled={!!v.cancelledAt&&!!v.workOrderNumber} disabled={busy||!!v.cancelledAt&&!v.workOrderNumber} title={v.workOrderNeedsReissue?'Consultar OS desatualizada':v.workOrderNumber?'Visualizar '+v.workOrderNumber:v.cancelledAt?'OS não emitida; orçamento cancelado':'Criar OS'}/>
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
