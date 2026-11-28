import {useEffect, useState} from 'react'
import type {FormEvent} from 'react'
import {api, type RequestFailure} from '../api'
import {deliveryDateLabel as calendarDate} from '../../shared/delivery-date'
import {currency, inputCents, todayInSaoPaulo} from '../finance-format'

export type FinanceCallbacks = {
  onAuthRequired: () => void
  onBusy: (value: boolean) => void
}

type Movement = {id: string; date: string; label: string; kind: 'transfer' | 'reversal' | 'receivable' | 'payable'; cents: string; effectCents: string}

type Flow = {
  opening: string
  realized: string
  projected: string
  movements: Movement[]
  scheduled: Movement[]
  forecast: {id: string; date: string; dueDate: string; label: string; kind: 'receivable' | 'payable'; cents: number; counterparty: string}[]
  today: string
  period: string
}

const kinds = {receivable: 'Recebimento', payable: 'Pagamento', transfer: 'Transferência interna', reversal: 'Estorno'}
const display = (cents: string) => currency(BigInt(cents))

export function FinanceCash({onAuthRequired, onBusy}: FinanceCallbacks) {
  const today = todayInSaoPaulo()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [data, setData] = useState<Flow | null>(null)
  const [revision, setRevision] = useState(0)
  const [selectedDay, setSelectedDay] = useState('')
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const [requestId, setRequestId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api<Flow>('/api/erp/finance/cash?' + new URLSearchParams({month}), {signal: controller.signal}).then(result => {
      if (controller.signal.aborted) return
      setData(result)
      setLoadError('')
    }).catch((error: RequestFailure) => {
      if (controller.signal.aborted) return
      if (error.status === 401) onAuthRequired()
      setLoadError(error.message)
    })
    return () => controller.abort()
  }, [month, revision, onAuthRequired])

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const value = inputCents(String(fields.get('amount')))
    if (!value) { setActionError('Informe o valor da transferência com até duas casas decimais.'); return }
    setActionError('')
    setMessage('')
    setBusy(true)
    onBusy(true)
    try {
      await api('/api/erp/finance/transactions', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          id: requestId, kind: 'transfer', date: fields.get('date'), amountCents: value,
          sourceAccount: fields.get('source'), targetAccount: fields.get('target'),
        }),
      })
      setRequestId('')
      setMessage('Transferência interna registrada.')
      setRevision(current => current + 1)
    } catch (cause) {
      const failure = cause as RequestFailure
      if (failure.status === 401) onAuthRequired()
      setActionError(failure.message)
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  const days = new Map<string, {realized: number; planned: number}>()
  if (data?.period === month) {
    const dates = [
      ...data.movements.map(row => ({date: row.date, key: 'realized' as const})),
      ...data.scheduled.map(row => ({date: row.date, key: 'planned' as const})),
      ...data.forecast.map(row => ({date: row.date, key: 'planned' as const})),
    ]
    for (const row of dates) {
      const day = days.get(row.date) ?? {realized: 0, planned: 0}
      day[row.key]++
      days.set(row.date, day)
    }
  }

  return <section className="fin-page" aria-label="Fluxo de caixa">
    <header className="fin-heading"><h1>Fluxo de caixa</h1>
      <button className="primary-btn" disabled={busy || Boolean(requestId)} onClick={() => {
        setMessage(''); setActionError(''); setRequestId(crypto.randomUUID())
      }}>Registrar transferência interna</button>
    </header>
    {message && <p className="fin-notice" role="status">{message}</p>}
    {requestId && <form className="fin-form" onSubmit={transfer}>
      <h2>Transferência entre contas</h2>
      <div className="fin-fields">
        <label>Conta de origem<input name="source" maxLength={120} required /></label>
        <label>Conta de destino<input name="target" maxLength={120} required /></label>
        <label>Valor (R$)<input name="amount" inputMode="decimal" required /></label>
        <label>Data de caixa<input name="date" type="date" defaultValue={today} max={today} required /></label>
      </div>
      {actionError && <p className="fin-error" role="alert">{actionError}</p>}
      <div className="fin-actions"><button type="button" className="fin-button" disabled={busy} onClick={() => setRequestId('')}>Cancelar</button>
        <button className="primary-btn" disabled={busy}>Registrar</button></div>
    </form>}
    <div className="fin-period"><label>Mês<input type="month" value={month} onChange={event => {
      if (event.target.value) { setMonth(event.target.value); setSelectedDay(''); setLoadError('') }
    }} /></label></div>
    {loadError ? <div><p className="fin-error" role="alert">{loadError}</p>
      <button className="fin-button" onClick={() => { setLoadError(''); setRevision(current => current + 1) }}>Tentar novamente</button></div>
      : data?.period !== month ? <p role="status">Carregando fluxo de caixa…</p> : <>
        <section className="fin-metrics" aria-label="Saldos do caixa">
          {([['Saldo inicial', data.opening], ['Saldo realizado', data.realized], ['Saldo projetado', data.projected]]).map(([label, value]) =>
            <div className="fin-metric" key={label}><span>{label}</span><strong>{display(value)}</strong></div>)}
        </section>
        <p className="fin-meta">Saldos calculados a partir dos lançamentos do FunixApp.</p>
        <div><header className="fin-heading"><h2>Calendário financeiro</h2>
          {selectedDay && <button className="fin-button" onClick={() => setSelectedDay('')}>Mostrar mês inteiro</button>}</header>
          <ul className="fin-calendar">
            {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day => <li className="fin-weekday" key={day}>{day}</li>)}
            {calendarDays(month).map((day, index) => {
            const count = days.get(day)
            return <li key={day} style={index === 0 ? {gridColumnStart: new Date(day + 'T00:00:00Z').getUTCDay() + 1} : undefined}><button type="button" disabled={!count} aria-pressed={selectedDay === day}
              aria-label={`${calendarDate(day)} · ${count?.realized ?? 0} movimentações · ${count?.planned ?? 0} previsões`}
              onClick={() => setSelectedDay(day)}>{Number(day.slice(8))}
              {count && <small>{count.realized} real. · {count.planned} prev.</small>}</button></li>
          })}</ul>
        </div>
        <div><h2>Movimentações realizadas</h2>
          <ul className="fin-history fin-movements">{data.movements.filter(row => !selectedDay || row.date === selectedDay).map(row =>
            <li className="fin-history-item" key={row.id}><span><strong>{row.label}</strong><small>{calendarDate(row.date)} · {kinds[row.kind]}</small></span>
              <strong>{row.kind === 'transfer' ? display(row.cents) + ' transferidos' : display(row.effectCents)}</strong></li>)}
            {!data.movements.some(row => !selectedDay || row.date === selectedDay) && <li className="fin-history-item">Nenhuma movimentação realizada.</li>}
          </ul>
        </div>
        <div><h2>Previsões de recebimento e pagamento</h2>
          <ul className="fin-history fin-movements">{data.forecast.filter(row => !selectedDay || row.date === selectedDay).map(row =>
            <li className="fin-history-item" key={row.id}><span><strong>{row.label}</strong>
              <small>{calendarDate(row.date)} · {kinds[row.kind]} · {row.counterparty}{row.dueDate < data.today && ` · Vencido em ${calendarDate(row.dueDate)}`}</small></span>
              <strong>{currency(row.cents * (row.kind === 'payable' ? -1 : 1))}</strong></li>)}
            {data.scheduled.filter(row => !selectedDay || row.date === selectedDay).map(row =>
              <li className="fin-history-item" key={row.id}><span><strong>{row.label}</strong>
                <small>{calendarDate(row.date)} · Baixa lançada para data futura</small></span><strong>{display(row.effectCents)}</strong></li>)}
            {![...data.forecast, ...data.scheduled].some(row => !selectedDay || row.date === selectedDay) && <li className="fin-history-item">Nenhuma previsão no período.</li>}
          </ul>
        </div>
      </>}
  </section>
}

function calendarDays(month: string) {
  const cursor = new Date(month + '-01T00:00:00Z')
  const days: string[] = []
  while (Number.isFinite(cursor.getTime()) && cursor.toISOString().startsWith(month + '-')) {
    days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}
