import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatMessage, ChatPage } from '../../shared/chat'
import { api } from '../api'
import type { RequestFailure } from '../api'
import { ChatRail, Icon, Notice } from '../ui'
import './chat.css'

const kinds = { text: 'Texto', image: 'Foto', audio: 'Áudio', video: 'Vídeo', document: 'Documento', unsupported: 'Formato não suportado' }
const statuses = { accepted: 'Aceita pelo provedor', failed: 'Falhou', delivered: 'Entregue', read: 'Lida' }
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

function Message({ message }: { message: ChatMessage }) {
  return <li data-sequence={message.sequence} className={`chat-message ${message.fromMe ? 'chat-outgoing' : 'chat-incoming'}`}>
    <article aria-label={message.fromMe ? 'Mensagem de saída' : 'Mensagem recebida'}>
      <span className="chat-direction">{message.fromMe ? 'Saída' : 'Entrada'}</span>
      {message.kind !== 'text' && <div className="chat-media"><strong>{kinds[message.kind]}</strong><span>Mídia indisponível</span></div>}
      {message.text !== null && <p className="chat-text" dir="auto">{message.text}</p>}
      <footer><time dateTime={message.occurredAt} title="Horário de Brasília">{date.format(new Date(message.occurredAt))}</time>
        {message.status !== null && <span className="chat-message-status">{statuses[message.status]}</span>}</footer>
    </article>
  </li>
}

export function ChatPanel({ atendimentoId, onUnauthorized, children }: { atendimentoId: string; onUnauthorized: () => void; children: ReactNode }) {
  const [page, setPage] = useState<ChatPage>({ items: [], nextCursor: null })
  const [busy, setBusy] = useState(true), [failure, setFailure] = useState('')
  const [version, setVersion] = useState(0)
  const request = useRef<AbortController | null>(null)
  const scroll = useRef<HTMLDivElement | null>(null)
  const restore = useRef<{ end: true } | { sequence: string; offset: number } | { top: number } | null>(null)

  const readingPosition = useCallback(() => {
    const element = scroll.current
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('.chat-message')).find(message => {
      const rect = message.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    return anchor ? { sequence: anchor.dataset.sequence!, offset: anchor.getBoundingClientRect().top - bounds.top } : { top: element.scrollTop }
  }, [])

  useLayoutEffect(() => {
    const target = restore.current, element = scroll.current
    if (!target || !element) return
    restore.current = null
    if ('end' in target) element.scrollTop = element.scrollHeight
    else if ('top' in target) element.scrollTop = target.top
    else {
      const anchor = element.querySelector<HTMLElement>(`[data-sequence="${target.sequence}"]`)
      if (anchor) element.scrollTop += anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - target.offset
    }
  }, [page, busy, failure])

  const load = useCallback(async (cursor: string | null, controller: AbortController) => {
    try {
      const query = new URLSearchParams({ limit: '50' })
      if (cursor !== null) query.set('cursor', cursor)
      const result = await api<ChatPage>(`/api/atendimentos/${encodeURIComponent(atendimentoId)}/messages?${query}`, { signal: controller.signal })
      if (!Array.isArray(result.items) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new Error('Não foi possível ler as mensagens recebidas do aplicativo.')
      if (!controller.signal.aborted) {
        restore.current = cursor === null ? { end: true } : readingPosition()
        setPage(previous => ({
          items: cursor === null ? result.items : [...new Map([...result.items, ...previous.items].map(message => [message.sequence, message])).values()]
            .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.sequence - b.sequence),
          nextCursor: result.nextCursor,
        }))
      }
    } catch (cause) {
      if (controller.signal.aborted) return
      if ((cause as RequestFailure).status === 401) { setPage({ items: [], nextCursor: null }); onUnauthorized(); return }
      if (cursor !== null) restore.current = readingPosition()
      setFailure('Não foi possível carregar as mensagens. Tente novamente.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }, [atendimentoId, onUnauthorized, readingPosition])

  useEffect(() => {
    const controller = new AbortController(); request.current = controller
    queueMicrotask(() => { if (!controller.signal.aborted) void load(null, controller) })
    return () => { request.current?.abort() }
  }, [load, version])

  function more() {
    if (busy || !page.nextCursor) return
    restore.current = readingPosition()
    setBusy(true); setFailure('')
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    void load(page.nextCursor, controller)
  }

  function refresh() {
    request.current?.abort()
    restore.current = null
    setPage({ items: [], nextCursor: null }); setBusy(true); setFailure('')
    setVersion(value => value + 1)
  }

  return <div className="detail-page chat-page chat-readonly">
    <div className="chat-stage"><div className="at-chat-scroll" ref={scroll}>
      <div className="chat-channel-state">Recebimento WhatsApp ainda não conectado</div>
      {children}
      <section className="chat-history" aria-label="Mensagens deste Atendimento" aria-busy={busy}>
        <div className="chat-read-toolbar"><strong>Chat · somente leitura</strong><button type="button" className="fh-filter" disabled={busy} onClick={refresh}>Atualizar mensagens</button></div>
        {page.nextCursor && !failure && <button type="button" className="fh-filter chat-more" disabled={busy} onClick={more}>Carregar mensagens anteriores</button>}
        {busy && <Notice title="Carregando mensagens…" />}
        {!busy && !failure && page.items.length === 0 && <Notice title="Nenhuma mensagem disponível neste Atendimento">Recebimento WhatsApp ainda não conectado.</Notice>}
        {failure && <Notice title="Falha ao carregar mensagens" error retry={page.nextCursor ? more : refresh}>{failure}</Notice>}
        {page.items.length > 0 && <ol className="chat-messages">{page.items.map(message => <Message key={message.sequence} message={message} />)}</ol>}
      </section>
    </div><ChatRail /></div>
    <footer className="compose"><div className="compose-area"><textarea aria-label="Mensagem ao cliente" placeholder="Envio indisponível · somente leitura" disabled rows={1} />
      <button className="compose-button" disabled title="Anexos ainda indisponíveis" aria-label="Anexar arquivo indisponível"><Icon name="attach" /></button>
      <button className="compose-button" disabled title="Áudio ainda indisponível" aria-label="Gravar áudio indisponível"><Icon name="mic" /></button>
      <button className="compose-button send" disabled title="Envio ainda indisponível" aria-label="Enviar mensagem indisponível"><Icon name="send" /></button>
    </div></footer>
  </div>
}
