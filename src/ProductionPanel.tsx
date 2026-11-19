import {useEffect, useEffectEvent, useRef, useState} from 'react'
import type {FormEvent} from 'react'
import type {CustomerReference} from '../shared/customer'
import {deliveryDateLabel} from '../shared/delivery-date'
import {budgetLifecycleLabels} from '../shared/production'
import type {ProductionBudget, ProductionOverview} from '../shared/production'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
import './production.css'

const label = (ref: CustomerReference) => [ref.text, ref.plate].filter(Boolean).join(' · ')
const budgetLabel = (budget: ProductionBudget) => budget.documentNumber ?? 'Orçamento ' + budget.label
const fields = [
  {name:'customer', source:'person', caption:'Cliente'},
  {name:'vehicle', source:'vehicle', caption:'Veículo'},
  {name:'payer', source:'payer', caption:'Pagador'},
] as const
const formatEvent = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone:'America/Sao_Paulo', dateStyle:'short', timeStyle:'short',
})

export function ProductionPanel({at,onBusy,onAuthRequired,onOpenBudget,onScheduleSaved}: {
  at: string
  onBusy: (busy: boolean) => void
  onAuthRequired: () => void
  onOpenBudget: (id: string) => void
  onScheduleSaved: () => void
}) {
  const base='/api/atendimentos/'+encodeURIComponent(at)
  const [data,setData]=useState<ProductionOverview|null>(null)
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('')
  const [editing,setEditing]=useState(false)
  const [entry,setEntry]=useState(''), [delivery,setDelivery]=useState('')
  const [selections,setSelections]=useState({customer:'',vehicle:'',payer:''})
  const [budgetIds,setBudgetIds]=useState<string[]>([])
  const [rejection,setRejection]=useState<{budget: ProductionBudget; reason: string}|null>(null)
  const locked=useRef(false)
  const requireAuth=useEffectEvent(onAuthRequired)

  useEffect(()=>{
    const controller=new AbortController()
    api<ProductionOverview>(base+'/experiencia',{signal:controller.signal}).then(setData).catch((cause: RequestFailure)=>{
      if(controller.signal.aborted)return
      setError(cause.message)
      if(cause.status===401)requireAuth()
    })
    return ()=>controller.abort()
  },[base])

  async function run(action: ()=>Promise<void>) {
    if(locked.current)return
    locked.current=true
    setBusy(true);onBusy(true);setError('');setNotice('')
    try {await action()}
    catch(cause) {
      const failure=cause as RequestFailure
      setError(failure.message)
      if(failure.status===401)onAuthRequired()
    } finally {
      setBusy(false);onBusy(false);locked.current=false
    }
  }

  function post<T>(path: string, body: unknown) {
    return api<T>(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  }

  function openSchedule() {
    setEntry(data?.experience?.scheduledEntry??'')
    setDelivery(data?.deliveryDate??'')
    setBudgetIds([])
    setError('');setNotice('');setEditing(true)
  }

  function submitSchedule(event: FormEvent) {
    event.preventDefault()
    if(!data)return
    const current=data.experience
    const parties=current
      ? {customer:current.customer,vehicle:current.vehicle,payer:current.payer}
      : Object.fromEntries(fields.map(field=>[field.name,JSON.parse(selections[field.name]||'null')]))
    void run(async()=>{
      const result=await post<ProductionOverview>('/agendamento',{
        parties, budgetIds, scheduledEntry:entry, deliveryDate:delivery||null,
        expectedAtendimentoRevision:data.atendimentoRevision, expectedExperienceRevision:current?.revision??null,
      })
      setData(result);onScheduleSaved();setEditing(false);setNotice('Agendamento confirmado.')
    })
  }

  function authorize(budget: ProductionBudget) {
    if(!window.confirm('Autorizar tecnicamente '+budgetLabel(budget)+' e gerar a Ordem de Serviço? A inspeção de recebimento continua necessária.'))return
    void run(async()=>{
      const result=await post<{number:string}>('/orcamentos/'+encodeURIComponent(budget.id)+'/autorizacao-tecnica',{confirmed:true})
      setData(await api<ProductionOverview>(base+'/experiencia'))
      setNotice(result.number+' gerada.')
    })
  }

  function reject(event: FormEvent) {
    event.preventDefault()
    if(!rejection)return
    const action=rejection
    void run(async()=>{
      setData(await post<ProductionOverview>('/orcamentos/'+encodeURIComponent(action.budget.id)+'/rejeicao-tecnica',{reason:action.reason}))
      setRejection(null);setNotice('Rejeição técnica registrada.')
    })
  }

  const experience=data?.experience
  const candidates=data?.budgets.flatMap(budget=>budget.state==='negotiating'||budget.state==='consented'
    ?[{...budget,state:budget.state}]:[])??[]
  const requiredReferences=fields.every(field=>data?.references[field.source].some(ref=>ref.text.trim()))
  const selectionsValid=fields.every(field=>data?.references[field.source].some(ref=>JSON.stringify(ref)===selections[field.name]))
  const showSchedule=!!data && (experience||candidates.length>0 && requiredReferences)

  return <section className="production-panel" aria-label="Experiência do Atendimento">
    {error&&<div className="production-feedback"><p className="form-error" role="alert">{error}</p>
      <button type="button" className="fh-filter" disabled={busy} onClick={()=>void run(async()=>setData(await api<ProductionOverview>(base+'/experiencia')))}>Atualizar produção</button>
    </div>}
    {notice&&<p className="at-save-success" role="status">{notice}</p>}
    {!data&&!error&&<p role="status">Carregando experiência…</p>}
    {experience&&<dl className="production-details">
      <div><dt>Cliente</dt><dd>{label(experience.customer)}</dd></div>
      <div><dt>Veículo</dt><dd>{label(experience.vehicle)}</dd></div>
      <div><dt>Pagador</dt><dd>{label(experience.payer)}</dd></div>
      <div><dt>Entrada agendada</dt><dd>{deliveryDateLabel(experience.scheduledEntry.slice(0,10))} às {experience.scheduledEntry.slice(11)}</dd></div>
      <div><dt>Entrega combinada</dt><dd>{experience.deliveryDate?deliveryDateLabel(experience.deliveryDate):'A combinar'}</dd></div>
    </dl>}
    {data&&!experience&&<p className="at-form-hint">{!candidates.length?'Nenhum orçamento emitido disponível para agendamento.':!requiredReferences?'Identifique cliente, veículo e pagador na ficha do Atendimento para agendar.':'Nenhuma experiência agendada.'}</p>}
    {showSchedule&&!editing&&<button type="button" className="primary-btn" disabled={busy||!!rejection} onClick={openSchedule}>{experience?'Reagendar ou incluir orçamentos':'Agendar Atendimento'}</button>}
    {editing&&data&&<form className="production-form diagnosis-card" aria-label="Agendamento" onSubmit={submitSchedule}>
      {!experience&&fields.map(field=><div className="at-field" key={field.name}>
        <label htmlFor={'production-'+field.name}>{field.caption}</label>
        <select id={'production-'+field.name} required value={selections[field.name]} disabled={busy}
          onChange={event=>setSelections(previous=>({...previous,[field.name]:event.target.value}))}>
          <option value="">Selecionar…</option>
          {data.references[field.source].filter(ref=>ref.text.trim()).map((ref,index)=><option key={index} value={JSON.stringify(ref)}>{label(ref)}</option>)}
        </select>
      </div>)}
      <label className="at-field">Entrada agendada (horário de Brasília)
        <input type="datetime-local" required value={entry} disabled={busy} onChange={event=>setEntry(event.target.value)}/>
      </label>
      <label className="at-field">Entrega combinada (opcional)
        <input type="date" min={entry.slice(0,10)||undefined} value={delivery} disabled={busy} onChange={event=>setDelivery(event.target.value)}/>
      </label>
      {!!candidates.length&&<fieldset disabled={busy}>
        <legend>Orçamentos com consentimento comercial</legend>
        {candidates.map(budget=><label className="production-check" key={budget.id}>
          <input type="checkbox" checked={budgetIds.includes(budget.id)} onChange={event=>setBudgetIds(previous=>
            event.target.checked?[...previous,budget.id]:previous.filter(id=>id!==budget.id))}/>
          <span>{budgetLabel(budget)} · {money(budget.total)} · {budgetLifecycleLabels[budget.state]}</span>
        </label>)}
      </fieldset>}
      <div className="production-actions">
        <button className="primary-btn" disabled={busy||(!experience&&(!budgetIds.length||!selectionsValid))}>Confirmar agendamento</button>
        <button type="button" className="fh-filter" disabled={busy} onClick={()=>{setEditing(false);setError('')}}>Cancelar</button>
      </div>
    </form>}
    {data&&<section aria-labelledby="production-budgets">
      <h2 id="production-budgets">Orçamentos relacionados</h2>
      {!data.budgets.length&&<p className="at-form-hint">Nenhuma versão emitida.</p>}
      {data.budgets.map(budget=><article className="diagnosis-card production-budget" key={budget.id}>
        <div className="production-actions">
          <button type="button" className="fh-filter" disabled={busy} onClick={()=>onOpenBudget(budget.id)}>{budgetLabel(budget)}</button>
          <strong>{budget.state?budgetLifecycleLabels[budget.state]:'Histórico sem estado registrado'}</strong>
        </div>
        {budget.workOrderNumber&&<button type="button" className="fh-filter" disabled={busy} onClick={()=>onOpenBudget(budget.id)}>Consultar {budget.workOrderNumber}</button>}
        {budget.legacyOrder&&<p className="at-form-hint">OS histórica sem vínculo com Experiência.</p>}
        {budget.state==='consented'&&<div className="production-actions">
          <button type="button" className="primary-btn" disabled={busy||editing||!!rejection} onClick={()=>authorize(budget)}>Autorizar e gerar OS</button>
          <button type="button" className="fh-filter" disabled={busy||editing||!!rejection} onClick={()=>{setError('');setRejection({budget,reason:''})}}>Rejeitar tecnicamente</button>
        </div>}
        {rejection?.budget.id===budget.id&&<form aria-label="Rejeição técnica" onSubmit={reject}>
          <label className="at-field">Motivo da rejeição técnica
            <textarea value={rejection.reason} required minLength={5} maxLength={500} disabled={busy}
              onChange={event=>setRejection({...rejection,reason:event.target.value})}/>
          </label>
          <div className="production-actions">
            <button className="primary-btn" disabled={busy||rejection.reason.trim().length<5}>Confirmar rejeição</button>
            <button type="button" className="fh-filter" disabled={busy} onClick={()=>{setRejection(null);setError('')}}>Cancelar</button>
          </div>
        </form>}
        {!!budget.history.length&&<details><summary>Histórico de transições</summary><ul>
          {budget.history.map((event,index)=><li key={index}>
            {budgetLifecycleLabels[event.to]} · {event.origin==='technical'?'Técnica':'Comercial'} · <time dateTime={event.occurredAt}>{formatEvent(event.occurredAt)}</time> · Sessão autenticada
            {event.reason&&<span> · {event.reason}</span>}
          </li>)}
        </ul></details>}
      </article>)}
    </section>}
  </section>
}
