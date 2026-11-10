import{executionDeadline}from'../shared/budget-terms'
import './budget-experience.css'
import{DeadlineControl}from'./DeadlineControl'
import type {Dispatch,SetStateAction} from 'react'
import {useEffect,useEffectEvent,useLayoutEffect,useRef,useState} from 'react'
import type {CommercialWorkspace} from '../shared/commercial'
import type {BudgetPreview,BudgetVersion,PricingConfiguration} from '../shared/pricing'
import type {NegotiationState} from './negotiation'
import {negotiationInput,negotiationSignature} from './negotiation'
import type {CalculationState} from './calculation-state'
import {api} from './api'
import {emissionWasNotIssued} from './emission-error'
import {percentInput,resolveMR} from '../shared/mr'
import {Login} from './ui'
import {money} from './money'
import {ApprovedIcon as I} from './ApprovedIcon'
import {downloadIssuedPdf} from './BudgetPanel'
import './approved.css'

export function FinancialPanel({at,workspace,state,onState,fresh,onSync,onBusy,onDirty,externalBusy,calculationState,parameterState,onParameterState,onConfiguration,onArchive,negotiationPending,negotiationSaveError,onRetryNegotiation}:{at:string;workspace:CommercialWorkspace;state:NegotiationState;negotiationPending:boolean;negotiationSaveError:string;onRetryNegotiation:()=>void;onState:Dispatch<SetStateAction<NegotiationState>>;fresh:boolean;onSync:()=>Promise<CommercialWorkspace|void>;onBusy:(b:boolean)=>void;onDirty:(b:boolean)=>void;externalBusy:boolean;calculationState:CalculationState;parameterState:CalculationState;onParameterState:(v:CalculationState)=>void;onConfiguration:(c:PricingConfiguration)=>void;onArchive:()=>void}){
 const [open,setOpen]=useState(false),[neg,setNeg]=useState(false),[focus,setFocus]=useState(false),[moneyText,setMoneyText]=useState('')
 const [config,setConfig]=useState<PricingConfiguration|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reauth,setReauth]=useState(false)
 const [review,setReview]=useState<{preview:BudgetPreview;key:string;url:string;deal:ReturnType<typeof negotiationInput>}|null>(null)
 const [version,setVersion]=useState<BudgetVersion|null>(null),[uncertain,setUncertain]=useState(false)
 const [deadlineDirty,setDeadlineDirty]=useState(false),[deadlineBusy,setDeadlineBusy]=useState(false)
 const [mrText,setMRText]=useState(''),[mrDirty,setMRDirty]=useState(false)
 const previewAbort=useRef<AbortController|null>(null)
 useEffect(()=>()=>previewAbort.current?.abort(),[])
 const mrRecovery=useRef(false)
 const running=useRef(false),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null)
 const intent=negotiationSignature(workspace,state.draft),latest=useRef(intent);useLayoutEffect(()=>{latest.current=intent},[intent])
 const hasReview=Boolean(review)
 const locked=busy||deadlineBusy||deadlineDirty||externalBusy||calculationState==='pending'||calculationState==='error'||parameterState==='pending'
 useEffect(()=>{let live=true;api<PricingConfiguration>('/api/precificacao').then(c=>{if(live){setConfig(c);onConfiguration(c)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[workspace.configurationRevision,onConfiguration])
 useEffect(()=>{onDirty(mrDirty||deadlineDirty||uncertain);return()=>onDirty(false)},[uncertain,mrDirty,deadlineDirty,onDirty])
 useEffect(()=>()=>{if(review)URL.revokeObjectURL(review.url)},[review])
 useEffect(()=>{if(hasReview){opener.current=document.activeElement as HTMLElement;dialog.current?.showModal()}else opener.current?.focus()},[hasReview])
 async function operation(action:()=>Promise<void>,lock=true){
  if(running.current||deadlineBusy||(lock&&externalBusy))return
  running.current=true;setBusy(true);if(lock)onBusy(true);setError('')
  try{await action()}catch(e){if((e as {status?:number}).status===401)setReauth(true);setError((e as Error).message)}finally{running.current=false;setBusy(false);if(lock)onBusy(false)}
 }
 const original=workspace.calculations.find(c=>c.scenarioId===workspace.selectedId)
 let none=false;try{none=negotiationInput(state.draft).mode==='none'}catch{}
 const calc=none?original:fresh?state.preview?.snapshot.calculation:null
 const valueState=calculationState!=='current'?calculationState:parameterState
 const statusText=valueState==='error'?'Não atualizado':valueState==='incomplete'?'Incompleto':valueState==='missing'?'Pendente':'Calculando…'
 const adjusted=calc?.adjustment,amount=valueState!=='current'?statusText:adjusted==null?'—':(adjusted.startsWith('-')?'− ':adjusted==='0'?'':'+ ')+money(adjusted.replace(/^-/,'') )
 const shown=(v:string|null|undefined)=>valueState!=='current'?statusText:v==null?'Pendente':money(v)
 async function obtain(){
  const deal=negotiationInput(state.draft),p=await api<BudgetPreview>(`/api/atendimentos/${at}/orcamentos/previa`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:workspace.selectedId,negotiation:deal})})
  if(latest.current!==intent)return null
  const s=p.snapshot,changed=s.compositionRevision!==workspace.revision||s.configuration.revision!==workspace.configurationRevision||s.scenarioRevision!==workspace.scenarios.find(v=>v.id===workspace.selectedId)?.revision
  if(changed){await onSync();throw new Error('Os dados salvos mudaram. Valores atualizados; confira e tente novamente.')}
  const key=crypto.randomUUID();onState(current=>({...current,preview:p,signature:intent,requestKey:key}))
  return {preview:p,key,deal}
 }
 async function beginEmission(){await operation(async()=>{
  const controller=new AbortController();previewAbort.current=controller
  const p=await obtain();if(!p||controller.signal.aborted)return
  if(!p.preview.canEmit)throw new Error([...p.preview.snapshot.calculation.errors,...(p.preview.snapshot.pdfPresentation?.errors??[]),...(p.preview.snapshot.executionDeadline?.effectiveDays===null?['Prazo de execução pendente.']:[])].join(' ')||'Orçamento incompleto. Confira a configuração comercial.')
  const response=await fetch(`/api/atendimentos/${at}/orcamentos/previa-pdf`,{signal:controller.signal,method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:p.preview.snapshot.scenarioId,negotiation:p.deal,previewToken:p.preview.token})}).catch(e=>{if((e as Error).name==='AbortError')throw e;throw new Error('Não foi possível carregar a prévia PDF. Tente Emitir novamente.')})
  if(!response.ok){const body=await response.json().catch(()=>null);throw Object.assign(new Error(body?.error?.message??'Não foi possível gerar a prévia PDF.'),{status:response.status})}
  if(!response.headers.get('Content-Type')?.includes('application/pdf'))throw new Error('A prévia não retornou um PDF válido.')
  const blob=await response.blob()
  if(controller.signal.aborted)return
  if(latest.current!==intent)throw new Error('Os dados mudaram. Gere uma nova prévia.')
  setVersion(null);setUncertain(false);setReview({...p,url:URL.createObjectURL(blob)})
 })}
 async function confirmEmission(){await operation(async()=>{
  if(!review||version)return
  setUncertain(true)
  let issued:BudgetVersion
  try{issued=await api<BudgetVersion>(`/api/atendimentos/${at}/orcamentos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:review.preview.snapshot.scenarioId,negotiation:review.deal,previewToken:review.preview.token,idempotencyKey:review.key})})}
  catch(e){
   if(emissionWasNotIssued(e)){
    setUncertain(false)
    const message=`O orçamento não foi emitido. ${(e as Error).message}`
    throw Object.assign(new Error(message),e,{message})
   }
   throw e
  }
  setVersion(issued);setUncertain(false)
  try{await downloadIssuedPdf(at,issued);setReview(null)}catch(e){throw Object.assign(new Error(`Orçamento ${issued.documentNumber??issued.label} emitido, mas não foi possível baixar o PDF. Use Baixar novamente; nenhuma nova emissão será criada.`),{status:(e as{status?:number}).status})}
 })}
 const closeReview=()=>{if(!busy&&!uncertain)setReview(null)}

 const autoPreview=useEffectEvent(()=>{void operation(async()=>{await obtain()},false)})
 useEffect(()=>{
  if(none||fresh||error||externalBusy||busy||deadlineBusy||deadlineDirty||valueState!=='current')return
  const timer=setTimeout(()=>{autoPreview()},450)
  return()=>clearTimeout(timer)
 },[intent,fresh,none,error,externalBusy,busy,deadlineBusy,deadlineDirty,valueState])
 async function saveMR(){
  if(!mrDirty||mrRecovery.current)return
  const percent=percentInput(mrText)
  if(percent===null){onParameterState('incomplete');return}
  if(Object.hasOwn(workspace.settings,'mrPercent')&&workspace.settings.mrPercent===percent){setMRDirty(false);onParameterState('current');return}
  await operation(async()=>{
   try{
    await api(`/api/atendimentos/${at}/parametros`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:workspace.revision,mrPercent:percent})})
    const saved=await onSync()
    if(!saved||saved.settings.mrPercent!==percent)throw new Error('O MR salvo mudou. Atualize os valores antes de tentar novamente.')
    setMRDirty(false);onParameterState('current')
   }catch(e){mrRecovery.current=true;onParameterState('error');throw e}
  })
 }
 async function recoverParameters(){
  await operation(async()=>{
   let saved=await onSync()
   if(saved&&!saved.settings.defaultsInitialized){await api(`/api/atendimentos/${at}/parametros/inicializar`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});saved=await onSync()}
   if(!saved)throw new Error('Não foi possível confirmar os parâmetros atuais. Tente atualizar novamente.')
   mrRecovery.current=false
   if(mrDirty){
    if(percentInput(mrText)!==null&&saved.settings.mrPercent===percentInput(mrText)){setMRDirty(false);onParameterState('current')}
    else{onParameterState('incomplete');setError('Confira o MR digitado e pressione Enter para salvar novamente.')}
   }else onParameterState('current')
  })
 }
 const initialize=useEffectEvent(()=>{void operation(async()=>{
  onParameterState('pending')
  try{await api(`/api/atendimentos/${at}/parametros/inicializar`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await onSync();onParameterState('current')}
  catch(e){onParameterState('error');throw e}
 })})
 useEffect(()=>{let live=true;if(!workspace.settings.defaultsInitialized)Promise.resolve().then(()=>{if(live)initialize()});return()=>{live=false}},[at,workspace.settings.defaultsInitialized])
 const field=(label:string,key:'tableId'|'colorId'|'riskId',options:PricingConfiguration['config']['tables'])=><div className="factor"><label htmlFor={'factor-'+key}>{label}</label><div className="select-wrap"><select id={'factor-'+key} aria-label={label} disabled={locked||mrDirty} value={workspace.settings[key]??''} onChange={e=>{const value=e.target.value;onParameterState('pending');void operation(async()=>{try{await api(`/api/atendimentos/${at}/parametros`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:workspace.revision,[key]:value||null})});await onSync();onParameterState('current')}catch(e){onParameterState('error');throw e}})}}><option value="">{options.length?'Selecionar…':'Sem opções'}</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><I name="chevron"/></div></div>
 const mrValue=mrDirty?mrText:config?resolveMR(workspace.settings,config.config).percent??'':''
 const mrField=<div className="factor"><label htmlFor="factor-mrPercent">MR</label><div className="select-wrap"><input id="factor-mrPercent" className="mr-percent" aria-label="MR" aria-invalid={mrDirty&&percentInput(mrText)===null} aria-description="Percentual de acréscimo sobre o custo dos componentes. Salvo ao sair do campo ou pressionar Enter." inputMode="decimal" autoComplete="off" disabled={busy||deadlineBusy||externalBusy||calculationState==='pending'||calculationState==='error'} value={mrValue} onChange={e=>{setMRText(e.target.value);setMRDirty(true);if(!mrRecovery.current){onParameterState(percentInput(e.target.value)===null?'incomplete':'pending');setError('')}}} onBlur={()=>{void saveMR()}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void saveMR()}}}/><span className="mr-suffix" aria-hidden="true">%</span></div></div>
 const login=reauth&&<div className="commercial-reauth"><p>Entre novamente. Campos e chave de emissão preservados.</p><Login session={{authenticated:false,configured:true}} error="" refresh={()=>{}} onSession={()=>{setReauth(false);setError('')}}/></div>
 const moneyValue=state.draft.value.trim()||'0'
 const activeScenario=workspace.scenarios.find(s=>s.id===workspace.selectedId)
 const effectiveDays=valueState==='current'&&!deadlineDirty&&!deadlineBusy?executionDeadline(activeScenario?.deadline,original?.days??null).effectiveDays:null
 return <section className="approved-finance" aria-label="Painel financeiro" data-calculation-state={valueState!=='current'?valueState:original?.errors.length?'missing':'current'}><button className="summary" title={valueState==='incomplete'?'Rascunho incompleto — complete os campos do diagnóstico':original?.errors.join(' ')} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><div className="metric"><small>Serviços</small><span>{shown(original?.originalServiceSubtotal)}</span></div><div className="metric"><small>Componentes</small><span>{shown(original?.componentSubtotal)}</span></div><div className="metric"><small>{!adjusted||adjusted.startsWith('-')||adjusted==='0'?'Desconto':'Acréscimo'}</small><span>{amount}</span></div><div className="metric final"><small>Total final</small><span>{(calc?.nonBillableOnly&&valueState==='current'?'Sem cobrança':shown(calc?.total))}</span></div><div className="metric deadline"><small>Prazo</small><span>{effectiveDays!==null&&Number.isSafeInteger(effectiveDays)&&effectiveDays>0?effectiveDays:'—'}</span></div><I name="chevron"/></button>
 <div className="body" hidden={!open}>{valueState==='incomplete'?<p className="notice" role="status">{mrDirty?'MR incompleto — informe um percentual não negativo.':'Rascunho incompleto — complete os campos do diagnóstico.'}</p>:valueState==='current'&&original?.errors.length?<p className="notice" role="status">Configuração pendente: {original.errors[0]}</p>:null}<div className="factors">{field('Tabela','tableId',config?.config.tables??[])}{field('FC','colorId',config?.config.colors??[])}{field('FR','riskId',config?.config.risks??[])}{mrField}</div><div className="rule"/><div className="line"><span>Serviços originais</span><span className="number">{shown(original?.originalServiceSubtotal)}</span></div><button className="neg-head" aria-expanded={neg} onClick={()=>setNeg(v=>!v)}><span className="neg-label"><span className="neg-arrow">{neg?'⌄':'›'}</span>Negociação comercial</span><span className="neg-value">{amount}</span></button>
 <div hidden={!neg}><div className="neg-fields"><div className="segments" role="group" aria-label="Tipo de negociação">{(['discount','adjust'] as const).map((mode,i)=><button key={mode} disabled={locked} aria-pressed={state.draft.mode===mode||(state.draft.mode==='none'&&i===0)} className={state.draft.mode===mode||(state.draft.mode==='none'&&i===0)?'active':''} onClick={()=>onState(current=>({...current,draft:{mode,value:'0',acknowledgeResidual:false},signature:''}))}>{i===0?'Desconto':'Negociação'}</button>)}</div><input className="money" aria-label="Valor em reais" inputMode="decimal" disabled={externalBusy||deadlineBusy} value={focus?moneyText:/^\d+(?:[.,]\d+)?$/.test(moneyValue)?money(moneyValue.replace(',','.')):moneyValue} onFocus={e=>{setMoneyText(e.currentTarget.value);setFocus(true)}} onBlur={()=>setFocus(false)} onChange={e=>{setMoneyText(e.target.value);let value=e.target.value.replace(/R\$\s*/g,'');if(value.includes(','))value=value.replace(/\./g,'');onState(current=>({...current,draft:{...current.draft,mode:current.draft.mode==='none'?'discount':current.draft.mode,value,acknowledgeResidual:false},signature:''}));setError('')}}/></div></div>
 {neg&&fresh&&state.preview?.snapshot.calculation.residual!=='0'&&!state.draft.acknowledgeResidual&&<button className="residual-ack" onClick={()=>onState(current=>({...current,draft:{...current.draft,acknowledgeResidual:true},signature:''}))}>Reconhecer resíduo de {money(state.preview?.snapshot.calculation.residual)} e recalcular</button>}
 <DeadlineControl key={workspace.selectedId} at={at} scenario={workspace.scenarios.find(s=>s.id===workspace.selectedId)!} technicalDays={original?.days??null} externalBusy={externalBusy||busy} onDirty={setDeadlineDirty} onBusy={v=>{setDeadlineBusy(v);onBusy(v)}} onSync={onSync} onAuthRequired={()=>setReauth(true)}/><div className="line"><span>Serviço</span><span className="number">{shown(calc?.serviceNet)}</span></div><div className="line"><span>Componente</span><span className="number">{shown(calc?.componentSubtotal)}</span></div><div className="rule"/><div className="total"><span>Total final</span><strong>{(calc?.nonBillableOnly&&valueState==='current'?'Sem cobrança':shown(calc?.total))}</strong></div></div>
 {negotiationPending&&!negotiationSaveError&&<p className="notice" role="status">Negociação: alterações pendentes de confirmação no cenário.</p>}
 {negotiationSaveError&&<div role="alert" className="finance-feedback"><p className="error">{negotiationSaveError}</p><button type="button" onClick={onRetryNegotiation}>Tentar salvar negociação</button></div>}
 {!review&&(error||parameterState==='error'||reauth)&&<div className="finance-feedback">{error&&<p role="alert" className="error">{error}</p>}{parameterState==='error'&&<button onClick={()=>recoverParameters()}>Atualizar valores</button>}{login}</div>}
 <footer className="actions budget-actions" aria-label="Ações do orçamento"><button className="history" disabled={busy||deadlineBusy||externalBusy} onClick={onArchive}>Orçamentos emitidos</button><button className="emit" disabled={locked||negotiationPending||Boolean(negotiationSaveError)||valueState!=='current'} onClick={()=>beginEmission()}>Emitir</button></footer>
 {review&&<dialog ref={dialog} className="finance-review pdf-review" aria-label="Prévia PDF do orçamento" onCancel={e=>{e.preventDefault();closeReview()}}>
 <header><h2>{version?`Orçamento ${version.documentNumber??version.label} emitido`:'Prévia do orçamento'}</h2></header>
 {!version&&<><iframe title="PDF da prévia do orçamento" src={review.url}/><p className="pdf-fallback">Se o PDF não aparecer, <a href={review.url} target="_blank" rel="noopener noreferrer">abrir prévia em outra aba</a>.</p></>}
 {login}{error&&<p role="alert">{error}</p>}{uncertain&&!busy&&<p role="status">Confirmação pendente. Tente Confirmar novamente para recuperar a mesma emissão com segurança.</p>}
 <footer><button disabled={busy||uncertain} onClick={closeReview}>Voltar</button>{version?<button disabled={busy} onClick={()=>operation(async()=>{await downloadIssuedPdf(at,version);setReview(null)})}>Baixar novamente</button>:<button disabled={busy} onClick={()=>confirmEmission()}>Confirmar</button>}</footer>
 </dialog>}
 </section>
}
