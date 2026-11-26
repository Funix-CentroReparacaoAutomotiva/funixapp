import {discountReasons, paymentCents} from '../shared/finance'
import {PaymentMethodFields, paymentMethodLabel, readPaymentMethod} from './PaymentMethodFields'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { FinancialTitle, FinancialExperienceOption } from '../shared/finance'
import { api } from './api'
import type { RequestFailure } from './api'
import {todayInSaoPaulo, decimal, currency, inputCents} from './finance-format'
import { Notice } from './ui'
import './finance-page.css'

type Kind = FinancialTitle['kind']
type Editor = { type: 'title'; id: string; experienceId?: string } | { type: 'settlement'; id: string; titleId: string; balanceCents: number }
type Dashboard = { titles: FinancialTitle[]; experiences: FinancialExperienceOption[] }

const direction: Record<Kind, string> = { receivable: 'A receber', payable: 'A pagar' }
const settled: Record<Kind, string> = { receivable: 'Recebido', payable: 'Pago' }
const settle: Record<Kind, string> = { receivable: 'Registrar recebimento', payable: 'Registrar pagamento' }

function calendarDate(date: string) {
  return date.split('-').reverse().join('/')
}

function isOverdue(title: FinancialTitle, today: string) {
  return title.balanceCents > 0 && title.dueDate < today
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="fin-metric"><span>{label}</span><strong>{children}</strong></div>
}

export function FinancePage({ search, onAuthRequired, onBusy }: {
  search: string
  onAuthRequired: () => void
  onBusy: (busy: boolean) => void
}) {
  const params = new URLSearchParams(search)
  const experienceId = params.get('experiencia') ?? ''
  const today = todayInSaoPaulo()
  const [data, setData] = useState<Dashboard | null>(null)
  const [loadFailure, setLoadFailure] = useState('')
  const [version, setVersion] = useState(0)
  const [kind, setKind] = useState<'all' | Kind>('all')
  const [status, setStatus] = useState('all')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editor, setEditor] = useState<Editor | null>(() =>
    params.get('nova') === 'receber' ? { type: 'title', id: crypto.randomUUID(), experienceId } : null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<{ titleId?: string; message: string } | null>(null)
  const [notice, setNotice] = useState('')
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    api<Dashboard>('/api/financeiro', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) {
        setLoadFailure('')
        setData(result)
      }
    }).catch((cause: RequestFailure) => {
      if (cause.name === 'AbortError' || controller.signal.aborted) return
      if (cause.status === 401) onAuthRequired()
      setLoadFailure(cause.message)
    })
    return () => controller.abort()
  }, [onAuthRequired, version])

  useEffect(() => {
    if (editor && data) form.current?.scrollIntoView({ block: 'nearest' })
  }, [editor, Boolean(data)])

  function edit(next: Editor | null) {
    setActionError(null)
    setNotice('')
    setEditor(next)
  }

  async function update(url: string, request: RequestInit, message: string, titleId?: string) {
    setActionError(null)
    setNotice('')
    setBusy(true)
    onBusy(true)
    try {
      const title = await api<FinancialTitle>(url, request)
      setData(current => {
        if (!current) return current
        const index = current.titles.findIndex(item => item.id === title.id)
        const titles = index === -1 ? [title, ...current.titles] : current.titles.map(item => item.id === title.id ? title : item)
        return { ...current, titles }
      })
      setEditor(null)
      setNotice(message)
    } catch (cause) {
      const failure = cause as RequestFailure
      if (failure.status === 401) onAuthRequired()
      setActionError({ titleId, message: failure.message })
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  function save(event: FormEvent<HTMLFormElement>, current: Editor, title?: FinancialTitle) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const get = (key: string) => String(fields.get(key) ?? '')
    const amountCents = inputCents(get('amount'))
    if (!amountCents) {
      setActionError({ titleId: title?.id, message: 'Informe um valor maior que zero, com até duas casas decimais.' })
      return
    }
    const base = { id: current.id, amountCents }
    const common = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    if (current.type === 'title') {
      const body = { ...base, kind: get('kind'), counterparty: get('counterparty').trim(), description: get('description').trim(), dueDate: get('date'), experienceId: get('experience') || null }
      if (!body.counterparty || !body.description) {
        setActionError({ message: 'Informe a contraparte e a descrição.' })
        return
      }
      setKind('all')
      setStatus('all')
      void update('/api/financeiro/titulos', { ...common, body: JSON.stringify(body) }, 'Título lançado.')
    } else if (title) {
      const body = { ...base, date: get('date'), ...readPaymentMethod(fields) }
      if (amountCents > title.balanceCents) {
        setActionError({ titleId: title.id, message: 'O valor da baixa deve ser de até ' + currency(title.balanceCents) + '.' })
        return
      }
      void update(`/api/financeiro/titulos/${encodeURIComponent(title.id)}/baixas`, { ...common, body: JSON.stringify(body) },
        title.kind === 'receivable' ? 'Recebimento registrado.' : 'Pagamento registrado.', title.id)
    }
  }

  function reverse(title: FinancialTitle, item: FinancialTitle['settlements'][number]) {
    if (!window.confirm(`Desfazer a baixa de ${currency(item.amountCents)} de ${calendarDate(item.date)}?`)) return
    const url = `/api/financeiro/titulos/${encodeURIComponent(title.id)}/baixas/${encodeURIComponent(item.id)}`
    void update(url, { method: 'DELETE' }, 'Baixa desfeita. O valor voltou ao pendente.', title.id)
  }

  if (!data) {
    if (loadFailure) return <Notice title="Não foi possível carregar o financeiro" error retry={() => {
      setLoadFailure('')
      setVersion(current => current + 1)
    }}>{loadFailure}</Notice>
    return <Notice title="Carregando financeiro…" />
  }

  const { titles, experiences } = data
  const linkedExperience = editor?.type === 'title' && editor.experienceId
    ? experiences.find(item => item.id === editor.experienceId) : undefined
  const experienceLabels = new Map(experiences.map(item => [item.id, item.label]))
  const pending = { receivable: 0n, payable: 0n }
  const overdue = { receivable: 0n, payable: 0n }
  const movementTotals = { receivable: 0n, payable: 0n }
  let overdueCount = 0
  const movements = titles.flatMap(title => {
    pending[title.kind] += BigInt(title.balanceCents)
    if (isOverdue(title, today)) {
      overdue[title.kind] += BigInt(title.balanceCents)
      overdueCount++
    }
    return title.settlements.filter(item => !item.reversedAt && paymentCents(item)>0 && (!month || item.date.startsWith(month + '-'))).map(item => {
      movementTotals[title.kind] += BigInt(paymentCents(item))
      return { ...item, title }
    })
  }).sort((left, right) => right.date.localeCompare(left.date))
  const visibleTitles = titles.filter(title => !title.directReceipt && (kind === 'all' || kind === title.kind) && (
    status === 'all' || (status === 'pending' && title.balanceCents > 0) ||
    (status === 'overdue' && isOverdue(title, today)) || (status === 'settled' && title.balanceCents === 0)
  )).sort((left, right) => Number(left.balanceCents === 0) - Number(right.balanceCents === 0) || left.dueDate.localeCompare(right.dueDate))

  return <section className="fin-page" aria-label="Financeiro">
    <header className="fin-heading">
      <h1>Financeiro</h1>
      <button className="primary-btn" disabled={busy || editor?.type === 'title'} onClick={() => edit({ type: 'title', id: crypto.randomUUID() })}>+ Novo título</button>
    </header>
    {notice && <p className="fin-notice" role="status">{notice}</p>}

    {editor?.type === 'title' && <form ref={form} className="fin-form" onSubmit={event => save(event, editor)} key={editor.id}>
      <h2>Novo título</h2>
      <div className="fin-fields">
        <label>Tipo<select name="kind" defaultValue={kind === 'payable' && !linkedExperience ? kind : 'receivable'}>
          <option value="receivable">A receber</option><option value="payable">A pagar</option>
        </select></label>
        <label>Contraparte<input name="counterparty" placeholder="Cliente ou fornecedor" defaultValue={linkedExperience?.counterparty} required maxLength={150} /></label>
        <label className="fin-span">Descrição<input name="description" required maxLength={500} /></label>
        <label>Valor (R$)<input name="amount" placeholder="0,00" inputMode="decimal" required /></label>
        <label>Vencimento<input name="date" type="date" defaultValue={today} required /></label>
        {experiences.length > 0 && <label className="fin-span">Experiência (opcional)
          <select name="experience" defaultValue={linkedExperience?.id ?? ''}>
            <option value="">Sem Experiência</option>
            {experiences.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
        </label>}
      </div>
      {editor.experienceId && !linkedExperience && <p role="status">Experiência do atalho indisponível. Confira o vínculo antes de lançar.</p>}
      {actionError && !actionError.titleId && <p className="fin-error" role="alert">{actionError.message}</p>}
      <div className="fin-actions"><button className="fin-button" type="button" disabled={busy} onClick={() => edit(null)}>Cancelar</button>
        <button className="primary-btn" disabled={busy}>{busy ? 'Salvando…' : 'Lançar título'}</button></div>
    </form>}

    <section className="fin-metrics" aria-label="Valores em aberto">
      <Metric label="Total a receber">{currency(pending.receivable)}</Metric>
      <Metric label="Total a pagar">{currency(pending.payable)}</Metric>
      <div className="fin-metric fin-overdue"><span>Títulos vencidos</span>
        <strong>{overdueCount}</strong>
        <small>{currency(overdue.receivable)} a receber · {currency(overdue.payable)} a pagar</small>
      </div>
    </section>

    <section aria-label="Títulos financeiros" id="titulos">
      <header className="fin-heading"><h2>Títulos</h2><a href="#movimentacoes">Ver movimentações</a></header>
      <div className="fin-fields fin-filters">
        <label>Tipo<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          <option value="all">Todos</option><option value="receivable">A receber</option><option value="payable">A pagar</option>
        </select></label>
        <label>Situação<select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">Todas</option><option value="pending">Pendentes</option><option value="overdue">Vencidos</option><option value="settled">Quitados</option>
        </select></label>
      </div>
      {visibleTitles.length === 0 && <p className="fin-empty">{titles.length ? 'Nenhum título com esses filtros.' : 'Nenhum título lançado.'}</p>}
      <ul className="fin-titles">
        {visibleTitles.map(title => {
          const late = isOverdue(title, today)
          const titleEditor = editor?.type === 'settlement' && editor.titleId === title.id ? editor : null
          const state = title.balanceCents === 0 ? 'Quitado' : late ? 'Vencido' : title.balanceCents < title.amountCents ? 'Parcial' : 'Em aberto'
          return <li className="fin-title" key={title.id}>
            <div className="fin-title-top">
              <div><h3>{title.description}</h3><p>{title.counterparty}</p></div>
              <div className="fin-value"><strong>{currency(title.balanceCents)} pendente</strong><small>Valor do título {currency(title.amountCents)}</small></div>
            </div>
            <p className="fin-meta">{direction[title.kind]} · Vence em {calendarDate(title.dueDate)} · <strong className={late ? 'fin-late' : ''}>{state}</strong></p>
            {title.experienceId && <p className="fin-meta">Experiência · {experienceLabels.get(title.experienceId) ?? 'Vinculada'}</p>}
            {title.balanceCents > 0 && !titleEditor && <button className="fin-button" disabled={busy}
              onClick={() => edit({ type: 'settlement', id: crypto.randomUUID(), titleId: title.id, balanceCents: title.balanceCents })}>{settle[title.kind]}</button>}
            {titleEditor && <form className="fin-form fin-settlement" ref={form} key={titleEditor.id} onSubmit={event => save(event, titleEditor, title)}>
              <h4>{settle[title.kind]}</h4>
              <div className="fin-fields">
                <label>Valor da baixa (R$)<input name="amount" inputMode="decimal" defaultValue={decimal(titleEditor.balanceCents).replace('.', ',')} required /></label>
                <PaymentMethodFields disabled={busy}/><label>Data da baixa<input name="date" type="date" defaultValue={today} required /></label>
              </div>
              {actionError?.titleId === title.id && <p className="fin-error" role="alert">{actionError.message}</p>}
              <div className="fin-actions"><button type="button" className="fin-button" onClick={() => edit(null)} disabled={busy}>Cancelar</button>
                <button className="primary-btn" disabled={busy}>{busy ? 'Salvando…' : 'Confirmar baixa'}</button></div>
            </form>}
            {title.settlements.length > 0 && <details className="fin-history">
              <summary>Histórico de baixas ({title.settlements.length})</summary>
              <ul>{title.settlements.map(item => <li className="fin-history-item" key={item.id}>
                <span>{calendarDate(item.date)}
                  {paymentCents(item)>0&&<> · {paymentMethodLabel(item)} · <strong>{currency(paymentCents(item))}</strong></>}
                  {item.discountCents?<> · Desconto {currency(item.discountCents)} ({discountReasons[item.discountReason!]})</>:null}
                  {item.withheldIssCents?<> · ISS retido {currency(item.withheldIssCents)}</>:null}{item.invoiceNumber?<> · NF {item.invoiceNumber}</>:null}{item.reversedAt && ' · Desfeita'}</span>
                {!item.reversedAt && <button className="fin-button" disabled={busy} onClick={() => reverse(title, item)}>Desfazer baixa</button>}
              </li>)}</ul>
            </details>}
            {!titleEditor && actionError?.titleId === title.id && <p className="fin-error" role="alert">{actionError.message}</p>}
          </li>
        })}
      </ul>
    </section>

    <section aria-label="Movimentações registradas" id="movimentacoes">
      <header className="fin-heading fin-movement-heading"><h2>Movimentações registradas</h2>
        <div className="fin-period">
          <label>Mês<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
          {month ? <button className="fin-button" onClick={() => setMonth('')}>Todos os meses</button> :
            <button className="fin-button" onClick={() => setMonth(today.slice(0, 7))}>Mês atual</button>}
        </div>
      </header>
      <div className="fin-metrics fin-movement-metrics">
        <Metric label="Recebimentos">{currency(movementTotals.receivable)}</Metric>
        <Metric label="Pagamentos">{currency(movementTotals.payable)}</Metric>
      </div>
      {!movements.length ? <p className="fin-empty">Nenhuma baixa registrada no período.</p> :
        <ul className="fin-history fin-movements">{movements.map(item => <li className="fin-history-item" key={item.id}>
          <span><strong>{item.title.description}</strong><small>{calendarDate(item.date)} · {item.title.counterparty} · {settled[item.title.kind]} · {paymentMethodLabel(item)}</small></span>
          <strong>{currency(paymentCents(item))}</strong>
        </li>)}</ul>}
    </section>
  </section>
}
