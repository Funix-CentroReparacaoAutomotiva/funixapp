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
  const listRequest = useRef<AbortController | null>(null)
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

  function refreshList() {
    listRequest.current?.abort()
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

  function open(row: ConversationRow) {
    if (row.atendimentoId && onOpenAtendimento) {
      setUnlinked(null)
      onOpenAtendimento(row.atendimentoId, 'chat', row.conversationId)
      return
    }
    setUnlinked(current => current === row.conversationId ? null : row.conversationId)
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
          <button type="button" className="ev-item" onClick={() => open(row)}
            aria-expanded={!row.atendimentoId ? unlinked === row.conversationId : undefined}>
            <strong>{conversationLabel(row)}</strong>
            <span>{row.updatedAt ? `Atualização: ${date.format(new Date(row.updatedAt))}` : 'Data não informada'}</span>
            <small>{row.atendimentoId ? 'Abrir Chat do Atendimento' : 'Atendimento não vinculado'}</small>
          </button>
          {unlinked === row.conversationId && !row.atendimentoId && <section className="ev-unlinked" aria-label="Conversa sem Atendimento">
            <strong>Esta conversa ainda não tem Atendimento confirmado.</strong>
            <p>Não é possível abrir o Chat de um Atendimento sem um vínculo. A associação não será feita automaticamente pelo nome ou telefone.</p>
            {linksEnabled && <ConversationLinksPanel key={row.conversationId} conversationId={row.conversationId} onUnauthorized={onUnauthorized} />}
            <p className="ev-links-hint">Se o Atendimento já existir no Funil, confira o vínculo antes de abrir o histórico dele.</p>
          </section>}
        </div>)}
      </div>}
      {nextSkip !== null && <button type="button" className="fh-filter ev-more" disabled={listBusy} onClick={moreList}>
        {listBusy ? 'Carregando…' : 'Carregar mais conversas'}
      </button>}
    </div>
  </section>
}
