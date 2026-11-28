import { useTaskRecord } from './task-record'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AtendimentoForm } from '../AtendimentoForm'
import type { FunnelCard, SalesContext, SalesMetric, SalesStage, TrackingCard } from '../../shared/sales'
import type { Atendimento } from '../../shared/contracts'
import { workshopPhases } from '../../shared/erp'
import { api } from '../api'
import { currency } from '../finance-format'
import { money as formatMoney } from '../money'
import { WorkspaceIcon } from './Navigation'
import './sales.css'

const endpoint='/api/erp/sales'
const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
const dateLabel=(value:string|null|undefined)=>value?date.format(new Date(value)):'—'
const calendarDay=(value:string|null|undefined)=>value?.split('-').reverse().join('/')??'—'
const money=(value:string|null|undefined)=>value==null?'—':formatMoney(value)
const recordLink=(id:string,suffix='')=>'/atendimentos/'+encodeURIComponent(id)+suffix
const formData=(event:FormEvent<HTMLFormElement>)=>new FormData(event.currentTarget)
const field=(form:FormData,name:string)=>String(form.get(name)??'')
const writeJson=<T,>(path:string,body:unknown,method:'POST'|'PATCH')=>api<T>(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const message=(error:unknown)=>error instanceof Error?error.message:'O FUNIX não concluiu a operação.'

function useRead<T>(path:string|null,refresh=0) {
  const [response,setResponse]=useState<{path:string;refresh:number;data:T|null;error:string}|null>(null)
  useEffect(()=>{
    if(!path)return
    const controller=new AbortController()
    void api<T>(path,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted)setResponse({path,refresh,data,error:''})
    }).catch(error=>{
      if(!controller.signal.aborted)setResponse(previous=>({path,refresh,data:previous?.path===path?previous.data:null,error:message(error)}))
    })
    return ()=>controller.abort()
  },[path,refresh])
  const current=response?.path===path?response:null
  return {data:current?.data??null,error:current?.refresh===refresh?current.error:'',loading:path!==null&&current?.refresh!==refresh}
}
function useWrite(onSave:()=>void) {
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[failure,setFailure]=useState('')
  const save=async(path:string,body:unknown,method:'POST'|'PATCH'='POST')=>{
    setBusy(true);setStatus('');setFailure('')
    try {await writeJson(path,body,method);setStatus('Alteração salva.');onSave()}
    catch(error){setFailure(message(error))}
    finally{setBusy(false)}
  }
  return {busy,save,status,failure}
}
function ReadStatus({read}:{read:{error:string;loading:boolean}}) {
  return <>{read.error&&<p role="alert">{read.error}</p>}{read.loading&&<p role="status">Carregando…</p>}</>
}
function WriteStatus({write}:{write:{failure:string;status:string}}) {
  return <>{write.failure&&<p role="alert">{write.failure}</p>}{write.status&&<p role="status">{write.status}</p>}</>
}
function humanName(record:Atendimento) {
  return record.name||record.references?.person[0]?.text||'Cliente não identificado'
}
function recordVehicle(record:Atendimento) {
  return [record.vehicle||[record.brand,record.model].filter(Boolean).join(' '),record.plate].filter(Boolean).join(' · ')||'Veículo a identificar'
}
type RecordEditCallbacks={onDirty:(value:boolean)=>void;onBusy:(value:boolean)=>void}
type CommentEntry={id:string;source:string;kind:'comment'|'note'|'event';body:string;occurredAt:string;author:string|null;attachments:{name:string;type:string;data:string}[]}
const commentSource:Record<string,string>={commercial:'Vendas',atendimento:'Atendimento',diagnostico:'Diagnóstico',orcamento:'Orçamento',os:'OS',experiencia:'Experiência'}
function Comments({id,refresh,onSave}:{id:string;refresh:number;onSave:()=>void}) {
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID())
  const read=useRead<{items:CommentEntry[];legacyNotes:{source:string;relatedId:string;body:string}[]}>('/api/erp/experiences/diario?atendimentoId='+encodeURIComponent(id),refresh)
  const write=useWrite(()=>{setRequestId(crypto.randomUUID());onSave()})
  const entries=read.data?.items.filter(entry=>entry.kind!=='event')??[]
  return <section className="sales-comments">
    <h2>Anotações</h2>
    <form className="erp-sales-form" key={requestId} onSubmit={event=>{
      event.preventDefault();const form=formData(event)
      void write.save(endpoint+'/records/'+id+'/comment',{requestId,comment:field(form,'comment')})
    }}>
      <label className="sales-comment-field"><span className="sr-only">Anotação</span><textarea name="comment" placeholder="Adicionar anotação…" required maxLength={8000} rows={2}/></label>
      <button disabled={write.busy}>Registrar anotação</button><WriteStatus write={write}/>
    </form>
    <ReadStatus read={{...read,loading:read.loading&&!read.data}}/>
    {entries.length||read.data?.legacyNotes.length?<ol className="erp-sales-events">{entries.map(entry=><li key={entry.id}>
      <time dateTime={entry.occurredAt}>{dateLabel(entry.occurredAt)}</time><small> · {commentSource[entry.source]??entry.source}{entry.author&&entry.author!=='funix_operator'?' · '+entry.author:''}</small><p>{entry.body}</p>
      {entry.attachments.map((file,index)=><a key={index} download={file.name} href={`data:${file.type};base64,${file.data}`}>{file.name}</a>)}
    </li>)}{read.data?.legacyNotes.map((note,index)=><li key={note.relatedId+":"+index}><small>{note.source==='atendimento'?'Anotação anterior':commentSource[note.source]??note.source}</small><p>{note.body}</p></li>)}</ol>:!read.loading&&<p className="sales-comments-empty">Nenhuma anotação registrada.</p>}
  </section>
}
const stageTones:Record<string,string>={'novo-lead':'neutral','aguardando-dados':'blue','em-negociacao':'yellow','morno':'orange','frio':'blue','rejeitados':'neutral'}
const cardStage=(card:FunnelCard)=>card.lane==='triage'?'novo-lead':card.lane
function FunnelPreview({card,onClick,mobile=false,stageLabel}:{card:FunnelCard;onClick:()=>void;mobile?:boolean;stageLabel?:string}) {
  const {record,context}=card,amount=record.commercialValue
  const value=amount?(amount.min===amount.max?money(amount.min):money(amount.min)+' a '+money(amount.max)):null
  return <button className={'erp-sales-card'+(card.overdue?' erp-sales-overdue':'')+(mobile?' erp-sales-compact-card erp-phase-'+(stageTones[cardStage(card)]??'neutral'):'')} onClick={onClick}>
    {mobile?<><div className="erp-sales-card-top"><strong>{humanName(record)}</strong>{value&&<b>{value}</b>}</div>
      <span>{recordVehicle(record)}</span>
      <div className="erp-sales-card-bottom">{card.lane==='triage'?<span className="erp-sales-classification-badge">A classificar</span>:stageLabel?<span className="erp-sales-stage-badge">{stageLabel}</span>:null}
        <span className={card.overdue?'erp-sales-alert':''}>{card.nextContactAt?(card.overdue?'Retorno vencido':'Retorno')+' · '+dateLabel(card.nextContactAt):'Última atividade · '+dateLabel(card.lastActivityAt)}</span></div></>:<>
      <strong>{humanName(record)}</strong><span>{recordVehicle(record)}</span>
      {card.lane==='triage'&&<span className="erp-sales-classification-badge">A classificar</span>}
      {value&&<span>{value}</span>}
      <span>Última atividade · {dateLabel(card.lastActivityAt)}</span>
      <span>{card.overdue?'Retorno vencido':'Próximo contato'} · {dateLabel(card.nextContactAt)}</span>
      {(context.channel||context.origin)&&<span>{[context.channel,context.origin].filter(Boolean).join(' · ')}</span>}
    </>}
  </button>
}
function Funnel({openRecord}:{openRecord:(id:string)=>void}) {
  const [query,setQuery]=useState(()=>new URLSearchParams(window.location.search))
  const [refresh]=useState(0)
  const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:760px)').matches)
  useEffect(()=>{
    const media=window.matchMedia('(max-width:760px)')
    const sync=()=>setMobile(media.matches)
    media.addEventListener('change',sync);return ()=>media.removeEventListener('change',sync)
  },[])
  const apiQuery=new URLSearchParams(query)
  apiQuery.delete('stage')
  const read=useRead<{cards:FunnelCard[];stages:SalesStage[];owners:string[];channels:string[];origins:string[]}>(endpoint+'/funnel?'+apiQuery,refresh)
  const lanes=read.data?.stages??[]
  const stageFilter=query.get('stage')??''
  const auxiliary=stageFilter==='triage'||stageFilter==='non-commercial'
  const regular=(read.data?.cards??[]).filter(card=>card.lane!=='non-commercial')
  const cards=(read.data?.cards??[]).filter(card=>auxiliary?card.lane===stageFilter:
    card.lane!=='non-commercial'&&(!stageFilter||cardStage(card)===stageFilter))
  const selectStage=(stage:string)=>{
    setQuery(previous=>{const next=new URLSearchParams(previous);if(stage)next.set('stage',stage);else next.delete('stage');return next})
  }
  useEffect(()=>{window.history.replaceState(window.history.state,'',window.location.pathname+(query.size?'?'+query:''))},[query])
  const filters=<>
      <label>Vendedor<select name="owner" defaultValue={query.get('owner')??''}><option value="">Todos</option>{read.data?.owners.map(owner=><option key={owner}>{owner}</option>)}</select></label>
      <label>Canal<select name="channel" defaultValue={query.get('channel')??''}><option value="">Todos</option>{read.data?.channels?.map(channel=><option key={channel}>{channel}</option>)}</select></label>
      <label>Origem<select name="origin" defaultValue={query.get('origin')??''}><option value="">Todas</option>{read.data?.origins.map(origin=><option key={origin}>{origin}</option>)}</select></label>
      {mobile?<label>Classificação<select aria-label="Classificação do filtro" name="classification" key={stageFilter} defaultValue={auxiliary?stageFilter:''}><option value="">Todas comerciais</option><option value="triage">A classificar</option><option value="non-commercial">Não comercial</option></select></label>:
        <label>Etapa<select aria-label="Etapa" name="stage" key={lanes.length+stageFilter} defaultValue={stageFilter}><option value="">Todas</option>{lanes.map(lane=><option key={lane.id} value={lane.id}>{lane.label}</option>)}<option value="triage">A classificar</option><option value="non-commercial">Não comercial</option></select></label>}
  </>
  return <>
    <div className="erp-sales-heading"><h1>Funil de vendas</h1></div>
    <form className={'erp-sales-fields erp-sales-filters'+(mobile?' erp-sales-mobile-filters':'')} onSubmit={event=>{
      event.preventDefault()
      const next=new URLSearchParams([...formData(event)].map(([key,value])=>[key,String(value)]))
      if(mobile){const classification=next.get('classification');next.delete('classification');const stage=classification||(auxiliary?'':stageFilter);if(stage)next.set('stage',stage)}
      setQuery(next)
    }}>
      <label>Pesquisar<input name="q" type="search" maxLength={150} defaultValue={query.get('q')??''} placeholder={mobile?'Cliente, veículo ou placa':undefined}/></label>
      {mobile?<details className="erp-sales-more-filters"><summary><WorkspaceIcon name="filter"/> Filtros</summary><div>{filters}</div></details>:filters}
      <button className="erp-sales-filter-button"><WorkspaceIcon name="search" />Filtrar</button>
    </form>
    <ReadStatus read={read}/>
    {read.data&&<>
      {mobile&&<div className="erp-sales-stage-selector" role="group" aria-label="Etapas comerciais">{lanes.map(lane=><button type="button" className={'erp-phase-'+(stageTones[lane.id]??'neutral')} key={lane.id} aria-pressed={stageFilter===lane.id} onClick={()=>selectStage(stageFilter===lane.id?'':lane.id)}>
        <strong>{regular.filter(card=>cardStage(card)===lane.id).length}</strong><span>{lane.label}</span></button>)}</div>}
      {mobile?<><div className="erp-sales-mobile-list-header"><h2>{auxiliary?(stageFilter==='triage'?'A classificar':'Não comercial'):lanes.find(l=>l.id===stageFilter)?.label??'Todos os atendimentos'} <small>({cards.length})</small></h2>
        {stageFilter&&<button type="button" onClick={()=>selectStage('')}>Ver todos</button>}</div>
        <div className="erp-sales-mobile-list" aria-label="Atendimentos">{cards.map(card=><FunnelPreview key={card.record.id} card={card} mobile stageLabel={!stageFilter?lanes.find(l=>l.id===cardStage(card))?.label:undefined} onClick={()=>openRecord(card.record.id)}/>)}</div></>:
        auxiliary?<div className="erp-sales-classification-results" aria-label={stageFilter==='triage'?'Atendimentos a classificar':'Atendimentos não comerciais'}>
        {cards.map(card=><FunnelPreview key={card.record.id} card={card} onClick={()=>openRecord(card.record.id)}/>)}
      </div>:<div className="erp-sales-board">{lanes.filter(lane=>!stageFilter||stageFilter===lane.id).map(lane=>{
        const laneCards=cards.filter(card=>cardStage(card)===lane.id)
        return <section className="erp-sales-lane" key={lane.id} aria-label={lane.label}><h2>{lane.label} <small>{laneCards.length}</small></h2>
          {laneCards.map(card=><FunnelPreview key={card.record.id} card={card} onClick={()=>openRecord(card.record.id)}/>)}
        </section>
      })}</div>}
      {!cards.length&&<p>Nenhum atendimento corresponde aos filtros.</p>}
    </>}
  </>
}

function TrackingDetail({card,onSave}:{card:TrackingCard;onSave:()=>void}) {
  useTaskRecord(card.vehicle.atendimentoId)
  const write=useWrite(onSave)
  const [closureRequestId]=useState(()=>crypto.randomUUID())
  const {vehicle,receivables}=card
  const id=vehicle.atendimentoId
  return <section className="erp-sales-detail">
    <h2>{vehicle.model} · {vehicle.plate||'Placa a conferir'}</h2>
    {vehicle.requiresClassification&&<p className="erp-sales-alert">Classificação a conferir</p>}
    {vehicle.blocked&&<p className="erp-sales-alert">Impedimento registrado</p>}
    <dl className="erp-sales-info">
      <div><dt>Cliente</dt><dd>{vehicle.customer||'—'}</dd></div>
      <div><dt>Pagador</dt><dd>{vehicle.payer||'—'}</dd></div>
      <div><dt>Previsão de entrega</dt><dd>{calendarDay(vehicle.deliveryDate)}</dd></div>
      <div><dt>Último envio confirmado</dt><dd>{dateLabel(card.lastContactAt)}</dd></div>
      <div><dt>Valor aprovado</dt><dd>{money(card.approvedValue)}</dd></div>
      <div><dt>Quitado</dt><dd>{receivables?currency(receivables.settledCents):'Sem título registrado'}</dd></div>
      <div><dt>Pendente</dt><dd>{receivables?currency(receivables.outstandingCents):'Sem título registrado'}</dd></div>
    </dl>
    <div className="erp-sales-actions"><a href="/oficina/patio">Registrar saída no Pátio</a><a href={'/financeiro/contas-a-receber?experiencia='+encodeURIComponent(vehicle.experienceId)}>Contas a receber</a></div>
    <h3>Orçamentos e autorizações</h3>
    <ul>{card.budgets.map(b=><li key={b.id}><a href={recordLink(id,'?comercial=1&aba=diagnosticos&tela=orcamentos&versao='+encodeURIComponent(b.id))}>{b.documentNumber??b.label} · {money(b.total)}</a>{b.state?' · '+budgetLabels[b.state]:''}{b.workOrderNumber?' · OS '+b.workOrderNumber:''}</li>)}</ul>
    {vehicle.departedAt&&<form className="erp-sales-form" onSubmit={event=>{
      event.preventDefault()
      void write.save('/api/erp/workshop/movement',{experienceId:vehicle.experienceId,requestId:closureRequestId,revision:vehicle.revision,action:'commercial-close',operator:field(formData(event),'operator')})
    }}>
      <h3>Fechamento comercial</h3><p>Saída confirmada em {dateLabel(vehicle.departedAt)}.</p>
      <label>Responsável pelo fechamento<input name="operator" required maxLength={120}/></label>
      <button disabled={write.busy}>Registrar fechamento</button><WriteStatus write={write}/>
    </form>}
  </section>
}
const budgetLabels={negotiating:'Negociando',consented:'Consentido',authorized:'Autorizado',rejected:'Rejeitado',executed:'OS emitida',cancelled:'Cancelado'}
function Tracking({openRecord}:{openRecord:(id:string)=>void}) {
  const [query,setQuery]=useState(''),[selected,setSelected]=useState('')
  const read=useRead<{cards:TrackingCard[];owners:string[];summary:{approvedValue:string|null;outstanding:string|null;overdue:number}}>(endpoint+'/tracking?'+query)
  const cards=read.data?.cards??[]
  const phases=[...new Map(workshopPhases.map(phase=>[phase.commercial,phase.tone])).entries()]
  const owners=read.data?.owners??[]
  const preview=(card:TrackingCard)=><button className="erp-sales-card erp-sales-tracking-card" type="button" key={card.vehicle.experienceId} onClick={()=>openRecord(card.vehicle.atendimentoId)}>
    <strong>{card.vehicle.model||'Modelo a conferir'}</strong><span className="erp-sales-plate">{card.vehicle.plate||'Placa a conferir'}</span>
    {card.vehicle.customer&&<span className="erp-sales-customer">{card.vehicle.customer}</span>}
    {card.vehicle.deliveryDate&&<span className="erp-sales-delivery"><WorkspaceIcon name="calendar"/> Entrega {calendarDay(card.vehicle.deliveryDate)}</span>}
    {card.vehicle.requiresClassification&&<span className="erp-sales-alert">Classificação a conferir</span>}{card.vehicle.blocked&&<span className="erp-sales-alert">Impedimento</span>}
  </button>
  return <>
    <h1>Acompanhamento de veículos</h1>
    <form className="erp-sales-fields erp-sales-filters" onSubmit={event=>{event.preventDefault();setQuery(new URLSearchParams([...formData(event)].map(([key,value])=>[key,String(value)])).toString())}}>
      <label>Pesquisar<input name="q" type="search" placeholder="Cliente, modelo ou placa"/></label>
      <label>Vendedor<select name="owner"><option value="">Todos</option>{owners.map(owner=><option key={owner}>{owner}</option>)}</select></label>
      <button className="erp-sales-filter-button"><WorkspaceIcon name="search"/>Filtrar</button>
    </form><ReadStatus read={read}/>
    {read.data&&<>
      <dl className="erp-sales-info erp-sales-tracking-summary">
        <div><dt>Veículos</dt><dd>{cards.length}</dd></div>
        <div><dt>Aprovado</dt><dd>{money(read.data.summary?.approvedValue)}</dd></div>
        <div><dt>Retornos vencidos</dt><dd className={read.data.summary?.overdue?"erp-sales-alert":undefined}>{read.data.summary?.overdue??0}</dd></div>
        <div><dt>A receber</dt><dd>{money(read.data.summary?.outstanding)}</dd></div>
      </dl>
      <div className="erp-tracking-flow" aria-label="Fluxo de acompanhamento">{phases.map(([phase,tone])=>{
        const lane=cards.filter(card=>card.commercialPhase===phase)
        return <section key={phase} className={'erp-sales-lane erp-phase-'+tone}>
          <button type="button" className="erp-tracking-phase" aria-pressed={selected===phase} onClick={()=>setSelected(selected===phase?'':phase)}><h2>{phase}</h2><strong>{lane.length}</strong></button>
          <div className="erp-tracking-desktop-cards">{lane.map(preview)}</div>
        </section>
      })}</div>
      <div className="erp-tracking-mobile-cards"><div className="erp-sales-mobile-list-header"><h2>{selected||'Todos os veículos'}</h2>{selected&&<button onClick={()=>setSelected('')}>Ver todos</button>}</div>
        {cards.filter(card=>!selected||card.commercialPhase===selected).map(preview)}
        {!cards.filter(card=>!selected||card.commercialPhase===selected).length&&<p>Nenhum veículo nesta etapa.</p>}
      </div>
    </>}
  </>
}
function LinkedAtendimento({experienceId,onOpen}:{experienceId:string;onOpen:(id:string)=>void}) {
  const [requestId]=useState(()=>crypto.randomUUID()),[origin,setOrigin]=useState(''),[busy,setBusy]=useState(false),[failure,setFailure]=useState('')
  return <details className="erp-sales-detail"><summary>Novo atendimento vinculado</summary>
    <form className="erp-sales-form" onSubmit={async event=>{
      event.preventDefault();const form=formData(event);setBusy(true);setFailure('')
      try{const result=await writeJson<{record:{atendimentoId:string}}>('/api/erp/experiences/sequencia',{experienceId,requestId,origin,channel:field(form,'channel'),reason:field(form,'reason')|| (origin==='rework'?'Retorno para retrabalho.':'Retorno para novo serviço.')},'POST');onOpen(result.record.atendimentoId)}
      catch(error){setFailure(message(error))}finally{setBusy(false)}
    }}>
      <label>Origem<select value={origin} onChange={e=>setOrigin(e.target.value)} required><option value="">Selecione</option><option value="recurrence">Recorrência · novo serviço</option><option value="rework">Retrabalho · correção anterior</option></select></label>
      <label>Canal de aquisição<select name="channel" defaultValue="Balcão">{['Balcão','WhatsApp','Seguradora'].map(c=><option key={c}>{c}</option>)}</select></label>
      <label>Observações<textarea name="reason" maxLength={8000}/></label>
      {origin==='rework'&&<p>Revise o escopo de garantia ao elaborar o orçamento; use serviços sem cobrança para correção coberta.</p>}
      <button disabled={busy||!origin}>Criar atendimento vinculado</button>{failure&&<p role="alert">{failure}</p>}
    </form></details>
}
function LinkExistingAtendimento({record,onSave}:{record:Atendimento;onSave:()=>void}) {
  const read=useRead<{items:{id:string;customer:string;vehicle:string;createdAt:string}[]}>('/api/erp/experiences/sequencia/candidatos?atendimentoId='+encodeURIComponent(record.id),record.revision)
  const write=useWrite(onSave)
  if(!read.data?.items.length)return null
  return <details className="erp-sales-detail"><summary>Vincular a uma experiência anterior</summary>
    <ReadStatus read={read}/>{read.data?.items.length?<form className="erp-sales-form" onSubmit={event=>{event.preventDefault();const form=formData(event);void write.save('/api/erp/experiences/sequencia/vincular',{atendimentoId:record.id,experienceId:field(form,'experienceId'),origin:field(form,'origin')})}}>
      <label>Experiência anterior<select name="experienceId" required><option value="">Selecione</option>{read.data.items.map(item=><option key={item.id} value={item.id}>{item.vehicle} · {item.customer} · {dateLabel(item.createdAt)}</option>)}</select></label>
      <label>Origem<select name="origin" required><option value="">Selecione</option><option value="recurrence">Recorrência</option><option value="rework">Retrabalho</option></select></label>
      <button disabled={write.busy}>Vincular origem</button><WriteStatus write={write}/>
    </form>:read.data?<p>Nenhuma experiência anterior localizada para a placa deste veículo.</p>:null}
  </details>
}
export function SalesRecord({id,scrollNotes,onDirty,onBusy,onOpen,onAutoSaved,onMessage,onAuthRequired}:{id:string;scrollNotes?:boolean;onOpen:(id:string)=>void;onAutoSaved:(record:Atendimento,contactsChanged:boolean)=>void;onMessage:(conversationId:string)=>void;onAuthRequired:()=>void}&RecordEditCallbacks) {
  const [refresh,setRefresh]=useState(0)
  const [editing,setEditing]=useState(false),[saving,setSaving]=useState(false)
  const read=useRead<{record:Atendimento;context:SalesContext;stages:SalesStage[];experienceId:string|null;tracking:TrackingCard|null}>(endpoint+'/records/'+id+'/summary',refresh)
  const data=read.data, invalidate=()=>setRefresh(count=>count+1)
  useEffect(()=>{if(scrollNotes&&data)document.querySelector('.sales-comments')?.scrollIntoView({block:'start'})},[scrollNotes,Boolean(data)])
  useTaskRecord(id)
  const editDirty=useCallback((value:boolean)=>{setEditing(value);onDirty(value)},[onDirty])
  const editBusy=useCallback((value:boolean)=>{setSaving(value);onBusy(value)},[onBusy])
  return <main className="erp-sales sales-record"><ReadStatus read={{...read,loading:read.loading&&!data}}/>{data&&<>
    <div className="sales-record-heading">
      <div><h1>Dados do Atendimento</h1>{data.record.origin==='rework'&&<span className="erp-sales-alert">Retrabalho</span>}{data.record.origin==='recurrence'&&<span className="sales-origin-tag">Recorrência</span>}</div>
    </div>
    <AtendimentoForm key={id} record={data.record} inline={{context:data.context,stages:data.stages,scheduled:!!data.experienceId}} onSaved={record=>{onAutoSaved(record,false);invalidate()}}
      onAutoSaved={(record,contactsChanged)=>{onAutoSaved(record,contactsChanged);invalidate()}}
      onDirty={editDirty} onBusy={editBusy} onMessage={onMessage} onAuthRequired={onAuthRequired}/>
    <div className="sales-record-secondary" inert={editing||saving}>
      {data.tracking&&<details className="erp-sales-detail"><summary>Acompanhamento · {data.tracking.commercialPhase}</summary><TrackingDetail card={data.tracking} onSave={invalidate}/></details>}
      {!data.experienceId&&!data.record.closedAt&&data.record.purpose!=='non_commercial'&&data.record.origin!=='rework'&&data.record.origin!=='recurrence'&&<LinkExistingAtendimento record={data.record} onSave={invalidate}/>}
      {data.experienceId&&<LinkedAtendimento experienceId={data.experienceId} onOpen={onOpen}/>}
    </div>
    <Comments id={id} refresh={refresh} onSave={invalidate}/>
  </>}</main>
}

type DailySale={day:string;amount:string;vehicles:number}
type DashboardData={from:string;to:string;today:string;goal:string|null;owners:string[];metrics:SalesMetric[];priorities:{label:string;records:string[]}[];daily:DailySale[];approvedTotal:string}
function SalesChart({daily,from,to}:{daily:DailySale[];from:string;to:string}) {
  const values=new Map(daily.map(item=>[item.day,item]))
  const count=Math.floor((Date.parse(to)-Date.parse(from))/86400000)+1
  const days=count<=93?Array.from({length:count},(_,i)=>{const day=new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10);return values.get(day)??{day,amount:'0',vehicles:0}}):daily
  const amountMax=Math.max(1,...days.map(x=>Number(x.amount))),vehicleMax=Math.max(1,...days.map(x=>x.vehicles))
  const width=Math.max(320,days.length*25+92),left=54,right=width-33,top=17,bottom=169,step=(right-left)/Math.max(1,days.length)
  const x=(i:number)=>left+step*(i+.5), yMoney=(value:number)=>bottom-value/amountMax*(bottom-top),yCount=(value:number)=>bottom-value/vehicleMax*(bottom-top)
  const moneyTick=new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1})
  return <section className="sales-chart"><h2>Vendas por dia</h2><div className="sales-chart-scroll">
    <svg viewBox={'0 0 '+width+' 197'} role="img" aria-label="Gráfico de valor aprovado em reais e quantidade de novas experiências vendidas por dia" style={{minWidth:Math.min(width,2600)}}>
      {[0,1,2,3,4].map(i=>{const y=bottom-i*(bottom-top)/4;return <g key={i}><line x1={left} x2={right} y1={y} y2={y} stroke="#dbe4ed"/><text x={left-4} y={y+3} textAnchor="end" fill="#244b79" fontSize="10">{moneyTick.format(amountMax*i/4)}</text>{i%2===0&&<text x={right+5} y={y+3} fill="#c46b17" fontSize="10">{Number((vehicleMax*i/4).toFixed(1))}</text>}</g>})}
      {days.map((item,i)=><g key={item.day}><rect x={x(i)-Math.min(step*.68,31)/2} y={yMoney(Number(item.amount))} width={Math.min(step*.68,31)} height={bottom-yMoney(Number(item.amount))} rx="2" fill="#244b79"><title>{calendarDay(item.day)} · {money(item.amount)}</title></rect>{(i%Math.max(1,Math.ceil(days.length/12))===0||i===days.length-1)&&<text x={x(i)} y={bottom+16} fontSize="9" textAnchor="middle" fill="#536b88">{item.day.slice(8,10)}/{item.day.slice(5,7)}</text>}</g>)}
      <polyline fill="none" stroke="#e88128" strokeWidth="2.2" points={days.map((item,i)=>x(i)+','+yCount(item.vehicles)).join(' ')}/>
      {days.map((item,i)=><circle key={item.day} cx={x(i)} cy={yCount(item.vehicles)} r="2.8" fill="#e88128"><title>{calendarDay(item.day)} · {item.vehicles} experiências</title></circle>)}
    </svg>
  </div><div className="sales-chart-legend"><span><i/>Valor aprovado (R$)</span><span><i/>Experiências vendidas</span></div>
  {count>93&&<small>Período extenso: exibindo os dias com atividade.</small>}
  </section>
}
function Dashboard() {
  const [query,setQuery]=useState(''),[owner,setOwner]=useState('')
  const read=useRead<DashboardData>(endpoint+'/dashboard?'+query)
  const data=read.data
  const progress=data?.goal&&Number(data.goal)>0?100*Number(data.approvedTotal)/Number(data.goal):null
  return <>
    <h1>Desempenho</h1><ReadStatus read={read}/>
    {data&&<>
      <form className="erp-sales-fields erp-sales-filters" key={data.from+'-'+data.to+'-'+owner} onSubmit={event=>{
        event.preventDefault();const form=formData(event);setOwner(field(form,'owner'));setQuery(new URLSearchParams([...form].map(([key,value])=>[key,String(value)])).toString())
      }}>
        <label>Início<input name="from" type="date" defaultValue={data.from} required/></label>
        <label>Fim<input name="to" type="date" defaultValue={data.to} required/></label>
        <label>Vendedor<select name="owner" defaultValue={owner}><option value="">Todos</option>{data.owners.map(o=><option key={o}>{o}</option>)}</select></label>
        <button className="erp-sales-filter-button">Aplicar</button>
      </form>
      <section className="sales-goal"><h2>Meta do período</h2><div><strong>{money(data.approvedTotal)}</strong><span>{progress===null?'Sem meta definida':progress.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</span></div>{progress!==null&&<><progress max="100" value={Math.min(progress,100)}/><small>Meta: {money(data.goal)}</small></>}</section>
      <div className="erp-sales-metrics erp-sales-dashboard-cards">{data.metrics.map(metric=><section key={metric.label} title={metric.definition}><h2>{metric.label}</h2><strong>{metric.value}</strong></section>)}</div>
      <SalesChart daily={data.daily??[]} from={data.from} to={data.to}/>
      <h2>Prioridades do dia</h2>
      <div className="erp-sales-metrics erp-sales-dashboard-cards">{data.priorities.map((priority,i)=><section key={priority.label}><h3>{priority.label}</h3><strong>{priority.records.length}</strong><a href={i<2?'/vendas/funil':'/vendas/acompanhamento'}>Consultar</a></section>)}</div>
    </>}
  </>
}
function GoalSettings(){
  const [query,setQuery]=useState(''),[refresh,setRefresh]=useState(0),[owner,setOwner]=useState('')
  const read=useRead<DashboardData>(endpoint+'/dashboard?'+query,refresh),write=useWrite(()=>setRefresh(n=>n+1))
  const data=read.data
  return <section className="erp-sales-detail"><h2>Metas comerciais</h2><ReadStatus read={read}/>
    {data&&<form className="erp-sales-fields" key={data.from+'-'+data.to+'-'+owner+'-'+refresh} onSubmit={event=>{
      event.preventDefault();const form=formData(event),from=field(form,'from'),to=field(form,'to'),selected=field(form,'owner');setOwner(selected);setQuery(new URLSearchParams({from,to,owner:selected}).toString());void write.save(endpoint+'/goals',{from,to,owner:selected,amount:field(form,'amount')})
    }}>
      <label>Início<input name="from" type="date" defaultValue={data.from} required/></label><label>Fim<input name="to" type="date" defaultValue={data.to} required/></label>
      <label>Vendedor<select name="owner" defaultValue={owner}><option value="">Todos</option>{data.owners.map(o=><option key={o}>{o}</option>)}</select></label>
      <label>Meta em reais<input name="amount" inputMode="decimal" defaultValue={data.goal??''} required maxLength={16}/></label><button disabled={write.busy}>Salvar meta</button>
      <WriteStatus write={write}/>
    </form>}
  </section>
}
export function SalesSettings() {
  const [refresh,setRefresh]=useState(0)
  const read=useRead<{stages:SalesStage[]}>(endpoint+'/stages',refresh)
  const write=useWrite(()=>setRefresh(count=>count+1))
  return <section className="erp-sales">
    <GoalSettings/><h2>Etapas do Funil</h2>
    <p>As cadências usam minutos corridos. O retorno programado prevalece.</p><ReadStatus read={read}/><WriteStatus write={write}/>
    {read.data?.stages.map(stage=><form className="erp-sales-fields" key={stage.id} onSubmit={event=>{
      event.preventDefault()
      const form=formData(event)
      void write.save(endpoint+'/stages',{id:stage.id,label:field(form,'label'),minutes:stage.minutes===null?null:Number(field(form,'minutes'))})
    }}>
      <label>Nome da etapa<input name="label" defaultValue={stage.label} required maxLength={80}/></label>
      {stage.minutes!==null&&<label>Cadência em minutos<input name="minutes" type="number" min="1" max="527040" defaultValue={stage.minutes} required/></label>}
      <button disabled={write.busy}>Salvar etapa</button>
    </form>)}
  </section>
}
export default function Sales({view,openRecord}:{view:string;openRecord:(id:string)=>void}) {
  const views:Record<string,ReactNode>={funil:<Funnel openRecord={openRecord}/>,acompanhamento:<Tracking openRecord={openRecord}/>,desempenho:<Dashboard/>}
  return <main className="erp-sales">{views[view]??<p>Visão de Vendas indisponível.</p>}</main>
}
