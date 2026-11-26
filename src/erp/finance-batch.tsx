import {useState} from 'react'
import type {FormEvent} from 'react'
import type {FinancialTitle} from '../../shared/finance'
import {api, type RequestFailure} from '../api'
import {PaymentMethodFields, readPaymentMethod} from '../PaymentMethodFields'
import {currency, decimal, inputCents, todayInSaoPaulo} from '../finance-format'
import type {FinanceCallbacks} from './finance-cash'

export function FinanceBatch({titles, onDone, onClose, onAuthRequired, onBusy}: FinanceCallbacks & {
  titles: FinancialTitle[]
  onDone: () => void
  onClose: () => void
}) {
  const [id] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const today = todayInSaoPaulo()
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const allocations = []
    for (const title of titles) {
      const amountCents = inputCents(String(form.get(title.id)))
      if (!amountCents || amountCents > title.balanceCents) {
        setError('Confira o valor da baixa para cada título selecionado.')
        return
      }
      allocations.push({titleId: title.id, amountCents})
    }
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      await api('/api/erp/finance/transactions', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id, kind: titles[0]?.kind, date: form.get('date'), allocations, ...readPaymentMethod(form) }),
      })
      onDone()
    } catch (cause) {
      const failure = cause as RequestFailure
      if (failure.status === 401) onAuthRequired()
      setError(failure.message)
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }
  return <form className="fin-form" onSubmit={save} aria-label="Baixa em grupo">
    <h2>Baixa em grupo</h2>
    <div className="fin-fields">
      <label>Data de caixa<input name="date" type="date" defaultValue={today} max={today} required /></label>
      <PaymentMethodFields disabled={busy} />
      {titles.map(title => <label key={title.id}>{title.description} · {title.counterparty}
        <input name={title.id} inputMode="decimal" defaultValue={decimal(title.balanceCents).replace('.', ',')} required />
        <small>Saldo disponível {currency(title.balanceCents)}</small>
      </label>)}
    </div>
    {error && <p className="fin-error" role="alert">{error}</p>}
    <div className="fin-actions">
      <button type="button" className="fin-button" onClick={onClose} disabled={busy}>Cancelar</button>
      <button className="primary-btn" disabled={busy}>{busy ? 'Salvando…' : 'Confirmar transação'}</button>
    </div>
  </form>
}
