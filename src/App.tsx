import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento, AtendimentoList } from '../shared/contracts'
import { api } from './api'
import type { RequestFailure, Session } from './api'
import { AtendimentoForm } from './AtendimentoForm'
import { Icon, Login, Notice, RecordButton } from './ui'
import { CommercialPanel } from './CommercialPanel'
import './App.css'

type Area = 'conversas' | 'funil'
type Route = { path: string; search: string }
type Editor = { record?: Atendimento }
const readRoute = (): Route => ({ path: window.location.pathname, search: window.location.search })
const labels: Record<Area, string> = { conversas: 'Conversas', funil: 'Funil' }
const symbols: Record<Area, string> = { conversas: '▤', funil: '▥' }
function vehicleLabel(record: Atendimento) { return record.vehicle || [record.brand, record.model].filter(Boolean).join(' ') }
function dateLabel(value: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) }

function App() {
  const [route, setRoute] = useState(readRoute)
  const routeRef = useRef(route)
  const params = new URLSearchParams(route.search)
  const area: Area = route.path === '/conversas' ? 'conversas' : 'funil'
  const mode = params.get('modo') === 'lista' ? 'lista' : 'quadro', query = params.get('q') || ''
  const isDetail = /^\/atendimentos\/[^/]+$/.test(route.path), detailId = isDetail ? route.path.split('/')[2] : ''
  const removedRoute = route.path.startsWith('/veiculos') || route.path.startsWith('/experiencias')
  const tab = ['chat', 'mapa', 'diagnosticos'].includes(params.get('aba') || '') ? params.get('aba')! : 'chat'
  const key = query, routeKey = route.path + route.search
  const [session, setSession] = useState<Session | null>(null), [sessionError, setSessionError] = useState(''), [sessionVersion, setSessionVersion] = useState(0)
  const [storedList, setList] = useState<AtendimentoList | null>(null), [listKey, setListKey] = useState('')
  const [storedRecord, setRecord] = useState<Atendimento | null>(null)
  const list = listKey === key ? storedList : null
  const record = storedRecord?.id === detailId ? storedRecord : null
  const [failure, setFailure] = useState(''), [loading, setLoading] = useState(false), [loadingMore, setLoadingMore] = useState(false), [reload, setReload] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copilotOpen, setCopilotOpen] = useState(false), [editor, setEditor] = useState<Editor | null>(null), [savedMessage, setSavedMessage] = useState('')
  const [commercialVersion, setCommercialVersion] = useState(0)
  const [scenarioContext] = useState(() => new Map<string,string>())
  const dirty = useRef(false), saving = useRef(false)
  const viewport = useRef<HTMLDivElement>(null), board = useRef<HTMLDivElement>(null), modal = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, { top: number; left: number }>())
  const cache = useRef(new Map<string, AtendimentoList>())
  const pageRequest = useRef<AbortController | null>(null)
  const currentKey = useRef(key)
  useLayoutEffect(() => { currentKey.current = key; routeRef.current = route }, [key, route])
  const onDirty = useCallback((value: boolean) => { dirty.current = value }, [])
  const onBusy = useCallback((value: boolean) => { saving.current = value }, [])
  function canLeaveEditor() {
    if (saving.current) return false
    if (dirty.current && !window.confirm('Há alterações não salvas. Deseja descartá-las?')) return false
    if (dirty.current) setCommercialVersion(value => value + 1)
    if (editor?.record) setReload(value => value + 1)
    dirty.current = false; setEditor(null); return true
  }
  function navigate(href: string, replace = false, state?: unknown) {
    if (!canLeaveEditor()) return
    if (replace) window.history.replaceState(state ?? window.history.state, '', href)
    else window.history.pushState(state ?? null, '', href)
    setRoute(readRoute()); setSavedMessage('')
  }
  function updateParams(values: Record<string, string>) {
    const next = new URLSearchParams(route.search)
    Object.entries(values).forEach(([name, value]) => value ? next.set(name, value) : next.delete(name))
    navigate(`${route.path}${next.size ? '?' + next.toString() : ''}`, true)
  }
  function openRecord(item: Atendimento) {
    const returnTo = isDetail ? window.history.state?.returnTo : routeKey
    navigate(`/atendimentos/${encodeURIComponent(item.id)}?aba=chat`, false, { returnTo })
    setCopilotOpen(false)
  }
  function goBack() {
    if (!canLeaveEditor()) return
    if (window.history.state?.returnTo) window.history.back()
    else navigate('/funil', true)
  }
  function expireSession() {
    setSession(previous => previous ? { ...previous, authenticated: false } : null)
    cache.current.clear(); setList(null); setRecord(null)
  }
  useEffect(() => {
    const onPop = () => {
      if (saving.current || (dirty.current && !window.confirm('Há alterações não salvas. Deseja descartá-las?'))) {
        window.history.pushState(null, '', routeRef.current.path + routeRef.current.search)
        return
      }
      dirty.current = false; setEditor(null); setRoute(readRoute()); setSavedMessage('')
    }
    const onUnload = (event: BeforeUnloadEvent) => { if (dirty.current || saving.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('popstate', onPop); window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('beforeunload', onUnload) }
  }, [])
  useEffect(() => {
    const controller = new AbortController(); setSessionError('')
    api<Session>('/api/session', { signal: controller.signal }).then(setSession).catch(cause => { if (cause.name !== 'AbortError') setSessionError(cause.message) })
    return () => controller.abort()
  }, [sessionVersion])
  useEffect(() => {
    if (!session?.authenticated || isDetail || area === 'conversas' || removedRoute) return
    const controller = new AbortController(), cached = cache.current.get(key)
    setListKey(key); setList(cached ?? null); setFailure(''); setLoading(!cached)
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams({ q: query, limit: '50', offset: '0' })
      api<AtendimentoList>(`/api/atendimentos?${search}`, { signal: controller.signal }).then(result => {
        if (!controller.signal.aborted && currentKey.current === key) { cache.current.set(key, result); setList(result) }
      }).catch((cause: RequestFailure) => {
        if (cause.name === 'AbortError') return
        if (cause.status === 401) expireSession()
        setFailure(cause.message)
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, cached ? 0 : 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [session?.authenticated, key, isDetail, area, removedRoute, reload, query])
  useEffect(() => {
    if (!session?.authenticated || !isDetail) { setRecord(null); return }
    const controller = new AbortController(); setRecord(null); setFailure(''); setLoading(true)
    api<Atendimento>(`/api/atendimentos/${encodeURIComponent(detailId)}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setRecord(result)
    }).catch((cause: RequestFailure) => {
      if (cause.name === 'AbortError') return
      if (cause.status === 401) expireSession()
      setFailure(cause.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [session?.authenticated, isDetail, detailId, reload])
  useLayoutEffect(() => {
    if (isDetail || loading) return
    const position = positions.current.get(routeKey)
    if (viewport.current) viewport.current.scrollTop = position?.top || 0
    if (board.current) board.current.scrollLeft = position?.left || 0
  }, [isDetail, loading, routeKey, list])
  useEffect(() => {
    pageRequest.current?.abort(); setLoadingMore(false)
    return () => pageRequest.current?.abort()
  }, [key, isDetail, session?.authenticated])
  async function loadMore() {
    if (list?.nextOffset == null || loadingMore) return
    pageRequest.current?.abort()
    const controller = new AbortController(); pageRequest.current = controller
    setLoadingMore(true); setFailure('')
    try {
      const search = new URLSearchParams({ q: query, limit: '50', offset: String(list.nextOffset) })
      const result = await api<AtendimentoList>(`/api/atendimentos?${search}`, { signal: controller.signal })
      if (controller.signal.aborted || currentKey.current !== key) return
      const combined = { ...result, items: [...list.items, ...result.items.filter(item => !list.items.some(old => old.id === item.id))] }
      cache.current.set(key, combined); setList(combined)
    } catch (cause) {
      if ((cause as Error).name === 'AbortError' || currentKey.current !== key) return
      if ((cause as RequestFailure).status === 401) expireSession()
      setFailure((cause as Error).message)
    } finally { if (!controller.signal.aborted && currentKey.current === key) setLoadingMore(false) }
  }
  async function logout() {
    if (!canLeaveEditor()) return
    try { await api('/api/session', { method: 'DELETE' }); expireSession(); setCopilotOpen(false) }
    catch (cause) { setFailure((cause as Error).message) }
  }
  function saved(savedRecord: Atendimento) {
    const creating = !editor?.record
    dirty.current = false; setEditor(null); cache.current.clear(); setList(null); setRecord(savedRecord)
    if (creating) {
      window.history.pushState({ returnTo: area === 'funil' && !isDetail ? routeKey : '/funil' }, '', `/atendimentos/${savedRecord.id}?aba=chat`)
      setRoute(readRoute())
    }
    setReload(value => value + 1); setSavedMessage('Atendimento salvo no aplicativo.')
  }
  const login = <Login session={session} error={sessionError} refresh={() => setSessionVersion(value => value + 1)} onSession={setSession} />
  return <div className="app-shell">
    <div className={`app-viewport ${isDetail ? 'detail-viewport' : ''}`} ref={viewport} inert={Boolean(editor)} onScroll={event => {
      if (!isDetail) positions.current.set(routeKey, { top: event.currentTarget.scrollTop, left: board.current?.scrollLeft || 0 })
    }}>
      {!isDetail ? <main className="fh-work">
        <nav className="fh-tabs" aria-label="Áreas da FUNIX">{(Object.keys(labels) as Area[]).map(item => <button key={item} className={area === item && !removedRoute ? 'selected' : ''} onClick={() => navigate('/' + item)} aria-current={area === item && !removedRoute ? 'page' : undefined}><span aria-hidden="true">{symbols[item]}</span> {labels[item]}</button>)}</nav>
        {!session?.authenticated ? login : removedRoute ? <div className="fh-surface"><Notice title="Área fora do aplicativo Comercial" retry={() => navigate('/funil', true)} actionLabel="Abrir Funil">Os Atendimentos são gerenciados no Funil.</Notice></div> : <>
          <div className="fh-tools"><label className="fh-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar nome, telefone, placa ou Atendimento" autoComplete="off" placeholder="Buscar nome, telefone, placa…" value={query} onChange={event => updateParams({ q: event.target.value })} disabled={area === 'conversas'} /></label><div className="fh-tools-right">
            <button className="primary-btn at-new" onClick={() => { setSavedMessage(''); setEditor({}) }}>+ Novo Atendimento</button>
            {area === 'funil' && <div className="fh-listtoggle" aria-label="Visualização"><button className={mode === 'quadro' ? 'active' : ''} onClick={() => updateParams({ modo: 'quadro' })} aria-pressed={mode === 'quadro'}>▥ Quadro</button><button className={mode === 'lista' ? 'active' : ''} onClick={() => updateParams({ modo: 'lista' })} aria-pressed={mode === 'lista'}>☷ Lista</button></div>}
          </div></div>
          {area === 'conversas' ? <div className="fh-surface"><Notice title="Chat WhatsApp ainda indisponível" retry={() => navigate('/funil')} actionLabel="Abrir Funil">Você já pode criar e editar Atendimentos pelo Funil. Mensagens reais serão conectadas em uma próxima etapa.</Notice></div> : <>
            {loading && <div className="fh-surface"><Notice title="Carregando Atendimentos…" /></div>}{failure && <div className="fh-surface"><Notice title="Não foi possível carregar" error retry={() => setReload(value => value + 1)}>{failure}</Notice></div>}
            {!loading && list && <><div className="query-meta"><span>{list.items.length} de {list.total} Atendimento{list.total !== 1 ? 's' : ''}</span><button onClick={() => setReload(value => value + 1)}>Atualizar</button></div>
              {!list.items.length && <div className="fh-surface"><Notice title={query ? 'Nenhum Atendimento encontrado' : 'Nenhum Atendimento cadastrado'}>{query ? 'Tente outro nome, telefone, placa ou identificador.' : 'Use Novo Atendimento para registrar o primeiro contato.'}</Notice></div>}
              {mode === 'lista' ? <div className="fh-surface fh-board-list">{list.items.map(item => <RecordButton key={item.id} item={item} list onOpen={openRecord} />)}</div> : <div className="fh-kboard" ref={board} onScroll={event => positions.current.set(routeKey, { top: viewport.current?.scrollTop || 0, left: event.currentTarget.scrollLeft })} aria-label="Funil de Atendimentos">
                {ATENDIMENTO_STAGES.map(stage => {
                  const closed = collapsed.has(stage.id), items = list.items.filter(item => item.stage === stage.id)
                  return <section key={stage.id} className={`fh-lane ${closed ? 'collapsed' : ''}`} aria-label={stage.name}><button className="fh-lanehead" aria-expanded={!closed} title={`${closed ? 'Expandir' : 'Recolher'} ${stage.name}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next })}><span className="fh-toggle" aria-hidden="true">{closed ? '▸' : '▾'}</span><span className="fh-lane-title">{stage.name}</span><em aria-label={`${items.length} registros carregados`}>{items.length}</em></button>{!closed && <div className="fh-lane-items">{items.map(item => <RecordButton key={item.id} item={item} onOpen={openRecord} />)}</div>}</section>
                })}
              </div>}
              {list.nextOffset != null && <button className="load-more fh-filter" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando…' : 'Carregar mais Atendimentos'}</button>}
              <p className="read-only-note">Atendimentos salvos no aplicativo. Fases alteradas manualmente; os prazos não geram movimentação automática.</p>
            </>}
          </>}
          <button className="session-exit" onClick={logout}>Sair</button>
        </>}
      </main> : <>
        <header className="detail-header"><button aria-label="Voltar à visão anterior" className="back-detail" onClick={goBack}>←</button><div className="detail-contact"><span className="detail-avatar" aria-hidden="true">{record ? (record.name || record.phone).slice(0, 2).toUpperCase() : '·'}</span><strong>{record ? record.name || record.phone : 'Atendimento'}</strong></div><div className="detail-identity"><strong>{record?.plate || record?.phone || '—'}</strong><span>{record ? vehicleLabel(record) || record.phone : loading ? 'Carregando…' : ''}</span></div>{session?.authenticated && record && <button className="edit-detail" aria-label="Editar Atendimento" title="Editar Atendimento" onClick={() => { if (canLeaveEditor()) { setSavedMessage(''); setEditor({ record }) } }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4" /></svg></button>}</header>
        <nav className="view-switch" aria-label="Visões do Atendimento">{(['chat', 'diagnosticos', 'mapa'] as const).map(item => <button key={item} className={`view-tab ${tab === item ? 'active' : ''}`} onClick={() => updateParams({ aba: item })} aria-current={tab === item ? 'page' : undefined}><Icon name={item === 'diagnosticos' ? 'diagnostics' : item === 'mapa' ? 'map' : 'chat'} />{item === 'diagnosticos' ? 'Diagnósticos' : item === 'mapa' ? 'Mapa' : 'Chat'}</button>)}</nav>
        {!session?.authenticated ? <div className="detail-content">{login}</div> : loading ? <Notice title="Carregando Atendimento…" /> : failure ? <Notice title="Não foi possível abrir o Atendimento" error retry={() => setReload(value => value + 1)}>{failure}</Notice> : record && <>
          {savedMessage && <p className="at-save-success" role="status">{savedMessage}</p>}
          {tab === 'chat' ? <div className="detail-page chat-page"><div className="at-chat-scroll">
            <div className="record-summary at-record-summary"><strong>{record.name || 'Nome não informado'}</strong><p>{record.phone}</p><p>{[vehicleLabel(record), record.plate].filter(Boolean).join(' · ') || 'Veículo não informado'}</p>{record.reason && <p><b>Motivo:</b> {record.reason}</p>}{record.notes && <p><b>Observações:</b> {record.notes}</p>}{record.stage === 'rejeitados' && <p><b>Recusa registrada:</b> {record.rejectionReason}</p>}<small>Atualizado em {dateLabel(record.updatedAt)}</small><details><summary>Identificador técnico</summary><span className="at-technical-id">{record.id}</span></details></div>
            <Notice title="Chat WhatsApp ainda indisponível">Nenhuma mensagem foi enviada ou recebida por este aplicativo. Os dados acima pertencem ao Atendimento selecionado.</Notice>
          </div><div className="at-context-ai" aria-label="IA do Atendimento"><span>IA ainda indisponível</span><div><button disabled>Resumir</button><button disabled>Sugerir resposta</button><button disabled>Preencher dados</button></div></div><footer className="compose"><div className="compose-area"><textarea aria-label="Mensagem ao cliente" placeholder="Envio de mensagens ainda indisponível" disabled rows={1} /><button className="compose-button send" disabled title="WhatsApp ainda indisponível" aria-label="Enviar mensagem indisponível"><Icon name="send" /></button></div></footer></div> : <CommercialPanel key={`${record.id}:${commercialVersion}`} atendimentoId={record.id} tab={tab} scenarioContext={scenarioContext} onDirty={onDirty} onBusy={onBusy} />}
        </>}
      </>}
    </div>
    {copilotOpen && !editor && <section className="copilot-panel" aria-label="Copiloto FUNIX"><header><div><strong>Copiloto FUNIX</strong><small>Inteligência artificial</small></div><button aria-label="Recolher Copiloto" onClick={() => setCopilotOpen(false)}>⌄</button></header><div className="copilot-feed"><Notice title="IA ainda indisponível">{record ? `Contexto: ${record.name || record.phone}. ` : ''}Nenhuma sugestão ou ação automática está habilitada.</Notice></div><div className="copilot-status">Integração assistiva pendente</div></section>}
    <button className="copilot-fixed" aria-label="Abrir Copiloto FUNIX" title="Copiloto" aria-expanded={copilotOpen} disabled={Boolean(editor)} onClick={() => setCopilotOpen(value => !value)}><Icon name="bot" /></button>
    {editor && <div className="at-editor-shade" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); canLeaveEditor() }
      if (event.key === 'Tab') {
        const focusable = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? []).filter(element => element.offsetParent !== null)
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}><section className="at-editor" role="dialog" aria-modal="true" aria-labelledby="at-editor-title" ref={modal}><header><h1 id="at-editor-title">{editor.record ? 'Editar Atendimento' : 'Novo Atendimento'}</h1><button type="button" aria-label="Fechar formulário" onClick={canLeaveEditor}>×</button></header>
      {!session?.authenticated && <div className="at-reauth"><p>Sua sessão expirou. Entre novamente para continuar; as alterações do formulário foram mantidas.</p>{login}</div>}
      <div className="at-editor-body" hidden={!session?.authenticated}><AtendimentoForm record={editor.record} onSaved={saved} onDirty={onDirty} onBusy={onBusy} onAuthRequired={expireSession} /></div>
    </section></div>}
  </div>
}
export default App
