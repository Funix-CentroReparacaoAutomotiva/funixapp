import {useState} from 'react'
import type {GmailAnalysis} from '../shared/gmail-analysis'
import {gmailFactLabels} from '../shared/gmail-analysis'
import type {GmailIntakeNotice} from '../shared/gmail-intake'
import type {UpdatePackageList} from '../shared/update-packages'
import {api} from './api'
import './gmail-analysis.css'
export function GmailAnalysisPanel({notice,analysis,permissions,onRefresh,onUnauthorized}:{notice:GmailIntakeNotice,analysis?:GmailAnalysis,permissions:Pick<UpdatePackageList,'decisionsEnabled'|'clarificationsEnabled'>,onRefresh:()=>void,onUnauthorized:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[answers,setAnswers]=useState<Record<string,string>>({})
 const p=analysis?.proposal,result=analysis?.result
 const working=analysis?.state==='queued'||analysis?.state==='processing'
 async function command(path:string,payload:object){
  setBusy(true);setError('')
  try{await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:crypto.randomUUID()})});onRefresh()}
  catch(cause){const e=cause as {status?:number,message:string};if(e.status===401)onUnauthorized();setError(e.message);onRefresh()}
  finally{setBusy(false)}
 }
 const label=p?.status==='approved_pending_execution'?'Proposta aprovada · sem execução':p?.status==='rejected'?'Proposta rejeitada':!analysis?'Análise autorizada':({queued:'Análise autorizada · aguardando',processing:'Análise em andamento',ready:'Proposta pronta para revisão',needs_information:'Informação insuficiente',failed:'Falha recuperável'} as const)[analysis.state]
 return <section className="gmail-analysis" aria-label="Análise contextual">
  <h3 aria-live="polite">{label}</h3>
  <p>Esta revisão não altera o ERP, não agenda serviços e não envia comunicações.</p>
  {(!analysis||analysis.state==='failed')&&<div>
   {analysis&&<p>Falha técnica: {analysis.errorCode}. Tentativas: {analysis.attempts}. {analysis.nextAttemptAt?'Nova tentativa automática prevista.':'Aguardando recuperação pelo operador.'}</p>}
   <button disabled={busy} onClick={()=>void command(`/api/atualizacoes/avisos-gmail/${notice.id}/analisar`,{revision:notice.revision,snapshotHash:notice.snapshotHash})}>Retomar análise</button>
  </div>}
  {result&&<>
   <p>{result.summary}</p>
   <details><summary>Evidências e informações extraídas</summary>
    <dl>{result.extraction.facts.map(f=><div key={f.field}>
     <dt>{gmailFactLabels[f.field]}</dt><dd>{f.value??'Não identificado'} <small>({f.provenance==='declared'?'Declarado no e-mail':f.provenance==='inferred'?'Inferido pela análise':'Não identificado'})</small>
      {f.evidence&&<blockquote>{f.evidence.quote}<small> · {f.evidence.part==='body'?'Corpo':'Assunto'} · caracteres {f.evidence.start}–{f.evidence.end}</small></blockquote>}
     </dd></div>)}</dl>
    <p>Origem: {result.extraction.source.accountId} · mensagem {result.extraction.source.messageId}</p>
   </details>
   <h4>Contexto consultado no Coda</h4>
   <p>{result.context.status==='matched'?'Correspondência confirmada no ERP':result.context.status==='ambiguous'?'Múltiplos candidatos: vínculo exige escolha humana':result.context.status==='conflict'?'Divergências identificadas':result.context.status==='needs_identity'?'Identidade insuficiente para vínculo automático':'Registro não encontrado'}</p>
   <small>Consulta em {new Date(result.context.observedAt).toLocaleString('pt-BR')}</small>
   <ul>{result.context.candidates.map(r=><li key={r.rowId}>{[r.processId,r.experienceId,r.plate,r.vehicle,r.partner,r.budgetId,r.budgetVersion].filter(Boolean).join(' · ')}<small> · Coda: {r.rowId}{result.context.selected?.rowId===r.rowId?' · Registro relacionado':''}</small></li>)}</ul>
   {result.context.conflicts.length>0&&<div className="updates-missing"><strong>Conferência necessária</strong><ul>{result.context.conflicts.map(c=><li key={c}>{c}</li>)}</ul></div>}
   {Object.keys(result.clarifications).length>0&&<details><summary>Complementação humana utilizada</summary><ul>{Object.entries(result.clarifications).map(([key,value])=><li key={key}>{key}: {value}</li>)}</ul></details>}
   <details><summary>Anexos ({result.extraction.source.attachments.length})</summary><ul>{result.extraction.source.attachments.map(a=><li key={a.attachmentId}>{a.name} · {a.mime} · {a.size} bytes · referência {a.attachmentId}</li>)}</ul><p>Originais permanecem no Gmail. Nenhum arquivo foi enviado ao Drive.</p></details>
  </>}
  {p&&<>
   <h4>Providências para revisão humana</h4>
   <ul>{p.actions.map(a=><li key={a.id}><strong>{a.title}</strong><p>{a.detail}</p></li>)}</ul>
   {p.status==='awaiting_review'&&<>
    {p.clarificationPending?<p role="status">Complementação registrada; preparando nova revisão.</p>:p.missingFields.length>0&&<form className="updates-answer-form" onSubmit={e=>{e.preventDefault();void command(`/api/atualizacoes/${p.id}/complementar`,{revision:p.revision,snapshotHash:p.snapshotHash,answers})}}>
     {p.missingFields.map(f=><label key={f.key}>{f.label}<small>{f.hint}</small>{f.options?.length?<select required value={answers[f.key]??''} onChange={e=>setAnswers(a=>({...a,[f.key]:e.target.value}))}><option value="">Escolha uma opção</option>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input required maxLength={250} value={answers[f.key]??''} onChange={e=>setAnswers(a=>({...a,[f.key]:e.target.value}))}/>}</label>)}
     <button disabled={busy||working||!permissions.clarificationsEnabled} type="submit">Enviar para conferência</button>
    </form>}
    <div className="updates-decisions">{(['reject','approve'] as const).map(decision=><button key={decision} disabled={busy||working||!permissions.decisionsEnabled||(decision==='approve'&&Boolean(p.missingFields.length||p.clarificationPending))} onClick={()=>{
     if(window.confirm(decision==='approve'?'Aprovar somente estas providências para revisão? Nenhuma ação será executada.':'Rejeitar esta proposta?'))void command(`/api/atualizacoes/${p.id}/decisao`,{revision:p.revision,snapshotHash:p.snapshotHash,decision})
    }}>{decision==='approve'?'Aprovar proposta':'Rejeitar proposta'}</button>)}</div>
   </>}
   {p.decidedAt&&<p>Decisão persistida em {new Date(p.decidedAt).toLocaleString('pt-BR')}. Nenhuma providência executada.</p>}
  </>}
  {error&&<p className="updates-error" role="alert">{error}</p>}
 </section>
}
