import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { WorkRecord, WorkspaceResponse } from '../shared/contracts'
import { api } from './api'
import type { RequestFailure, Session } from './api'
import { Icon, Login, Notice, RecordButton } from './ui'
import carMap from './assets/car-map.svg'
import './App.css'

type Area = 'conversas' | 'funil' | 'veiculos'
type Route = { path: string; search: string }
const readRoute = (): Route => ({ path: window.location.pathname, search: window.location.search })
const labels: Record<Area, string> = { conversas: 'Conversas', funil: 'Funil', veiculos: 'Veículos' }
const symbols: Record<Area, string> = { conversas: '▤', funil: '▥', veiculos: '▦' }
function dateLabel(value: string | null) {
  if (!value) return 'Não registrada'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date)
}
function App() {
  const [route, setRoute] = useState(readRoute)
  const params = new URLSearchParams(route.search)
  const area: Area = route.path === '/funil' ? 'funil' : route.path === '/veiculos' ? 'veiculos' : 'conversas'
  const scope = params.get('aba') === 'historico' ? 'historico' : 'acompanhamento'
  const mode = params.get('modo') === 'lista' ? 'lista' : 'quadro', query = params.get('q') || ''
  const isAtendimento = route.path.startsWith('/atendimentos/'), isExperiencia = route.path.startsWith('/experiencias/')
  const isDetail = isAtendimento || isExperiencia, detailId = isDetail ? route.path.split('/')[2] : ''
  const tab = ['chat', 'mapa', 'diagnosticos'].includes(params.get('aba') || '') ? params.get('aba')! : 'chat'
  const key = `${area}|${scope}|${query}`, routeKey = route.path + route.search
  const [session, setSession] = useState<Session | null>(null), [sessionError, setSessionError] = useState(''), [sessionVersion, setSessionVersion] = useState(0)
  const [storedWorkspace, setWorkspace] = useState<WorkspaceResponse | null>(null), [storedRecord, setRecord] = useState<WorkRecord | null>(null)
  const [workspaceKey, setWorkspaceKey] = useState('')
  const workspace = workspaceKey === key ? storedWorkspace : null
  const record = storedRecord?.rowId === detailId && storedRecord.kind === (isAtendimento ? 'atendimento' : 'experiencia') ? storedRecord : null
  const [failure, setFailure] = useState(''), [loading, setLoading] = useState(false), [loadingMore, setLoadingMore] = useState(false), [reload, setReload] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copilotOpen, setCopilotOpen] = useState(false), [copilotQuery, setCopilotQuery] = useState(''), [copilotArea, setCopilotArea] = useState('funil')
  const [copilotResults, setCopilotResults] = useState<WorkspaceResponse | null>(null), [copilotFailure, setCopilotFailure] = useState(''), [copilotBusy, setCopilotBusy] = useState(false)
  const viewport = useRef<HTMLDivElement>(null), board = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, { top: number; left: number }>())
  const cache = useRef(new Map<string, WorkspaceResponse>())
  const copilotRequest = useRef<AbortController | null>(null)
  const pageRequest = useRef<AbortController | null>(null)
  const currentKey = useRef(key)
  useLayoutEffect(() => { currentKey.current = key }, [key])
  function navigate(href: string, replace = false, state?: unknown) {
    if (replace) window.history.replaceState(state ?? window.history.state, '', href)
    else window.history.pushState(state ?? null, '', href)
    setRoute(readRoute())
  }
  function updateParams(values: Record<string, string>) {
    const next = new URLSearchParams(route.search)
    Object.entries(values).forEach(([name, value]) => value ? next.set(name, value) : next.delete(name))
    navigate(`${route.path}${next.size ? '?' + next.toString() : ''}`, true)
  }
  function openRecord(item: WorkRecord) {
    const returnTo = isDetail ? window.history.state?.returnTo : routeKey
    navigate(`/${item.kind === 'atendimento' ? 'atendimentos' : 'experiencias'}/${encodeURIComponent(item.rowId)}${item.kind === 'atendimento' ? '?aba=chat' : ''}`, false, { returnTo })
    setCopilotOpen(false)
  }
  function goBack() { if (window.history.state?.returnTo) window.history.back(); else navigate(isAtendimento ? '/funil' : '/veiculos', true) }
  function expireSession() {
    setSession(previous => previous ? { ...previous, authenticated: false } : null)
    cache.current.clear(); setWorkspace(null); setRecord(null); setCopilotResults(null)
  }
  useEffect(() => { const onPop = () => setRoute(readRoute()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop) }, [])
  useEffect(() => {
    // Reset the session request's error before checking the server again.
    const controller = new AbortController(); setSessionError('')
    api<Session>('/api/session', { signal: controller.signal }).then(setSession).catch(cause => { if (cause.name !== 'AbortError') setSessionError(cause.message) })
    return () => controller.abort()
  }, [sessionVersion])
  useEffect(() => {
    if (!session?.authenticated || isDetail || area === 'conversas') return
    const controller = new AbortController(), cached = cache.current.get(key)
    // Synchronize the new query with its cache; a different query never inherits old rows.
    setWorkspaceKey(key); setWorkspace(cached ?? null); setFailure(''); setLoading(!cached)
    const timer = window.setTimeout(() => {
      const search = new URLSearchParams({ area, scope, q: query, limit: '50' })
      api<WorkspaceResponse>(`/api/workspace?${search}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted && currentKey.current === key) { cache.current.set(key, result); setWorkspace(result) } }).catch((cause: RequestFailure) => {
        if (cause.name === 'AbortError') return
        if (cause.status === 401) expireSession()
        setFailure(cause.message)
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, cached ? 0 : 280)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [session?.authenticated, key, isDetail, reload, area, scope, query])
  useEffect(() => {
    // Clear the previous entity while its replacement is requested; all views share this context.
    if (!session?.authenticated || !isDetail) { setRecord(null); return }
    const controller = new AbortController(); setRecord(null); setFailure(''); setLoading(true)
    api<WorkRecord>(`/api/${isAtendimento ? 'atendimentos' : 'experiencias'}/${encodeURIComponent(detailId)}`, { signal: controller.signal }).then(setRecord).catch((cause: RequestFailure) => {
      if (cause.name === 'AbortError') return
      if (cause.status === 401) expireSession()
      setFailure(cause.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [session?.authenticated, isDetail, isAtendimento, detailId, reload])
  useLayoutEffect(() => {
    if (isDetail || loading) return
    const position = positions.current.get(routeKey)
    if (viewport.current) viewport.current.scrollTop = position?.top || 0
    if (board.current) board.current.scrollLeft = position?.left || 0
  }, [isDetail, loading, routeKey, workspace])
  useEffect(() => () => copilotRequest.current?.abort(), [])
  useEffect(() => {
    // A page belongs to one query and session; cancel its pending state on context changes.
    pageRequest.current?.abort(); setLoadingMore(false)
    return () => pageRequest.current?.abort()
  }, [key, isDetail, session?.authenticated])
  async function loadMore() {
    if (!workspace?.nextCursor || loadingMore || area === 'conversas') return
    pageRequest.current?.abort()
    const controller = new AbortController(); pageRequest.current = controller
    setLoadingMore(true); setFailure('')
    try {
      const search = new URLSearchParams({ area, scope, q: query, limit: '50', cursor: workspace.nextCursor })
      const result = await api<WorkspaceResponse>(`/api/workspace?${search}`, { signal: controller.signal })
      if (controller.signal.aborted || currentKey.current !== key) return
      const combined = { ...result, items: [...workspace.items, ...result.items.filter(item => !workspace.items.some(old => old.rowId === item.rowId))] }
      cache.current.set(key, combined); setWorkspace(combined)
    } catch (cause) { if ((cause as Error).name === 'AbortError' || currentKey.current !== key) return; if ((cause as RequestFailure).status === 401) expireSession(); setFailure((cause as Error).message) }
    finally { if (!controller.signal.aborted && currentKey.current === key) setLoadingMore(false) }
  }
  async function logout() {
    try { await api('/api/session', { method: 'DELETE' }); expireSession(); setCopilotQuery(''); setCopilotOpen(false) }
    catch (cause) { setFailure((cause as Error).message) }
  }
  async function searchCopilot(event: FormEvent) {
    event.preventDefault(); if (!copilotQuery.trim() || !session?.authenticated) return
    copilotRequest.current?.abort(); const controller = new AbortController(); copilotRequest.current = controller
    setCopilotBusy(true); setCopilotFailure(''); setCopilotResults(null)
    const search = new URLSearchParams({ area: copilotArea === 'funil' ? 'funil' : 'veiculos', scope: copilotArea === 'historico' ? 'historico' : 'acompanhamento', q: copilotQuery.trim(), limit: '20' })
    try { setCopilotResults(await api<WorkspaceResponse>(`/api/workspace?${search}`, { signal: controller.signal })) }
    catch (cause) { if ((cause as Error).name === 'AbortError') return; if ((cause as RequestFailure).status === 401) expireSession(); setCopilotFailure((cause as Error).message) }
    finally { if (!controller.signal.aborted) setCopilotBusy(false) }
  }
  function continueCopilot() {
    const target = copilotArea === 'funil' ? '/funil' : '/veiculos'
    const search = new URLSearchParams({ q: copilotQuery.trim(), ...(copilotArea === 'historico' ? { aba: 'historico' } : {}) })
    setCopilotOpen(false); navigate(`${target}?${search}`)
  }
  const stages = workspace ? [...workspace.stages, ...workspace.items.filter(item => !workspace.stages.some(stage => stage.id === item.stageId)).map(item => ({ id: item.stageId || '__unassigned', name: item.stage || 'Sem fase informada' }))].filter((stage, index, all) => all.findIndex(candidate => candidate.id === stage.id) === index) : []
  const sourceUrl = record?.sourceUrl && /^https:\/\/(?:coda\.io|docs\.superhuman\.com)\//.test(record.sourceUrl) ? record.sourceUrl : null
  const login = <Login session={session} error={sessionError} refresh={() => setSessionVersion(value => value + 1)} onSession={setSession} />
  return <div className="app-shell"><div className={`app-viewport ${isDetail ? 'detail-viewport' : ''}`} ref={viewport} onScroll={event => { if (!isDetail) positions.current.set(routeKey, { top: event.currentTarget.scrollTop, left: board.current?.scrollLeft || 0 }) }}>
    {!isDetail ? <main className="fh-work">
      <nav className="fh-tabs" aria-label="Áreas da FUNIX">{(Object.keys(labels) as Area[]).map(item => <button key={item} className={area === item ? 'selected' : ''} onClick={() => navigate('/' + item)} aria-current={area === item ? 'page' : undefined}><span aria-hidden="true">{symbols[item]}</span> {labels[item]}</button>)}</nav>
      <div className="fh-tools"><label className="fh-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar nome, placa, veículo ou atendimento" autoComplete="off" placeholder="Buscar nome, placa, veículo ou atendimento…" value={query} onChange={event => updateParams({ q: event.target.value })} disabled={!session?.authenticated || area === 'conversas'} /></label><div className="fh-tools-right">
        {area === 'veiculos' && <><button className={`fh-filter ${scope === 'acompanhamento' ? 'active' : ''}`} onClick={() => updateParams({ aba: 'acompanhamento' })}>Em acompanhamento</button><button className={`fh-filter ${scope === 'historico' ? 'active' : ''}`} onClick={() => updateParams({ aba: 'historico' })}>Histórico</button></>}
        {area !== 'conversas' && !(area === 'veiculos' && scope === 'historico') && <div className="fh-listtoggle" aria-label="Visualização"><button className={mode === 'quadro' ? 'active' : ''} onClick={() => updateParams({ modo: 'quadro' })} aria-pressed={mode === 'quadro'}>▥ Quadro</button><button className={mode === 'lista' ? 'active' : ''} onClick={() => updateParams({ modo: 'lista' })} aria-pressed={mode === 'lista'}>☷ Lista</button></div>}
      </div></div>
      {!session?.authenticated ? login : area === 'conversas' ? <div className="fh-surface"><Notice title="Conversas ainda não conectadas" retry={() => navigate('/funil')} actionLabel="Consultar Funil">Os atendimentos podem ser consultados no Funil. O histórico de mensagens será exibido após validar os vínculos das conversas.</Notice></div> : <>
        {loading && <div className="fh-surface"><Notice title="Consultando registros…" /></div>}{failure && <div className="fh-surface"><Notice title="Consulta indisponível" error retry={() => setReload(value => value + 1)}>{failure}</Notice></div>}
        {!loading && workspace && <><div className="query-meta"><span>{workspace.items.length} registro{workspace.items.length !== 1 ? 's' : ''} carregado{workspace.items.length !== 1 ? 's' : ''}{workspace.nextCursor ? ' · Há mais resultados' : ''}<br /><time dateTime={workspace.source.fetchedAt}>{failure ? 'Última consulta: ' : 'Consultado às '}{new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(workspace.source.fetchedAt))}</time></span><button onClick={() => setReload(value => value + 1)}>Atualizar</button></div>
          {!workspace.items.length ? <div className="fh-surface"><Notice title={workspace.nextCursor ? 'Nenhum resultado nesta página' : 'Nenhum registro encontrado'}>{workspace.nextCursor ? 'Continue a consulta para verificar os próximos registros.' : query ? 'Tente outro nome, placa ou identificador.' : 'Não há registros para esta visualização.'}</Notice></div> : mode === 'lista' || scope === 'historico' ? <div className="fh-surface fh-board-list">{workspace.items.map(item => <RecordButton key={item.rowId} item={item} list onOpen={openRecord} />)}</div> : <div className="fh-kboard" ref={board} onScroll={event => positions.current.set(routeKey, { top: viewport.current?.scrollTop || 0, left: event.currentTarget.scrollLeft })} aria-label={area === 'funil' ? 'Funil de atendimentos' : 'Acompanhamento de experiências'}>
            {stages.map(stage => { const collapseKey = area + stage.id, closed = collapsed.has(collapseKey), items = workspace.items.filter(item => (item.stageId || '__unassigned') === stage.id); return <section key={stage.id} className={`fh-lane ${closed ? 'collapsed' : ''}`} aria-label={stage.name}><button className="fh-lanehead" aria-expanded={!closed} title={`${closed ? 'Expandir' : 'Recolher'} ${stage.name}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey); return next })}><span className="fh-toggle" aria-hidden="true">{closed ? '▸' : '▾'}</span><span className="fh-lane-title">{stage.name}</span><em aria-label={`${items.length} registros carregados`}>{items.length}</em></button>{!closed && <div className="fh-lane-items">{items.map(item => <RecordButton key={item.rowId} item={item} onOpen={openRecord} />)}</div>}</section> })}
          </div>}{workspace.nextCursor && <button className="load-more fh-filter" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando…' : 'Carregar mais registros'}</button>}<p className="read-only-note">Consulta somente leitura. As etapas permanecem controladas pelo ERP.</p></>}
      </>}{session?.authenticated && <button className="session-exit" onClick={logout}>Sair</button>}
    </main> : <>
      <header className="detail-header"><button aria-label="Voltar à visão anterior" className="back-detail" onClick={goBack}>←</button><div className="detail-contact"><span className="detail-avatar" aria-hidden="true">{record?.name?.slice(0, 2).toUpperCase() || '·'}</span><strong>{record?.name || (loading ? 'Carregando…' : isAtendimento ? 'Atendimento' : 'Experiência')}</strong></div><div className="detail-identity"><strong>{record?.plate || record?.id || '—'}</strong><span>{record?.id}{record?.vehicle ? ` · ${record.vehicle}` : ''}</span></div></header>
      {isAtendimento && <nav className="view-switch" aria-label="Visões do atendimento">{(['chat', 'diagnosticos', 'mapa'] as const).map(item => <button key={item} className={`view-tab ${tab === item ? 'active' : ''}`} onClick={() => updateParams({ aba: item })} aria-current={tab === item ? 'page' : undefined}><Icon name={item === 'diagnosticos' ? 'diagnostics' : item === 'mapa' ? 'map' : 'chat'} />{item === 'diagnosticos' ? 'Diagnósticos' : item === 'mapa' ? 'Mapa' : 'Chat'}</button>)}</nav>}
      {!session?.authenticated ? <div className="detail-content">{login}</div> : loading ? <Notice title="Consultando registro…" /> : failure ? <Notice title="Não foi possível abrir o registro" error retry={() => setReload(value => value + 1)}>{failure}</Notice> : record && <>
        {isAtendimento && tab === 'chat' ? <div className="detail-page chat-page"><Notice title="Mensagens ainda não conectadas">Este é o atendimento {record.id || record.rowId}. As mensagens serão exibidas quando o vínculo da conversa estiver validado.</Notice><div className="record-summary"><span>{record.stage}</span><p>{[record.vehicle, record.plate, record.contact].filter(Boolean).join(' · ')}</p>{record.detail && <p>{record.detail}</p>}{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Abrir atendimento no ERP ↗</a>}</div><footer className="compose"><div className="compose-area"><textarea aria-label="Mensagem ao cliente" placeholder="Envio de mensagens ainda indisponível" disabled rows={1} /><button className="compose-button send" disabled title="Envio ainda não conectado" aria-label="Enviar mensagem indisponível"><Icon name="send" /></button></div></footer></div> : isAtendimento && tab === 'mapa' ? <div className="detail-page map-page"><p className="map-state">Mapa visual · diagnósticos ainda não conectados</p><div className="map-shell"><img src={carMap} alt="Mapa do veículo da V20: frente, motorista, passageiro, topo, estruturas e traseira. Seleção de diagnósticos ainda indisponível." /></div><footer className="detail-footer"><button className="primary-btn" disabled title="Geração de orçamento depende da integração validada">Criar orçamento</button></footer></div> : isAtendimento ? <div className="detail-page"><div className="diagnostics-body"><h1>Diagnósticos</h1><Notice title="Diagnósticos ainda não conectados">A consulta dos itens e serviços deste atendimento será habilitada após validar seus relacionamentos no ERP.</Notice><button className="codex-add" disabled>+ Adicionar item</button></div><footer className="detail-footer"><button className="primary-btn" disabled>Criar orçamento</button></footer></div> : <div className="experience-content"><span className="fh-pill blue">{record.stage || 'Fase não informada'}</span><h1>{record.vehicle || 'Experiência do veículo'}</h1><dl><div><dt>Identificador</dt><dd>{record.id || record.rowId}</dd></div><div><dt>Cliente</dt><dd>{record.name || 'Não informado'}</dd></div><div><dt>Placa</dt><dd>{record.plate || 'Não informada'}</dd></div><div><dt>Entrada</dt><dd>{dateLabel(record.enteredAt)}</dd></div><div><dt>Saída física</dt><dd>{dateLabel(record.exitedAt)}</dd></div><div><dt>Finalização operacional</dt><dd>{record.finished ? 'Finalizada' : 'Não finalizada'}</dd></div></dl>{record.atendimentoRowId && <button className="fh-filter" onClick={() => openRecord({ ...record, kind: 'atendimento', rowId: record.atendimentoRowId! })}>Abrir atendimento de origem ↗</button>}{sourceUrl && <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">Abrir experiência no ERP ↗</a>}<p className="read-only-note">Fase calculada pelo ERP. Entrada, saída e financeiro permanecem somente leitura.</p></div>}
      </>}
    </>}
  </div>
  {copilotOpen && <section className="copilot-panel" aria-label="Copiloto FUNIX"><header><div><strong>Copiloto FUNIX</strong><small>Busca e navegação</small></div><button aria-label="Recolher Copiloto" onClick={() => setCopilotOpen(false)}>⌄</button></header><div className="copilot-feed" aria-live="polite"><p className="copilot-message">{record ? `Contexto: ${record.id || record.rowId}. ` : ''}Busque uma placa, nome ou identificador no ERP.</p>{copilotFailure && <p role="alert" className="form-error">{copilotFailure}</p>}{copilotResults && <><p>{copilotResults.items.length ? 'Selecione o registro:' : copilotResults.nextCursor ? 'Nenhum resultado nesta página.' : 'Nenhum registro encontrado.'}</p>{copilotResults.items.map(item => <RecordButton key={item.rowId} item={item} list onOpen={openRecord} />)}{copilotResults.nextCursor && <><p>A busca continua nas próximas páginas.</p><button className="fh-filter" onClick={continueCopilot}>Continuar busca na área</button></>}</>}</div><form onSubmit={searchCopilot}><label htmlFor="copilot-scope" className="sr-only">Onde buscar</label><select id="copilot-scope" value={copilotArea} onChange={event => setCopilotArea(event.target.value)}><option value="funil">Atendimentos</option><option value="acompanhamento">Veículos em acompanhamento</option><option value="historico">Histórico de veículos</option></select><div className="copilot-compose"><input aria-label="Buscar no Copiloto" placeholder="Placa, nome ou ID…" value={copilotQuery} onChange={event => setCopilotQuery(event.target.value)} disabled={!session?.authenticated} /><button type="submit" disabled={!session?.authenticated || copilotBusy || !copilotQuery.trim()} aria-label="Buscar registros">{copilotBusy ? '…' : <Icon name="send" />}</button></div></form><div className="copilot-status">{session?.authenticated ? 'Consultas somente leitura' : 'Entre para consultar registros'}</div></section>}
  <button className="copilot-fixed" aria-label="Abrir Copiloto FUNIX" title="Copiloto" aria-expanded={copilotOpen} onClick={() => setCopilotOpen(value => !value)}><Icon name="bot" /></button>
  </div>
}
export default App
