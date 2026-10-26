import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento } from '../shared/contracts'
import { api } from './api'
import type { Session } from './api'

export function Icon({ name }: { name: 'chat' | 'map' | 'diagnostics' | 'send' | 'bot' }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === 'chat' && <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>}
    {name === 'map' && <path d="M3 8l7-4 6 4 5-3v11l-5 4-6-4-7 4zM10 4v12M16 8v12" />}
    {name === 'diagnostics' && <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />}
    {name === 'send' && <path d="m5 12 14-9-4 18-4-7-6-2z" />}
    {name === 'bot' && <><rect x="4.5" y="7" width="15" height="12" rx="3" /><path d="M12 4v3M9 4h6M8.5 12h.01M15.5 12h.01M9 16h6M2.5 11v4M21.5 11v4" /></>}
  </svg>
}
export function Notice({ title, children, retry, actionLabel = 'Tentar novamente', error = false }: {title: string; children?: ReactNode; retry?: () => void; actionLabel?: string; error?: boolean}) {
  return <div className={`fh-empty notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}><strong>{title}</strong>{children && <p>{children}</p>}{retry && <button className="fh-filter" onClick={retry}>{actionLabel}</button>}</div>
}
export function RecordButton({ item, list = false, onOpen }: {item: Atendimento; list?: boolean; onOpen: (record: Atendimento) => void}) {
  const title = item.name || item.phone
  const stage = ATENDIMENTO_STAGES.find(stage => stage.id === item.stage)?.name
  const vehicle = item.vehicle || [item.brand, item.model].filter(Boolean).join(' ')
  return <button type="button" className={list ? 'fh-row' : 'fh-card'} onClick={() => onOpen(item)}>
    {list && <span className="fh-avatar" aria-hidden="true">{title.slice(0, 1).toUpperCase()}</span>}
    <span className={list ? 'fh-rowmain' : 'fh-cardmain'}><strong>{title}</strong><span className="record-description">{[vehicle, item.plate].filter(Boolean).join(' · ') || 'Veículo não informado'}{item.name && <><br />{item.phone}</>}{item.reason && <><br />{item.reason}</>}</span><span className="fh-cardfoot"><span title={item.id}>ID {item.id.slice(0, 8)}…</span>{!list && <b>Abrir ↗</b>}</span></span>
    {list && <span className="fh-pill blue">{stage}</span>}
  </button>
}
export function Login({ session, error, refresh, onSession }: {session: Session | null; error: string; refresh: () => void; onSession: (session: Session) => void}) {
  const [password, setPassword] = useState(''), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFailure('')
    try { const result = await api<Session>('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); setPassword(''); onSession(result) }
    catch (cause) { setFailure((cause as Error).message) } finally { setBusy(false) }
  }
  if (error) return <div className="fh-surface"><Notice title="Não foi possível verificar o acesso" error retry={refresh}>{error}</Notice></div>
  if (!session) return <div className="fh-surface"><Notice title="Verificando acesso…" /></div>
  if (!session.configured) return <div className="fh-surface"><Notice title="Acesso em preparação">O acesso ao aplicativo ainda não foi configurado. Os registros da FUNIX permanecem protegidos.</Notice></div>
  return <form className="fh-surface login" onSubmit={login}><h1>Acessar FUNIX</h1><p>Entre para trabalhar nos Atendimentos da oficina.</p><label htmlFor="password">Senha de acesso</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />{failure && <p role="alert" className="form-error">{failure}</p>}<button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button></form>
}
