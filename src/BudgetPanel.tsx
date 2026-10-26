import {useCallback,useEffect,useRef,useState} from 'react'
import type {CatalogItem,CommercialWorkspace} from '../shared/commercial'
import type {BudgetPreview,BudgetVersion,ComponentItem,Negotiation,PricingConfiguration,PricingSettings} from '../shared/pricing'
import {api} from './api'
import type {RequestFailure} from './api'
import {PricingEditor} from './PricingEditor'
import {money} from './money'

type VersionMeta=Omit<BudgetVersion,'snapshot'>&{total:string}
export function BudgetPanel({at,workspace,catalog,onRefresh,onDirty,onBusy,onAuthRequired}:{at:string;workspace:CommercialWorkspace;catalog:CatalogItem[];onRefresh:()=>Promise<void>;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onAuthRequired:()=>void}){
 const [configuration,setConfiguration]=useState<PricingConfiguration|null>(null),[versions,setVersions]=useState<VersionMeta[]>([])
 const [view,setView]=useState<'home'|'settings'|'pricing'|'component'|'issue'|'version'>('home'),[component,setComponent]=useState<ComponentItem|undefined>()
 const [failure,setFailure]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState<BudgetVersion|null>(null)
 const [mode,setMode]=useState<'none'|'discount'|'adjust'>('none'),[value,setValue]=useState(''),[ack,setAck]=useState(false)
 const [preview,setPreview]=useState<BudgetPreview|null>(null),[requestKey,setRequestKey]=useState('')
 const dirty=useRef(false),auth=useRef(onAuthRequired)
 useEffect(()=>{auth.current=onAuthRequired},[onAuthRequired])
 const childBusy=useCallback((v:boolean)=>{setBusy(v);onBusy(v)},[onBusy])
 const setDirty=useCallback((v:boolean)=>{dirty.current=v;onDirty(v)},[onDirty])
 useEffect(()=>()=>onDirty(false),[onDirty])
 useEffect(()=>{if(view!=='issue')return;setDirty(mode!=='none'||value!==''||ack);return()=>setDirty(false)},[view,mode,value,ack,setDirty])
 const scenario=workspace.scenarios.find(s=>s.id===workspace.selectedId)!,calc=workspace.calculations.find(c=>c.scenarioId===workspace.selectedId)
 const deal:Negotiation=mode==='none'?{mode:'none'}:{mode,value,acknowledgeResidual:ack}
 const fresh=preview && JSON.stringify(preview.snapshot.calculation.negotiation)===JSON.stringify(deal)
 const load=useCallback(async()=>{
  const [c,v]=await Promise.all([api<PricingConfiguration>('/api/precificacao'),api<VersionMeta[]>(`/api/atendimentos/${at}/orcamentos`)])
  setConfiguration(c);setVersions(v)
 },[at])
 const failed=useCallback((cause:unknown)=>{setFailure((cause as Error).message);if((cause as RequestFailure).status===401)auth.current()},[])
 useEffect(()=>{let live=true;Promise.resolve().then(load).catch(cause=>{if(live)failed(cause)});return()=>{live=false}},[load,failed])
 async function operation(fn:()=>Promise<void>){if(busy)return;setBusy(true);onBusy(true);setFailure('');try{await fn()}catch(cause){failed(cause)}finally{setBusy(false);onBusy(false)}}
 function navigate(next:typeof view){if(busy || (dirty.current && !window.confirm('Há alterações não salvas. Deseja descartá-las?')))return;setDirty(false);if(next!=='issue'){setMode('none');setValue('');setAck(false);setPreview(null)}setView(next);setFailure('')}
 const afterSave=async()=>{await onRefresh();await load();setDirty(false);setView('home')}
 const byId=(id:string)=>catalog.find(c=>c.id===id)
 const pieceName=(id:string)=>byId(workspace.items.find(p=>p.id===id)?.pieceId??'')?.name??'Peça ausente'
 async function download(v:BudgetVersion){await operation(async()=>{
  const r=await fetch(`/api/atendimentos/${at}/orcamentos/${v.id}/pdf`,{credentials:'same-origin'})
  if(!r.ok){const body=await r.json();const error=Object.assign(new Error(body.error?.message??'Falha ao baixar PDF.'),{status:r.status});throw error}
  if(!r.headers.get('content-type')?.includes('application/pdf'))throw new Error('Documento PDF inválido.')
  const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`FUNIX-orcamento-${v.label}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 })}
 const renderVersion=(v:BudgetVersion)=><section aria-label="Versão emitida"><h2>Orçamento {v.label} · versão {v.sequence}</h2><p className="at-form-hint">Emitido em {new Date(v.createdAt).toLocaleString('pt-BR')}. Documento congelado; não usa o catálogo atual.</p><h3>{v.snapshot.atendimento.name||v.snapshot.atendimento.phone}</h3><CalculationView preview={{snapshot:v.snapshot,token:'',canEmit:true}}/><button className="primary-btn" disabled={busy} onClick={()=>download(v)}>Baixar PDF {v.label}</button></section>
 return <section aria-label="Orçamento e componentes"><div className="commercial-toolbar"><h2>Orçamento · {scenario.name}</h2>{view!=='home'&&<button className="fh-filter" disabled={busy} onClick={()=>navigate('home')}>Voltar ao orçamento</button>}</div>
 {failure&&<p className="form-error" role="alert">{failure}</p>}
 {view==='pricing'&&configuration?<PricingEditor initial={configuration} catalog={catalog} onSaved={afterSave} onDirty={setDirty} onBusy={childBusy} onAuthRequired={onAuthRequired}/>:view==='settings'&&configuration?<SettingsForm settings={workspace.settings} revision={workspace.revision} config={configuration} at={at} onSaved={afterSave} onDirty={setDirty} onBusy={childBusy} onAuthRequired={onAuthRequired}/>:view==='component'?<ComponentForm initial={component} at={at} workspace={workspace} pieceName={pieceName} onSaved={afterSave} onDirty={setDirty} onBusy={childBusy} onAuthRequired={onAuthRequired}/>:view==='version'&&version?renderVersion(version):view==='issue'?<>
 <p className="at-form-hint">Emissão manual do cenário selecionado. A negociação afeta somente serviços; componentes permanecem iguais.</p>
 <label className="at-field">Negociação<select aria-label="Negociação" disabled={busy} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setAck(false)}}><option value="none">Sem negociação</option><option value="discount">Desconto em serviços (R$)</option><option value="adjust">Ajustar subtotal de serviços (R$)</option></select></label>
 {mode!=='none'&&<label className="at-field">Valor informado (R$)<input aria-label="Valor informado (R$)" disabled={busy} inputMode="decimal" value={value} onChange={e=>{setValue(e.target.value);setAck(false)}}/></label>}
 {mode==='adjust'&&<label className="commercial-check"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> Estou ciente da diferença residual informada e do total efetivo a emitir.</label>}
 <button className="codex-add" disabled={busy} onClick={()=>operation(async()=>{const p=await api<BudgetPreview>(`/api/atendimentos/${at}/orcamentos/previa`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:scenario.id,negotiation:deal})});setPreview(p);setRequestKey(crypto.randomUUID())})}>Preparar prévia de emissão</button>
 {preview&&<><CalculationView preview={preview}/>{!fresh&&<p className="form-error">Negociação alterada. Prepare outra prévia antes de emitir.</p>}<button className="primary-btn" disabled={busy||!preview.canEmit||!fresh} onClick={()=>operation(async()=>{
  const v=await api<BudgetVersion>(`/api/atendimentos/${at}/orcamentos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenarioId:scenario.id,negotiation:deal,previewToken:preview.token,idempotencyKey:requestKey})});setDirty(false);setVersion(v);setView('version');setMode('none');setValue('');setAck(false);setPreview(null);await load()
 })}>Emitir versão imutável</button></>}
 </>:<>
 <dl className="budget-summary"><div><dt>Serviços antes de negociação</dt><dd>{money(calc?.serviceSubtotal)}</dd></div><div><dt>Componentes</dt><dd>{money(calc?.componentSubtotal)}</dd></div><div><dt>Total do cenário</dt><dd>{money(calc?.total)}</dd></div><div><dt>Energia / dias técnicos</dt><dd>{calc?.energy??'Indisponível'} / {calc?.days??'Indisponível'}</dd></div></dl>
 {calc?.errors.length?<details className="budget-errors"><summary>{calc.errors.length} pendência(s) de emissão</summary><ul>{calc.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></details>:<p className="at-form-hint">Cálculo disponível. Revise a prévia antes de emitir.</p>}
 <div className="commercial-toolbar"><button className="fh-filter" onClick={()=>navigate('settings')} disabled={!configuration||busy}>Parâmetros do Atendimento</button><button className="fh-filter" onClick={()=>navigate('pricing')} disabled={!configuration||busy}>Configuração comercial</button></div>
 <h2>Componentes monetários</h2><p className="at-form-hint">Lançamentos manuais vinculados a uma peça. Não são peças adicionais no mapa. Vazio é pendente; zero explícito é permitido.</p>
 {workspace.components.map(c=><article className="diagnosis-card" key={c.id}><strong>{c.name} · {pieceName(c.pieceId)}</strong><p>{c.quantity} × preço manual {money(c.manualPrice)} · FCT {c.fct??'pendente'}</p><label className="commercial-check"><input type="checkbox" checked={Boolean(scenario.pieceFlags[c.pieceId]&&scenario.componentFlags[c.id])} disabled={busy||!scenario.pieceFlags[c.pieceId]} onChange={e=>operation(async()=>{await api(`/api/atendimentos/${at}/cenarios/${scenario.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:scenario.revision,componentFlags:{[c.id]:e.target.checked}})});await onRefresh()})}/> Incluir neste cenário</label><div className="commercial-toolbar"><button className="fh-filter" disabled={busy} onClick={()=>{setComponent(c);navigate('component')}}>Editar componente</button><button className="fh-filter" disabled={busy} onClick={()=>{if(window.confirm('Excluir este componente de TODOS os cenários?'))operation(async()=>{await api(`/api/atendimentos/${at}/componentes/${c.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:c.revision})});await onRefresh()})}}>Excluir componente</button></div></article>)}
 <button className="codex-add" disabled={busy||!workspace.items.length} onClick={()=>{setComponent(undefined);navigate('component')}}>+ Componente monetário</button>
 <button className="primary-btn" disabled={busy} onClick={()=>{setPreview(null);navigate('issue')}}>Preparar emissão do cenário</button>
 <h2>Versões emitidas · {versions.length}</h2>{versions.map(v=><button key={v.id} className="catalog-row" disabled={busy} onClick={()=>operation(async()=>{setVersion(await api<BudgetVersion>(`/api/atendimentos/${at}/orcamentos/${v.id}`));setView('version')})}>Orçamento {v.label} · {new Date(v.createdAt).toLocaleString('pt-BR')} · {money(v.total)}</button>)}
 {!versions.length&&<p className="at-form-hint">Nenhuma versão emitida. Não existe limite de três versões.</p>}
 </>}
 </section>
}

function CalculationView({preview}:{preview:BudgetPreview}){
 const c=preview.snapshot.calculation
 return <section className="budget-preview" aria-label="Prévia de orçamento"><h3>{c.scenarioName}</h3>{c.errors.length>0&&<ul className="form-error">{c.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
 {c.lines.map(l=><article className={`diagnosis-card ${l.included?'':'excluded'}`} key={l.id}><strong>{l.pieceName} · {l.name}</strong><p>{l.dimension} {l.diagnosis} {l.notes}</p>{l.included?<p>{l.quantity} × {money(l.finalUnit)} = {money(l.total)}</p>:<p>{l.quantity} · Fora deste cenário: não integra totais ou PDF.</p>}{l.finalUnit!==l.unit&&<small>Unitário de referência: {money(l.unit)}</small>}</article>)}
 <dl className="budget-summary"><div><dt>Serviços originais</dt><dd>{money(c.originalServiceSubtotal)}</dd></div><div><dt>Serviços efetivos</dt><dd>{money(c.serviceSubtotal)}</dd></div><div><dt>Desconto em serviços</dt><dd>{money(c.discount)}</dd></div><div><dt>Componentes</dt><dd>{money(c.componentSubtotal)}</dd></div><div><dt>Total efetivo</dt><dd>{money(c.total)}</dd></div><div><dt>Energia / dias técnicos</dt><dd>{c.energy??'Pendente'} / {c.days??'Pendente'}</dd></div></dl>
 {c.target!==null&&<p>Subtotal de serviços informado: {money(c.target)}. Resíduo (informado − efetivo): {money(c.residual)}.</p>}
 <p className="at-form-hint">Dias técnicos são estimativa de escopo, não data de entrega nem autorização de execução.</p><p>{preview.snapshot.conditions||'Condições comerciais ainda não informadas.'}</p></section>
}

function SettingsForm({settings,revision,config,at,onSaved,onDirty,onBusy,onAuthRequired}:{settings:PricingSettings;revision:number;config:PricingConfiguration;at:string;onSaved:()=>Promise<void>;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onAuthRequired:()=>void}){
 const [fields,setFields]=useState(settings),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const dirty=JSON.stringify(settings)!==JSON.stringify(fields)
 useEffect(()=>{onDirty(dirty)},[dirty,onDirty]);useEffect(()=>()=>onDirty(false),[onDirty])
 return <form aria-label="Parâmetros comerciais" onSubmit={async e=>{e.preventDefault();setBusy(true);onBusy(true);setError('');try{await api(`/api/atendimentos/${at}/parametros`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,...fields})});onDirty(false);await onSaved()}catch(cause){setError((cause as Error).message);if((cause as RequestFailure).status===401)onAuthRequired()}finally{setBusy(false);onBusy(false)}}}><fieldset disabled={busy}><p className="at-form-hint">Parâmetros comuns a TODOS os cenários. Ausências não são substituídas por fatores neutros.</p>{([['tableId','Tabela comercial',config.config.tables],['colorId','Cor',config.config.colors],['riskId','Risco',config.config.risks]] as const).map(([key,label,options])=><label className="at-field" key={key}>{label}<select aria-label={label} value={fields[key]??''} onChange={e=>setFields(f=>({...f,[key]:e.target.value||null}))}><option value="">Ainda não definido</option>{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}{error&&<p role="alert" className="form-error">{error}</p>}<button className="primary-btn" disabled={!dirty}>Salvar parâmetros</button></fieldset></form>
}

function ComponentForm({initial,at,workspace,pieceName,onSaved,onDirty,onBusy,onAuthRequired}:{initial?:ComponentItem;at:string;workspace:CommercialWorkspace;pieceName:(id:string)=>string;onSaved:()=>Promise<void>;onDirty:(v:boolean)=>void;onBusy:(v:boolean)=>void;onAuthRequired:()=>void}){
 const defaults={pieceId:initial?.pieceId??workspace.items[0]?.id??'',name:initial?.name??'',quantity:initial?.quantity??'1',manualPrice:initial?.manualPrice??null,fct:initial?.fct??null,notes:initial?.notes??''}
 const [fields,setFields]=useState(defaults),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const dirty=JSON.stringify(defaults)!==JSON.stringify(fields)
 useEffect(()=>{onDirty(dirty)},[dirty,onDirty]);useEffect(()=>()=>onDirty(false),[onDirty])
 return <form aria-label="Componente monetário" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);onBusy(true);setError('');try{await api(`/api/atendimentos/${at}/componentes${initial?'/'+initial.id:''}`,{method:initial?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,revision:initial?.revision,scenarioId:workspace.selectedId,scenarioRevision:workspace.scenarios.find(s=>s.id===workspace.selectedId)!.revision})});onDirty(false);await onSaved()}catch(cause){setError((cause as Error).message);if((cause as RequestFailure).status===401)onAuthRequired()}finally{setBusy(false);onBusy(false)}}}><fieldset disabled={busy}><label className="at-field">Peça física<select aria-label="Peça física" required disabled={Boolean(initial)} value={fields.pieceId} onChange={e=>setFields(f=>({...f,pieceId:e.target.value}))}>{workspace.items.map(p=><option value={p.id} key={p.id}>{pieceName(p.id)}</option>)}</select></label>
 <label className="at-field">Descrição do componente<input aria-label="Descrição do componente" required maxLength={250} value={fields.name} onChange={e=>setFields(f=>({...f,name:e.target.value}))}/></label>
 {([['quantity','Quantidade do componente'],['manualPrice','Preço manual unitário (R$)'],['fct','FCT individual']] as const).map(([key,label])=><label className="at-field" key={key}>{label}<input aria-label={label} inputMode="decimal" required={key==='quantity'} value={fields[key]??''} onChange={e=>setFields(f=>({...f,[key]:e.target.value===''&&key!=='quantity'?null:e.target.value}))}/></label>)}
 <label className="at-field">Observações do componente<textarea aria-label="Observações do componente" rows={3} maxLength={8000} value={fields.notes} onChange={e=>setFields(f=>({...f,notes:e.target.value}))}/></label><p className="at-form-hint">Preço manual zero é válido. Vazio permanece pendente. Mudanças de atributos afetam todos os cenários.</p>{error&&<p role="alert" className="form-error">{error}</p>}<button className="primary-btn">Salvar componente</button></fieldset></form>
}
