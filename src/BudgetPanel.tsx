import {useCallback,useEffect,useEffectEvent,useLayoutEffect,useState} from 'react'
import type {BudgetPreview,BudgetVersion} from '../shared/pricing'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
type VersionMeta=Omit<BudgetVersion,'snapshot'>&{total:string;scenarioName?:string;serial?:number}
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

export function BudgetPanel({at,onBusy,onAuthRequired,externalBusy,versionId,onTitle}:{at:string;onBusy:(v:boolean)=>void;onAuthRequired:()=>void;externalBusy:boolean;versionId:string|null;onOpenVersion:(id:string)=>void;onTitle:(title:string)=>void}){
 const [versions,setVersions]=useState<VersionMeta[]>([]),[version,setVersion]=useState<BudgetVersion|null>(null),[error,setError]=useState(''),[ownBusy,setBusy]=useState(false)
 const requireAuth=useEffectEvent(onAuthRequired)
 const selected=version?.id===versionId?version:null
 const busy=ownBusy||externalBusy
 useLayoutEffect(()=>{onTitle(versionId?selected?'Orçamento '+(selected.documentNumber??selected.label):'Orçamento emitido':'Orçamentos emitidos')},[versionId,selected,onTitle])
 useEffect(()=>{
  if(!versionId)return
  const controller=new AbortController()
  api<BudgetVersion>(`/api/atendimentos/${at}/orcamentos/${encodeURIComponent(versionId)}`,{signal:controller.signal}).then(v=>{if(!controller.signal.aborted){setError('');setVersion(v)}}).catch(e=>{if(!controller.signal.aborted){setError(e.message);if(e.status===401)requireAuth()}})
  return()=>controller.abort()
 },[at,versionId])
 const load=useCallback(async()=>{setVersions(await api<VersionMeta[]>(`/api/atendimentos/${at}/orcamentos`))},[at])
 useEffect(()=>{let active=true;Promise.resolve().then(load).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[load])
 async function operation(action:()=>Promise<void>){if(busy)return;setBusy(true);onBusy(true);setError('');try{await action()}catch(e){setError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired()}finally{setBusy(false);onBusy(false)}}
 return <section aria-label="Orçamentos emitidos">{error&&<p role="alert" className="form-error">{error}</p>}
 {selected?<><p>Documento emitido em {new Date(selected.createdAt).toLocaleString('pt-BR')}. O PDF original fica preservado, independente de mudanças posteriores.</p><button className="primary-btn" disabled={busy} onClick={()=>operation(()=>downloadIssuedPdf(at,selected))}>Baixar PDF {selected.documentNumber??selected.label}</button></>:versionId?<p className="at-form-hint">{error?'Versão indisponível. Use Voltar para retornar.':'Carregando documento…'}</p>:<>{versions.map(v=><button className="catalog-row" key={v.id} disabled={busy} onClick={()=>operation(()=>downloadIssuedPdf(at,v))} title="Baixar PDF original">{v.documentNumber??'Orçamento '+v.label} · {v.scenarioName??'Cenário anterior'} · {new Date(v.createdAt).toLocaleString('pt-BR')} · {money(v.total)} · Baixar PDF</button>)}{!versions.length&&<p className="at-form-hint">Nenhuma versão emitida.</p>}</>}
 </section>
}

export function CalculationView({preview,scenarioName}:{preview:BudgetPreview;scenarioName?:string}){
 const c=preview.snapshot.calculation
 return <section className="budget-preview" aria-label="Prévia de orçamento"><h3>{scenarioName??c.scenarioName}</h3>{c.errors.length>0&&<ul className="form-error">{c.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
 {c.lines.map(l=><article className={`diagnosis-card ${l.included?'':'excluded'}`} key={l.id}><strong>{l.pieceName} · {l.name}</strong><p>{l.dimension} {l.diagnosis} {l.notes}</p>{l.included?<p>{l.billing==='not_billed'?`${l.quantity} · Sem cobrança`:<>{l.quantity} × {money(l.finalUnit)} = {money(l.total)}</>}</p>:<p>{l.quantity} · Fora deste cenário: não integra totais ou PDF.</p>}{l.finalUnit!==l.unit&&<small>Unitário de referência: {money(l.unit)}</small>}</article>)}
 <dl className="budget-summary"><div><dt>Serviços originais</dt><dd>{money(c.originalServiceSubtotal)}</dd></div><div><dt>Serviços efetivos</dt><dd>{money(c.serviceSubtotal)}</dd></div><div><dt>Desconto em serviços</dt><dd>{money(c.discount)}</dd></div><div><dt>Componentes</dt><dd>{money(c.componentSubtotal)}</dd></div><div><dt>Total efetivo</dt><dd>{money(c.total)}</dd></div><div><dt>Energia / dias técnicos</dt><dd>{c.energy??'Pendente'} / {c.days??'Pendente'}</dd></div></dl>
 {preview.snapshot.requestedTotal!==undefined&&<p>Total final desejado: {money(preview.snapshot.requestedTotal)}.</p>}
 {c.target!==null&&<p>{preview.snapshot.requestedTotal!==undefined?'Meta do subtotal de serviços':'Subtotal de serviços informado'}: {money(c.target)}. Resíduo (informado − efetivo): {money(c.residual)}.</p>}
 {preview.snapshot.executionDeadline&&<><p>Prazo de execução: {preview.snapshot.executionDeadline.effectiveDays===null?'Pendente':preview.snapshot.executionDeadline.effectiveDays+' dias úteis'}.</p>{preview.snapshot.executionDeadline.warning&&<p role="status">{preview.snapshot.executionDeadline.warning}</p>}</>}<p className="at-form-hint">Dias técnicos são estimativa de escopo, não data de entrega nem autorização de execução.</p><p>{preview.snapshot.conditions||'Condições comerciais ainda não informadas.'}</p></section>
}
