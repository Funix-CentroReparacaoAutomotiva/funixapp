import AcquisitionComponents from './erp/AcquisitionComponents'
import {discountReasons, paymentCents} from '../shared/finance'
import {PaymentMethodFields, paymentMethodLabel, readPaymentMethod} from './PaymentMethodFields'
import {useEffect, useEffectEvent, useRef, useState} from 'react'
import type {FormEvent} from 'react'
import type {CustomerReference} from '../shared/customer'
import {deliveryDateLabel} from '../shared/delivery-date'
import {budgetLifecycleLabels, scheduledEntryLabel} from '../shared/production'
import type {ProductionBudget, ProductionOverview} from '../shared/production'
import {api} from './api'
import type {RequestFailure} from './api'
import {money} from './money'
import {currency, decimal, inputCents, todayInSaoPaulo} from './finance-format'
import type {ExperienceFinance} from '../shared/finance'
import './production.css'

const label = (ref: CustomerReference) => [ref.text, ref.plate].filter(Boolean).join(' · ')
const budgetLabel = (budget: ProductionBudget) => budget.documentNumber ?? 'Orçamento ' + budget.label
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
  const [finance,setFinance]=useState<ExperienceFinance|null>(null)
  const [financeForm,setFinanceForm]=useState<{action:'receive'|'title';id:string;date:string;amount:string;titleId?:string;discount?:string;iss?:string}|null>(null)
  const base='/api/atendimentos/'+encodeURIComponent(at)
  const [data,setData]=useState<ProductionOverview|null>(null)
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('')
  const [editing,setEditing]=useState(false)
  const [entryDate,setEntryDate]=useState(''), [entryTime,setEntryTime]=useState(''), [delivery,setDelivery]=useState('')
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
    const [date='', time='']=(experience?.scheduledEntry??'').split('T')
    setEntryDate(date)
    setEntryTime(time)
    setDelivery(data?.deliveryDate??'')
    setBudgetIds(!experience&&candidates.length===1?[candidates[0]!.id]:[])
    setSelections({customer:'',vehicle:'',payer:''})
    setError('');setNotice('');setEditing(true)
  }

  function submitSchedule(event: FormEvent) {
    event.preventDefault()
    if(!data)return
    const current=data.experience
    const parties=Object.fromEntries(Object.entries(selections)
      .filter(([,selection])=>selection)
      .map(([kind,selection])=>[kind,JSON.parse(selection)]))
    void run(async()=>{
      const result=await post<ProductionOverview>('/agendamento',{
        parties, budgetIds, scheduledEntry:entryTime?entryDate+'T'+entryTime:entryDate, deliveryDate:delivery||null,
        expectedAtendimentoRevision:data.atendimentoRevision, expectedExperienceRevision:current?.revision??null,
      })
      setData(result);onScheduleSaved();setEditing(false);setNotice('Agendamento confirmado.')
    })
  }

  function authorize(budget: ProductionBudget) {
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

  useEffect(()=>{
    if(!data?.experience)return
    const controller=new AbortController()
    void api<ExperienceFinance>(base+'/experiencia/financeiro',{signal:controller.signal}).then(setFinance).catch(error=>{
      if(!controller.signal.aborted)setError(error.message)
    })
    return ()=>controller.abort()
  },[base,data])

  const receiptLimit=financeForm?.titleId
    ? finance?.openTitles.find(title=>title.id===financeForm.titleId)?.balanceCents??0
    : finance?.untitledCents??0
  const discountCents=inputCents(financeForm?.discount??'')??0
  const withheldIssCents=inputCents(financeForm?.iss??'')??0
  const proposedPayment=inputCents(financeForm?.amount??'')??0
  const proposedSettlement=proposedPayment+discountCents+withheldIssCents
  const validOptionalMoney=(value:string|undefined)=>!value?.trim()||/^[0]+(?:[,.]0{1,2})?$/.test(value.trim())||inputCents(value)!==null

  function updateAdjustment(key:'discount'|'iss', value:string) {
    if(!financeForm)return
    const currentDefault=Math.max(0,receiptLimit-discountCents-withheldIssCents)
    const next={...financeForm,[key]:value}
    if(proposedPayment===currentDefault){
      const remaining=Math.max(0,receiptLimit-(inputCents(next.discount??'')??0)-(inputCents(next.iss??'')??0))
      next.amount=decimal(remaining).replace('.',',')
    }
    setFinanceForm(next)
  }

  function submitFinance(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(!financeForm)return
    const {action,id,date,titleId}=financeForm
    const fields=new FormData(event.currentTarget)
    if(!validOptionalMoney(financeForm.amount)||!validOptionalMoney(financeForm.discount)||!validOptionalMoney(financeForm.iss)||
      proposedSettlement<=0||(action==='receive'&&proposedSettlement>receiptLimit)){
      setError('Confira os valores. A soma do pagamento e dos ajustes deve caber no saldo disponível.');return
    }
    const payment = action==='receive'&&proposedPayment>0 ? readPaymentMethod(fields) : {}
    const invoiceNumber=String(fields.get('invoiceNumber')??'').trim()
    const values={id,date,amountCents:proposedPayment,...payment,
      ...(invoiceNumber?{invoiceNumber}:{}),
      ...(discountCents?{discountCents,discountReason:String(fields.get('discountReason')??'')}:{}),
      ...(withheldIssCents?{withheldIssCents}:{})}
    void run(async()=>{
      if(titleId){
        await api('/api/financeiro/titulos/'+titleId+'/baixas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)})
        setFinance(await api<ExperienceFinance>(base+'/experiencia/financeiro'))
      }else setFinance(await post<ExperienceFinance>('/experiencia/financeiro',{action,...values}))
      setFinanceForm(null)
      setNotice(action==='receive'?'Lançamento confirmado.':'Título criado.')
    })
  }

  const experience=data?.experience
  const candidates=data?.budgets.flatMap(budget=>budget.state==='negotiating'?[{...budget,state:budget.state}]:[])??[]
  const customers=data?.references.person.filter(ref=>ref.text)??[]
  const vehicles=data?.references.vehicle.filter(ref=>ref.text||ref.plate)??[]
  const payers=data?.references.payer.filter(ref=>ref.text)??[]
  const fields=[
    {name:'customer', caption:'Cliente', options:customers},
    {name:'vehicle', caption:'Veículo', options:vehicles},
    {name:'payer', caption:'Pagador', options:payers},
  ] as const
  const requiredReferences=customers.length>0 && vehicles.length>0
  const selectionsValid=fields.every(field=>field.options.length<=1||selections[field.name])
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
      <div><dt>Entrada agendada</dt><dd>{scheduledEntryLabel(experience.scheduledEntry)}</dd></div>
      <div><dt>Entrega combinada</dt><dd>{experience.deliveryDate?deliveryDateLabel(experience.deliveryDate):'A combinar'}</dd></div>
    </dl>}
    {experience&&<div className="production-actions production-experience-controls">
      <label className="production-check">
        <input type="checkbox" checked={experience.inOperation} disabled={busy} onChange={event=>{
          const inOperation=event.target.checked
          void run(async()=>setData(await post<ProductionOverview>('/experiencia/operacao',{inOperation})))
        }}/>
        Em operação
      </label>

    </div>}
    {experience&&<div className="diagnosis-card production-form"><AcquisitionComponents key={experience.id+':'+(data?.budgets.map(b=>b.state).join(',')??'')} experienceId={experience.id}/></div>}
    {experience&&finance&&<section className="diagnosis-card production-form" aria-label="Financeiro da Experiência">
      <h2>Financeiro da Experiência</h2>
      <dl className="production-details">
        <div><dt>Total autorizado</dt><dd>{currency(finance.totalCents)}</dd></div>
        <div><dt>Já recebido</dt><dd>{currency(finance.paidCents)}</dd></div>
        {finance.discountCents>0&&<div><dt>Descontos</dt><dd>{currency(finance.discountCents)}</dd></div>}
        {finance.withheldIssCents>0&&<div><dt>ISS retido</dt><dd>{currency(finance.withheldIssCents)}</dd></div>}
        <div><dt>Saldo a receber</dt><dd>{currency(finance.balanceCents)}</dd></div>
        {finance.titledCents>0&&<div><dt>Em títulos a receber</dt><dd>{currency(finance.titledCents)}</dd></div>}
      </dl>
      {!financeForm&&<div className="production-actions">
        <button type="button" className="primary-btn" disabled={busy||!finance.untitledCents} onClick={()=>setFinanceForm({
          action:'receive',id:crypto.randomUUID(),date:todayInSaoPaulo(),amount:decimal(finance.untitledCents).replace('.',','),
        })}>Registrar recebimento</button>
        {finance.untitledCents>0&&<button type="button" className="fh-filter" disabled={busy} onClick={()=>setFinanceForm({
          action:'title',id:crypto.randomUUID(),date:todayInSaoPaulo(),amount:decimal(finance.untitledCents),
        })}>Gerar título do restante</button>}
        {finance.openTitles.map(title=><button key={title.id} type="button" className="fh-filter" disabled={busy} onClick={()=>setFinanceForm({
          action:'receive',titleId:title.id,id:crypto.randomUUID(),date:todayInSaoPaulo(),amount:decimal(title.balanceCents).replace('.',','),
        })}>Receber título · {deliveryDateLabel(title.dueDate)} · {currency(title.balanceCents)}</button>)}
      </div>}
      {financeForm&&<form className="production-form" onSubmit={submitFinance}>
        {financeForm.action==='receive'?<>
          <label>Valor que o cliente pagou<input inputMode="decimal" value={financeForm.amount} disabled={busy}
            onChange={event=>setFinanceForm({...financeForm,amount:event.target.value})}/></label>
          {proposedPayment>0&&<PaymentMethodFields disabled={busy}/>}
          <label>Desconto (opcional)<input inputMode="decimal" value={financeForm.discount??''} disabled={busy}
            onChange={event=>updateAdjustment('discount',event.target.value)}/></label>
          {discountCents>0&&<label>Motivo do desconto<select name="discountReason" defaultValue="" disabled={busy} required>
            <option value="">Selecione</option>
            {Object.entries(discountReasons).map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select></label>}
          <label>ISS retido pelo cliente (opcional)<input inputMode="decimal" value={financeForm.iss??''} disabled={busy}
            onChange={event=>updateAdjustment('iss',event.target.value)}/></label>
          <label>Número da nota fiscal (opcional)<input name="invoiceNumber" maxLength={60} disabled={busy}/></label>
          <dl className="production-details" aria-live="polite">
            <div><dt>Valor recebido agora</dt><dd>{currency(proposedPayment)}</dd></div>
            <div><dt>Total abatido do saldo</dt><dd>{currency(proposedSettlement)}</dd></div>
            {proposedSettlement<=receiptLimit?<div><dt>Saldo da Experiência após o lançamento</dt><dd>{currency(Math.max(0,finance.balanceCents-proposedSettlement))}</dd></div>
              :<div><dt>Valor acima do saldo disponível</dt><dd>{currency(proposedSettlement-receiptLimit)}</dd></div>}
          </dl>
        </>:<p>Valor do título {currency(proposedPayment)}</p>}
        <label>{financeForm.action==='receive'?'Data do recebimento':'Vencimento'}<input required type="date" value={financeForm.date} disabled={busy}
          onChange={event=>setFinanceForm({...financeForm,date:event.target.value})}/></label>
        <div className="production-actions">
          <button className="primary-btn" disabled={busy}>{financeForm.action==='receive'?'Confirmar lançamento':'Criar título'}</button>
          <button type="button" disabled={busy} onClick={()=>setFinanceForm(null)}>Cancelar</button>
        </div>
      </form>}
      {finance.receipts.filter(item=>!item.reversedAt).map(item=><div key={item.id} className="production-actions">
        <span>{deliveryDateLabel(item.date)} · {paymentCents(item)>0&&<>Recebido {currency(paymentCents(item))} · {paymentMethodLabel(item)}</>}
          {item.discountCents?<> · Desconto {currency(item.discountCents)} ({discountReasons[item.discountReason!]})</>:null}
          {item.withheldIssCents?<> · ISS retido {currency(item.withheldIssCents)}</>:null}
          {item.invoiceNumber?<> · NF {item.invoiceNumber}</>:null}</span>
        <button type="button" className="fh-filter" disabled={busy} onClick={()=>{
          if(!window.confirm('Desfazer todo este lançamento?'))return
          void run(async()=>{
            await api('/api/financeiro/titulos/'+item.titleId+'/baixas/'+item.id,{method:'DELETE'})
            setFinance(await api<ExperienceFinance>(base+'/experiencia/financeiro'))
          })
        }}>Desfazer</button>
      </div>)}
    </section>}
    {data&&!experience&&!showSchedule&&<p className="at-form-hint">{!candidates.length?'Nenhum orçamento emitido disponível para agendamento.':'Identifique cliente e veículo na ficha do Atendimento para agendar.'}</p>}
    {showSchedule&&!editing&&<button type="button" className="primary-btn" disabled={busy||!!rejection} onClick={openSchedule}>{experience?'Reagendar ou incluir orçamentos':'Agendar Atendimento'}</button>}
    {editing&&data&&<form className="production-form diagnosis-card" aria-label="Agendamento" onSubmit={submitSchedule}>
      {!experience&&fields.map(field=>field.options.length<=1
        ? <p className="at-form-hint" key={field.name}>{field.caption} · {field.options[0]?label(field.options[0]):'O mesmo cliente'}</p>
        : <div className="at-field" key={field.name}>
        <label htmlFor={'production-'+field.name}>{field.caption}</label>
        <select id={'production-'+field.name} required value={selections[field.name]} disabled={busy}
          onChange={event=>setSelections(previous=>({...previous,[field.name]:event.target.value}))}>
          <option value="">Selecionar…</option>
          {field.options.map((ref,index)=><option key={index} value={JSON.stringify(ref)}>{label(ref)}</option>)}
        </select>
      </div>)}
      <label className="at-field">Data da entrada
        <input type="date" required value={entryDate} disabled={busy} onChange={event=>setEntryDate(event.target.value)}/>
      </label>
      <label className="at-field">Horário da entrada (opcional, Brasília)
        <input type="time" value={entryTime} disabled={busy} onChange={event=>setEntryTime(event.target.value)}/>
      </label>
      <label className="at-field">Entrega combinada (opcional)
        <input type="date" min={entryDate||undefined} value={delivery} disabled={busy} onChange={event=>setDelivery(event.target.value)}/>
      </label>
      {!!candidates.length&&<fieldset disabled={busy}>
        <legend>Orçamentos aceitos pelo cliente</legend>
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
        {budget.state==='consented'&&<p className="at-form-hint">A inspeção de recebimento continua necessária.</p>}
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
