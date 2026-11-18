import {useMemo,useRef,useState,useEffect} from 'react'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
import type {Calculation} from '../shared/pricing'

type Entry={id:string;kind:'peca'|'servico'|'diagnostico'|'dimensao';name:string;code:string|null;serviceId:string|null}
type Operation={sourceId:string;kind:string;hours:string|null;amount:string|null;state:string;issues:string[];candidates:{serviceId:string;dimensions:{dimensionId:string;name:string}[]}[]}
export type CiliaConsultation={
 plateComparison:'match'|'mismatch'|'unknown';attendance:{plate:string;revision:number};canWrite:false;catalog:Entry[];
 preview:{source:{evidenceSha256:string;identity:{number:string;revision:string;plate:string|null;status:string;issuerName:string};financialIntegrity:boolean;issues:string[];calculated:{labor:string;workshopParts:string;partnerParts:string;workshopTotal:string;global:string}|null;items:{id:string;name:string;supply:string;netPrice:string}[]};
 rows:{sourceId:string;piece:{state:string;candidates:{pieceId:string;code:string}[];issues:string[]};operations:Operation[]}[];
 groupingCandidates:{pieceId:string;sourceRowIds:string[]}[];components:{sourceId:string;description:string;supply:string;sourceUnitNet:string}[]}
}
type Option={serviceId:string;dimensionId:string;quantity:string}
type PieceReview={diagnosisId:string|null;intensity:'leve'|'moderado'|'severo'|null;reason:string}
type GroupReview={options:Option[];reason:string}
type Comparison={state:string;financialMatch:boolean;calculation:Calculation|null;blockers:string[];groups:{id:string;operationIds:string[];sourceTotal:string}[];canWrite:false}
type Receipt={id:string;scenarioId:string}
type Prepared={state:'preview';previewToken:string;calculation:Calculation;externalGroupIds:string[];partnerComponents:{sourceId:string;description:string;quantity:string;total:string}[]}|{state:'existing';record:Receipt}|{state:'blocked';issues:string[]}
type Confirmed={state:'created'|'existing';record:Receipt}
const emptyPiece:PieceReview={diagnosisId:null,intensity:null,reason:''}
const emptyGroup:GroupReview={options:[],reason:''}
const operationClass=(kind:string)=>kind==='T'||kind==='RI'?'assembly':kind

export function CiliaScopeEditor({consultation,at,file,steering,disabled,onAuthRequired,writeEnabled,onBusy,onCreated}:{consultation:CiliaConsultation;at:string;file:File;steering:'left'|'right'|'unknown';disabled:boolean;onAuthRequired:()=>void;writeEnabled:boolean;onBusy:(v:boolean)=>void;onCreated:()=>Promise<void>}){
 const p=consultation.preview,catalog=consultation.catalog
 const names=useMemo(()=>new Map(catalog.map(c=>[c.id,c.name])),[catalog])
 const allOperations=useMemo(()=>p.rows.flatMap(r=>r.operations.map(o=>({...o,rowId:r.sourceId,label:(p.source.items.find(i=>i.id===r.sourceId)?.name??r.sourceId)+' · '+o.kind}))),[p])
 const [assignment,setAssignment]=useState<Record<string,string>>(()=>Object.fromEntries(p.rows.map(r=>[r.sourceId,r.piece.state==='candidate'&&r.piece.candidates.length===1?r.piece.candidates[0]!.pieceId:''])))
 const [pieceReviews,setPieceReviews]=useState<Record<string,PieceReview>>({})
 const [groupAssignment,setGroupAssignment]=useState<Record<string,string>>(()=>Object.fromEntries(allOperations.map(o=>[o.sourceId,o.sourceId])))
 const [groupReviews,setGroupReviews]=useState<Record<string,GroupReview>>({})
 const [reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[comparison,setComparison]=useState<Comparison|null>(null)
 const [prepared,setPrepared]=useState<Prepared|null>(null),[saved,setSaved]=useState<Receipt|null>(null)
 const [identityReviewed,setIdentityReviewed]=useState(false),[financialReviewed,setFinancialReviewed]=useState(false),[sourceAuthorized,setSourceAuthorized]=useState(false),[externalReviewed,setExternalReviewed]=useState(false),[authorizationReference,setAuthorizationReference]=useState('')
 const resetConfirmation=()=>{setPrepared(null);setIdentityReviewed(false);setFinancialReviewed(false);setSourceAuthorized(false);setExternalReviewed(false);setAuthorizationReference('')}
 const pending=useRef<AbortController|null>(null)
 useEffect(()=>()=>pending.current?.abort(),[])
 const locked=disabled||busy||saved!==null
 const pieces=Object.entries(p.rows.reduce<Record<string,string[]>>((a,r)=>{const key=assignment[r.sourceId];if(key)(a[key]??=[]).push(r.sourceId);return a},Object.create(null)))
 const groups=Object.entries(allOperations.reduce<Record<string,typeof allOperations>>((a,o)=>{(a[groupAssignment[o.sourceId]??o.sourceId]??=[]).push(o);return a},Object.create(null)))
 const changed=()=>{setReviewed(false);setComparison(null);setError('');resetConfirmation()}
 const setPiece=(id:string,patch:Partial<PieceReview>)=>{changed();setPieceReviews(old=>({...old,[id]:{...(old[id]??emptyPiece),...patch}}))}
 const setGroup=(id:string,patch:Partial<GroupReview>)=>{changed();setGroupReviews(old=>({...old,[id]:{...(old[id]??emptyGroup),...patch}}))}
 const hasMissing=p.rows.some(r=>!assignment[r.sourceId])||pieces.some(([id,rows])=>{const review=pieceReviews[id]??emptyPiece;return (rows.length>1||rows.some(rowId=>{const row=p.rows.find(r=>r.sourceId===rowId)!;return row.piece.state!=='candidate'||!row.piece.candidates.some(c=>c.pieceId===id)}))&&!review.reason.trim()})||groups.some(([id,ops])=>{
  const g=groupReviews[id]??emptyGroup
  return !g.options.length||g.options.some(o=>!o.serviceId||!o.dimensionId||!/^\d{1,9}(?:\.\d{1,6})?$/.test(o.quantity)||Number(o.quantity)<=0)||new Set(ops.map(o=>assignment[o.rowId])).size!==1||new Set(ops.map(o=>operationClass(o.kind))).size!==1||((ops.length>1||ops.some(o=>o.state!=='candidate'||g.options.some(opt=>!o.candidates.some(c=>c.serviceId===opt.serviceId))))&&!g.reason.trim())
 })
 async function request(action:'comparar'|'preparar'|'confirmar'){
  if(locked||!reviewed||hasMissing)return
  if(action==='preparar'&&(!writeEnabled||!comparison?.financialMatch))return
  if(action==='confirmar'&&(!writeEnabled||prepared?.state!=='preview'||!identityReviewed||!financialReviewed||!sourceAuthorized||!authorizationReference.trim()||(prepared.externalGroupIds.length>0&&!externalReviewed)))return
  const controller=new AbortController();pending.current?.abort();pending.current=controller
  setBusy(true);onBusy(true);setError('')
  if(action==='comparar'){setComparison(null);resetConfirmation()}
  if(action==='preparar')resetConfirmation()
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
   if(controller.signal.aborted)return
   const review={evidenceSha256:p.source.evidenceSha256,scopeReviewed:true,pieces:pieces.map(([pieceId,sourceRowIds])=>({pieceId,sourceRowIds,...(pieceReviews[pieceId]??emptyPiece)})),groups:groups.map(([id,ops])=>({operationIds:ops.map(o=>o.sourceId),...(groupReviews[id]??emptyGroup)}))}
   const input={xmlBase64:btoa(binary),steering,review,attendanceRevision:consultation.attendance.revision}
   const opts={method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal}
   const url='/api/atendimentos/'+encodeURIComponent(at)+'/importar-cilia/'+action
   if(action==='comparar'){
    const res=await api<Comparison>(url,{...opts,body:JSON.stringify(input)})
    if(!controller.signal.aborted)setComparison(res)
   }else if(action==='preparar'){
    const res=await api<Prepared>(url,{...opts,body:JSON.stringify(input)})
    if(!controller.signal.aborted){setPrepared(res);if(res.state==='existing'){setSaved(res.record);await onCreated()}}
   }else if(prepared?.state==='preview'){
    const res=await api<Confirmed>(url,{...opts,body:JSON.stringify({...input,previewToken:prepared.previewToken,identityReviewed,scopeReviewed:true,financialReviewed,sourceAuthorized,sourceAuthorizationReference:authorizationReference.trim(),externalReviewed,confirmed:true})})
    if(!controller.signal.aborted){setSaved(res.record);resetConfirmation();await onCreated()}
   }
  }catch(e){if(!controller.signal.aborted){setError((e as Error).message);if((e as RequestFailure).status===401)onAuthRequired();if((e as RequestFailure).status===409)resetConfirmation()}}
  finally{if(!controller.signal.aborted){setBusy(false);onBusy(false)}}
 }
 const byKind=(kind:Entry['kind'])=>catalog.filter(c=>c.kind===kind).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
 return <section className="cilia-editor" aria-label="Revisão de escopo Cilia"><h3>Revisão técnica</h3><p>Confira a identidade de cada peça e agrupe somente operações que representam trabalho efetivamente incluído. Escolha apenas dimensões tecnicamente aceitáveis; o motor selecionará a combinação financeira.</p>
 <fieldset disabled={locked}><legend>1. Peças</legend>
 {p.rows.map(r=><label key={r.sourceId}>{p.source.items.find(i=>i.id===r.sourceId)?.name??r.sourceId}<select value={assignment[r.sourceId]??''} onChange={e=>{changed();setAssignment(old=>({...old,[r.sourceId]:e.target.value}))}}><option value="">Selecionar peça</option>{byKind('peca').map(c=><option key={c.id} value={c.id}>{c.name} · {c.code}{r.piece.candidates.some(x=>x.pieceId===c.id)?' (sugestão)':''}</option>)}</select></label>)}
 {pieces.map(([id,rows])=>{const draft=pieceReviews[id]??emptyPiece;return <details className="cilia-row" key={id}><summary>{names.get(id)} · {rows.length} linhas</summary><label>Diagnóstico<select value={draft.diagnosisId??''} onChange={e=>setPiece(id,{diagnosisId:e.target.value||null})}><option value="">Não definido</option>{byKind('diagnostico').map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Intensidade<select value={draft.intensity??''} onChange={e=>setPiece(id,{intensity:(e.target.value||null) as PieceReview['intensity']})}><option value="">Não definida</option><option value="leve">Leve</option><option value="moderado">Moderado</option><option value="severo">Severo</option></select></label><label>Justificativa de agrupamento ou divergência<textarea maxLength={500} value={draft.reason} onChange={e=>setPiece(id,{reason:e.target.value})}/></label></details>})}</fieldset>
 <fieldset disabled={locked}><legend>2. Agrupamento de operações</legend>{allOperations.map(o=><label key={o.sourceId}>{o.label} · {money(o.amount)}<select value={groupAssignment[o.sourceId]??o.sourceId} onChange={e=>{changed();setGroupAssignment(old=>({...old,[o.sourceId]:e.target.value}))}}><option value={o.sourceId}>Grupo próprio</option>{allOperations.filter(x=>x.sourceId!==o.sourceId&&x.kind!=='manual'&&o.kind!=='manual'&&assignment[o.rowId]&&assignment[x.rowId]===assignment[o.rowId]&&operationClass(x.kind)===operationClass(o.kind)).map(x=><option key={x.sourceId} value={x.sourceId}>Grupo de {x.label}</option>)}{groupAssignment[o.sourceId]!==o.sourceId&&!allOperations.some(x=>x.sourceId===groupAssignment[o.sourceId]&&x.kind!=='manual'&&o.kind!=='manual'&&assignment[o.rowId]&&assignment[x.rowId]===assignment[o.rowId]&&operationClass(x.kind)===operationClass(o.kind))&&<option value={groupAssignment[o.sourceId]}>Grupo incompatível · revisar</option>}</select></label>)}</fieldset>
 <fieldset disabled={locked}><legend>3. Serviços e dimensões</legend>{groups.map(([id,ops],i)=>{const draft=groupReviews[id]??emptyGroup;const suggestions=[...new Set(ops.flatMap(o=>o.candidates.map(c=>c.serviceId)))];return <details key={id} className="cilia-row"><summary>Grupo {i+1} · {names.get(assignment[ops[0]!.rowId]??'')??'Peça pendente'} · {ops.length} operações / {draft.options.length} alternativas</summary>{ops.map(o=><p key={o.sourceId}>{o.label} · {money(o.amount)}</p>)}<label>Justificativa técnica<textarea maxLength={500} value={draft.reason} onChange={e=>setGroup(id,{reason:e.target.value})}/></label>{draft.options.map((option,index)=><div key={index} className="cilia-alternative"><label>Serviço<select value={option.serviceId} onChange={e=>setGroup(id,{options:draft.options.map((x,j)=>j===index?{...x,serviceId:e.target.value,dimensionId:''}:x)})}><option value="">Selecionar serviço</option>{byKind('servico').map(c=><option key={c.id} value={c.id}>{c.name}{suggestions.includes(c.id)?' (sugestão)':''}</option>)}</select></label><label>Dimensão<select value={option.dimensionId} onChange={e=>setGroup(id,{options:draft.options.map((x,j)=>j===index?{...x,dimensionId:e.target.value}:x)})}><option value="">Selecionar dimensão</option>{byKind('dimensao').filter(c=>c.serviceId===option.serviceId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Quantidade nativa<input inputMode="decimal" value={option.quantity} onChange={e=>setGroup(id,{options:draft.options.map((x,j)=>j===index?{...x,quantity:e.target.value.replace(',','.')}:x)})}/></label><button type="button" onClick={()=>setGroup(id,{options:draft.options.filter((_,j)=>j!==index)})}>Remover alternativa</button></div>)}<button type="button" disabled={draft.options.length>=20} onClick={()=>setGroup(id,{options:[...draft.options,{serviceId:suggestions.length===1?suggestions[0]!:'',dimensionId:'',quantity:'1'}]})}>Adicionar alternativa técnica</button></details>})}</fieldset>
 <label className="cilia-check"><input type="checkbox" checked={reviewed} disabled={locked||hasMissing} onChange={e=>{setReviewed(e.target.checked);setComparison(null);resetConfirmation()}}/> Revisei todas as peças, operações, agrupamentos, quantidades e dimensões.</label>
 {hasMissing&&<p>Complete os campos e justificativas pendentes.</p>}
 <button type="button" disabled={locked||hasMissing||!reviewed} onClick={()=>void request('comparar')}>{busy?'Calculando…':'Comparar com o motor FUNIX'}</button>
 {error&&<p role="alert" className="form-error">{error}</p>}
 {comparison&&<section aria-live="polite"><h4>{comparison.financialMatch?'Valores conciliados':'Comparação com pendências'}</h4>{comparison.calculation&&<><dl className="cilia-totals">{[['Serviços FUNIX',comparison.calculation.originalServiceSubtotal],['Desconto',comparison.calculation.discount],['Serviços líquidos',comparison.calculation.serviceNet],['Peças oficina',comparison.calculation.componentSubtotal],['Total FUNIX',comparison.calculation.total]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>{comparison.calculation.lines.map(l=><p key={l.id}>{l.pieceName} · {l.name} {l.dimension} · {money(l.total)}</p>)}</>}{comparison.blockers.map(b=><p key={b}>{b}</p>)}<p>Comparação somente leitura; não cria orçamento, cenário ou autorização de execução.</p>{writeEnabled&&comparison.financialMatch&&!saved&&<button type="button" disabled={locked} onClick={()=>void request('preparar')}>Preparar criação do cenário</button>}</section>}
 {prepared?.state==='blocked'&&<div role="alert"><h4>Gravação bloqueada</h4>{prepared.issues.map(i=><p key={i}>{i}</p>)}</div>}
 {prepared?.state==='preview'&&!saved&&<fieldset disabled={locked}><legend>4. Confirmação final</legend><p>Confira a prévia atualizada: {money(prepared.calculation.total)} · desconto {money(prepared.calculation.discount)}. A confirmação cria um cenário editável, não emite orçamento ou OS.</p>{prepared.calculation.lines.map(l=><p key={l.id}>{l.pieceName} · {l.name} {l.dimension} · {money(l.total)}</p>)}<h4>Componentes de terceiros (não faturáveis)</h4>{prepared.partnerComponents.map(c=><p key={c.sourceId}>{c.description} · {c.quantity} un. · {money(c.total)}</p>)}<label className="cilia-check"><input type="checkbox" checked={identityReviewed} onChange={e=>setIdentityReviewed(e.target.checked)}/> Conferi a identidade do veículo e do processo.</label><label className="cilia-check"><input type="checkbox" checked={financialReviewed} onChange={e=>setFinancialReviewed(e.target.checked)}/> Conferi o escopo final e os valores acima.</label><label>Referência da autorização (documento/e-mail e data)<input maxLength={500} value={authorizationReference} onChange={e=>setAuthorizationReference(e.target.value)}/></label><label className="cilia-check"><input type="checkbox" checked={sourceAuthorized} onChange={e=>setSourceAuthorized(e.target.checked)}/> Verifiquei a autorização documental correspondente a este orçamento e versão.</label>{prepared.externalGroupIds.length>0&&<label className="cilia-check"><input type="checkbox" checked={externalReviewed} onChange={e=>setExternalReviewed(e.target.checked)}/> Confirmei as condições de execução dos serviços especializados identificados nesta prévia.</label>}<button type="button" disabled={locked||!identityReviewed||!financialReviewed||!sourceAuthorized||!authorizationReference.trim()||(prepared.externalGroupIds.length>0&&!externalReviewed)} onClick={()=>void request('confirmar')}>Confirmar e criar cenário</button></fieldset>}
 {saved&&<p role="status">Cenário registrado. Consulte o histórico Cilia e o seletor de cenários. Nenhum documento foi emitido.</p>}
 </section>
}
