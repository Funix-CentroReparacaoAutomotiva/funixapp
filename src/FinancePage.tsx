import {discountReasons, paymentCents, paymentMethods} from '../shared/finance'
import {PaymentMethodFields, paymentMethodLabel, readPaymentMethod} from './PaymentMethodFields'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { FinancialTitle, FinancialExperienceOption } from '../shared/finance'
import { api } from './api'
import type { RequestFailure } from './api'
import {todayInSaoPaulo, decimal, currency, inputCents} from './finance-format'
import { Notice } from './ui'
import './finance-page.css'
import {FinanceCash, type FinanceCallbacks} from './erp/finance-cash'
import {FinanceBatch} from './erp/finance-batch'

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

type FinancePageProps = FinanceCallbacks & { search: string; view?: string }

export function FinancePage(props: FinancePageProps) {
  if (props.view === 'fluxo-de-caixa') return <FinanceCash {...props} />
  return <FinanceTitles key={props.view ?? 'legacy'} {...props} />
}

function titleStatus(title: FinancialTitle, today: string) {
  if (title.balanceCents === 0) return 'Quitado'
  if (isOverdue(title, today)) return 'Vencido'
  return title.balanceCents < title.amountCents ? 'Parcial' : 'Em aberto'
}

function FinanceTitles({ search, view, onAuthRequired, onBusy }: FinancePageProps) {
  const params = new URLSearchParams(search)
  const experienceId = params.get('experiencia') ?? ''
  const today = todayInSaoPaulo()
  const titleKind = view ? (view === 'contas-a-pagar' ? 'payable' : 'receivable') : undefined
  const heading = titleKind === 'payable' ? 'Contas a pagar' : titleKind ? 'Contas a receber' : 'Financeiro'
  const [data, setData] = useState<Dashboard | null>(null)
  const [loadFailure, setLoadFailure] = useState('')
  const [version, setVersion] = useState(0)
  const [kind, setKind] = useState<'all' | Kind>('all')
  const [status, setStatus] = useState('all')
  const [lookup, setLookup] = useState(experienceId)
  const [competenceMonth, setCompetenceMonth] = useState('')
  const [dueMonth, setDueMonth] = useState('')
  const [sort, setSort] = useState('due')
  const [grouped, setGrouped] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [expanded, setExpanded] = useState('')
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

  const dataLoaded = Boolean(data)
  useEffect(() => {
    if (editor && dataLoaded) form.current?.scrollIntoView({ block: 'nearest' })
  }, [editor, dataLoaded])

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
      const body = {
        ...base, kind: titleKind ?? get('kind'), counterparty: get('counterparty').trim(), description: get('description').trim(),
        dueDate: get('date'), experienceId: get('experience') || null, competenceDate: get('competence') || null,
        category: get('category').trim() || null, expectedPaymentMethod: get('expectedPaymentMethod') || null,
      }
      if (!body.counterparty || !body.description) {
        setActionError({ message: 'Informe a contraparte e a descrição.' })
        return
      }
      setKind('all')
      setStatus('all')
      void update(titleKind ? '/api/erp/finance/titles' : '/api/financeiro/titulos', { ...common, body: JSON.stringify(body) }, 'Título lançado.')
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
  const visibleTitles = titles.filter(title => !title.directReceipt && (titleKind ? title.kind === titleKind : kind === 'all' || kind === title.kind) && (
    status === 'all' || (status === 'pending' && title.balanceCents > 0) ||
    (status === 'overdue' && isOverdue(title, today)) || (status === 'settled' && title.balanceCents === 0)
  )).sort((left, right) => Number(left.balanceCents === 0) - Number(right.balanceCents === 0) || left.dueDate.localeCompare(right.dueDate))

  const term = lookup.trim().toLocaleLowerCase('pt-BR')
  const tableTitles = visibleTitles.filter(title => {
    const comparison = [title.id, title.experienceId, title.description, title.counterparty, title.category, experienceLabels.get(title.experienceId ?? '')]
      .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR')
    return comparison.includes(term)
      && (!competenceMonth || title.competenceDate?.startsWith(competenceMonth))
      && (!dueMonth || title.dueDate.startsWith(dueMonth))
  }).sort((a, b) => {
    const order = sort === 'amount' ? b.amountCents - a.amountCents
      : sort === 'competence' ? (a.competenceDate ?? '9999').localeCompare(b.competenceDate ?? '9999')
      : a.dueDate.localeCompare(b.dueDate)
    return order || a.id.localeCompare(b.id)
  })
  const groups = new Map<string, FinancialTitle[]>()
  for (const title of tableTitles) {
    const group = grouped ? title.counterparty : ''
    const current = groups.get(group)
    if (current) current.push(title)
    else groups.set(group, [title])
  }
  const batchTitles = titles.filter(title => selected.includes(title.id) && title.balanceCents > 0)
  return <section className="fin-page" aria-label={heading}>
    <header className="fin-heading">
      <h1>{heading}</h1>
      <button className="primary-btn" disabled={busy || editor?.type === 'title'} onClick={() => edit({ type: 'title', id: crypto.randomUUID(), experienceId: experienceId || undefined })}>+ Novo título</button>
    </header>
    {notice && <p className="fin-notice" role="status">{notice}</p>}

    {editor?.type === 'title' && <form ref={form} className="fin-form" onSubmit={event => save(event, editor)} key={editor.id}>
      <h2>Novo título</h2>
      <div className="fin-fields">
        {!titleKind && <label>Tipo<select name="kind" defaultValue={kind === 'payable' && !linkedExperience ? kind : 'receivable'}>
          <option value="receivable">A receber</option><option value="payable">A pagar</option>
        </select></label>}
        <label>Contraparte<input name="counterparty" placeholder="Cliente ou fornecedor" defaultValue={linkedExperience?.counterparty} required maxLength={150} /></label>
        <label className="fin-span">Descrição<input name="description" required maxLength={500} /></label>
        <label>Valor (R$)<input name="amount" placeholder="0,00" inputMode="decimal" required /></label>
        <label>Vencimento<input name="date" type="date" defaultValue={today} required /></label>
        {titleKind && <>
          <label>Competência<input name="competence" type="date" required /></label>
          <label>Classificação gerencial<input name="category" maxLength={100} required={titleKind === 'payable'} /></label>
          <label>Forma de quitação<select name="expectedPaymentMethod" required>
            <option value="">Selecione</option>
            {Object.entries(paymentMethods).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </>}
        {titleKind !== 'payable' && experiences.length > 0 && <label className="fin-span">Experiência (opcional)
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
      <header className="fin-heading"><h2>Títulos</h2>{!titleKind && <a href="#movimentacoes">Ver movimentações</a>}</header>
      <div className="fin-fields fin-filters">
        {!titleKind && <label>Tipo<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          <option value="all">Todos</option><option value="receivable">A receber</option><option value="payable">A pagar</option>
        </select></label>}
        <label>Situação<select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">Todas</option><option value="pending">Pendentes</option><option value="overdue">Vencidos</option><option value="settled">Quitados</option>
        </select></label>
      </div>
      {titleKind && <>
        <div className="fin-fields fin-filters">
          <label>Buscar títulos<input type="search" value={lookup} onChange={event => setLookup(event.target.value)} /></label>
          <label>Ordenar por<select value={sort} onChange={event => setSort(event.target.value)}>
            <option value="due">Vencimento</option><option value="competence">Competência</option><option value="amount">Maior valor</option>
          </select></label>
          <label>Competência<input type="month" value={competenceMonth} onChange={event => setCompetenceMonth(event.target.value)} /></label>
          <label>Vencimento<input type="month" value={dueMonth} onChange={event => setDueMonth(event.target.value)} /></label>
        </div>
        <div className="fin-heading fin-table-actions">
          <label className="fin-check"><input type="checkbox" checked={grouped} onChange={event => setGrouped(event.target.checked)} />
            {titleKind === 'receivable' ? 'Agrupar por pagador' : 'Agrupar por contraparte'}</label>
          <button className="fin-button" disabled={batchOpen || batchTitles.length < 2} onClick={() => {
            edit(null); setBatchOpen(true)
          }}>Registrar baixa em grupo ({batchTitles.length})</button>
        </div>
        {batchOpen && <FinanceBatch titles={batchTitles} onAuthRequired={onAuthRequired} onBusy={onBusy}
          onClose={() => setBatchOpen(false)} onDone={() => {
            setBatchOpen(false); setSelected([]); setNotice('Transação registrada.'); setVersion(current => current + 1)
          }} />}
        {[...groups].map(([group, groupTitles]) => <div key={group} className="fin-table-wrap" tabIndex={0} aria-label={group || 'Tabela de títulos'}>
          {group && <h3>{group}</h3>}
          <table className="fin-table">
            <thead><tr>
              <th scope="col">Selecionar</th><th scope="col">Título</th><th scope="col">{titleKind === 'receivable' ? 'Pagador' : 'Contraparte'}</th>
              <th scope="col">{titleKind === 'receivable' ? 'Experiência e veículo' : 'Classificação'}</th>
              <th scope="col">Competência</th><th scope="col">Vencimento</th><th scope="col">Quitação</th>
              <th scope="col">Valor</th><th scope="col">Saldo</th><th scope="col">Situação</th>
            </tr></thead>
            <tbody>{groupTitles.map(title => <tr key={title.id}>
              <td><input type="checkbox" aria-label={'Selecionar ' + title.description} checked={selected.includes(title.id)}
                disabled={title.balanceCents === 0 || batchOpen} onChange={event => {
                  const checked = event.target.checked
                  setSelected(current => checked ? [...current, title.id] : current.filter(id => id !== title.id))
                }} /></td>
              <th scope="row"><button type="button" className="fin-button" aria-expanded={expanded === title.id} onClick={() => {
                edit(null); setExpanded(current => current === title.id ? '' : title.id)
              }}>{title.description}</button></th>
              <td>{title.counterparty}</td>
              <td>{(titleKind === 'payable' ? title.category : experienceLabels.get(title.experienceId ?? '')) || '—'}</td>
              <td>{title.competenceDate ? calendarDate(title.competenceDate) : '—'}</td><td>{calendarDate(title.dueDate)}</td>
              <td>{title.expectedPaymentMethod ? paymentMethods[title.expectedPaymentMethod] : '—'}</td>
              <td>{currency(title.amountCents)}</td><td>{currency(title.balanceCents)}</td><td>{titleStatus(title, today)}</td>
            </tr>)}</tbody>
          </table>
        </div>)}
      </>}
      {(titleKind ? tableTitles : visibleTitles).length === 0 && <p className="fin-empty">{titles.length ? 'Nenhum título com esses filtros.' : 'Nenhum título lançado.'}</p>}
      <ul className="fin-titles">
        {(titleKind ? tableTitles.filter(title => title.id === expanded) : visibleTitles).map(title => {
          const late = isOverdue(title, today)
          const titleEditor = editor?.type === 'settlement' && editor.titleId === title.id ? editor : null
          const state = titleStatus(title, today)
          return <li className="fin-title" key={title.id}>
            <div className="fin-title-top">
              <div><h3>{title.description}</h3><p>{title.counterparty}</p>{titleKind && <p className="fin-meta">ID {title.id}</p>}</div>
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
                  {item.withheldIssCents?<> · ISS retido {currency(item.withheldIssCents)}</>:null}{item.invoiceNumber?<> · NF {item.invoiceNumber}</>:null}{item.transactionId && ' · Transação ' + item.transactionId}{item.reversedAt && ' · Desfeita'}</span>
                {!item.reversedAt && <button className="fin-button" disabled={busy} onClick={() => reverse(title, item)}>Desfazer baixa</button>}
              </li>)}</ul>
            </details>}
            {!titleEditor && actionError?.titleId === title.id && <p className="fin-error" role="alert">{actionError.message}</p>}
          </li>
        })}
      </ul>
    </section>

    {!titleKind && <section aria-label="Movimentações registradas" id="movimentacoes">
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
    </section>}
  </section>
}
