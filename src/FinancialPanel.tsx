import type {Dispatch,SetStateAction} from 'react'
import {useEffect,useEffectEvent,useLayoutEffect,useRef,useState} from 'react'
import type {CommercialWorkspace} from '../shared/commercial'
import type {BudgetPreview,BudgetVersion,PricingConfiguration} from '../shared/pricing'
import type {NegotiationState} from './negotiation'
import {negotiationInput,negotiationSignature} from './negotiation'
import type {CalculationState} from './calculation-state'
import {api} from './api'
import {Login} from './ui'
import {money} from './money'
import {ApprovedIcon as I} from './ApprovedIcon'
import {CalculationView} from './BudgetPanel'
import './approved.css'

export function FinancialPanel({at,workspace,state,onState,fresh,onSync,onBusy,onDirty,externalBusy,calculationState,parameterState,onParameterState,onConfiguration}:{at:string;workspace:CommercialWorkspace;state:NegotiationState;onState:Dispatch<SetStateAction<NegotiationState>>;fresh:boolean;onSync:()=>Promise<void>;onBusy:(b:boolean)=>void;onDirty:(b:boolean)=>void;externalBusy:boolean;calculationState:CalculationState;parameterState:CalculationState;onParameterState:(v:CalculationState)=>void;onConfiguration:(c:PricingConfiguration)=>void}){
 const [open,setOpen]=useState(false),[neg,setNeg]=useState(false),[focus,setFocus]=useState(false),[moneyText,setMoneyText]=useState('')
 const [config,setConfig]=useState<PricingConfiguration|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reauth,setReauth]=useState(false)
 const [review,setReview]=useState<{preview:BudgetPreview;key:string;emit:boolean;deal:ReturnType<typeof negotiationInput>}|null>(null)
 const [acceptedIntent,setAcceptedIntent]=useState(''),[version,setVersion]=useState<BudgetVersion|null>(null)
 const running=useRef(false),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null)
 const intent=negotiationSignature(workspace,state.draft),latest=useRef(intent);useLayoutEffect(()=>{latest.current=intent},[intent])
 const accepted=acceptedIntent===intent,hasReview=Boolean(review)
 const locked=busy||externalBusy||calculationState==='pending'||calculationState==='error'||parameterState==='pending'
 useEffect(()=>{let live=true;api<PricingConfiguration>('/api/precificacao').then(c=>{if(live){setConfig(c);onConfiguration(c)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[workspace.configurationRevision,onConfiguration])
 useEffect(()=>{onDirty(Boolean(review?.emit&&!version));return()=>onDirty(false)},[review,version,onDirty])
 useEffect(()=>{if(hasReview){opener.current=document.activeElement as HTMLElement;dialog.current?.showModal()}else opener.current?.focus()},[hasReview])
 async function operation(action:()=>Promise<void>,lock=true){
  if(running.current||(lock&&externalBusy))return
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
 async function preview(emit=false){await operation(async()=>{const p=await obtain();if(!p)return;setVersion(null);setAcceptedIntent('');setReview({...p,emit})})}
 const autoPreview=useEffectEvent(()=>{void operation(async()=>{await obtain()},false)})
 useEffect(()=>{
  if(none||fresh||error||externalBusy||busy||valueState!=='current')return
  const timer=setTimeout(()=>{autoPreview()},450)
  return()=>clearTimeout(timer)
 },[intent,fresh,none,error,externalBusy,busy,valueState])
 const field=(label:string,key:'tableId'|'colorId'|'riskId'|'mrId',options:PricingConfiguration['config']['tables'])=><div className="factor"><label htmlFor={'factor-'+key}>{label}</label><div className="select-wrap"><select id={'factor-'+key} aria-label={label} disabled={locked} value={workspace.settings[key]??''} onChange={e=>{const value=e.target.value;onParameterState('pending');void operation(async()=>{try{await api(`/api/atendimentos/${at}/parametros`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:workspace.revision,[key]:value||null})});await onSync();onParameterState('current')}catch(e){onParameterState('error');throw e}})}}><option value="">{options.length?'Selecionar…':'Sem opções'}</option>{options.map(o=><option key={o.id} value={o.id}>{label==='Tabela'?o.name:o.factor==null?o.name:money(o.factor).replace('R$ ','')}</option>)}</select><I name="chevron"/></div></div>
 const login=reauth&&<div className="commercial-reauth"><p>Entre novamente. Campos e chave de emissão preservados.</p><Login session={{authenticated:false,configured:true}} error="" refresh={()=>{}} onSession={()=>{setReauth(false);setError('')}}/></div>
 const moneyValue=state.draft.value.trim()||'0'
 return <section className="approved-finance" aria-label="Painel financeiro" data-calculation-state={valueState!=='current'?valueState:original?.errors.length?'missing':'current'}><button className="summary" title={valueState==='incomplete'?'Rascunho incompleto — complete os campos do diagnóstico':original?.errors.join(' ')} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><div className="metric"><small>Serviços</small><span>{shown(original?.originalServiceSubtotal)}</span></div><div className="metric"><small>Componentes</small><span>{shown(original?.componentSubtotal)}</span></div><div className="metric"><small>{!adjusted||adjusted.startsWith('-')||adjusted==='0'?'Desconto':'Acréscimo'}</small><span>{amount}</span></div><div className="metric final"><small>Total final</small><span>{shown(calc?.total)}</span></div><I name="chevron"/></button>
 <div className="body" hidden={!open}>{valueState==='incomplete'?<p className="notice" role="status">Rascunho incompleto — complete os campos do diagnóstico.</p>:valueState==='current'&&original?.errors.length?<p className="notice" role="status">Configuração pendente: {original.errors[0]}</p>:null}<div className="factors">{field('Tabela','tableId',config?.config.tables??[])}{field('FC','colorId',config?.config.colors??[])}{field('FR','riskId',config?.config.risks??[])}{field('MR','mrId',config?.config.resaleMultipliers??[])}</div><div className="rule"/><div className="line"><span>Serviços originais</span><span className="number">{shown(original?.originalServiceSubtotal)}</span></div><button className="neg-head" aria-expanded={neg} onClick={()=>setNeg(v=>!v)}><span className="neg-label"><span className="neg-arrow">{neg?'⌄':'›'}</span>Negociação comercial</span><span className="neg-value">{amount}</span></button>
 <div hidden={!neg}><div className="neg-fields"><div className="segments" role="group" aria-label="Tipo de negociação">{(['discount','adjust'] as const).map((mode,i)=><button key={mode} disabled={locked} aria-pressed={state.draft.mode===mode||(state.draft.mode==='none'&&i===0)} className={state.draft.mode===mode||(state.draft.mode==='none'&&i===0)?'active':''} onClick={()=>onState(current=>({...current,draft:{mode,value:'0',acknowledgeResidual:false},signature:''}))}>{i===0?'Desconto':'Negociação'}</button>)}</div><input className="money" aria-label="Valor em reais" inputMode="decimal" disabled={externalBusy} value={focus?moneyText:/^\d+(?:[.,]\d+)?$/.test(moneyValue)?money(moneyValue.replace(',','.')):moneyValue} onFocus={e=>{setMoneyText(e.currentTarget.value);setFocus(true)}} onBlur={()=>setFocus(false)} onChange={e=>{setMoneyText(e.target.value);let value=e.target.value.replace(/R\$\s*/g,'');if(value.includes(','))value=value.replace(/\./g,'');onState(current=>({...current,draft:{...current.draft,mode:current.draft.mode==='none'?'discount':current.draft.mode,value,acknowledgeResidual:false},signature:''}));setError('')}}/></div></div>
 <div className="line"><span>Serviço</span><span className="number">{shown(calc?.serviceNet)}</span></div><div className="line"><span>Componente</span><span className="number">{shown(calc?.componentSubtotal)}</span></div><div className="rule"/><div className="total"><span>Total final</span><strong>{shown(calc?.total)}</strong></div><div className="actions"><button className="preview" disabled={locked||valueState!=='current'} onClick={()=>preview(false)}>Conferir prévia</button><button className="emit" disabled={locked||valueState!=='current'} onClick={()=>preview(true)}>Emitir orçamento</button></div>{error&&<p role="alert" className="error">{error}</p>}{parameterState==='error'&&<button onClick={()=>operation(async()=>{await onSync();onParameterState('current')})}>Atualizar valores</button>}{!review&&login}</div>
 {review&&<dialog ref={dialog} className="finance-review" aria-label="Conferência do orçamento" onCancel={e=>{e.preventDefault();if(!busy)setReview(null)}}><button disabled={busy} onClick={()=>setReview(null)}>Fechar conferência</button>{login}{version?<><h2>Orçamento {version.label} emitido</h2><button onClick={()=>operation(async()=>{const r=await fetch(`/api/atendimentos/${at}/orcamentos/${version.id}/pdf`,{credentials:'same-origin'});if(!r.ok||!r.headers.get('content-type')?.includes('application/pdf'))throw new Error('Não foi possível baixar o PDF.');const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=`FUNIX-${version.label}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)})}>Baixar PDF</button></>:<><h2>Prévia do orçamento</h2><CalculationView preview={review.preview}/>{review.preview.snapshot.calculation.residual!=='0'&&<button onClick={()=>{onState(current=>({...current,draft:{...current.draft,acknowledgeResidual:true}}));setReview(null)}}>Reconhecer resíduo e recalcular antes de emitir</button>}{review.emit&&<><label><input type="checkbox" checked={accepted} onChange={e=>setAcceptedIntent(e.target.checked?intent:'')}/> Conferi o escopo, as condições e o total efetivo.</label><button disabled={busy||!accepted||!review.preview.canEmit} onClick={()=>operation(async()=>{const v=await api<BudgetVersion>(`/api/atendimentos/${at}/orcamentos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:review.preview.snapshot.scenarioId,negotiation:review.deal,previewToken:review.preview.token,idempotencyKey:review.key})});setVersion(v)})}>Confirmar emissão</button></>}</>}{error&&<p role="alert">{error}</p>}</dialog>}
 </section>
}
