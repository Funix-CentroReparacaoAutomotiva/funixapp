import { useEffect, useState } from 'react'
import { api } from '../api'
import type { RequestFailure } from '../api'
type Linked = { linkId: string; atendimentoId: string; linkedAt: string; name: string; vehicle: string; plate: string }
type Links = { revision: number; items: Linked[]; activeAtendimentoId: string | null; suggestedAtendimentos?:Candidate[]; atendimentoConflict?:boolean; numberReviewAvailable?:boolean; historyOnly?:boolean }
type Candidate = { id: string; name: string; vehicle: string; plate: string }
type List = { items: Candidate[]; total: number }
type NumberReview = {token:string;entityName:string;registeredPhone:string;observedPhone:string}
function description(row: Candidate | Linked): string {
  return [row.name || 'Atendimento sem nome', row.vehicle, row.plate].filter(Boolean).join(' · ')
}
function errorText(error: unknown): string {
  const failure=error as RequestFailure
  const message=failure.code==='V20_ASSOCIATION_CONFLICT'?'Vínculo alterado durante a operação. Atualize e tente novamente.':failure.message
  return [message||'Não foi possível concluir. Confira os dados e tente novamente.',
    failure.requestId?'Referência: '+failure.requestId:''].filter(Boolean).join(' ')
}
/** Explicit operator choice only; no phone/PN/LID-based automatic association. */
export function ConversationLinksPanel({ conversationId, onUnauthorized, onActiveAtendimentoChange, onLinksChange, onOpenLinkedAtendimento }: {
  conversationId: string
  onUnauthorized: () => void
  onLinksChange?: (links:Links)=>void
  onActiveAtendimentoChange?: (atendimentoId: string | null) => void
  onOpenLinkedAtendimento?: (id: string) => void
}) {
  const base = '/api/chat/conversations/' + encodeURIComponent(conversationId)
  const [links, setLinks] = useState<Links | null>(null)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [review,setReview] = useState<{candidate:Candidate;preview:NumberReview}|null>(null)
  const [confirmed,setConfirmed] = useState(false)
  const [reviewRequest,setReviewRequest] = useState<{reason:string;id:string}|null>(null)

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      void api<Links>(base + '/atendimentos', { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) {
            setLinks(value);onLinksChange?.(value)
            onActiveAtendimentoChange?.(value.activeAtendimentoId)
          } })
        .catch(cause => {
          if (controller.signal.aborted) return
          if ((cause as RequestFailure).status === 401) onUnauthorized()
          else setError(errorText(cause))
        })
    })
    return () => controller.abort()
  }, [base, onUnauthorized, onActiveAtendimentoChange, onLinksChange])

  async function reload() {
    try {
      const value = await api<Links>(base + '/atendimentos')
      setLinks(value);onLinksChange?.(value)
      onActiveAtendimentoChange?.(value.activeAtendimentoId)
      return value
    }
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
  async function reviewNumber(candidate:Candidate) {
    if(busy)return
    setBusy(true);setError('');setReview(null);setConfirmed(false);setReviewRequest(null)
    try{
      const preview=await api<NumberReview>(base+'/atendimentos/'+encodeURIComponent(candidate.id)+'/numeracao')
      setReview({candidate,preview})
    }catch(cause){
      if((cause as RequestFailure).status===401)onUnauthorized()
      else setError(errorText(cause))
    }finally{setBusy(false)}
  }
  async function confirmNumber() {
    if(!review||!confirmed||!reason.trim()||busy)return
    const reasonText=reason.trim()
    const requestId=reviewRequest?.reason===reasonText?reviewRequest.id:crypto.randomUUID()
    setReviewRequest({reason:reasonText,id:requestId});setBusy(true);setError('')
    try{
      await api(base+'/atendimentos/'+encodeURIComponent(review.candidate.id)+'/numeracao',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:review.preview.token,requestId,reason:reasonText}),
      })
      setReview(null);setConfirmed(false);setReason('');setCandidates([])
      const current=await reload()
      if(current?.items.some(link=>link.atendimentoId===review.candidate.id))onOpenLinkedAtendimento?.(review.candidate.id)
      else if(current)setError('O vínculo já foi removido. Atualize a conversa antes de tentar novamente.')
    }catch(cause){
      if((cause as RequestFailure).status===401)onUnauthorized()
      else setError(errorText(cause))
      if((cause as RequestFailure).status===409){setReview(null);await reload()}
    }finally{setBusy(false)}
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
      {links.historyOnly&&<p role="status">Histórico vinculado para leitura. O envio permanece bloqueado para este número.</p>}
      {links.items.map(item => <div className="ev-linked" key={item.linkId}>
        <span>{description(item)}</span>
        <div className="ev-link-actions">
          {!links.historyOnly&&<button type="button" disabled={busy}
            aria-pressed={links.activeAtendimentoId === item.atendimentoId}
            onClick={() => void change('context', links.activeAtendimentoId === item.atendimentoId ? null : item.linkId)}>
            {links.activeAtendimentoId === item.atendimentoId ? 'Contexto ativo ✓' : 'Usar contexto'}</button>}
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
      {links.atendimentoConflict&&<p role="status">Há fichas com dados de titularidade divergentes. Confira o cadastro antes de vincular.</p>}
      {!query.trim()&&!!links.suggestedAtendimentos?.length&&<p role="status">Confirme qual Atendimento deve receber este vínculo.</p>}
      {review&&<fieldset className="ev-number-review">
        <legend>Confirmar número do WhatsApp</legend>
        <p>{review.preview.entityName} · {description(review.candidate)}</p>
        <p>WhatsApp <strong>{review.preview.observedPhone}</strong><br/>Cadastro <strong>{review.preview.registeredPhone}</strong></p>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>
          Conferi que os dois números pertencem ao mesmo contato.
        </label>
        <p>O histórico ficará disponível na ficha para leitura.</p>
        <button type="button" disabled={busy||!confirmed||!reason.trim()} onClick={()=>void confirmNumber()}>Confirmar e vincular histórico</button>
        <button type="button" disabled={busy} onClick={()=>setReview(null)}>Cancelar revisão</button>
      </fieldset>}
      {(query.trim()?candidates:links.suggestedAtendimentos??[]).map(candidate => {
        const existing = links.items.some(link => link.atendimentoId === candidate.id)
        return <div className="ev-linked" key={candidate.id}>
          <span>{description(candidate)}</span>
          {links.numberReviewAvailable&&!existing
            ? <button type="button" disabled={busy||!!review} onClick={()=>void reviewNumber(candidate)}>Revisar numeração</button>
            : <button type="button" disabled={busy || existing || !reason.trim()}
                onClick={() => void change('link', candidate.id)}>{existing ? 'Já vinculado' : 'Vincular'}</button>}
        </div>
      })}
    </>}
  </section>
}
