import { useTaskRecord } from './task-record'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { workshopPhases, type WorkshopPhase } from '../../shared/erp'
import { displayDay, phaseDetails, workshopApi, type PhasePresentation, type YardVehicle } from './workshop-client'
import WorkshopPlanning from './workshop-planning'
import './workshop.css'

type Yard = {today:string; phases:PhasePresentation[]; vehicles:YardVehicle[]; unlinked:{atendimentoId:string}[]}
type Movement = {id:string; happenedAt:string; action:string; note:string|null; operator:string; phase:WorkshopPhase}
const actions = {entry:'Registrar entrada',phase:'Alterar fase',block:'Marcar impedimento',unblock:'Liberar impedimento',
  quality:'Registrar problema de qualidade',departure:'Registrar saída','commercial-close':'Encerrar comercialmente'}
type Action = keyof typeof actions

function YardDetails({vehicle, reload, onClose}:{vehicle:YardVehicle; reload:()=>void; onClose:()=>void}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(),[])
  const [events,setEvents] = useState<Movement[]>([])
  const [error,setError] = useState('')
  const [pending,setPending] = useState(false)
  const [action,setAction] = useState<Action | ''>('')
  const [key,setKey] = useState(() => crypto.randomUUID())
  useEffect(() => {
    const abort = new AbortController()
    void workshopApi<{events:Movement[]}>('/history?experienceId=' + encodeURIComponent(vehicle.experienceId),undefined,abort.signal)
      .then(result => setEvents(result.events)).catch(error => {if (!abort.signal.aborted) setError(error.message)})
    return () => abort.abort()
  },[vehicle.experienceId,vehicle.revision])
  const enabled:Action[] = []
  if (vehicle.phase === 'scheduled' && vehicle.plate) enabled.push('entry')
  if (vehicle.present && !vehicle.blocked) enabled.push('phase','block')
  if (vehicle.present && vehicle.blocked) enabled.push('unblock')
  if (vehicle.present) enabled.push('quality')
  if (vehicle.present && vehicle.phase === 'finished' && !vehicle.blocked) enabled.push('departure')
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try {
      await workshopApi('/movement',{experienceId:vehicle.experienceId,revision:vehicle.revision,requestId:key,
        action,phase:data.get('phase') ?? undefined,note:data.get('note'),operator:data.get('operator')})
      setAction('')
      setKey(crypto.randomUUID())
      reload()
    } catch (error) {setError((error as Error).message)}
    finally {setPending(false)}
  }
  return <section className="workshop-detail" aria-label="Detalhes do veículo">
    <header><h2 ref={heading} tabIndex={-1}>{vehicle.model || 'Veículo'} · {vehicle.plate || 'Placa pendente'}</h2>
      <button type="button" onClick={onClose}>Fechar detalhes</button></header>
    <dl><dt>Fase</dt><dd>{phaseDetails(vehicle.phase)?.label}</dd><dt>Cliente</dt><dd>{vehicle.customer || '—'}</dd>
      <dt>Pagador</dt><dd>{vehicle.payer || '—'}</dd><dt>Entrada prevista</dt>
      <dd>{displayDay(vehicle.scheduledEntry)} {vehicle.scheduledEntry.slice(11,16)}</dd>
      <dt>Entrega prevista</dt><dd>{vehicle.deliveryDate ? displayDay(vehicle.deliveryDate) : '—'}</dd>
      {vehicle.year && <><dt>Ano</dt><dd>{vehicle.year}</dd></>}</dl>
    <a href={'/atendimentos/' + encodeURIComponent(vehicle.atendimentoId) + '?aba=diagnosticos&tela=experiencia'}>Abrir ficha, orçamentos e OS</a>
    {vehicle.requiresClassification && <p role="status">Cadastro ou vínculo de OS pendente. Confira a ficha antes de registrar a movimentação.</p>}
    {enabled.length > 0 && <form onSubmit={submit} onChange={() => setKey(crypto.randomUUID())}>
      <label>Ação<select value={action} onChange={event => setAction(event.target.value as Action | '')} required>
        <option value="">Selecione</option>{enabled.map(item => <option key={item} value={item}>{actions[item]}</option>)}
      </select></label>
      {action === 'phase' && <label>Nova fase<select name="phase" required><option value="">Selecione</option>
        {workshopPhases.filter(item => !['scheduled','departed',vehicle.phase].includes(item.id))
          .map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {action && <><label>Responsável<input name="operator" maxLength={120} required/></label>
        <label>Justificativa ou observação<textarea name="note" maxLength={1000}
          required={['block','unblock','quality'].includes(action)}/></label>
        <button disabled={pending}>Confirmar</button></>}
    </form>}
    {error && <p role="alert">{error}</p>}
    <h3>Movimentações</h3>
    {!events.length && <p>Nenhuma movimentação registrada.</p>}
    <ul>{events.map(item => <li key={item.id}>
      {actions[item.action as Action]} · {item.operator} · {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(item.happenedAt))}
      {item.note && <p>{item.note}</p>}
    </li>)}</ul>
  </section>
}

function WorkshopYard() {
  const [data,setData] = useState<Yard|null>(null)
  const [error,setError] = useState('')
  const [version,setVersion] = useState(0)
  const [phase,setPhase] = useState<WorkshopPhase|null>(null)
  const [selected,setSelected] = useState<string|null>(null)
  const phaseHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {if (phase && !selected) phaseHeading.current?.focus()},[phase,selected])
  useEffect(() => {
    const abort = new AbortController()
    void workshopApi<Yard>('/yard',undefined,abort.signal).then(result => {setData(result);setError('')})
      .catch(error => {if (!abort.signal.aborted) setError(error.message)})
    return () => abort.abort()
  },[version])
  const reload = () => setVersion(current => current + 1)
  const open = (vehicle:YardVehicle) => {setSelected(vehicle.experienceId);setPhase(vehicle.phase)}
  const vehicle = data?.vehicles.find(item => item.experienceId === selected)
  useTaskRecord(vehicle?.atendimentoId)
  const vehicles = data?.vehicles ?? []
  return <section className="workshop workshop-yard">
    <header className="workshop-header"><h1>Pátio</h1>
      {data && <ul className="workshop-stats">
        <li><strong>{vehicles.filter(item => item.phase === 'scheduled').length}</strong> agendados</li>
        <li><strong>{vehicles.filter(item => item.present).length}</strong> presentes</li>
        <li><strong>{vehicles.filter(item => !item.departedAt && (item.phase === 'finished' || item.deliveryDate === data.today)).length}</strong> a entregar</li>
        <li><strong>{vehicles.filter(item => item.blocked).length}</strong> impedimentos</li>
      </ul>}
      <button type="button" onClick={reload}>Atualizar</button>
    </header>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Carregando Pátio…</p>}
    {data && <>
      <ol className="workshop-map" aria-label="Fluxo do Pátio">
        {data.phases.map(item => {
          const inPhase = vehicles.filter(vehicle => vehicle.phase === item.id)
          return <li key={item.id} className={'workshop-lane erp-phase-'+item.tone}>
            <button className="workshop-lane-title" type="button" onClick={() => {setPhase(phase === item.id ? null : item.id);setSelected(null)}}
              aria-expanded={phase === item.id}><span>{item.label}</span><strong>{inPhase.length}</strong></button>
            <ul className="workshop-mini-cards">{inPhase.slice(0,2).map(vehicle =>
              <li key={vehicle.experienceId}><button type="button" onClick={() => open(vehicle)}>
                <span>{vehicle.model || 'Veículo'}</span><strong>{vehicle.plate || 'Placa pendente'}</strong>
                {vehicle.blocked && <span className="workshop-alert">Bloqueado</span>}
                {vehicle.requiresClassification && vehicle.plate && <span className="workshop-alert">Vínculo pendente</span>}
                {!vehicle.departedAt && vehicle.deliveryDate && vehicle.deliveryDate < data.today &&
                  <span className="workshop-alert">Atrasado</span>}
              </button></li>)}</ul>
            {inPhase.length > 2 && <button className="workshop-overflow workshop-overflow-desktop" type="button"
              onClick={() => {setPhase(item.id);setSelected(null)}}>Ver mais {inPhase.length - 2}</button>}
            {inPhase.length > 1 && <button className="workshop-overflow workshop-overflow-mobile" type="button"
              onClick={() => {setPhase(item.id);setSelected(null)}}>Ver mais {inPhase.length - 1}</button>}
          </li>
        })}
      </ol>
      {data.unlinked.length > 0 && <details className="workshop-detail">
        <summary>{data.unlinked.length} fichas com OS sem vínculo de Experiência</summary>
        <ul>{data.unlinked.map(row => <li key={row.atendimentoId}>
          <a href={'/atendimentos/' + encodeURIComponent(row.atendimentoId)}>Abrir Atendimento {row.atendimentoId}</a></li>)}</ul>
      </details>}
      {phase && <section className="workshop-detail"><header><h2 ref={phaseHeading} tabIndex={-1}>{phaseDetails(phase)?.label}</h2>
        <button type="button" onClick={() => {setPhase(null);setSelected(null)}}>Fechar fase</button></header>
        <ul className="workshop-phase-list">{vehicles.filter(item => item.phase === phase).map(item =>
          <li key={item.experienceId}><button type="button" onClick={() => open(item)}>
            {item.model || 'Veículo'} · {item.plate || 'Placa pendente'}{item.blocked ? ' · Bloqueado' : ''}
          </button></li>)}</ul>
      </section>}
      {vehicle && <YardDetails key={vehicle.experienceId} vehicle={vehicle} reload={reload} onClose={() => setSelected(null)}/>}
    </>}
  </section>
}

export default function Workshop({view}:{view:string}) {
  return view === 'planejamento' ? <WorkshopPlanning/> : <WorkshopYard/>
}

type PhaseSettings = {phases:PhasePresentation[]; revision:string; options:PhasePresentation['commercial'][]}

export function WorkshopPhaseSettings() {
  const [settings,setSettings] = useState<PhaseSettings|null>(null)
  const [error,setError] = useState('')
  const [feedback,setFeedback] = useState('')
  const [pending,setPending] = useState(false)
  const [reload,setReload] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    void workshopApi<PhaseSettings>('/phase-mapping',undefined,abort.signal)
      .then(result => {setSettings(result);setError('')})
      .catch(error => {if (!abort.signal.aborted) setError(error.message)})
    return () => abort.abort()
  },[reload])

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings || pending) return
    const form = new FormData(event.currentTarget)
    setError('')
    setFeedback('')
    setPending(true)
    try {
      const result = await workshopApi<PhaseSettings>('/phase-mapping',{
        revision:settings.revision,
        correspondences:settings.phases.filter(phase => form.has(phase.id))
          .map(phase => ({phase:phase.id,commercial:form.get(phase.id)})),
      })
      setSettings(result)
      setFeedback('Correspondência salva.')
    } catch (error) {setError((error as Error).message)}
    finally {setPending(false)}
  }

  return <section className="workshop workshop-detail" aria-labelledby="workshop-phase-settings">
    <header><h2 id="workshop-phase-settings">Correspondência de fases da oficina</h2>
      <button type="button" disabled={pending} onClick={() => {setFeedback('');setReload(value => value+1)}}>Atualizar</button></header>
    <p>Escolha em qual coluna de Vendas cada fase aparece. A cor dessa coluna será usada no Pátio e no Planejamento.</p>
    {error && <p role="alert">{error}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {!error && !settings && <p role="status">Carregando fases…</p>}
    {settings && <form key={settings.revision+':'+reload} onSubmit={submit}>
      <div className="workshop-phase-settings">
        {settings.phases.map(item => <label className={'erp-phase-'+item.tone} key={item.id}>
          {item.label}
          {item.id === 'scheduled' || item.id === 'departed'
            ? <span>{item.commercial}{item.id === 'departed' ? ' (se pendente)' : ''}</span>
            : <select name={item.id} defaultValue={item.commercial}>
              {settings.options.map(option => <option key={option}>{option}</option>)}
            </select>}
        </label>)}
      </div>
      <button disabled={pending}>Salvar correspondência</button>
    </form>}
  </section>
}
