import { useTaskRecord } from './task-record'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { salesChannels } from '../../shared/sales'
import type { FunnelCard, SalesActivity, SalesContext, SalesMetric, SalesStage, TrackingCard } from '../../shared/sales'
import { ATENDIMENTO_PURPOSES } from '../../shared/contracts'
import type { Atendimento, AtendimentoPurpose } from '../../shared/contracts'
import { workshopPhases } from '../../shared/erp'
import { api } from '../api'
import { currency } from '../finance-format'
import { money as formatMoney } from '../money'
import { WorkspaceIcon } from './Navigation'
import './sales.css'

const endpoint='/api/erp/sales'
const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
const decimalDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
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
function ContextEditor({id,context,onSave}:{id:string;context:SalesContext;onSave:()=>void}) {
  const write=useWrite(onSave)
  const channels = [...new Set([...salesChannels, context.channel])].filter(Boolean)
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    const form=formData(event),returned=field(form,'nextContactAt')
    void write.save(endpoint+'/records/'+id+'/context',{
      revision:context.revision,owner:field(form,'owner'),channel:field(form,'channel'),
      nextContactAt:returned?new Date(returned+'-03:00').toISOString():null,
      nextAction:field(form,'nextAction'),additionalService:field(form,'additionalService'),
    })
  }
  return <form className="erp-sales-form" onSubmit={submit}>
    <h3>Responsável e próximo contato</h3>
    <div className="erp-sales-fields">
      <label>Responsável<input name="owner" defaultValue={context.owner} maxLength={100}/></label>
      <label>Canal de aquisição<select aria-label="Canal de aquisição" name="channel" defaultValue={context.channel}><option value="">A definir</option>{channels.map(channel=><option key={channel}>{channel}</option>)}</select></label>
      {context.origin&&<p>Origem · {context.origin}</p>}
      <label>Retorno (horário de São Paulo)<input type="datetime-local" name="nextContactAt" defaultValue={context.nextContactAt?decimalDay.format(new Date(context.nextContactAt)).replace(' ','T'):''}/></label>
      <label>Próxima ação<input name="nextAction" defaultValue={context.nextAction} maxLength={500}/></label>
      <label>Serviço adicional identificado<input name="additionalService" defaultValue={context.additionalService} maxLength={1000}/></label>
    </div>
    <button disabled={write.busy}>Salvar acompanhamento</button><WriteStatus write={write}/>
  </form>
}
function Activity({id,refresh,onSave}:{id:string;refresh:number;onSave:()=>void}) {
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID())
  const activity=useRead<{entries:SalesActivity[]}>(endpoint+'/records/'+id+'/activity',refresh)
  const write=useWrite(()=>{setRequestId(crypto.randomUUID());onSave()})
  return <>
    <form className="erp-sales-form" key={requestId} onSubmit={event=>{
      event.preventDefault()
      const form=formData(event)
      void write.save(endpoint+'/records/'+id+'/comment',{requestId,author:field(form,'author'),comment:field(form,'comment')})
    }}>
      <h3>Comentário comercial</h3>
      <label>Nome do autor<input name="author" required maxLength={120}/></label>
      <label>Comentário<textarea name="comment" required maxLength={8000}/></label>
      <button disabled={write.busy}>Registrar comentário</button><WriteStatus write={write}/>
    </form>
    <h3>Atividade comercial recente</h3><ReadStatus read={activity}/>
    {activity.data?.entries.length?<ol className="erp-sales-events">{activity.data.entries.map(event=><li key={event.id}>
      <time dateTime={event.occurredAt}>{dateLabel(event.occurredAt)}</time>{event.author?' · '+event.author:''}<p>{event.content}</p>
    </li>)}</ol>:!activity.loading&&<p>Sem atividade registrada.</p>}
  </>
}
function RecordActions({id}:{id:string}) {
  return <div className="erp-sales-actions">
    <a href={recordLink(id)}>Abrir atendimento</a>
    <a href={recordLink(id,'?aba=chat')}>Conversar pelo WhatsApp</a>
    <a href={recordLink(id,'?aba=diagnosticos&tela=orcamentos')}>Orçamentos</a>
    <a href={recordLink(id,'?aba=diagnosticos&tela=experiencia')}>Agendamento e OS</a>
  </div>
}
function StageEditor({record,stages,onSave}:{record:Atendimento;stages:SalesStage[];onSave:()=>void}) {
  const [stage,setStage]=useState(record.stage),write=useWrite(onSave)
  if(record.purpose==='non_commercial'||record.purpose==='unclassified')return null
  return <form className="erp-sales-form" onSubmit={event=>{
    event.preventDefault()
    void write.save(endpoint+'/records/'+record.id+'/stage',{stage,reason:field(formData(event),'reason'),revision:record.revision})
  }}>
    <label>Etapa comercial<select aria-label="Etapa comercial" value={stage} onChange={event=>setStage(event.target.value as Atendimento['stage'])}>{stages.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    {stage==='rejeitados'&&<label>Motivo da recusa confirmada<input name="reason" required maxLength={2000}/></label>}
    <button disabled={write.busy||stage===record.stage}>Alterar etapa</button><WriteStatus write={write}/>
  </form>
}
function PurposeEditor({record,onClassified}:{record:Atendimento;onClassified:(purpose:AtendimentoPurpose)=>void}) {
  const current=record.purpose??'commercial'
  const [purpose,setPurpose]=useState<AtendimentoPurpose>(current)
  const write=useWrite(()=>onClassified(purpose))
  return <form className="erp-sales-form erp-sales-classification" onSubmit={event=>{
    event.preventDefault()
    if(write.busy||purpose===current)return
    void write.save('/api/atendimentos/'+encodeURIComponent(record.id),{
      purpose,revision:record.revision,
      ...(purpose!=='commercial'?{stage:'novo-lead',explicitRefusal:false,rejectionReason:''}:{})
    },'PATCH')
  }}>
    <label>Classificação<select aria-label="Classificação" value={purpose} disabled={write.busy} onChange={event=>setPurpose(event.target.value as AtendimentoPurpose)}>
      {Object.entries(ATENDIMENTO_PURPOSES).map(([id,label])=><option key={id} value={id}>{label}</option>)}
    </select></label>
    {purpose!==current&&purpose!=='commercial'&&record.stage!=='novo-lead'&&<p>A etapa comercial voltará ao início.</p>}
    <button className="erp-sales-filter-button" disabled={write.busy||purpose===current}>{write.busy?'Salvando…':'Salvar classificação'}</button><WriteStatus write={write}/>
  </form>
}
function FunnelDetail({card,stages,refresh,onSave,onClassified}:{card:FunnelCard;stages:SalesStage[];refresh:number;onSave:()=>void;onClassified:(purpose:AtendimentoPurpose)=>void}) {
  const {record,context}=card
  return <section className="erp-sales-detail">
    <h2>{humanName(record)}</h2><p>{recordVehicle(record)}</p>
    <PurposeEditor key={record.revision} record={record} onClassified={onClassified}/>
    <RecordActions id={record.id}/>
    <StageEditor key={record.revision} record={record} stages={stages} onSave={onSave}/>
    <ContextEditor key={context.revision} id={record.id} context={context} onSave={onSave}/>
    <Activity id={record.id} refresh={refresh} onSave={onSave}/>
  </section>
}
function FunnelPreview({card,onClick}:{card:FunnelCard;onClick:()=>void}) {
  const {record,context}=card,amount=record.commercialValue
  return <button className={'erp-sales-card'+(card.overdue?' erp-sales-overdue':'')} onClick={onClick}>
    <strong>{humanName(record)}</strong><span>{recordVehicle(record)}</span>
    {card.lane==='triage'&&<span className="erp-sales-classification-badge">A classificar</span>}
    {amount&&<span>{amount.min===amount.max?money(amount.min):money(amount.min)+' a '+money(amount.max)}</span>}
    <span>Última atividade · {dateLabel(card.lastActivityAt)}</span>
    <span>{card.overdue?'Retorno vencido':'Próximo contato'} · {dateLabel(card.nextContactAt)}</span>
    {(context.channel||context.origin)&&<span>{[context.channel,context.origin].filter(Boolean).join(' · ')}</span>}
  </button>
}
function Funnel() {
  const [query,setQuery]=useState(()=>new URLSearchParams(window.location.search))
  const [selected,setSelected]=useState<string|null>(null),[refresh,setRefresh]=useState(0)
  const [classificationNotice,setClassificationNotice]=useState('')
  const invalidate=()=>setRefresh(count=>count+1)
  const apiQuery=new URLSearchParams(query)
  apiQuery.delete('stage')
  const read=useRead<{cards:FunnelCard[];stages:SalesStage[];owners:string[];channels:string[];origins:string[]}>(endpoint+'/funnel?'+apiQuery,refresh)
  const lanes=read.data?.stages??[]
  const stageFilter=query.get('stage')??''
  const auxiliary=stageFilter==='triage'||stageFilter==='non-commercial'
  const cards=(read.data?.cards??[]).filter(card=>auxiliary?card.lane===stageFilter:
    card.lane!=='non-commercial'&&(!stageFilter||(card.lane==='triage'?'novo-lead':card.lane)===stageFilter))
  const active=cards.find(c=>c.record.id===selected)
  useTaskRecord(active?.record.id)
  return <>
    <div className="erp-sales-heading"><h1>Funil de vendas</h1></div>
    <form className="erp-sales-fields erp-sales-filters" onSubmit={event=>{event.preventDefault();setSelected(null);setClassificationNotice('');setQuery(new URLSearchParams([...formData(event)].map(([key,value])=>[key,String(value)])))}}>
      <label>Pesquisar<input name="q" type="search" maxLength={150} defaultValue={query.get('q')??''}/></label>
      <label>Vendedor<select name="owner" defaultValue={query.get('owner')??''}><option value="">Todos</option>{read.data?.owners.map(owner=><option key={owner}>{owner}</option>)}</select></label>
      <label>Canal<select name="channel" defaultValue={query.get('channel')??''}><option value="">Todos</option>{read.data?.channels?.map(channel=><option key={channel}>{channel}</option>)}</select></label>
      <label>Origem<select name="origin" defaultValue={query.get('origin')??''}><option value="">Todas</option>{read.data?.origins.map(origin=><option key={origin}>{origin}</option>)}</select></label>
      <label>Etapa<select aria-label="Etapa" name="stage" key={lanes.length} defaultValue={query.get('stage')??''}><option value="">Todas</option>{lanes.map(lane=><option key={lane.id} value={lane.id}>{lane.label}</option>)}<option value="triage">A classificar</option><option value="non-commercial">Não comercial</option></select></label>
      <button className="erp-sales-filter-button"><WorkspaceIcon name="filter" />Filtrar</button>
    </form>
    <ReadStatus read={read}/>
    {read.data&&<>
      {classificationNotice&&<p role="status" className="erp-sales-classification-notice">{classificationNotice}</p>}
      {active&&<><button type="button" onClick={()=>setSelected(null)}>Fechar detalhes</button><FunnelDetail key={active.record.id} card={active} stages={read.data.stages} refresh={refresh} onSave={invalidate} onClassified={purpose=>{
        setClassificationNotice(humanName(active.record)+' · Classificação salva: '+ATENDIMENTO_PURPOSES[purpose])
        invalidate()
      }}/></>}
      {auxiliary?<div className="erp-sales-classification-results" aria-label={stageFilter==='triage'?'Atendimentos a classificar':'Atendimentos não comerciais'}>
        {cards.map(card=><FunnelPreview key={card.record.id} card={card} onClick={()=>setSelected(card.record.id)}/>)}
      </div>:<div className="erp-sales-board">{lanes.filter(lane=>!stageFilter||stageFilter===lane.id).map(lane=>{
        const laneCards=cards.filter(card=>(card.lane==='triage'?'novo-lead':card.lane)===lane.id)
        return <section className="erp-sales-lane" key={lane.id} aria-label={lane.label}><h2>{lane.label} <small>{laneCards.length}</small></h2>
          {laneCards.map(card=><FunnelPreview key={card.record.id} card={card} onClick={()=>setSelected(card.record.id)}/>)}
        </section>
      })}</div>}
      {!cards.length&&<p>Nenhum atendimento corresponde aos filtros.</p>}
    </>}
  </>
}

function TrackingDetail({card,refresh,onSave}:{card:TrackingCard;refresh:number;onSave:()=>void}) {
  useTaskRecord(card.vehicle.atendimentoId)
  const write=useWrite(onSave)
  const [closureRequestId]=useState(()=>crypto.randomUUID())
  const {vehicle,context,receivables}=card
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
    <RecordActions id={id}/>
    <div className="erp-sales-actions"><a href="/oficina/patio">Registrar saída no Pátio</a><a href={'/financeiro/contas-a-receber?experiencia='+encodeURIComponent(vehicle.experienceId)}>Contas a receber</a></div>
    <h3>Orçamentos e autorizações</h3>
    <ul>{card.budgets.map(b=><li key={b.id}><a href={recordLink(id,'?aba=diagnosticos&tela=orcamentos&versao='+encodeURIComponent(b.id))}>{b.documentNumber??b.label} · {money(b.total)}</a>{b.state?' · '+budgetLabels[b.state]:''}{b.workOrderNumber?' · OS '+b.workOrderNumber:''}</li>)}</ul>
    {vehicle.departedAt&&<form className="erp-sales-form" onSubmit={event=>{
      event.preventDefault()
      void write.save('/api/erp/workshop/movement',{experienceId:vehicle.experienceId,requestId:closureRequestId,revision:vehicle.revision,action:'commercial-close',operator:field(formData(event),'operator')})
    }}>
      <h3>Fechamento comercial</h3><p>Saída confirmada em {dateLabel(vehicle.departedAt)}.</p>
      <label>Responsável pelo fechamento<input name="operator" required maxLength={120}/></label>
      <button disabled={write.busy}>Registrar fechamento</button><WriteStatus write={write}/>
    </form>}
    <ContextEditor key={context.revision} id={id} context={context} onSave={onSave}/>
    <Activity id={id} refresh={refresh} onSave={onSave}/>
  </section>
}
const budgetLabels={negotiating:'Negociando',consented:'Consentido',authorized:'Autorizado',rejected:'Rejeitado',executed:'OS emitida',cancelled:'Cancelado'}
function Tracking() {
  const [query,setQuery]=useState(''),[selected,setSelected]=useState<string|null>(null),[refresh,setRefresh]=useState(0)
  const read=useRead<{cards:TrackingCard[];owners:string[];summary:{approvedValue:string|null;outstanding:string|null;overdue:number}}>(endpoint+'/tracking?'+query,refresh)
  const cards=read.data?.cards??[],active=cards.find(c=>c.vehicle.experienceId===selected)
  const phases=[...new Map(workshopPhases.map(phase=>[phase.commercial,phase.tone])).entries()]
  const owners=read.data?.owners??[]
  return <>
    <h1>Acompanhamento de veículos</h1>
    <form className="erp-sales-fields erp-sales-filters" onSubmit={event=>{event.preventDefault();setQuery(new URLSearchParams([...formData(event)].map(([key,value])=>[key,String(value)])).toString())}}>
      <label>Pesquisar<input name="q" type="search" placeholder="Cliente, modelo ou placa"/></label>
      <label>Vendedor<select name="owner"><option value="">Todos</option>{owners.map(owner=><option key={owner}>{owner}</option>)}</select></label>
      <button className="erp-sales-filter-button"><WorkspaceIcon name="filter" />Filtrar</button>
    </form><ReadStatus read={read}/>
    {read.data&&<>
      <dl className="erp-sales-info erp-sales-tracking-summary">
        <div><dt>Veículos</dt><dd>{cards.length}</dd></div>
        <div><dt title="Valor aprovado em atendimento">Aprovado</dt><dd>{money(read.data.summary?.approvedValue)}</dd></div>
        <div><dt>Retornos vencidos</dt><dd className={read.data.summary?.overdue ? "erp-sales-alert" : undefined}>{read.data.summary?.overdue??0}</dd></div>
        <div><dt title="Recebíveis pendentes">A receber</dt><dd>{money(read.data.summary?.outstanding)}</dd></div>
      </dl>
      {active&&<><button type="button" onClick={()=>setSelected(null)}>Fechar detalhes</button><TrackingDetail key={active.vehicle.experienceId} card={active} refresh={refresh} onSave={()=>setRefresh(count=>count+1)}/></>}
      <div className="erp-sales-board">{phases.map(([phase,tone])=>{
        const lane=cards.filter(card=>card.commercialPhase===phase)
        return <section key={phase} className={'erp-sales-lane erp-phase-'+tone}>
          <h2>{phase} <small>{lane.length}</small></h2>
          {lane.map(card=><button className="erp-sales-card erp-sales-tracking-card" type="button" key={card.vehicle.experienceId} onClick={()=>setSelected(card.vehicle.experienceId)}>
            <strong>{card.vehicle.model||'Modelo a conferir'}</strong>
            <span className="erp-sales-plate">{card.vehicle.plate||'Placa a conferir'}</span>
            {card.vehicle.customer&&<span className="erp-sales-customer">{card.vehicle.customer}</span>}
            {card.vehicle.deliveryDate&&<span className="erp-sales-delivery"><WorkspaceIcon name="calendar" /><span>Entrega {calendarDay(card.vehicle.deliveryDate)}</span></span>}
            {card.vehicle.requiresClassification&&<span className="erp-sales-alert">Classificação a conferir</span>}
            {card.vehicle.blocked&&<span className="erp-sales-alert">Impedimento</span>}

          </button>)}
        </section>
      })}</div>
    </>}
  </>
}

function RelatedRecords({ids,definition,href,summaryLabel}:{ids:string[];definition?:string;href?:string;summaryLabel?:string}) {
  const [expanded,setExpanded]=useState(false),[offset,setOffset]=useState(0)
  const batch=ids.slice(offset,offset+50)
  const read=useRead<{records:Atendimento[]}>(expanded&&batch.length?endpoint+'/records?ids='+batch.join(','):null)
  return <details onToggle={event=>setExpanded(event.currentTarget.open)}><summary>{summaryLabel??(ids.length===1?'1 registro':ids.length+' registros')}</summary>
    {definition&&<p>{definition}</p>}
    {href&&<a href={href}>Abrir Funil</a>}
    <ReadStatus read={read}/>
    <ul>{read.data?.records.map(record=><li key={record.id}><a href={recordLink(record.id)}>{humanName(record)} · {recordVehicle(record)}</a></li>)}</ul>
    {ids.length>50&&<div className="erp-sales-actions"><button disabled={offset===0} onClick={()=>setOffset(value=>value-50)}>Anteriores</button>
      <button disabled={offset+50>=ids.length} onClick={()=>setOffset(value=>value+50)}>Próximos</button></div>}
  </details>
}
function Dashboard() {
  const [query,setQuery]=useState(''),[owner,setOwner]=useState(''),[refresh,setRefresh]=useState(0)
  const read=useRead<{from:string;to:string;today:string;goal:string|null;owners:string[];metrics:SalesMetric[];priorities:{label:string;records:string[]}[]}>(endpoint+'/dashboard?'+query,refresh)
  const write=useWrite(()=>setRefresh(count=>count+1))
  const data=read.data
  return <>
    <h1>Desempenho</h1><ReadStatus read={read}/>
    {data&&<>
      <form className="erp-sales-fields erp-sales-filters" key={data.from+'-'+data.to+'-'+owner} onSubmit={event=>{
        event.preventDefault()
        const form=formData(event)
        setOwner(field(form,'owner'))
        setQuery(new URLSearchParams([...form].map(([key,value])=>[key,String(value)])).toString())
      }}>
        <label>Início<input name="from" type="date" defaultValue={data.from} required/></label>
        <label>Fim<input name="to" type="date" defaultValue={data.to} required/></label>
        <label>Vendedor<select name="owner" defaultValue={owner}><option value="">Todos</option>{data.owners.map(o=><option key={o}>{o}</option>)}</select></label>
        <button className="erp-sales-filter-button">Aplicar</button>
      </form>
      <details className="erp-sales-priorities"><summary>Meta do período · {data.goal===null?'Sem meta cadastrada':money(data.goal)}</summary>
        <form className="erp-sales-form" onSubmit={event=>{
          event.preventDefault()
          void write.save(endpoint+'/goals',{from:data.from,to:data.to,owner,amount:field(formData(event),'amount')})
        }}>
          <label>Meta em reais<input name="amount" inputMode="decimal" required maxLength={16}/></label>
          <button disabled={write.busy}>Salvar meta</button><WriteStatus write={write}/>
        </form>
      </details>
      <div className="erp-sales-metrics erp-sales-dashboard-cards">{data.metrics.map(metric=><section key={metric.label}><h2>{metric.label}</h2><strong>{metric.value}</strong>
        <RelatedRecords key={query} ids={metric.records} definition={metric.definition} href={metric.href}/>
      </section>)}</div>
      <h2>Prioridades do dia</h2>
      <div className="erp-sales-metrics erp-sales-dashboard-cards">{data.priorities.map(priority=><section key={priority.label}><h3>{priority.label}</h3><strong>{priority.records.length}</strong><RelatedRecords key={query} ids={priority.records} summaryLabel="Ver registros"/></section>)}</div>
    </>}
  </>
}
export function SalesSettings() {
  const [refresh,setRefresh]=useState(0)
  const read=useRead<{stages:SalesStage[]}>(endpoint+'/stages',refresh)
  const write=useWrite(()=>setRefresh(count=>count+1))
  return <section className="erp-sales">
    <h2>Etapas do Funil</h2>
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
export default function Sales({view}:{view:string}) {
  const views:Record<string,ReactNode>={funil:<Funnel/>,acompanhamento:<Tracking/>,desempenho:<Dashboard/>}
  return <main className="erp-sales">{views[view]??<p>Visão de Vendas indisponível.</p>}</main>
}
