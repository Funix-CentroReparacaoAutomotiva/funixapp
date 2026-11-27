import { useTaskRecord } from './task-record'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { workshopPhases } from '../../shared/erp'
import { displayDay, phaseDetails, workshopApi, type PhasePresentation, type YardVehicle } from './workshop-client'

type Day = {day:string; weekend:boolean; holiday:boolean}
type Source = {id:string; experienceId:string; name:string; piece:string; stageId:string; stageName:string; phase:string|null; energy:string|null}
type Resource = {id:string; name:string; dailyEnergy:string; exclusive:boolean}
type Segment = {sourceId:string; experienceId:string; name:string; resourceId:string; phase:string; start:string; end:string;
  actualStart:string|null; actualEnd:string|null; energy:string; priority:number; predecessor:string|null; revision:number; sourceChanged:boolean}
type CapacityDay = Day & {planned:string; capacity:string; percent:string|null; overloaded:boolean; phases:{phase:string;energy:string}[]}
type Schedule = {
  today:string; days:Day[]; phases:PhasePresentation[]; vehicles:YardVehicle[]; resources:Resource[]; plans:Segment[]; sources:Source[];
  scheduledIds:string[]; holidays:string[]; dependencies:Pick<Segment,'sourceId'|'experienceId'|'end'|'phase'|'name'>[]; capacity:(Resource & {days:CapacityDay[]})[]
}
type PlanEditor = {source:Source; segment?:Segment; targetDay?:string}
type PlanEvent = {sequence:number; recordedAt:string; action:string; snapshot:string}
const dateRange = (start:string,end:string) => displayDay(start) + ' a ' + displayDay(end)
const todayInSaoPaulo = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const monday = (day:string) => moveDay(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7))
const weekday = (day:string) => new Intl.DateTimeFormat('pt-BR',{weekday:'short',timeZone:'UTC'}).format(new Date(day+'T00:00:00Z')).replace('.','')
const monthDay = (day:string) => new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(day+'T00:00:00Z')).replace(' de ',' ').replace('.','')
const loadTone = (day:CapacityDay) => day.percent===null?'empty':day.overloaded?'over':Number(day.percent)>80?'near':'ok'
const moveDay = (day:string, amount:number) => new Date(Date.parse(day+'T00:00:00Z') + amount*86400000).toISOString().slice(0,10)
const span = (days: Day[], start: string, end: string) => {
  const first = days.findIndex(item => item.day >= start)
  const last = days.findLastIndex(item => item.day <= end)
  return first >= 0 && last >= first ? `${first+2} / ${last+3}` : undefined
}

function SegmentEditor({editor, schedule, save, close}: {
  editor:PlanEditor; schedule:Schedule; save:(path:string,body:unknown)=>Promise<boolean>; close:()=>void
}) {
  const {source,segment,targetDay} = editor
  const [history,setHistory] = useState<PlanEvent[]>([])
  const [error,setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(),[])
  const start = targetDay ?? segment?.start ?? schedule.days.find(item => !item.weekend && !item.holiday)?.day
  const end = targetDay && segment ? moveDay(targetDay,Math.round((Date.parse(segment.end)-Date.parse(segment.start))/86400000)) : segment?.end ?? start
  useEffect(() => {
    if (!segment) return
    const controller = new AbortController()
    void workshopApi<{events:PlanEvent[]}>('/planning/history?sourceId='+encodeURIComponent(segment.sourceId),undefined,controller.signal)
      .then(result => setHistory(result.events)).catch(error => {if (!controller.signal.aborted) setError(error.message)})
    return () => controller.abort()
  },[segment])
  async function submit(event:FormEvent<HTMLFormElement>, actual:boolean) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const payload = actual
      ? {action:'actual',actualStart:data.get('actualStart'),actualEnd:data.get('actualEnd') || null}
      : {start:data.get('start'),end:data.get('end'),resourceId:data.get('resourceId'),
        priority:Number(data.get('priority')),predecessor:data.get('predecessor') || null}
    if (await save('/planning/segment',{...payload,sourceId:source.id,revision:segment?.revision ?? 0})) close()
  }
  return <section className="workshop-detail">
    <header><h2 ref={heading} tabIndex={-1}>{source.piece ? source.piece+' · ' : ''}{source.name}</h2>
      <button type="button" onClick={close}>Fechar detalhes</button></header>
    <p>{source.stageName} · {phaseDetails(source.phase ?? '')?.label ?? 'Fase a configurar'} · Energia {source.energy ?? 'a confirmar'}</p>
    {segment?.sourceChanged && <p role="status">A autorização ou a configuração de fase mudou após a programação. Confira a origem antes de reprogramar.</p>}
    {source.energy !== null && source.phase && schedule.resources.length > 0 && <form onSubmit={event => void submit(event,false)}>
      <label>Início<input name="start" type="date" defaultValue={start} required/></label>
      <label>Término<input name="end" type="date" defaultValue={end} required/></label>
      <label>Recurso<select name="resourceId" defaultValue={segment?.resourceId} required>
        {schedule.resources.map(resource => <option value={resource.id} key={resource.id}>{resource.name}</option>)}</select></label>
      <label>Ordem de prioridade<input name="priority" type="number" min={0} max={9999} defaultValue={segment?.priority ?? 100} required/></label>
      <label>Etapa predecessora<select name="predecessor" defaultValue={segment?.predecessor ?? ''}>
        <option value="">Sem dependência</option>
        {schedule.dependencies.filter(plan => plan.experienceId === source.experienceId && plan.sourceId !== source.id)
          .map(plan => <option key={plan.sourceId} value={plan.sourceId}>{plan.name} · {phaseDetails(plan.phase)?.label} · {displayDay(plan.end)}</option>)}
      </select></label>
      <button>Salvar programação</button>
    </form>}
    {segment && <>
      <form onSubmit={event => void submit(event,true)}>
        <label>Início realizado<input type="date" name="actualStart" defaultValue={segment.actualStart ?? ''} max={schedule.today} required/></label>
        <label>Término realizado<input type="date" name="actualEnd" defaultValue={segment.actualEnd ?? ''} max={schedule.today}/></label>
        <button>Salvar realizado</button>
      </form>
      <details><summary>Histórico da programação ({history.length})</summary>
        {error && <p role="alert">{error}</p>}
        <ul>{history.map(event => {
          const item = JSON.parse(event.snapshot) as Segment
          const actual = event.action === 'actual'
          return <li key={event.sequence}>{displayDay(event.recordedAt)} · {actual ? 'Realizado' : 'Programação'} · {
            actual && item.actualStart ? item.actualEnd ? dateRange(item.actualStart,item.actualEnd) : displayDay(item.actualStart) : dateRange(item.start,item.end)}</li>
        })}</ul>
      </details>
    </>}
  </section>
}
type Save = (path:string,body:unknown)=>Promise<boolean>
function PlanningSetup({schedule,save}:{schedule:Schedule; save:Save}) {
  const [resourceId,setResourceId] = useState('')
  const resource = schedule.resources.find(item => item.id === resourceId)
  const stages = [...new Map(schedule.sources.filter(item => item.stageId).map(item => [item.stageId,item])).values()]
  const [stageId,setStageId] = useState('')
  const stage = stages.find(item => item.stageId === stageId)
  return <details className="workshop-detail">
    <summary>Configurar capacidade, fases e calendário</summary>
    <form onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void save('/planning/setup',{action:'resource',id:resourceId||crypto.randomUUID(),
        name:data.get('name'),dailyEnergy:String(data.get('energy')).replace(',','.'),exclusive:data.has('exclusive')})
    }} key={resourceId}>
      <label>Recurso<select value={resourceId} onChange={event => setResourceId(event.target.value)}>
        <option value="">Novo recurso</option>{schedule.resources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Nome<input name="name" defaultValue={resource?.name} maxLength={120} required/></label>
      <label>Energia diária<input name="energy" inputMode="decimal" defaultValue={resource?.dailyEnergy} required/></label>
      <label className="workshop-check"><input type="checkbox" name="exclusive" defaultChecked={resource?.exclusive}/> Uso exclusivo</label>
      <button>Salvar recurso</button>
    </form>
    <form onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void save('/planning/setup',{action:'holiday',day:data.get('day'),name:data.get('name')})
    }}>
      <label>Feriado<input name="day" type="date" required/></label>
      <label>Motivo<input name="name" maxLength={120} required/></label>
      <button>Bloquear dia</button>
    </form>
    {schedule.holidays.length > 0 && <ul>{schedule.holidays.map(day => <li key={day}>
      {displayDay(day)} <button type="button" onClick={() => void save('/planning/setup',{action:'remove-holiday',day})}>Reabrir dia</button>
    </li>)}</ul>}
    <form onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void save('/planning/setup',{action:'mapping',stageId,phase:data.get('phase')})
    }}>
      <label>Etapa técnica autorizada<select value={stageId} onChange={event => setStageId(event.target.value)} required>
        <option value="">Selecione</option>{stages.map(item => <option key={item.stageId} value={item.stageId}>{item.stageName} ({item.stageId})</option>)}
      </select></label>
      <label>Fase no Pátio<select key={stageId} name="phase" defaultValue={stage?.phase ?? ''} required>
        <option value="">Selecione</option>{workshopPhases.filter(item => !['scheduled','departed'].includes(item.id))
          .map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <button>Salvar correspondência</button>
    </form>
  </details>
}

export default function WorkshopPlanning() {
  const [schedule,setSchedule] = useState<Schedule|null>(null)
  const [start,setStart] = useState(()=>monday(todayInSaoPaulo()))
  const [length,setLength] = useState('7')
  const [version,setVersion] = useState(0)
  const [error,setError] = useState('')
  const [feedback,setFeedback] = useState('')
  const [busy,setBusy] = useState(false)
  const [compact,setCompact] = useState(true)
  const [editor,setEditor] = useState<PlanEditor|null>(null)
  const [selectedCapacity,setSelectedCapacity] = useState<{name:string;day:CapacityDay}|null>(null)
  useTaskRecord(schedule?.vehicles.find(vehicle => vehicle.experienceId === editor?.source.experienceId)?.atendimentoId)
  useEffect(() => {
    const controller = new AbortController()
    void workshopApi<Schedule>('/planning?' + new URLSearchParams({days:length,...(start ? {start} : {})}),undefined,controller.signal)
      .then(setSchedule).catch(error => {if (!controller.signal.aborted) setError(error.message)})
    return () => controller.abort()
  },[start,length,version])
  async function save(path:string,body:unknown) {
    if (busy) return false
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      await workshopApi(path,body)
      setVersion(current => current + 1)
      setFeedback('Alteração registrada.')
      return true
    } catch(error) {
      setError((error as Error).message)
      return false
    } finally {setBusy(false)}
  }
  function open(segment:Segment,targetDay?:string) {
    if (!schedule) return
    const source = schedule.sources.find(item => item.id === segment.sourceId) ?? {
      id:segment.sourceId, name:segment.name, phase:null, energy:null, experienceId:segment.experienceId, stageId:'', stageName:'Escopo anterior', piece:'',
    }
    setEditor({source,segment,targetDay})
  }
  const days = schedule?.days.filter(day=>!day.weekend) ?? []
  const grid = {'--workshop-days':days.length} as CSSProperties
  const dayClass = (day:Day) => day.holiday || day.weekend ? 'workshop-closed' : day.day === schedule?.today ? 'workshop-today' : ''
  return <section className="workshop workshop-planning">
    <header className="workshop-header planning-header"><h1>Planejamento da produção</h1>
      <div className="planning-controls">
        <button type="button" aria-label="Janela anterior" onClick={()=>setStart(moveDay(start,-Number(length)))}>‹</button>
        <label className="planning-range"><span>Início da janela</span><input type="date" value={start} onChange={event=>{if(event.target.value)setStart(event.target.value)}}/></label>
        <button type="button" aria-label="Próxima janela" onClick={()=>setStart(moveDay(start,Number(length)))}>›</button>
        <button type="button" onClick={()=>setStart(monday(todayInSaoPaulo()))}>Hoje</button>
        <label>Dias<select value={length} onChange={event=>setLength(event.target.value)}>
          {['7','14','21','28','35'].map(item=><option value={item} key={item}>{Number(item)/7} sem.</option>)}</select></label>
        <button type="button" aria-pressed={!compact} onClick={()=>setCompact(!compact)}>{compact?'Detalhar':'Compactar'}</button>
      </div>
    </header>
    {error && <p role="alert">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    {!schedule ? <p role="status">Carregando Planejamento…</p> : <>
      <div className="workshop-axis planning-timeline" data-compact={compact} style={grid}>
        <div className="planning-sheet">
          <div className="planning-caption"><strong>Programação por veículo</strong><span>{days.length?monthDay(days[0].day)+' – '+monthDay(days[days.length-1].day):''}</span></div>
          <div className="workshop-grid planning-dates">
            <div className="workshop-grid-title">Veículo / placa</div>
            {days.map(day=><div key={day.day} className={'workshop-grid-date '+dayClass(day)} title={day.holiday?'Feriado':day.day===schedule.today?'Hoje':undefined}>
              <strong>{weekday(day.day)}</strong><small>{day.day.slice(8,10)}/{day.day.slice(5,7)}</small>
            </div>)}
          </div>
          {schedule.vehicles.map(vehicle=>{
            const planned=schedule.plans.filter(item=>item.experienceId===vehicle.experienceId)
            const lanes:Segment[][]=[]
            for(const segment of planned){
              const lane=lanes.find(items=>items.every(other=>segment.start>other.end||segment.end<other.start))
              if(lane)lane.push(segment);else lanes.push([segment])
            }
            if(!lanes.length)lanes.push([])
            return <div className="workshop-vehicle workshop-grid planning-vehicle" key={vehicle.experienceId} style={{'--planning-lanes':lanes.length} as CSSProperties}>
              <div className="workshop-grid-title planning-identity" style={{gridRow:'1 / span '+lanes.length}}>
                <a href={'/atendimentos/'+encodeURIComponent(vehicle.atendimentoId)+'?aba=diagnosticos&tela=experiencia'} title={vehicle.model+' · '+vehicle.plate}>
                  <strong>{vehicle.model||'Veículo'}</strong><small>{vehicle.plate||'Placa pendente'}</small></a>
                {!compact&&vehicle.deliveryDate&&<small>Entrega {displayDay(vehicle.deliveryDate)}</small>}
              </div>
              {days.map((day,index)=><div className={'workshop-slot '+dayClass(day)} style={{gridColumn:index+2,gridRow:'1 / span '+lanes.length}} data-promise={vehicle.deliveryDate===day.day} key={day.day}
                onDragOver={event=>{if(!day.holiday)event.preventDefault()}} onDrop={event=>{
                  event.preventDefault();const segment=planned.find(item=>item.sourceId===event.dataTransfer.getData('text/plain'));if(segment&&!day.holiday)open(segment,day.day)
                }}>{vehicle.deliveryDate===day.day?<span title="Entrega prometida">◆</span>:null}</div>)}
              {lanes.flatMap((lane,index)=>lane.map(segment=>{
                const plannedColumn=span(days,segment.start,segment.end)
                const actualColumn=segment.actualStart?span(days,segment.actualStart,segment.actualEnd??schedule.today):undefined
                return <div key={segment.sourceId} style={{display:'contents'}}>
                  {plannedColumn&&<button type="button" draggable className={'workshop-segment erp-phase-'+(schedule.phases.find(phase=>phase.id===segment.phase)?.tone??'neutral')}
                    style={{gridColumn:plannedColumn,gridRow:index+1}} onDragOver={event=>event.preventDefault()} onDrop={event=>{
                      event.preventDefault();const candidate=planned.find(item=>item.sourceId===event.dataTransfer.getData('text/plain'));if(candidate){const bounds=event.currentTarget.getBoundingClientRect();const first=days.findIndex(day=>day.day>=segment.start);const last=days.findLastIndex(day=>day.day<=segment.end);const target=days[Math.min(last,Math.max(first,first+Math.floor((event.clientX-bounds.left)/bounds.width*(last-first+1))))];if(target&&!target.holiday)open(candidate,target.day)}
                    }} onDragStart={event=>event.dataTransfer.setData('text/plain',segment.sourceId)} onClick={()=>open(segment)}
                    aria-label={phaseDetails(segment.phase)?.label+' · '+segment.name+' · '+dateRange(segment.start,segment.end)} title={phaseDetails(segment.phase)?.label+' · '+segment.name+' · '+dateRange(segment.start,segment.end)}>
                    {!compact&&<span>{phaseDetails(segment.phase)?.label} · {segment.name}</span>}{segment.sourceChanged&&<b title="Revisar programação">!</b>}{segment.actualStart&&<i className="planning-actual-mark" title={'Realizado: '+dateRange(segment.actualStart,segment.actualEnd??schedule.today)}/>}
                  </button>}
                  {!plannedColumn&&actualColumn&&<button type="button" className="workshop-real" onClick={()=>open(segment)} style={{gridColumn:actualColumn,gridRow:index+1}} title={'Realizado · '+segment.name}>✓</button>}
                </div>
              }))}
            </div>
          })}
          {!schedule.vehicles.length&&<p className="planning-empty">Nenhum veículo na janela selecionada.</p>}
          <details open className="workshop-capacity">
            <summary>Capacidade programada <span>por recurso e dia</span></summary>
            {schedule.capacity.map(resource=><div className="workshop-grid planning-capacity-row" key={resource.id}>
              <div className="workshop-grid-title">{resource.name}</div>
              {resource.days.filter(day=>days.some(item=>item.day===day.day)).map(day=><button key={day.day} type="button" data-overload={day.overloaded} data-load={loadTone(day)}
                className={'workshop-load '+dayClass(day)} aria-label={resource.name+', '+displayDay(day.day)+', '+day.planned+' de '+day.capacity+(day.overloaded?', sobrecarga':'')}
                onClick={()=>setSelectedCapacity({name:resource.name,day})}>
                {day.percent===null?'—':day.percent+'%'}{!compact&&<small>{day.planned}/{day.capacity}</small>}
              </button>)}
            </div>)}
            {!schedule.capacity.length&&<p className="planning-empty">Cadastre recursos para acompanhar a capacidade.</p>}
          </details>
        </div>
      </div>
      <div className="planning-legend" aria-label="Legenda de capacidade"><span data-load="ok">Até 80%</span><span data-load="near">81–100%</span><span data-load="over">Acima de 100%</span><span>◆ Entrega</span></div>
      {selectedCapacity && <div className="workshop-detail">
        <header><h2>{selectedCapacity.name} · {displayDay(selectedCapacity.day.day)}</h2>
          <button type="button" onClick={() => setSelectedCapacity(null)}>Fechar capacidade</button></header>
        <p>Energia programada {selectedCapacity.day.planned} de {selectedCapacity.day.capacity}{selectedCapacity.day.overloaded ? ' · Sobrecarga' : ''}.</p>
        <ul>{selectedCapacity.day.phases.map(phase => <li key={phase.phase}>{phaseDetails(phase.phase)?.label} · {phase.energy}</li>)}</ul>
      </div>}
      {editor && <SegmentEditor key={editor.source.id+(editor.targetDay ?? '')} editor={editor} schedule={schedule} save={save} close={() => setEditor(null)}/>}
      <details className="workshop-detail"><summary>Serviços autorizados sem programação ({schedule.sources.filter(item => !schedule.scheduledIds.includes(item.id)).length})</summary>
        <ul>{schedule.sources.filter(item => !schedule.scheduledIds.includes(item.id)).map(item => {
          const vehicle = schedule.vehicles.find(vehicle => vehicle.experienceId === item.experienceId)
          return <li key={item.id}><button type="button" onClick={() => setEditor({source:item})}>
            {vehicle?.plate ? vehicle.plate+' · ' : ''}{item.name} · {item.stageName} · {item.energy ?? 'Energia pendente'}{!item.phase && ' · Fase pendente'}
          </button></li>
        })}</ul>
      </details>
      <PlanningSetup schedule={schedule} save={save}/>
    </>}
  </section>
}
