import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { RequestFailure } from '../api'
import { Notice } from '../ui'
import { ConversationLinksPanel } from './ConversationLinksPanel'
import { mergeReadMessages, parseConversationList, parseConversationMessages } from './evolution-read-model'
import type { ConversationRow, ReadUiMessage } from './evolution-read-model'
import './evolution-read.css'

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const time = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
function conversationLabel(row: ConversationRow): string {
  if (row.displayName) return row.displayName
  if (row.phoneNumber) return '+' + row.phoneNumber
  return 'Contato não identificado'
}
const mediaNames: Record<ReadUiMessage['kind'], string> = {
  text: 'Texto', image: 'Imagem', audio: 'Áudio', video: 'Vídeo',
  document: 'Documento', unsupported: 'Formato não disponível',
}
function errorLabel(cause: unknown): string {
  const error = cause as RequestFailure
  if (error.status === 503) return 'A Evolution está indisponível ou não respondeu. Nenhuma conclusão sobre o histórico pode ser tirada.'
  if (error.status === 404) return 'Esta conversa temporária expirou. Atualize a lista para continuar.'
  return 'Não foi possível carregar os dados. Confira a conexão e tente novamente.'
}

export function EvolutionConversationReader({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [linksEnabled, setLinksEnabled] = useState(false)
  const [list, setList] = useState<ConversationRow[]>([])
  const [nextSkip, setNextSkip] = useState<number | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<ReadUiMessage[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [listBusy, setListBusy] = useState(false)
  const [messageBusy, setMessageBusy] = useState(false)
  const [listError, setListError] = useState('')
  const [messageError, setMessageError] = useState('')
  const [listVersion, setListVersion] = useState(0)
  const [messageVersion, setMessageVersion] = useState(0)
  const listRequest = useRef<AbortController | null>(null)
  const messageRequest = useRef<AbortController | null>(null)
  const loadingMore = useRef(false)

  const loadList = useCallback(async (skip: number, controller: AbortController) => {
    try {
      const result = parseConversationList(await api<unknown>(`/api/chat/conversations?skip=${skip}`, { signal: controller.signal }))
      if (controller.signal.aborted) return
      setAvailable(true)
      setLinksEnabled(result.linksEnabled)
      setList(previous => skip === 0 ? result.items : [
        ...previous, ...result.items.filter(row => !previous.some(known => known.conversationId === row.conversationId)),
      ])
      setNextSkip(result.nextSkip)
      setListError('')
    } catch (cause) {
      if (controller.signal.aborted) return
      const error = cause as RequestFailure
      if (error.status === 401) { onUnauthorized(); return }
      if (error.status === 404 && skip === 0) { setAvailable(false); setList([]); setNextSkip(null); return }
      setListError(errorLabel(cause))
    } finally {
      if (!controller.signal.aborted) setListBusy(false)
      loadingMore.current = false
    }
  }, [onUnauthorized])

  useEffect(() => {
    const controller = new AbortController()
    listRequest.current = controller
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setListBusy(true)
        setListError('')
        void loadList(0, controller)
      }
    })
    return () => controller.abort()
  }, [loadList, listVersion])

  const loadPage = useCallback(async (conversationId: string, page: number, controller: AbortController) => {
    try {
      const result = parseConversationMessages(await api<unknown>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages?page=${page}`,
        { signal: controller.signal },
      ), conversationId)
      if (controller.signal.aborted) return
      setMessages(previous => page === 1 ? mergeReadMessages([], result.items) : mergeReadMessages(previous, result.items))
      setNextPage(result.nextPage)
      setMessageError('')
    } catch (cause) {
      if (controller.signal.aborted) return
      const error = cause as RequestFailure
      if (error.status === 401) { onUnauthorized(); return }
      setMessageError(errorLabel(cause))
    } finally { if (!controller.signal.aborted) setMessageBusy(false) }
  }, [onUnauthorized])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    messageRequest.current = controller
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setMessageBusy(true)
        setMessageError('')
        void loadPage(selected, 1, controller)
      }
    })
    return () => controller.abort()
  }, [selected, messageVersion, loadPage])

  function choose(conversationId: string) {
    if (selected === conversationId) return
    messageRequest.current?.abort()
    setMessages([])
    setNextPage(null)
    setMessageError('')
    setSelected(conversationId)
  }

  function refreshList() {
    listRequest.current?.abort()
    messageRequest.current?.abort()
    setSelected(null)
    setMessages([])
    setNextPage(null)
    setList([])
    setNextSkip(null)
    setAvailable(null)
    setLinksEnabled(false)
    setListVersion(value => value + 1)
  }

  function moreList() {
    if (nextSkip === null || listBusy || loadingMore.current) return
    loadingMore.current = true
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    setListBusy(true)
    setListError('')
    void loadList(nextSkip, controller)
  }

  function moreMessages() {
    if (!selected || nextPage === null || messageBusy) return
    messageRequest.current?.abort()
    const controller = new AbortController()
    messageRequest.current = controller
    setMessageBusy(true)
    setMessageError('')
    void loadPage(selected, nextPage, controller)
  }

  if (available === false) return <div className="fh-surface">
    <Notice title="Chat WhatsApp ainda indisponível">A integração de conversas não está habilitada neste FunixApp. Os Atendimentos continuam disponíveis no Funil.</Notice>
  </div>

  return <section className="ev-reader" aria-label="Conversas WhatsApp — leitura experimental">
    <div className="ev-header">
      <div><strong>Conversas · somente leitura</strong><small>Evolution · histórico não verificado como completo</small></div>
      <button type="button" className="fh-filter" onClick={refreshList} disabled={listBusy}>Atualizar lista</button>
    </div>
    <p className="ev-warning">Piloto de leitura. {linksEnabled ? 'Vínculos manuais com Atendimentos habilitados; histórico permanece na Evolution.' : 'Identificadores temporários que podem expirar após 30 minutos ou reinício. Nenhum Atendimento vinculado automaticamente.'}</p>
    {listBusy && !list.length && <Notice title="Carregando conversas…" />}
    {listError && <Notice title="Falha na lista" error retry={refreshList}>{listError}</Notice>}
    {!listBusy && available === true && !listError && !list.length && <Notice title="Nenhuma conversa retornada">A consulta não comprova que o histórico está vazio.</Notice>}
    {list.length > 0 && <div className="ev-list" aria-label="Lista de conversas">
      {list.map(row => <button type="button" key={row.conversationId}
        className={selected === row.conversationId ? 'ev-item selected' : 'ev-item'}
        onClick={() => choose(row.conversationId)} aria-pressed={selected === row.conversationId}>
        <strong>{conversationLabel(row)}</strong>
        <span>{row.updatedAt ? `Atualização: ${date.format(new Date(row.updatedAt))}` : 'Data não informada'}</span>
        {row.unreadCount !== null && <small>{row.unreadCount} não lida(s) informadas pelo provedor</small>}
      </button>)}
    </div>}
    {nextSkip !== null && <button type="button" className="fh-filter ev-more" disabled={listBusy} onClick={moreList}>
      {listBusy ? 'Carregando…' : 'Carregar mais conversas'}
    </button>}
    {selected && linksEnabled && <ConversationLinksPanel key={selected} conversationId={selected} onUnauthorized={onUnauthorized} />}
    {selected && <section className="ev-history" aria-label="Histórico da conversa">
      <header><strong>Histórico · somente leitura</strong><button type="button" className="fh-filter"
        disabled={messageBusy} onClick={() => {
          messageRequest.current?.abort()
          setMessages([])
          setNextPage(null)
          setMessageVersion(value => value + 1)
        }}>Atualizar mensagens</button></header>
      <p className="ev-warning">A paginação é por deslocamento, sem fotografia estável. Novas mensagens podem gerar repetições ou lacunas. Mídias e envio indisponíveis.</p>
      {messageError && <Notice title="Falha de leitura" error retry={() => setMessageVersion(value => value + 1)}>{messageError}</Notice>}
      {messageBusy && <Notice title="Carregando mensagens…" />}
      {!messageBusy && !messageError && !messages.length && <Notice title="Nenhuma mensagem retornada">Isso não comprova histórico vazio ou completo.</Notice>}
      {messages.length > 0 && <ol className="ev-messages">{messages.map(message =>
        <li key={message.messageId} className={message.fromMe ? 'ev-outgoing' : 'ev-incoming'}>
          <article><small>{message.fromMe ? 'Saída · origem não identificada' : 'Entrada'}</small>
            {message.kind === 'text' ? <p dir="auto">{message.text}</p> :
              <p>{mediaNames[message.kind]} · conteúdo indisponível</p>}
            <time dateTime={new Date(message.timestamp * 1000).toISOString()}>{time.format(new Date(message.timestamp * 1000))}</time>
          </article>
        </li>)}</ol>}
      {nextPage !== null && <button type="button" className="fh-filter ev-more" onClick={moreMessages} disabled={messageBusy}>
        Carregar página anterior
      </button>}
    </section>}
    <p className="read-only-note">Exibição sem envio e sem mídia. {linksEnabled ? 'Associações manuais não alteram mensagens.' : 'Vínculos N:N ainda indisponíveis.'} Use o Funil para editar Atendimentos.</p>
  </section>
}
