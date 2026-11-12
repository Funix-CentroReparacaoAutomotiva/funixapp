import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { RequestFailure } from '../api'
import { Notice } from '../ui'
import { ConversationLinksPanel } from './ConversationLinksPanel'
import { parseConversationList } from './evolution-read-model'
import type { ConversationRow } from './evolution-read-model'
import './evolution-read.css'

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
function conversationLabel(row: ConversationRow): string {
  return row.displayName || (row.phoneNumber ? '+' + row.phoneNumber : 'Contato não identificado')
}
type CandidateAtendimento = { id: string; phone: string; phoneNormalized?: string | null; name: string; vehicle?: string; plate?: string; stage?: string }
type Choice = { items: CandidateAtendimento[] }
const stageNames: Record<string, string> = {
  'novo-lead': 'Novo lead', 'aguardando-dados': 'Aguardando dados',
  'em-negociacao': 'Em negociação', morno: 'Morno', frio: 'Frio',
  rejeitados: 'Rejeitado',
}
type AtendimentoSearch = { items: CandidateAtendimento[]; nextOffset: number | null }
/** A navigation lookup, NOT a permanent conversation association.
 * A Brazilian +55 prefix is only a formatting difference. Never add a ninth digit.
 */
function comparablePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.startsWith('55') && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : digits
}
function listErrorLabel(cause: unknown) {
  const error = cause as RequestFailure
  return error.status === 503
    ? 'A Evolution não respondeu. Atualize a lista para tentar novamente.'
    : 'Não foi possível carregar as conversas. Confira a conexão e tente novamente.'
}

/**
 * Conversas é uma entrada para o Atendimento, não um segundo Chat.
 * A navegação só usa o Atendimento canônico confirmado no servidor;
 * contatos sem vínculo têm uma ação explícita, sem adivinhar por telefone.
 */
export function EvolutionConversationReader({ onUnauthorized, onOpenAtendimento }: {
  onUnauthorized: () => void
  onOpenAtendimento?: (atendimentoId: string, tab: 'chat' | 'diagnosticos' | 'mapa', conversationId?: string) => void
}) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [linksEnabled, setLinksEnabled] = useState(false)
  const [list, setList] = useState<ConversationRow[]>([])
  const [nextSkip, setNextSkip] = useState<number | null>(null)
  const [unlinked, setUnlinked] = useState<string | null>(null)
  const [listBusy, setListBusy] = useState(false)
  const [listError, setListError] = useState('')
  const [version, setVersion] = useState(0)
  const [lookupBusy, setLookupBusy] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState('')
  const [choice, setChoice] = useState<Choice | null>(null)
  const choiceDialog = useRef<HTMLDialogElement | null>(null)
  const listRequest = useRef<AbortController | null>(null)
  const lookupRequest = useRef<AbortController | null>(null)
  const loadingMore = useRef(false)

  const loadList = useCallback(async (skip: number, controller: AbortController) => {
    try {
      const result = parseConversationList(await api<unknown>(`/api/chat/conversations?skip=${skip}`, { signal: controller.signal }))
      if (controller.signal.aborted) return
      setAvailable(true)
      setLinksEnabled(result.linksEnabled === true)
      setList(previous => skip === 0 ? result.items : [
        ...previous, ...result.items.filter(row => !previous.some(known => known.conversationId === row.conversationId)),
      ])
      setNextSkip(result.nextSkip)
      setListError('')
    } catch (cause) {
      if (controller.signal.aborted) return
      const error = cause as RequestFailure
      if (error.status === 401) { onUnauthorized(); return }
      if (error.status === 404 && skip === 0) {
        setAvailable(false); setList([]); setNextSkip(null); return
      }
      setListError(listErrorLabel(cause))
    } finally {
      if (!controller.signal.aborted) setListBusy(false)
      loadingMore.current = false
    }
  }, [onUnauthorized])

  useEffect(() => {
    const controller = new AbortController()
    listRequest.current = controller
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setListBusy(true)
      setListError('')
      void loadList(0, controller)
    })
    return () => controller.abort()
  }, [loadList, version])

  useEffect(() => () => lookupRequest.current?.abort(), [])

  useEffect(() => {
    if (choice && choiceDialog.current && !choiceDialog.current.open) {
      choiceDialog.current.showModal()
    }
  }, [choice])

  function refreshList() {
    listRequest.current?.abort()
    lookupRequest.current?.abort()
    setLookupBusy(null); setChoice(null); setLookupError('')
    setUnlinked(null); setList([]); setNextSkip(null)
    setAvailable(null); setLinksEnabled(false)
    setVersion(value => value + 1)
  }

  function moreList() {
    if (nextSkip === null || listBusy || loadingMore.current) return
    loadingMore.current = true
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    setListBusy(true); setListError('')
    void loadList(nextSkip, controller)
  }

  async function open(row: ConversationRow) {
    lookupRequest.current?.abort()
    setLookupBusy(null); setLookupError(''); setChoice(null)
    if (row.atendimentoId && onOpenAtendimento) {
      setUnlinked(null)
      onOpenAtendimento(row.atendimentoId, 'chat', row.conversationId)
      return
    }
    // The list may predate a successful Coda→FunixApp event. Recheck the
    // canonical mapping before relying on local phone matches as navigation.
    // A 200/null response is an expected missing link, not permission to
    // fabricate one or to merge manual records between systems.
    const canonicalController = new AbortController()
    lookupRequest.current = canonicalController
    setLookupBusy(row.conversationId)
    try {
      const current = await api<{ atendimentoId: string | null }>(
        '/api/chat/conversations/' + encodeURIComponent(row.conversationId) + '/active-atendimento',
        { signal: canonicalController.signal },
      )
      if (canonicalController.signal.aborted) return
      if (current.atendimentoId && onOpenAtendimento) {
        setLookupBusy(null)
        onOpenAtendimento(current.atendimentoId, 'chat', row.conversationId)
        return
      }
    } catch (cause) {
      if (canonicalController.signal.aborted) return
      const error = cause as RequestFailure
      if (error.status === 401) { onUnauthorized(); return }
      // Fail safely if the authoritative lookup is unavailable. Display the
      // problem instead of using a phone match as proof of an active context.
      if (error.status !== 404) {
        setLookupBusy(null)
        setUnlinked(row.conversationId)
        setLookupError('Não foi possível conferir o Atendimento vinculado. Tente novamente.')
        return
      }
      // 404 is possible on older servers with the resolver not yet deployed.
    } finally {
      if (!canonicalController.signal.aborted) setLookupBusy(null)
    }
    // A first tap performs the lookup. The operator should not have to open an
    // intermediate panel just to discover the only matching Atendimento.
    // This is navigation only; it MUST NOT create an ERP record or a link.
    setUnlinked(null)
    // The Funil can contain an Atendimento before this Evolution JID has
    // received a canonical Coda event. Search existing records on click.
    const phone = row.phoneNumber ? comparablePhone(row.phoneNumber) : ''
    // Never search by display name: it is not identity evidence. A LID-only
    // conversation stays pending until a trusted PN/canonical mapping exists.
    // Require an unambiguous Brazilian DDD + subscriber number for this
    // legacy navigation lookup; never synthesize digits from a LID.
    if (!/^[1-9][0-9][0-9]{8,9}$/.test(phone)) {
      setUnlinked(row.conversationId)
      setLookupError('Telefone confiável indisponível. A identidade da conversa precisa ser confirmada antes de abrir um Atendimento.')
      return
    }
    const query = phone
    const controller = new AbortController()
    lookupRequest.current = controller
    setLookupBusy(row.conversationId)
    try {
      let offset = 0
      let incomplete = false
      const matches = new Map<string, CandidateAtendimento>()
      for (let batch = 0; batch < 10; batch++) {
        const result = await api<AtendimentoSearch>(
          `/api/atendimentos?q=${encodeURIComponent(query)}&limit=100&offset=${offset}`,
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        if (!Array.isArray(result.items)) throw new Error('INVALID_ATENDIMENTO_SEARCH')
        for (const item of result.items) {
          if (!item || typeof item.id !== 'string' || typeof item.phone !== 'string') continue
          // Exact telephone match allows automatic NAVIGATION, never a new link.
          if (comparablePhone(item.phoneNormalized || item.phone) === phone)
            matches.set(item.id, item)
        }
        if (result.nextOffset === null) break
        if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset) throw new Error('INVALID_PAGINATION')
        offset = result.nextOffset
        if (batch === 9) incomplete = true
      }
      if (controller.signal.aborted) return
      const found = [...matches.values()]
      // A phone match is navigation, NOT proof that this record is the
      // current Coda Atendimento or that its WhatsApp history is linked.
      // The local stage is not a reliable indication of Coda closure.
      if (phone && !incomplete && found.length === 1 && onOpenAtendimento) {
        onOpenAtendimento(found[0]!.id, 'chat')
        return
      }
      if (phone && !incomplete && found.length > 1) {
        setChoice({ items: found })
        return
      }
      // Missing canonical events are an integration exception, not a reason
      // to create another Atendimento through a browser click.
      setUnlinked(row.conversationId)
      setLookupError(incomplete
        ? 'Consulta incompleta. Atualize a lista e confira a sincronização.'
        : !found.length
          ? 'Atendimento não identificado nesta consulta. A sincronização precisa ser verificada; não crie uma ficha duplicada.'
          : 'Não há Atendimento aberto identificado com segurança para esta conversa. Confira a sincronização.')
    } catch (cause) {
      if (controller.signal.aborted) return
      if ((cause as RequestFailure).status === 401) { onUnauthorized(); return }
      setUnlinked(row.conversationId)
      setLookupError('Não foi possível consultar os Atendimentos. Tente novamente.')
    } finally {
      if (!controller.signal.aborted) setLookupBusy(null)
    }
  }

  if (available === false) return <div className="fh-surface">
    <Notice title="Conversas indisponíveis">A consulta de conversas não está habilitada. Os Atendimentos continuam disponíveis no Funil.</Notice>
  </div>

  return <section className="ev-reader" aria-label="Conversas WhatsApp">
    <div className="ev-conversations-pane">
      <div className="ev-header"><strong>Conversas</strong>
        <button type="button" className="fh-filter" onClick={refreshList} disabled={listBusy}>Atualizar lista</button>
      </div>
      {listBusy && !list.length && <Notice title="Carregando conversas…" />}
      {listError && <Notice title="Falha na lista" error retry={refreshList}>{listError}</Notice>}
      {!listBusy && available === true && !listError && !list.length &&
        <Notice title="Nenhuma conversa retornada">Atualize a lista para consultar novamente.</Notice>}
      {list.length > 0 && <div className="ev-list" aria-label="Lista de conversas">
        {list.map(row => <div key={row.conversationId}>
          <button type="button" className="ev-item" onClick={() => { void open(row) }}
            disabled={lookupBusy !== null}
            aria-expanded={!row.atendimentoId ? unlinked === row.conversationId : undefined}>
            <strong>{conversationLabel(row)}</strong>
            <span>{row.updatedAt ? `Atualização: ${date.format(new Date(row.updatedAt))}` : 'Data não informada'}</span>
            {lookupBusy === row.conversationId && <small>Localizando Atendimento…</small>}
          </button>
          {unlinked === row.conversationId && !row.atendimentoId && <section className="ev-unlinked" aria-label="Conversa sem Atendimento">
            <strong>Vínculo pendente</strong>
            {lookupError && <p role="status">{lookupError}</p>}
            <button type="button" className="fh-filter" onClick={refreshList} disabled={listBusy}>Verificar novamente</button>
            {linksEnabled && <ConversationLinksPanel key={row.conversationId} conversationId={row.conversationId} onUnauthorized={onUnauthorized} />}

          </section>}
        </div>)}
      </div>}
      {nextSkip !== null && <button type="button" className="fh-filter ev-more" disabled={listBusy} onClick={moreList}>
        {listBusy ? 'Carregando…' : 'Carregar mais conversas'}
      </button>}
    </div>
    {choice && <dialog className="ev-choice-dialog" ref={choiceDialog}
      aria-labelledby="ev-choice-title" onClose={() => setChoice(null)}>
      <header>
        <strong id="ev-choice-title">Qual Atendimento deseja abrir?</strong>
        <button type="button" aria-label="Fechar seleção" onClick={() => setChoice(null)}>×</button>
      </header>
      <p>Foram encontradas várias fichas com este telefone. Escolha a correta; essa seleção não vincula o histórico WhatsApp.</p>
      <div className="ev-choice-items">
        {choice.items.map(item => <button key={item.id} type="button" onClick={() => {
          setChoice(null)
          onOpenAtendimento?.(item.id, 'chat')
        }}>
          <strong>{item.name || 'Atendimento sem nome'}</strong>
          <span>{[item.vehicle, item.plate, stageNames[item.stage ?? ''] || item.stage].filter(Boolean).join(' · ') || 'Sem detalhes cadastrados'}</span>
        </button>)}
      </div>
      <p className="ev-links-hint">Escolher uma ficha não cria um vínculo com a Evolution; sem associação canônica, o histórico poderá continuar indisponível.</p>
    </dialog>}
  </section>
}
