import {useEffect,useRef,useState} from 'react'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
import {CiliaScopeEditor} from './CiliaScopeEditor'
import type {CiliaConsultation} from './CiliaScopeEditor'
import './cilia-preview.css'

type Response=CiliaConsultation
type Receipt={id:string;scenarioId:string;scenarioExists:boolean;documentNumber:string;revision:string;createdAt:string;partnerComponents:{sourceId:string;description:string;quantity:string;total:string;nativePieceId:string|null}[];result:{total:string}}
type Capability={enabled:boolean;writeEnabled:boolean;historyEnabled:boolean}

export function CiliaPreviewPanel({at,disabled,onAuthRequired,onBusy,onCreated}:{at:string;disabled:boolean;onAuthRequired:()=>void;onBusy:(v:boolean)=>void;onCreated:()=>Promise<void>}){
 const [enabled,setEnabled]=useState(false),[open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[steering,setSteering]=useState<'unknown'|'left'|'right'>('unknown')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Response|null>(null)
 const [writeEnabled,setWriteEnabled]=useState(false),[historyEnabled,setHistoryEnabled]=useState(false),[childBusy,setChildBusy]=useState(false),[history,setHistory]=useState<Receipt[]>([]),[historyError,setHistoryError]=useState('')
 const pending=useRef<AbortController|null>(null)
 const url='/api/atendimentos/'+encodeURIComponent(at)+'/importar-cilia'
 useEffect(()=>{const c=new AbortController();api<Capability>(url,{signal:c.signal}).then(r=>{if(!c.signal.aborted){setEnabled(r.enabled);setWriteEnabled(r.writeEnabled);setHistoryEnabled(r.historyEnabled)}}).catch(()=>{});return()=>{c.abort();pending.current?.abort()}},[url])
 async function loadHistory(){try{setHistory(await api<Receipt[]>(url+'/recibos'));setHistoryError('')}catch(e){setHistoryError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired()}}
 async function refreshCreated(){await loadHistory();await onCreated()}
 function editorBusy(v:boolean){setChildBusy(v);onBusy(v)}
 async function consult(){
  if(disabled||busy||childBusy||!file)return
  if(!file.size||file.size>512*1024){setError('Selecione um XML de até 512 KiB.');return}
  const controller=new AbortController();pending.current?.abort();pending.current=controller
  setBusy(true);setError('');setResult(null)
  try{
   const bytes=new Uint8Array(await file.arrayBuffer())
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
   if(controller.signal.aborted)return
   const r=await api<Response>(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({xmlBase64:btoa(binary),steering}),signal:controller.signal})
   if(!controller.signal.aborted)setResult(r)
  }catch(e){if(!controller.signal.aborted){setError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired()}}
  finally{if(!controller.signal.aborted)setBusy(false)}
 }
 if(!enabled)return null
 const p=result?.preview,totals=p?.source.calculated
 return <section className="cilia-preview" aria-label="Importação Cilia">
  <button type="button" className="primary-btn" disabled={disabled||busy||childBusy} aria-expanded={open} onClick={()=>{setOpen(!open);if(open){setFile(null);setResult(null);setError('')}else if(historyEnabled)void loadHistory()}}>{open?'Fechar consulta Cilia':'Importar orçamento · Cilia'}</button>
  {open&&<div className="cilia-body">
   <p>{writeEnabled?'Importação de cenário após revisão e confirmação.':'Consulta de origem, sem gravação ou emissão de orçamento.'}</p>
   {historyEnabled&&<details><summary>Histórico de importações Cilia</summary><button type="button" disabled={busy||childBusy||disabled} onClick={()=>void loadHistory()}>Atualizar histórico</button>{historyError&&<p role="alert">{historyError}</p>}{history.map(r=><article key={r.id}><h4>{r.documentNumber} · revisão {r.revision}</h4><p>{money(r.result.total)} · {r.scenarioExists?'Cenário existente':'Cenário excluído; evidência preservada'}</p><p>Peças de terceiros conforme a importação (não comprova recebimento):</p>{r.partnerComponents.map(c=><p key={c.sourceId}>{c.description} · {c.quantity} un. · {money(c.total)}</p>)}</article>)}</details>}
   <label>Arquivo XML <input type="file" accept=".xml,application/xml,text/xml" disabled={busy||disabled||childBusy} onChange={e=>{setFile(e.target.files?.[0]??null);setResult(null);setError('')}}/></label>
   <label>Posição do volante <select aria-label="Posição do volante" value={steering} disabled={busy||disabled||childBusy} onChange={e=>{setSteering(e.target.value as typeof steering);setResult(null)}}><option value="unknown">A confirmar</option><option value="left">Esquerda</option><option value="right">Direita</option></select></label>
   <button type="button" disabled={!file||busy||disabled||childBusy} onClick={()=>void consult()}>{busy?'Lendo…':'Consultar XML'}</button>
   {error&&<p role="alert" className="form-error">{error}</p>}
   {p&&result&&<div aria-live="polite">
    <h3>Orçamento {p.source.identity.number} · revisão {p.source.identity.revision}</h3>
    <p>{p.source.identity.issuerName} · {p.source.identity.status}</p>
    <p role={result.plateComparison==='mismatch'?'alert':undefined}>Placa XML: {p.source.identity.plate??'Não informada'} · Atendimento: {result.attendance.plate||'Não informada'} · {result.plateComparison==='match'?'Placas coincidentes (identidade ainda exige revisão)':result.plateComparison==='mismatch'?'Placas divergentes — não importe':'Identidade pendente'}</p>
    <p>{p.source.financialIntegrity?'Totais de origem conciliados':'Origem com pendências'}</p>
    {totals&&<dl className="cilia-totals">{[['Serviços de origem',totals.labor],['Peças da oficina',totals.workshopParts],['Peças de terceiros',totals.partnerParts],['Total oficina',totals.workshopTotal],['Total geral',totals.global]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>}
    {!!p.source.issues.length&&<ul className="form-error">{p.source.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}
    <h4>{p.rows.length} itens · {p.groupingCandidates.length} possíveis agrupamentos</h4>
    {p.rows.map(row=>{const item=p.source.items.find(i=>i.id===row.sourceId);return <details key={row.sourceId} className="cilia-row"><summary>{item?.name??row.sourceId} · {row.operations.length} operações {row.piece.state==='candidate'?'':'· revisar'}</summary><p>{item?.supply} · {row.piece.candidates.map(c=>c.code).join(', ')||'Peça a identificar'}</p>{row.operations.map(op=><div key={op.sourceId}><strong>{op.kind} · {op.hours??'—'} h · {money(op.amount)}</strong><p>{op.candidates.map(c=>c.dimensions.map(d=>d.name).join(', ')).filter(Boolean).join(' / ')||'Dimensão a revisar'}{op.state==='review'?' · revisão necessária':''}</p>{!!op.issues.length&&<small>{op.issues.join(' · ')}</small>}</div>)}</details>})}
    <h4>Componentes de terceiros</h4>{p.components.filter(c=>c.supply==='partner').map(c=><p key={c.sourceId}>{c.description} · {money(c.sourceUnitNet)}</p>)}
    {p.source.financialIntegrity&&result.plateComparison==='match'&&file?<CiliaScopeEditor key={p.source.evidenceSha256+':'+steering} consultation={result} at={at} file={file} steering={steering} disabled={disabled||busy} onAuthRequired={onAuthRequired} writeEnabled={writeEnabled} onBusy={editorBusy} onCreated={refreshCreated}/>:<p className="at-form-hint">Corrija as pendências de origem e identidade antes da comparação.</p>}
   </div>}
  </div>}
 </section>
}
