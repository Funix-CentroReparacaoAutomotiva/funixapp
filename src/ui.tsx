import {money} from './money'
import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Atendimento } from '../shared/contracts'
import { api } from './api'
import type { Session } from './api'

export function Icon({ name }: { name: 'chat' | 'map' | 'diagnostics' | 'send' | 'bot' | 'spark' | 'mic' | 'attach' | 'photo' | 'document' | 'text' | 'flow' | 'edit' | 'search' | 'service' | 'component' }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {name === 'chat' && <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>}
    {name === 'map' && <path d="M3 8l7-4 6 4 5-3v11l-5 4-6-4-7 4zM10 4v12M16 8v12" />}
    {name === 'diagnostics' && <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />}
    {name === 'send' && <path d="m5 12 14-9-4 18-4-7-6-2z" />}
    {name === 'spark' && <path d="m12 3 2 6 6 1-5 4 2 6-5-4-5 4 2-6-5-4 6-1z" />}
    {name === 'mic' && <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>}
    {name === 'attach' && <path d="m21 11-9 9a5 5 0 0 1-7-7l10-9a3.5 3.5 0 0 1 5 5L9 19a2 2 0 0 1-3-3L17 6" />}
    {name === 'photo' && <><path d="M3 7h5l2-3h4l2 3h5v13H3z" /><circle cx="12" cy="13" r="3" /></>}
    {name === 'document' && <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>}
    {name === 'text' && <path d="M4 6h16M4 11h12M4 16h9" />}
    {name === 'flow' && <><path d="M6 8v6h9M11 14v6h4" /><rect x="3" y="3" width="6" height="5" rx="1" /><rect x="15" y="11" width="6" height="5" rx="1" /><rect x="15" y="19" width="6" height="3" rx="1" /></>}
    {name === 'edit' && <path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4" />}
    {name === 'search' && <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>}
    {name === 'service' && <path d="M14 4a5 5 0 0 0-6 6L3 15a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-3-3z" />}
    {name === 'component' && <path d="m3 7 9-5 9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10M7 4l10 6" />}
    {name === 'bot' && <><rect x="4.5" y="7" width="15" height="12" rx="3" /><path d="M12 4v3M9 4h6M8.5 12h.01M15.5 12h.01M9 16h6M2.5 11v4M21.5 11v4" /></>}
  </svg>
}
// V20 ordering and geometry; no simulated messages or AI actions.
export function ChatRail() {
  const actions = [
    ['spark', 'Sugestão'], ['chat', 'Chat IA'], ['mic', 'Áudio'],
    ['photo', 'Fotos'], ['document', 'Orçamento'], ['text', 'Olá'], ['flow', 'Mapa'],
  ] as const
  return <aside className="chat-rail" aria-label="IA do Atendimento">
    <span className="sr-only">IA ainda indisponível. Ações rápidas indisponíveis.</span><span className="rail-title">IA</span>
    {actions.map(([icon, label], index) => <div key={label}>
      {index === 3 && <><div className="rail-line" /><span className="rail-title">PRONTAS</span></>}
      <button className={`rail-btn ${index >= 3 && index <= 5 ? 'frequent' : ''}`} disabled title={`${label} ainda indisponível`} aria-label={`${label} indisponível`}><Icon name={icon} /><span>{label}</span></button>
    </div>)}
  </aside>
}
export function Notice({ title, children, retry, actionLabel = 'Tentar novamente', error = false }: {title: string; children?: ReactNode; retry?: () => void; actionLabel?: string; error?: boolean}) {
  return <div className={`fh-empty notice ${error ? 'notice-error' : ''}`} role={error ? 'alert' : 'status'}><strong>{title}</strong>{children && <p>{children}</p>}{retry && <button className="fh-filter" onClick={retry}>{actionLabel}</button>}</div>
}
export function RecordButton({ item, list = false, onOpen }: {item: Atendimento; list?: boolean; onOpen: (record: Atendimento) => void}) {
  const title = item.name || 'Sem nome'
  const vehicle=item.vehicle||[item.brand,item.model].filter(Boolean).join(' ')||'Sem veículo'
  const elapsed=item.lastContactAt?Math.max(0,Date.now()-Date.parse(item.lastContactAt)):null
  const age=elapsed===null?'◷?':elapsed<3600000?Math.floor(elapsed/60000)+' min':elapsed<172800000?Math.floor(elapsed/3600000)+' h':Math.floor(elapsed/86400000)+' d'
  const urgency=item.closedAt||item.stage==='rejeitados'?'closed':elapsed===null?'unknown':elapsed>120*3600000?'cold':elapsed>72*3600000?'late':elapsed>24*3600000?'attention':'current'

  const value=item.commercialValue,amount=value?value.min===value.max?money(value.min):money(value.min)+'–'+money(value.max):'—'
  return <button type="button" className={(list?'fh-row':'fh-card')+' funnel-compact urgency-'+urgency} onClick={()=>onOpen(item)}>
   <span className="funnel-first"><strong>{title}</strong><span title={item.lastContactAt?'Último contato: '+item.lastContactAt:'Horário do último contato desconhecido'} aria-label={elapsed===null?'Horário do último contato desconhecido':'Último contato há '+age}>{age}</span></span>
   <span className="funnel-phone">{item.phone||'Sem telefone'}</span>
   <span className="funnel-last"><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" style={{width:13,height:13,verticalAlign:'middle'}}><path d="m5 10 2-5h10l2 5M3 10h18v8H3zM6 18v3m12-3v3M6 14h2m8 0h2"/></svg> {vehicle}{item.plate?' · '+item.plate:''}</span><b title={'Faixa entre cenários calculados: '+amount}>{amount}</b></span>
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
