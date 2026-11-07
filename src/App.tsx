import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {flushSync}from'react-dom'
import { ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento, AtendimentoList } from '../shared/contracts'
import { api } from './api'
import type { RequestFailure, Session } from './api'
import { AtendimentoForm } from './AtendimentoForm'
import { Icon, Login, Notice, RecordButton } from './ui'
import { SettingsPage } from './SettingsPage'
import{VoiceCopilot}from'./VoiceCopilot'
import type{VoiceCaptureContext}from'../shared/voice-input'
import { CommercialPanel } from './CommercialPanel'
import {detailScreen,parentDetail,swipeTab,isTabSwipe} from './detail-navigation'
import type {DetailScreen} from './detail-navigation'
import { ChatPanel } from './chat/ChatPanel'
import { EvolutionConversationReader } from './chat/EvolutionConversationReader'
import './App.css'
import './footer-copilot.css'

type Area = 'conversas' | 'funil' | 'configuracoes'
type Route = { path: string; search: string }
type Editor = { record?: Atendimento }
const readRoute = (): Route => ({ path: window.location.pathname, search: window.location.search })
const labels: Record<Area, string> = { conversas: 'Conversas', funil: 'Funil', configuracoes: 'Configurações' }
const symbols: Record<Area, string> = { conversas: '▤', funil: '▥', configuracoes: '⚙' }
function vehicleLabel(record: Atendimento) { return record.vehicle || [record.brand, record.model].filter(Boolean).join(' ') }
function dateLabel(value: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) }

function App() {
  const [route, setRoute] = useState(() => {
    window.history.replaceState({...window.history.state,funixIndex:window.history.state?.funixIndex??0},'',window.location.href)
    return readRoute()
  })
  const routeRef = useRef(route), historyState = useRef(window.history.state), restoringHistory = useRef(false)
  const params = new URLSearchParams(route.search)
  const area: Area = route.path === '/configuracoes' ? 'configuracoes' : route.path === '/conversas' ? 'conversas' : 'funil'
  const mode = params.get('modo') === 'lista' ? 'lista' : 'quadro', query = params.get('q') || ''
  const isDetail = /^\/atendimentos\/[^/]+$/.test(route.path), detailId = isDetail ? route.path.split('/')[2] : ''
  const removedRoute = route.path.startsWith('/veiculos') || route.path.startsWith('/experiencias')
  const tab = ['chat', 'mapa', 'diagnosticos'].includes(params.get('aba') || '') ? params.get('aba')! : 'chat'
  const screen = isDetail ? detailScreen(route.search) : null
  const [contextTitle,setContextTitle]=useState<{key:string;title:string}|null>(null)
  const key = query, routeKey = route.path + route.search
  const onContextTitle=useCallback((title:string)=>setContextTitle({key:routeKey,title}),[routeKey])
  const mapClickUntil=useRef(0)
  const tabTransition=useRef<ViewTransition|null>(null)
  const touch=useRef<{x:number;y:number;time:number}|null>(null)
  const [session, setSession] = useState<Session | null>(null), [sessionError, setSessionError] = useState(''), [sessionVersion, setSessionVersion] = useState(0)
  const [storedList, setList] = useState<AtendimentoList | null>(null), [listKey, setListKey] = useState('')
  const [storedRecord, setRecord] = useState<Atendimento | null>(null)
  const list = listKey === key ? storedList : null
  const record = storedRecord?.id === detailId ? storedRecord : null
  const [failure, setFailure] = useState(''), [loading, setLoading] = useState(false), [loadingMore, setLoadingMore] = useState(false), [reload, setReload] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copilotOpen, setCopilotOpen] = useState(false), [editor, setEditor] = useState<Editor | null>(null), [savedMessage, setSavedMessage] = useState('')
  const [commercialVersion, setCommercialVersion] = useState(0)
  const [voiceRefreshVersion,setVoiceRefreshVersion] = useState(0)
  const[voiceContext,setVoiceContext]=useState<VoiceCaptureContext|null>(null)
  const [scenarioContext] = useState(() => new Map<string,string>())
  const dirty = useRef(false), negotiationDirty = useRef(false), saving = useRef(false)
  const [diagnosisNoteSlot,setDiagnosisNoteSlot]=useState<HTMLElement|null>(null)
  const [scenarioSlot, setScenarioSlot] = useState<HTMLDivElement | null>(null)
  const viewport = useRef<HTMLDivElement>(null), board = useRef<HTMLDivElement>(null), modal = useRef<HTMLDivElement>(null)
  const [positions] = useState(() => new Map<string, { top: number; left: number }>())
  const cache = useRef(new Map<string, AtendimentoList>())
  const pageRequest = useRef<AbortController | null>(null)
  const currentKey = useRef(key)
  useLayoutEffect(() => { currentKey.current = key; routeRef.current = route; historyState.current=window.history.state }, [key, route])
  const onDirty = useCallback((value: boolean) => { dirty.current = value }, [])
  const onBusy = useCallback((value: boolean) => { saving.current = value }, [])
  const onNegotiationDirty = useCallback((value: boolean) => { negotiationDirty.current = value }, [])
  function canLeaveEditor(preserveNegotiation = false) {
    if (saving.current) return false
    if ((dirty.current || (!preserveNegotiation && negotiationDirty.current)) && !window.confirm('Há alterações não salvas. Deseja descartá-las?')) return false
    if (dirty.current || (!preserveNegotiation && negotiationDirty.current)) { setCommercialVersion(value => value + 1); negotiationDirty.current = false }
    if (editor?.record) setReload(value => value + 1)
    dirty.current = false; setEditor(null); return true
  }
  function navigate(href: string, replace = false, state?: unknown) {
    if (!canLeaveEditor(isDetail && new URL(href, window.location.origin).pathname === route.path)) return false
    const index=historyState.current?.funixIndex??0
    const nextState={...(state??window.history.state),funixIndex:replace?index:index+1}
    if (replace) window.history.replaceState(nextState, '', href)
    else window.history.pushState(nextState, '', href)
    historyState.current=nextState
    const nextRoute=readRoute(),nextTab=new URLSearchParams(nextRoute.search).get('aba')??'chat'
    const tabs=['chat','diagnosticos','mapa'],animated=isDetail&&!screen&&nextRoute.path===route.path&&nextTab!==tab&&!new URLSearchParams(nextRoute.search).has('tela')&&!matchMedia('(prefers-reduced-motion: reduce)').matches
    const update=()=>{if(window.location.pathname!==nextRoute.path||window.location.search!==nextRoute.search)return;setRoute(nextRoute);setSavedMessage('')}
    tabTransition.current?.skipTransition()
    if(animated&&document.startViewTransition){
      document.documentElement.setAttribute('data-tab-direction',tabs.indexOf(nextTab)>tabs.indexOf(tab)?'forward':'back')
      const transition=document.startViewTransition(()=>flushSync(update));tabTransition.current=transition
      void transition.ready.catch(()=>{}) // Superseded navigation intentionally skips the animation.
      void transition.finished.catch(()=>{}).finally(()=>{if(tabTransition.current===transition)tabTransition.current=null})
    }else update()
    return true
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
  function openView(next:DetailScreen,id?:string) {
    const values=new URLSearchParams(route.search)
    values.set('tela',next);values.delete('peca');values.delete('versao')
    if(next==='peca'&&id)values.set('peca',id)
    if(next==='orcamentos'&&id)values.set('versao',id)
    return navigate(route.path+'?'+values,false,{...window.history.state,detailParent:routeKey})
  }
  function goBack() {
    if(screen){
      if(window.history.state?.detailParent && historyState.current?.funixIndex>0)window.history.back()
      else {const search=parentDetail(route.search);navigate(route.path+(search?'?'+search:''),true)}
      return
    }
    if (!canLeaveEditor()) return
    if (window.history.state?.returnTo && historyState.current?.funixIndex>0) window.history.back()
    else navigate('/funil', true)
  }
  const expireSession = useCallback(() => {
    setSession(previous => previous ? { ...previous, authenticated: false } : null)
    cache.current.clear(); setList(null); setRecord(null)
  }, [])
  useEffect(() => {
    const onPop = () => {
      if(restoringHistory.current){restoringHistory.current=false;return}
      const changedRecord=window.location.pathname!==routeRef.current.path
      const unsaved=dirty.current||(negotiationDirty.current&&changedRecord)
      if (saving.current || (unsaved&&!window.confirm('Há alterações não salvas. Deseja descartá-las?'))) {
        const delta=(historyState.current?.funixIndex??0)-(window.history.state?.funixIndex??0)
        if(delta){restoringHistory.current=true;window.history.go(delta)}
        else window.history.pushState(historyState.current,'',routeRef.current.path+routeRef.current.search)
        return
      }
      if(unsaved)setCommercialVersion(value=>value+1)
      if(changedRecord)negotiationDirty.current=false
      tabTransition.current?.skipTransition()
      dirty.current=false;setEditor(null);historyState.current=window.history.state;setRoute(readRoute());setSavedMessage('')
    }
    const onUnload = (event: BeforeUnloadEvent) => { if (dirty.current || negotiationDirty.current || saving.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('popstate', onPop); window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('beforeunload', onUnload) }
  }, [])
  useEffect(() => {
    const controller = new AbortController(); setSessionError('')
    api<Session>('/api/session', { signal: controller.signal }).then(setSession).catch(cause => { if (cause.name !== 'AbortError') setSessionError(cause.message) })
    return () => controller.abort()
  }, [sessionVersion])
  useEffect(() => {
    if (!session?.authenticated || isDetail || area !== 'funil' || removedRoute) return
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
  }, [session?.authenticated, key, isDetail, area, removedRoute, reload, query, expireSession])
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
  }, [session?.authenticated, isDetail, detailId, reload, expireSession])
  useLayoutEffect(() => {
    if (isDetail || loading) return
    const position = positions.get(routeKey)
    if (viewport.current) viewport.current.scrollTop = position?.top || 0
    if (board.current) board.current.scrollLeft = position?.left || 0
  }, [isDetail, loading, routeKey, list, positions])
  useEffect(() => {
    pageRequest.current?.abort(); setLoadingMore(false)
    return () => pageRequest.current?.abort()
  }, [key, isDetail, session?.authenticated])
  useLayoutEffect(()=>{
    if(screen)document.querySelector<HTMLElement>('.detail-header h1')?.focus({preventScroll:true})
  },[screen,routeKey])
  useEffect(()=>{
    const root=viewport.current,shell=root?.parentElement
    if(!root||!shell)return
    let frame=0,observed:Element|null=null
    const measure=()=>{
      const surface=root.querySelector('.approved-finance')
      if(surface!==observed){if(observed)resize.unobserve(observed);observed=surface;if(surface)resize.observe(surface)}
      const offset=surface?Math.max(0,shell.getBoundingClientRect().bottom-surface.getBoundingClientRect().top):0
      shell.style.setProperty('--finance-height',offset+'px')
    }
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)}
    const resize=new ResizeObserver(schedule);resize.observe(root)
    const mutations=new MutationObserver(schedule);mutations.observe(root,{childList:true,subtree:true})
    measure();return()=>{resize.disconnect();mutations.disconnect();cancelAnimationFrame(frame)}
  },[isDetail,tab,screen])
  function touchStart(event:React.TouchEvent<HTMLDivElement>){
    touch.current=null;mapClickUntil.current=0
    if(!isDetail||screen||editor||event.touches.length!==1||document.querySelector('dialog[open]')||copilotOpen)return
    const target=event.target as Element
    const onMap=Boolean(target.closest('.interactive-map'))
    if(!onMap&&target.closest('input,textarea,select,button,[role="button"],a,label,summary,details,[role="menu"],[role="dialog"],.view-switch,.detail-header,.approved-finance,.scenario-matrix,[data-row-gesture],.disc-wrap,.interactive-map,[contenteditable=true],[role=slider],[role=switch],[role=checkbox]'))return
    for(let node:Element|null=target;node&&node!==event.currentTarget;node=node.parentElement){
      if(node.scrollWidth>node.clientWidth+1&&/auto|scroll/.test(getComputedStyle(node).overflowX))return
    }
    const t=event.touches[0];touch.current={x:t.clientX,y:t.clientY,time:event.timeStamp}
  }
  function touchEnd(event:React.TouchEvent<HTMLDivElement>){
    const start=touch.current;touch.current=null
    if(!start||screen||editor||event.changedTouches.length!==1)return
    const t=event.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y,elapsed=event.timeStamp-start.time
    if(isTabSwipe(dx,dy,elapsed)&&(event.target as Element).closest('.interactive-map')){mapClickUntil.current=event.timeStamp+500;if(event.cancelable)event.preventDefault()}
    const next=swipeTab(tab,dx,dy,elapsed)
    if(next)updateParams({aba:next})
  }
  function mapClickCapture(event:React.MouseEvent<HTMLDivElement>){
    const pointer=event.nativeEvent as PointerEvent
    if(event.detail!==0&&pointer.pointerType!=='mouse'&&event.timeStamp<mapClickUntil.current&&(event.target as Element).closest('.interactive-map')){event.preventDefault();event.stopPropagation()}
  }
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
      window.history.pushState({ funixIndex:(historyState.current?.funixIndex??0)+1,returnTo: area === 'funil' && !isDetail ? routeKey : '/funil' }, '', `/atendimentos/${savedRecord.id}?aba=chat`)
      setRoute(readRoute())
    }
    setReload(value => value + 1); setSavedMessage('Atendimento salvo no aplicativo.')
  }
  const login = <Login session={session} error={sessionError} refresh={() => setSessionVersion(value => value + 1)} onSession={setSession} />
  return <div className="app-shell">
    <div className={`app-viewport ${isDetail ? 'detail-viewport' : ''}`} ref={viewport} inert={Boolean(editor)} onClickCapture={mapClickCapture} onTouchStart={touchStart} onTouchEnd={touchEnd} onTouchCancel={()=>{touch.current=null}} onScroll={event => {
      if (!isDetail) positions.set(routeKey, { top: event.currentTarget.scrollTop, left: board.current?.scrollLeft || 0 })
    }}>
      {!isDetail ? <main className="fh-work">
        <nav className="fh-tabs" aria-label="Áreas da FUNIX">{(Object.keys(labels) as Area[]).map(item => <button key={item} className={area === item && !removedRoute ? 'selected' : ''} onClick={() => navigate('/' + item)} aria-current={area === item && !removedRoute ? 'page' : undefined}><span aria-hidden="true">{symbols[item]}</span> {labels[item]}</button>)}</nav>
        {!session?.authenticated ? login : removedRoute ? <div className="fh-surface"><Notice title="Área fora do aplicativo Comercial" retry={() => navigate('/funil', true)} actionLabel="Abrir Funil">Os Atendimentos são gerenciados no Funil.</Notice></div> : area==='configuracoes'?<><SettingsPage key={commercialVersion} onDirty={onDirty} onBusy={onBusy}/><button className="session-exit" onClick={logout}>Sair</button></>:<>
          <div className="fh-tools"><label className="fh-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar nome, telefone, placa ou Atendimento" autoComplete="off" placeholder="Buscar nome, telefone, placa…" value={query} onChange={event => updateParams({ q: event.target.value })} disabled={area === 'conversas'} /></label><div className="fh-tools-right">
            <button className="primary-btn at-new" onClick={() => { setSavedMessage(''); setEditor({}) }}>+ Novo Atendimento</button>
            {area === 'funil' && <div className="fh-listtoggle" aria-label="Visualização"><button className={mode === 'quadro' ? 'active' : ''} onClick={() => updateParams({ modo: 'quadro' })} aria-pressed={mode === 'quadro'}>▥ Quadro</button><button className={mode === 'lista' ? 'active' : ''} onClick={() => updateParams({ modo: 'lista' })} aria-pressed={mode === 'lista'}>☷ Lista</button></div>}
          </div></div>
          {area === 'conversas' ? <EvolutionConversationReader onUnauthorized={expireSession} /> : <>
            {loading && <div className="fh-surface"><Notice title="Carregando Atendimentos…" /></div>}{failure && <div className="fh-surface"><Notice title="Não foi possível carregar" error retry={() => setReload(value => value + 1)}>{failure}</Notice></div>}
            {!loading && list && <><div className="query-meta"><span>{list.items.length} de {list.total} Atendimento{list.total !== 1 ? 's' : ''}</span><button onClick={() => setReload(value => value + 1)}>Atualizar</button></div>
              {!list.items.length && <div className="fh-surface"><Notice title={query ? 'Nenhum Atendimento encontrado' : 'Nenhum Atendimento cadastrado'}>{query ? 'Tente outro nome, telefone, placa ou identificador.' : 'Use Novo Atendimento para registrar o primeiro contato.'}</Notice></div>}
              {mode === 'lista' ? <div className="fh-surface fh-board-list">{list.items.map(item => <RecordButton key={item.id} item={item} list onOpen={openRecord} />)}</div> : <div className="fh-kboard" ref={board} onScroll={event => positions.set(routeKey, { top: viewport.current?.scrollTop || 0, left: event.currentTarget.scrollLeft })} aria-label="Funil de Atendimentos">
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
        <header className="detail-header">{screen?<><button aria-label={screen==='peca'?(tab==='mapa'?'Voltar ao Mapa':'Voltar aos Diagnósticos'):'Voltar à tela anterior'} title="Voltar" className="back-detail" onClick={goBack}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m11 5-7 7 7 7M4 12h16"/></svg></button><h1 tabIndex={-1}>{(contextTitle?.key===routeKey?contextTitle.title:'')||(screen==='peca'?'Peça':screen==='comparacao'?'Comparação de cenários':'Orçamentos emitidos')}</h1>{screen==='peca'&&<span className="diagnosis-note-slot" ref={setDiagnosisNoteSlot}/>}</>:<><button aria-label="Voltar à visão anterior" className="back-detail" onClick={goBack}>←</button><div className="detail-contact"><span className="detail-avatar" aria-hidden="true">{record ? (record.name || record.phone).slice(0, 2).toUpperCase() : '·'}</span><strong>{record ? record.name || record.phone : 'Atendimento'}</strong></div><div className="detail-identity"><strong>{record?.plate || record?.phone || '—'}</strong><span>{record ? vehicleLabel(record) || record.phone : loading ? 'Carregando…' : ''}</span></div>{session?.authenticated && record && <button className="edit-detail" aria-label="Editar Atendimento" title="Editar Atendimento" onClick={() => { if (canLeaveEditor()) { setSavedMessage(''); setEditor({ record }) } }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4" /></svg></button>}</>}</header>
        {!screen&&<nav className="view-switch" aria-label="Visões do Atendimento">{(['chat', 'diagnosticos', 'mapa'] as const).map(item => <button key={item} className={`view-tab ${tab === item ? 'active' : ''}`} onClick={() => updateParams({ aba: item })} aria-current={tab === item ? 'page' : undefined}><Icon name={item === 'diagnosticos' ? 'diagnostics' : item === 'mapa' ? 'map' : 'chat'} />{item === 'diagnosticos' ? 'Diagnósticos' : item === 'mapa' ? 'Mapa' : 'Chat'}</button>)}<div className="scenario-slot" ref={setScenarioSlot} /></nav>}
        {!session?.authenticated ? <div className="detail-content">{login}</div> : loading ? <Notice title="Carregando Atendimento…" /> : failure ? <Notice title="Não foi possível abrir o Atendimento" error retry={() => setReload(value => value + 1)}>{failure}</Notice> : record && <>
          {savedMessage && <p className="at-save-success" role="status">{savedMessage}</p>}
          {<CommercialPanel key={`${record.id}:${commercialVersion}`} atendimentoId={record.id} refreshVersion={voiceRefreshVersion} onVoiceContext={setVoiceContext} tab={tab} scenarioContext={scenarioContext} onDirty={onDirty} onBusy={onBusy} onNegotiationDirty={onNegotiationDirty} scenarioSlot={scenarioSlot} diagnosisNoteSlot={diagnosisNoteSlot} screen={screen} pieceId={params.get('peca')} versionId={params.get('versao')} onView={openView} onBack={goBack} onTitle={onContextTitle} scrollPositions={positions} chat={<ChatPanel key={record.id} atendimentoId={record.id} onUnauthorized={expireSession}>
            <div className="record-summary at-record-summary"><strong>{record.name || 'Nome não informado'}</strong><p>{record.phone}</p><p>{[vehicleLabel(record), record.plate].filter(Boolean).join(' · ') || 'Veículo não informado'}</p>{record.reason && <p><b>Motivo:</b> {record.reason}</p>}{record.notes && <p><b>Observações:</b> {record.notes}</p>}{record.stage === 'rejeitados' && <p><b>Recusa registrada:</b> {record.rejectionReason}</p>}<small>Atualizado em {dateLabel(record.updatedAt)}</small><details><summary>Identificador técnico</summary><span className="at-technical-id">{record.id}</span></details></div>
          </ChatPanel>} />}
        </>}
      </>}
    </div>
    <VoiceCopilot onClose={()=>setCopilotOpen(false)} navigationKey={routeKey} context={session?.authenticated&&record&&voiceContext?.atendimentoId===record.id&&!screen?voiceContext:null} open={copilotOpen} onToggle={()=>setCopilotOpen(value=>!value)} onOpen={()=>setCopilotOpen(true)} visible={!screen} disabled={Boolean(editor)} onApplied={()=>{setVoiceRefreshVersion(v=>v+1)}}/>
    {editor && <div className="at-editor-shade" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); canLeaveEditor() }
      if (event.key === 'Tab') {
        const focusable = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? []).filter(element => element.offsetParent !== null)
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}><section className="at-editor" role="dialog" aria-modal="true" aria-labelledby="at-editor-title" ref={modal}><header><h1 id="at-editor-title">{editor.record ? 'Editar Atendimento' : 'Novo Atendimento'}</h1><button type="button" aria-label="Fechar formulário" onClick={()=>canLeaveEditor()}>×</button></header>
      {!session?.authenticated && <div className="at-reauth"><p>Sua sessão expirou. Entre novamente para continuar; as alterações do formulário foram mantidas.</p>{login}</div>}
      <div className="at-editor-body" hidden={!session?.authenticated}><AtendimentoForm record={editor.record} onSaved={saved} onDirty={onDirty} onBusy={onBusy} onAuthRequired={expireSession} /></div>
    </section></div>}
  </div>
}
export default App
