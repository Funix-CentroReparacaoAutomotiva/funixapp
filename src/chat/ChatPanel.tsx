import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatMessage, ChatPage } from '../../shared/chat'
import { api } from '../api'
import type { RequestFailure } from '../api'
import { ChatRail, Icon, Notice } from '../ui'
import { mergeReadMessages, parseConversationMessages } from './evolution-read-model'
import type { ReadUiMessage } from './evolution-read-model'
import { MediaMessage } from './MediaMessage'
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

function LegacyChatPanel({ atendimentoId, onUnauthorized, children }: { atendimentoId: string; onUnauthorized: () => void; children: ReactNode }) {
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

/** Canonical Coda-linked read-only projection. The server verifies BOTH IDs. */
function EvolutionAtendimentoChat({ atendimentoId, conversationId, onUnauthorized }: {
  atendimentoId: string; conversationId: string; onUnauthorized: () => void; children: ReactNode
}) {
  const [items, setItems] = useState<ReadUiMessage[]>([])
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [busy, setBusy] = useState(true)
  const [failure, setFailure] = useState('')
  const [canSendText, setCanSendText] = useState(false)
  const [canMedia, setCanMedia] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNotice, setSendNotice] = useState('')
  const [sendFailure, setSendFailure] = useState('')
  // A single active Atendimento is polled: no Coda writes, webhook or new infrastructure.
  // Evolution pagination uses offsets, not snapshots; keep already loaded history.
  const AUTO_REFRESH_MS = 20_000
  const request = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const autoPaused = useRef(false)
  const lastCheckedAt = useRef(0)
  const loadedOlderPage = useRef(false)
  const sendingRef = useRef(false)
  const itemsRef = useRef<ReadUiMessage[]>([])
  const scroll = useRef<HTMLDivElement | null>(null)
  const restore = useRef<{ bottom: true } | { id: string; offset: number } | { top: number } | null>(null)
  const [autoError, setAutoError] = useState(false)
  const [newMessages, setNewMessages] = useState(0)

  const readingPosition = useCallback(() => {
    const element = scroll.current
    if (!element) return null
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 48) return { bottom: true } as const
    const bounds = element.getBoundingClientRect()
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-chat-message-id]')).find(item => {
      const rect = item.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    return anchor
      ? { id: anchor.dataset.chatMessageId!, offset: anchor.getBoundingClientRect().top - bounds.top }
      : { top: element.scrollTop }
  }, [])

  useLayoutEffect(() => {
    const target = restore.current, element = scroll.current
    if (!target || !element) return
    restore.current = null
    if ('bottom' in target) { element.scrollTop = element.scrollHeight; setNewMessages(0); return }
    if ('top' in target) { element.scrollTop = target.top; return }
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-chat-message-id]'))
      .find(item => item.dataset.chatMessageId === target.id)
    if (anchor) element.scrollTop +=
      anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - target.offset
  }, [items])

  const load = useCallback(async (page: number, silent = false) => {
    if (silent && (pending.current || sendingRef.current || autoPaused.current)) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    pending.current = true
    lastCheckedAt.current = Date.now()
    if (!silent) { autoPaused.current = false; setAutoError(false); setBusy(true); setFailure('') }
    try {
      const raw = await api<unknown>(`/api/atendimentos/${encodeURIComponent(atendimentoId)}/evolution-conversations/${encodeURIComponent(conversationId)}/messages?page=${page}`, { signal: controller.signal })
      const result = parseConversationMessages(raw, conversationId)
      if (controller.signal.aborted) return
      setCanSendText((raw as { sendTextAvailable?: unknown }).sendTextAvailable === true)
      setCanMedia((raw as { mediaSendAvailable?: unknown }).mediaSendAvailable === true)
      const pageItems = result.items.map(m => ({ ...m, page }))
      const old = itemsRef.current
      const position = old.length ? readingPosition() : { bottom: true } as const
      const next = mergeReadMessages(old, pageItems)
      const changed = next.length !== old.length || next.some((item, index) => {
        const before = old[index]
        return !before || before.messageId !== item.messageId || before.timestamp !== item.timestamp ||
          before.kind !== item.kind || before.text !== item.text || before.fromMe !== item.fromMe || before.page !== item.page
      })
      if (changed) {
        restore.current = position
        itemsRef.current = next
        setItems(next)
        if (silent && position && !('bottom' in position)) {
          const known = new Set(old.map(message => message.messageId))
          const added = pageItems.filter(message => !known.has(message.messageId)).length
          if (added) setNewMessages(count => count + added)
        }
      }
      if (page > 1) loadedOlderPage.current = true
      if (page > 1 || !loadedOlderPage.current) setNextPage(result.nextPage)
      setAutoError(false)
    } catch (cause) {
      if (controller.signal.aborted) return
      const error = cause as RequestFailure
      if (error.status === 401) { itemsRef.current = []; setItems([]); onUnauthorized(); return }
      if (silent) { autoPaused.current = true; setAutoError(true); return }
      if (error.status === 404) {
        itemsRef.current = []
        setItems([])
        setFailure('O vínculo entre conversa e Atendimento não foi confirmado. Atualize a lista de conversas.')
      } else setFailure('Não foi possível carregar o histórico Evolution. Tente novamente.')
      autoPaused.current = true
      setAutoError(true)
    } finally {
      if (request.current === controller) {
        pending.current = false
        if (!controller.signal.aborted && !silent) setBusy(false)
      }
    }
  }, [atendimentoId, conversationId, onUnauthorized, readingPosition])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void load(1) })
    return () => { active = false; request.current?.abort() }
  }, [load])

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible' || autoPaused.current ||
          sendingRef.current || pending.current) return
      void load(1, true)
    }
    const interval = window.setInterval(refreshIfVisible, AUTO_REFRESH_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible' &&
          Date.now() - lastCheckedAt.current >= AUTO_REFRESH_MS) refreshIfVisible()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])
  async function sendMedia() {
    if(!file||!canMedia||sending)return
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' :
      file.type.startsWith('audio/') ? 'audio' : null
    if(!kind || file.size > 12*1024*1024 || !file.size) {
      setSendFailure('Formato de arquivo inválido ou acima de 12 MB.'); return
    }
    sendingRef.current = true
    setSending(true);setSendFailure('');setSendNotice('')
    try {
      const base64 = await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader()
        reader.onerror=()=>reject(Error('Falha no arquivo'))
        reader.onload=()=> {
          const data=reader.result
          if(typeof data!=='string'||!data.includes(';base64,'))reject(Error('Falha no arquivo'))
          else resolve(data.split(';base64,')[1]!)
        }
        reader.readAsDataURL(file)
      })
      await api<{state:'accepted';messageId:string}>(
        '/api/atendimentos/'+encodeURIComponent(atendimentoId)+
        '/evolution-conversations/'+encodeURIComponent(conversationId)+'/send-media',
        {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({kind,mimeType:file.type,base64,...(kind!=='audio'?{caption:draft}: {})})})
      setFile(null);setDraft('')
      setSendNotice('Arquivo aceito pela Evolution. Confira no WhatsApp antes de reenviar.')
      void load(1)
    }catch{
      setSendFailure('Envio de mídia não confirmado. Confira o WhatsApp antes de tentar novamente.')
    }finally{sendingRef.current = false;setSending(false)}
  }
  async function sendText() {
    const text = draft.trim()
    if (!canSendText || sending || !text || [...text].length > 4096) return
    sendingRef.current = true
    setSending(true); setSendFailure(''); setSendNotice('')
    try {
      await api<{ state: 'accepted'; messageId: string }>(
        `/api/atendimentos/${encodeURIComponent(atendimentoId)}/evolution-conversations/${encodeURIComponent(conversationId)}/send-text`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) },
      )
      setDraft('')
      setSendNotice('Mensagem aceita pelo WhatsApp. Confira o histórico antes de enviar novamente.')
      void load(1)
    } catch (cause) {
      if ((cause as RequestFailure).status === 401) { onUnauthorized(); return }
      setSendFailure('Envio não confirmado. Verifique a conversa antes de tentar outra vez, para evitar mensagem duplicada.')
    } finally { sendingRef.current = false; setSending(false) }
  }
  return <div className="detail-page chat-page chat-readonly chat-evolution">
    <div className="chat-stage"><div className="at-chat-scroll" ref={scroll}>
      <section className="chat-history" aria-label="Histórico Evolution deste Atendimento" aria-busy={busy}>
        <div className="chat-read-toolbar">
          <span className="chat-auto-state" role="status">{autoError
            ? 'Atualização automática pausada · tente atualizar'
            : 'Atualização automática ativa'}</span>
          <button type="button" className="fh-filter" disabled={busy} onClick={() => void load(1)}>Atualizar mensagens</button>
        </div>
        {newMessages > 0 && <button type="button" className="fh-filter chat-new-messages" onClick={() => {
          const element = scroll.current
          if (element) element.scrollTop = element.scrollHeight
          setNewMessages(0)
        }}>Ver {newMessages} {newMessages === 1 ? 'nova mensagem' : 'novas mensagens'}</button>}
        {failure && <Notice title="Falha ao consultar conversa vinculada" error retry={() => void load(1)}>{failure}</Notice>}
        {busy && <Notice title="Carregando mensagens…" />}
        {!busy && !failure && items.length === 0 && <Notice title="Nenhuma mensagem retornada">Isso não comprova histórico vazio ou completo.</Notice>}
        {items.length > 0 && <ol className="chat-messages">{items.map(message => <li key={message.messageId} data-chat-message-id={message.messageId} className={`chat-message ${message.fromMe ? 'chat-outgoing' : 'chat-incoming'}`}><article aria-label={message.fromMe ? 'Mensagem de saída' : 'Mensagem recebida'}>
          <span className="chat-direction">{message.fromMe ? 'Saída' : 'Entrada'}</span>
          {message.kind !== 'text' && <div className="chat-media"><strong>{kinds[message.kind]}</strong>{canMedia && ['image','video','audio'].includes(message.kind) ? <MediaMessage atendimentoId={atendimentoId} conversationId={conversationId} messageId={message.messageId} page={message.page??1} kind={message.kind as 'image'|'video'|'audio'} enabled={canMedia}/> : <span>Mídia indisponível</span>}</div>}
          {message.text !== null && <p className="chat-text" dir="auto">{message.text}</p>}
          <footer><time dateTime={new Date(message.timestamp * 1000).toISOString()}>{date.format(new Date(message.timestamp * 1000))}</time></footer>
        </article></li>)}</ol>}
        {nextPage !== null && !failure && <button type="button" className="fh-filter chat-more" disabled={busy} onClick={() => void load(nextPage)}>Carregar mensagens anteriores</button>}
      </section>
    </div></div>
    {(canSendText||canMedia) && <form className="chat-send-text" onSubmit={event => { event.preventDefault(); void (file ? sendMedia() : sendText()) }}>
      <label htmlFor="chat-whatsapp-text">Responder pelo WhatsApp</label>
      <textarea id="chat-whatsapp-text" aria-label="Mensagem de texto para o cliente"
        value={draft} onChange={event => setDraft(event.target.value)}
        maxLength={4096} rows={2} disabled={sending}
        placeholder="Digite sua resposta ao cliente"
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); void (file ? sendMedia() : sendText())
          }
        }} />
      {canMedia && <label className="chat-file-chooser">Anexar foto, vídeo ou áudio
        <input type="file" aria-label="Escolher foto, vídeo ou áudio" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/webm" disabled={sending}
          onChange={event => {setFile(event.target.files?.[0]??null);setSendFailure('');}} />
      </label>}
      {file && <p className="chat-file-picked">{file.name} ({(file.size/1024/1024).toFixed(1)} MB) <button type="button" onClick={()=>setFile(null)} disabled={sending}>Remover</button></p>}
      <button className="fh-filter" type="submit" disabled={sending || (!file && (!draft.trim()||!canSendText))}>
        {sending ? 'Enviando…' : file ? 'Enviar mídia' : 'Enviar mensagem'}
      </button>
      {sendNotice && <p role="status" className="chat-send-success">{sendNotice}</p>}
      {sendFailure && <p role="alert" className="chat-send-failure">{sendFailure}</p>}
    </form>}
  </div>
}
/** Resolve the server-confirmed Coda context when opening an Atendimento directly from Funil. */
function ResolvedAtendimentoChat({ atendimentoId, onUnauthorized, children }: {
  atendimentoId: string; onUnauthorized: () => void; children: ReactNode
}) {
  const [resolution, setResolution] = useState<{ state: 'loading' | 'legacy' | 'linked' | 'unlinked' | 'error'; id?: string }>({state:'loading'})
  useEffect(() => {
    const controller = new AbortController()
    setResolution({state:'loading'})
    void api<{conversationId:string}>(`/api/atendimentos/${encodeURIComponent(atendimentoId)}/evolution-conversation`,{signal:controller.signal})
      .then(result => {
        if (controller.signal.aborted) return
        if (!/^[0-9a-f-]{36}$/.test(result.conversationId)) throw new Error('Invalid conversation ID')
        setResolution({state:'linked',id:result.conversationId})
      }).catch(cause => {
        if (controller.signal.aborted) return
        const error = cause as RequestFailure
        if (error.status === 401) {onUnauthorized();return}
        if (error.status === 404) {
          setResolution({state:error.code === 'CHAT_NOT_LINKED' ? 'unlinked' : 'legacy'})
          return
        }
        setResolution({state:'error'})
      })
    return () => controller.abort()
  },[atendimentoId,onUnauthorized])
  if (resolution.state==='loading') return <Notice title="Consultando vínculo do Chat…" />
  if (resolution.state==='error') return <Notice title="Não foi possível verificar o vínculo do Chat">Atualize o Atendimento para tentar novamente. Nenhuma conversa foi selecionada por aproximação.</Notice>
  if (resolution.state==='unlinked') return <div className="detail-page chat-page chat-readonly"><div className="chat-unlinked"><Notice title="Conversa da Evolution não vinculada a este Atendimento">Este registro ainda não tem uma conversa canônica única confirmada. Abra Conversas, selecione o contato e utilize o botão de Atendimento vinculado quando disponível. Não vinculamos históricos apenas pelo telefone.</Notice><a className="fh-filter" href="/conversas">Abrir Conversas</a></div></div>
  return resolution.state==='linked' && resolution.id
    ? <EvolutionAtendimentoChat atendimentoId={atendimentoId} conversationId={resolution.id} onUnauthorized={onUnauthorized}>{children}</EvolutionAtendimentoChat>
    : <LegacyChatPanel atendimentoId={atendimentoId} onUnauthorized={onUnauthorized}>{children}</LegacyChatPanel>
}
export function ChatPanel({ atendimentoId, evolutionConversationId, onUnauthorized, children }: {
  atendimentoId: string; evolutionConversationId?: string | null; onUnauthorized: () => void; children: ReactNode
}) {
  return evolutionConversationId
    ? <EvolutionAtendimentoChat atendimentoId={atendimentoId} conversationId={evolutionConversationId} onUnauthorized={onUnauthorized}>{children}</EvolutionAtendimentoChat>
    : <ResolvedAtendimentoChat atendimentoId={atendimentoId} onUnauthorized={onUnauthorized}>{children}</ResolvedAtendimentoChat>
}
