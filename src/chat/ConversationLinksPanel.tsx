import { useEffect, useState } from 'react'
import { api } from '../api'
import type { RequestFailure } from '../api'
type Linked = { linkId: string; atendimentoId: string; linkedAt: string; name: string; vehicle: string; plate: string }
type Links = { revision: number; items: Linked[]; activeAtendimentoId: string | null }
type Candidate = { id: string; name: string; vehicle: string; plate: string }
type List = { items: Candidate[]; total: number }
function description(row: Candidate | Linked): string {
  return [row.name || 'Atendimento sem nome', row.vehicle, row.plate].filter(Boolean).join(' · ')
}
function errorText(error: unknown): string {
  if ((error as RequestFailure).status === 409) return 'Vínculo alterado durante a operação. Atualize e tente novamente.'
  return 'Não foi possível concluir. Confira os dados e tente novamente.'
}
/** Explicit operator choice only; no phone/PN/LID-based automatic association. */
export function ConversationLinksPanel({ conversationId, onUnauthorized }: { conversationId: string; onUnauthorized: () => void }) {
  const base = '/api/chat/conversations/' + encodeURIComponent(conversationId)
  const [links, setLinks] = useState<Links | null>(null)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      void api<Links>(base + '/atendimentos', { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) setLinks(value) })
        .catch(cause => {
          if (controller.signal.aborted) return
          if ((cause as RequestFailure).status === 401) onUnauthorized()
          else setError(errorText(cause))
        })
    })
    return () => controller.abort()
  }, [base, onUnauthorized])

  async function reload() {
    try { setLinks(await api<Links>(base + '/atendimentos')) }
    catch (cause) {
      if ((cause as RequestFailure).status === 401) onUnauthorized()
      else setError(errorText(cause))
    }
  }
  async function search() {
    if (query.trim().length < 2 || busy || searching) return
    setSearching(true); setCandidates([]); setError('')
    try {
      const list = await api<List>('/api/atendimentos?q=' + encodeURIComponent(query.trim()) + '&limit=20&offset=0')
      setCandidates(list.items)
    } catch (cause) {
      if ((cause as RequestFailure).status === 401) onUnauthorized()
      else setError(errorText(cause))
    } finally { setSearching(false) }
  }
  async function change(kind: 'link' | 'unlink' | 'context', id: string | null) {
    if (!links || busy) return
    if (kind !== 'context' && !reason.trim()) { setError('Informe o motivo da alteração.'); return }
    const url = kind === 'context' ? base + '/context' : kind === 'link'
      ? base + '/atendimentos' : base + '/atendimentos/' + encodeURIComponent(id!)
    const body = kind === 'context' ? { linkId: id } :
      { expectedRevision: links.revision, requestId: crypto.randomUUID(), reason: reason.trim(),
        ...(kind === 'link' ? { atendimentoId: id } : {}) }
    setBusy(true); setError('')
    try {
      await api(url, { method: kind === 'unlink' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      await reload()
      setReason(''); setCandidates([]); setPendingRemove(null)
    } catch (cause) {
      if ((cause as RequestFailure).status === 401) onUnauthorized()
      else setError(errorText(cause))
      if ((cause as RequestFailure).status === 409) await reload()
    } finally { setBusy(false) }
  }

  return <section className="ev-links" aria-label="Vínculos com Atendimentos">
    <header><strong>Atendimentos desta conversa</strong>
      <button type="button" onClick={() => void reload()} disabled={busy}>Atualizar vínculos</button></header>
    <p className="ev-links-hint">Vínculo manual. Uma conversa pode participar de vários Atendimentos. O histórico não muda ao selecionar outro contexto.</p>
    {error && <p role="alert" className="ev-links-error">{error}</p>}
    {!links ? <p>Carregando vínculos…</p> : <>
      {links.items.length === 0 && <p>Nenhum Atendimento vinculado.</p>}
      {links.items.map(item => <div className="ev-linked" key={item.linkId}>
        <span>{description(item)}</span>
        <div className="ev-link-actions">
          <button type="button" disabled={busy}
            aria-pressed={links.activeAtendimentoId === item.atendimentoId}
            onClick={() => void change('context', links.activeAtendimentoId === item.atendimentoId ? null : item.linkId)}>
            {links.activeAtendimentoId === item.atendimentoId ? 'Contexto ativo ✓' : 'Usar contexto'}</button>
          {pendingRemove === item.linkId ? <>
            <button type="button" disabled={busy || !reason.trim()} onClick={() => void change('unlink', item.linkId)}>Confirmar desvínculo</button>
            <button type="button" disabled={busy} onClick={() => setPendingRemove(null)}>Cancelar</button>
          </> : <button type="button" disabled={busy} onClick={() => setPendingRemove(item.linkId)}>Desvincular</button>}
        </div>
      </div>)}
      <label className="ev-link-field">Motivo para vincular ou desvincular
        <input type="text" value={reason} maxLength={500} disabled={busy}
          placeholder="Ex.: solicitação do cliente" onChange={event => setReason(event.target.value)} /></label>
      <div className="ev-link-search">
        <label>Localizar Atendimento existente
          <input type="search" maxLength={150} value={query} disabled={busy}
            placeholder="Nome, telefone ou placa" onChange={event => { setQuery(event.target.value); setCandidates([]) }} /></label>
        <button type="button" onClick={() => void search()} disabled={busy || searching || query.trim().length < 2}>
          {searching ? 'Buscando…' : 'Buscar'}</button>
      </div>
      {candidates.map(candidate => {
        const existing = links.items.some(link => link.atendimentoId === candidate.id)
        return <div className="ev-linked" key={candidate.id}>
          <span>{description(candidate)}</span>
          <button type="button" disabled={busy || existing || !reason.trim()}
            onClick={() => void change('link', candidate.id)}>{existing ? 'Já vinculado' : 'Vincular'}</button>
        </div>
      })}
    </>}
  </section>
}
