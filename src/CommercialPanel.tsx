import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import type { CatalogItem, CatalogKind, CatalogResponse, DiagnosisItem, HierarchyNode, Scenario, CommercialWorkspace } from '../shared/commercial'
import { catalogItemUsable as usable, scenarioLabel } from '../shared/commercial'
import { api } from './api'
import type { RequestFailure } from './api'
import { Icon, Login } from './ui'
import { PieceDialog } from './PieceDialog'
import {DiagnosisEditor} from './DiagnosisEditor'
import type {CalculationState} from './calculation-state'
import {FinancialPanel} from './FinancialPanel'
import {BudgetPanel} from './BudgetPanel'
import type {DetailScreen} from './detail-navigation'
import {ScenarioMenu} from './ScenarioMenu'
import {emptyNegotiationState,negotiationSignature} from './negotiation'
import type {NegotiationState} from './negotiation'
import {money} from './money'
import carMap from './assets/car-map.svg?raw'

const kindNames: Record<CatalogKind, string> = { peca: 'Peças', diagnostico: 'Diagnósticos', servico: 'Serviços', dimensao: 'Dimensões' }
function stateLabel(item?: CatalogItem) { return !item || (item.kind === 'peca' && !item.code?.trim()) ? 'Sem código · indisponível' : item.active ? 'Ativo' : 'Inativo' }
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function CommercialPanel({ atendimentoId, tab, onDirty, onBusy, scenarioContext, scenarioSlot, chat, onNegotiationDirty, screen, pieceId, versionId, onView, onBack, onTitle, scrollPositions }: {
  atendimentoId: string; tab: string; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; scenarioContext: Map<string,string>; scenarioSlot: HTMLElement | null; chat: ReactNode; onNegotiationDirty:(value:boolean)=>void; screen:DetailScreen|null;pieceId:string|null;versionId:string|null;onView:(screen:DetailScreen,id?:string)=>boolean;onBack:()=>void;onTitle:(title:string)=>void;scrollPositions:Map<string,{top:number;left:number}>
}) {
  const [dealState,setDealState] = useState<NegotiationState>(emptyNegotiationState)
  const [scenarioGone,setScenarioGone] = useState(false)
  const negotiationDirty = dealState.draft.mode!=='none' || dealState.draft.value!=='' || dealState.draft.acknowledgeResidual
  useEffect(()=>{onNegotiationDirty(negotiationDirty);return()=>onNegotiationDirty(false)},[negotiationDirty,onNegotiationDirty])
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null), [items, setItems] = useState<DiagnosisItem[]>([])
  const [workspace,setWorkspace] = useState<CommercialWorkspace|null>(null)
  const budget=screen==='orcamentos',matrix=screen==='comparacao'
  const body=useRef<HTMLDivElement>(null)
  const viewKey=atendimentoId+':'+(screen==='peca'?'peca:'+pieceId:screen==='orcamentos'?'orcamentos:'+(versionId??'lista'):screen??tab)
  const loaded=Boolean(workspace)
  useLayoutEffect(()=>{if(body.current&&loaded)body.current.scrollTop=scrollPositions.get(viewKey)?.top??0},[viewKey,loaded,scrollPositions])
  const [scenarios,setScenarios] = useState<Scenario[]>([]), [scenarioId,setScenarioId] = useState(scenarioContext.get(atendimentoId) ?? '')
  const catalogCache=useRef<CatalogResponse|null>(null)
  const selection = useRef(scenarioId)
  const loadVersion = useRef(0), mutationInFlight = useRef(false)
  const mapStage = useRef<HTMLDivElement>(null), mapOpener = useRef('.map-search-trigger')
  const returnMapFocus = useCallback(() => { mapStage.current?.querySelector<HTMLElement>(mapOpener.current)?.focus() }, [])
  const [differences,setDifferences] = useState(false)
  const [failure, setFailure] = useState(''), [message, setMessage] = useState(''), [localBusy, setBusy] = useState(false)
  const [failureDetails, setFailureDetails] = useState<RequestFailure | null>(null), [refreshNeeded, setRefreshNeeded] = useState(false)
  const [reauth, setReauth] = useState(false), [selecting, setSelecting] = useState(false)
  const [displayTab,setDisplayTab]=useState(tab)
  if(displayTab!==tab){setDisplayTab(tab);setSelecting(false)}
  const [discPage, setDiscPage] = useState(0)
  const [path, setPath] = useState<HierarchyNode[]>([]), [query, setQuery] = useState('')
  const draft=screen==='peca'?workspace?.items.find(item=>item.id===pieceId):undefined
  const title=screen==='peca'?(catalog?.items.find(c=>c.id===draft?.pieceId)?.name??'Peça indisponível').replace(/\s*·\s*/g,' '):screen==='comparacao'?'Comparação de cenários':'Orçamentos emitidos'
  useLayoutEffect(()=>{if(screen&&!(screen==='orcamentos'&&versionId))onTitle(title)},[screen,title,versionId,onTitle])
  const [calculationState,setCalculationState]=useState<CalculationState>('current'),[parameterState,setParameterState]=useState<CalculationState>('current')
  const [editorDirty,setEditorDirty]=useState(false),[financeDirty,setFinanceDirty]=useState(false)
  const [editorBusy,setEditorBusy]=useState(false),[financeBusy,setFinanceBusy]=useState(false)
  const busy=localBusy||editorBusy||financeBusy
  const [pendingPiece,setPendingPiece]=useState<string|null>(null),[pendingBack,setPendingBack]=useState(false)
  const onManagerDirty=useCallback((v:boolean)=>setEditorDirty(v),[])
  const onFinanceDirty=useCallback((v:boolean)=>setFinanceDirty(v),[])
  const onManagerBusy=useCallback((v:boolean)=>setEditorBusy(v),[])
  const onFinanceBusy=useCallback((v:boolean)=>setFinanceBusy(v),[])
  const managerDirty=editorDirty||financeDirty
  useEffect(()=>{onBusy(busy)},[busy,onBusy])
  useEffect(() => { onDirty(editorDirty||financeDirty) }, [editorDirty,financeDirty,onDirty])
  useEffect(() => () => { onDirty(false); onBusy(false) }, [onDirty, onBusy])
  useEffect(()=>{
    if(busy||(!pendingPiece&&!pendingBack))return
    let active=true
    Promise.resolve().then(()=>{if(!active)return;if(pendingPiece){setPendingPiece(null);onView('peca',pendingPiece)}if(pendingBack){setPendingBack(false);onBack()}})
    return()=>{active=false}
  },[busy,pendingPiece,pendingBack,onView,onBack])
  const load = useCallback(async (signal?: AbortSignal, preferred = selection.current, refreshCatalog = false) => {
    const version = ++loadVersion.current
    const suffix = preferred ? '?scenarioId='+encodeURIComponent(preferred) : ''
    try {
      const [c, workspace] = await Promise.all([refreshCatalog || !catalogCache.current ? api<CatalogResponse>('/api/catalogos', { signal }) : Promise.resolve(catalogCache.current), api<CommercialWorkspace>(`/api/atendimentos/${atendimentoId}/cenarios${suffix}`, { signal })])
      if (signal?.aborted || version !== loadVersion.current) return
      if(preferred && preferred!==workspace.selectedId)setScenarioGone(true)
      setDealState(old=>{
        const snapshot=old.preview?.snapshot
        if(snapshot && (snapshot.compositionRevision!==workspace.revision || snapshot.configuration.revision!==workspace.configurationRevision || snapshot.scenarioId!==workspace.selectedId || snapshot.scenarioRevision!==workspace.scenarios.find(s=>s.id===workspace.selectedId)?.revision))return {...old,draft:{...old.draft,acknowledgeResidual:false},signature:''}
        return old
      })
      catalogCache.current=c; setCatalog(c); setWorkspace(workspace); setItems(workspace.items); setScenarios(workspace.scenarios); setScenarioId(workspace.selectedId)
      selection.current = workspace.selectedId; scenarioContext.set(atendimentoId,workspace.selectedId)
    } catch(cause) {if(!signal?.aborted && version === loadVersion.current)throw cause}
  }, [atendimentoId,scenarioContext])
  function failed(cause: unknown, message?: string) {
    if ((cause as Error).name === 'AbortError') return
    setFailure(message ?? (cause as Error).message); setFailureDetails(cause as RequestFailure)
    if ((cause as RequestFailure).status === 401) setReauth(true)
  }
  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(() => load(controller.signal)).catch(cause => { if (!controller.signal.aborted) {setRefreshNeeded(true);failed(cause)} })
    return () => controller.abort()
  }, [load])
  async function mutate(operation: () => Promise<void>, keepMessage = false) {
    if (busy || mutationInFlight.current) return false
    mutationInFlight.current = true
    setBusy(true); setFailure(''); setFailureDetails(null); if(!keepMessage)setMessage('')
    try { await operation(); return true } catch (cause) { failed(cause); return false }
    finally { mutationInFlight.current = false; setBusy(false) }
  }
  function discardContext() {setDealState(emptyNegotiationState());setScenarioGone(false);setSelecting(false);onDirty(false)}
  function canChangeScenario() {return !busy && (!(managerDirty || negotiationDirty) || window.confirm('Há alterações não salvas de diagnóstico, configuração ou negociação. Deseja descartá-las para trocar de cenário?'))}
  async function chooseScenario(id:string) {
    if(id===scenarioId && !scenarioGone)return true
    if(!canChangeScenario())return false
    const ok=await mutate(()=>load(undefined,id));if(ok){discardContext();setRefreshNeeded(false)};return ok
  }
  async function addScenario() {
    const active=scenarios.find(s=>s.id===scenarioId)
    if(!active || !canChangeScenario())return false
    return mutate(async()=>{
      const created=await api<Scenario>(`/api/atendimentos/${atendimentoId}/cenarios`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Variação',duplicateFrom:active.id,sourceRevision:active.revision})})
      setScenarios(old=>[...old,created]);selection.current=created.id;setScenarioId(created.id);scenarioContext.set(atendimentoId,created.id);discardContext()
      try{await load(undefined,created.id);setRefreshNeeded(false)}catch(cause){setRefreshNeeded(true);failed(cause,'Variação criada, mas a atualização da tela falhou. Use Atualizar dados antes de criar outra.')}
    })
  }
  async function deleteScenario(s:Scenario) {
    const current=s.id===scenarioId
    if(!window.confirm(`Excluir ${scenarioLabel(s)}? Somente suas inclusões serão removidas; peças, serviços e orçamentos emitidos serão preservados.${current&&(managerDirty||negotiationDirty)?' Os campos locais não salvos serão descartados.':''}`))return false
    return mutate(async()=>{
      let result:{scenarios:Scenario[]}
      try{result=await api(`/api/atendimentos/${atendimentoId}/cenarios/${s.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:s.revision})})}
      catch(cause){if((cause as RequestFailure).status===409||(cause as RequestFailure).status===404||(cause as RequestFailure).kind==='network'||(cause as RequestFailure).kind==='response')setRefreshNeeded(true);throw cause}
      const next=result.scenarios.some(s=>s.id===scenarioId)?scenarioId:result.scenarios[0].id
      setScenarios(result.scenarios);setScenarioId(next);selection.current=next;scenarioContext.set(atendimentoId,next);if(current)discardContext()
      setMessage(`${scenarioLabel(s)} excluído. Composição e versões emitidas preservadas.`)
      try{await load(undefined,next);setRefreshNeeded(false)}catch(cause){setRefreshNeeded(true);failed(cause,'Exclusão confirmada, mas a tela não foi atualizada. Use Atualizar dados; não é preciso excluir novamente.')}
    })
  }
  const previewFresh=Boolean(workspace && dealState.preview && dealState.signature===negotiationSignature(workspace,dealState.draft) && !scenarioGone && !refreshNeeded)
  const byId = (id: string | null) => catalog?.items.find(item => item.id === id)
  const byCode = (code?: string) => catalog?.items.find(item => item.code === code)
  async function select(codes: string[]) {
    if (refreshNeeded || scenarioGone) return
    const existing = codes.length===1 ? items.find(p=>p.pieceId===byCode(codes[0])?.id) : undefined
    await mutate(async () => {
      let result: DiagnosisItem[]
      try {
        result = await api<DiagnosisItem[]>(`/api/atendimentos/${atendimentoId}/diagnosticos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceCodes: codes, scenarioId, scenarioRevision: scenarios.find(s=>s.id===scenarioId)?.revision }) })
      } catch(cause) {
        const error = cause as RequestFailure
        if (error.status === 409 && error.code === 'VERSION_CONFLICT') {
          setRefreshNeeded(true)
          try {
            await load(); setRefreshNeeded(false)
            failed(error, 'Os dados do Atendimento mudaram e foram atualizados. Tente adicionar a peça novamente.')
          } catch(refreshError) {failed(refreshError, 'Os dados mudaram e não foi possível atualizá-los. Use Atualizar dados antes de tentar novamente.')}
        } else if(error.kind === 'network' || error.kind === 'response') {
          setRefreshNeeded(true)
          // HTTP headers alone do not confirm the application result if its body is unreadable.
          failed(error, error.kind === 'response' ? 'A resposta da inclusão não pôde ser lida. Não foi possível confirmar se a peça foi gravada. Use Atualizar dados antes de tentar novamente.' : 'Não foi possível confirmar a inclusão. Ela pode ter sido gravada. Use Atualizar dados antes de tentar novamente.')
        } else failed(error)
        return
      }
      // POST confirmation and subsequent GET synchronization are separate outcomes.
      setItems(result); setMessage('Peça(s) salva(s) no Atendimento. Seleções repetidas não duplicam a peça.')
      if(existing){setSelecting(false);setPendingPiece(existing.id)}
      try { await load(); setRefreshNeeded(false) }
      catch(cause) {setRefreshNeeded(true);failed(cause, 'A inclusão foi confirmada, mas a atualização da tela falhou. Use Atualizar dados; a peça não precisa ser enviada novamente.')}
    })
  }
  async function refresh() {
    await mutate(async()=>{
      await load(undefined,selection.current,true); setRefreshNeeded(false)
      setMessage(managerDirty ? 'Dados atualizados. Os campos em edição foram preservados; confira antes de salvar.' : 'Dados atualizados. Confira os itens antes de adicionar novamente.')
    }, true)
  }
  function showNode(node: HierarchyNode) {
    if (node.tipo === 'grupo' || node.tipo === 'grupo_lados') { setPath(previous => [...previous, node]); setQuery(''); setDiscPage(0); return }
    const codes = node.tipo === 'acao_ambos' ? node.gera_codigos_peca! : node.codigo_peca ? [node.codigo_peca] : []
    if (codes.length) void select(codes)
  }
  const roots = catalog ? [...Object.values(catalog.hierarchy.regioes), catalog.hierarchy.acesso_geral] : []
  function searchNodes(): HierarchyNode[] {
    const seen = new Set<string>(), found: HierarchyNode[] = []
    function visit(node: HierarchyNode, parent = '') {
      const key = node.codigo_peca ?? node.id
      const name = byCode(node.codigo_peca)?.name ?? (node.lado ? `${parent} · ${node.nome}` : node.nome)
      if (node.tipo === 'peca' && !seen.has(key) && fold(`${parent} ${name} ${node.codigo_peca ?? ''}`).includes(fold(query.trim()))) {
        seen.add(key); found.push({ ...node, nome: name })
      }
      node.itens?.forEach(child => visit(child, node.nome))
    }
    roots.forEach(node => visit(node))
    for (const item of catalog?.items ?? []) {
      const key = item.code ?? item.id
      if (item.kind === 'peca' && !seen.has(key) && fold(`${item.name} ${item.code ?? ''}`).includes(fold(query.trim()))) {
        seen.add(key); found.push({ id: item.id, tipo: 'peca', nome: item.name, codigo_peca: item.code ?? undefined })
      }
    }
    return found
  }
  const nodes = query.trim() ? searchNodes() : path.length ? path[path.length - 1].itens ?? [] : roots
  const searchField = <label className="piece-search"><Icon name="search" /><input aria-label="Buscar peça em todas as vistas" placeholder="Buscar peça…" value={query} onChange={e => { setQuery(e.target.value); setDiscPage(0) }} maxLength={150} /></label>
  function option(node: HierarchyNode, index = 0, count = 1, radial = false) {
    const group = node.tipo === 'grupo' || node.tipo === 'grupo_lados'
    const codes = node.tipo === 'acao_ambos' ? node.gera_codigos_peca ?? [] : node.codigo_peca ? [node.codigo_peca] : []
    const available = codes.length > 0 && codes.every(code => { const item = byCode(code); return item && usable(item) })
    const selected = !group && codes.length > 0 && codes.every(code => items.some(item => item.pieceId === byCode(code)?.id && scenarios.find(s => s.id === scenarioId)?.pieceFlags[item.id]))
    const angle = index * 2 * Math.PI / count - Math.PI / 2
    const radius = count <= 2 ? 29 : count <= 4 ? 32 : 36
    return <button key={node.id} className={radial ? 'disc-node' : undefined}
      style={radial ? {left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius}%`} : undefined}
      aria-pressed={!group && available ? selected : undefined}
      disabled={busy || refreshNeeded || scenarioGone || (!group && !available)} onClick={() => showNode(node)}
      title={!group && !available ? 'Peça inativa ou sem código cadastrado' : undefined}>
      <span>{node.nome}</span>{group && <span aria-hidden="true">›</span>}
    </button>
  }
  const picker = <section className="piece-picker" aria-label="Selecionar peça">
    {searchField}
    <div className="commercial-toolbar"><button className="fh-filter" disabled={!path.length || busy} onClick={() => { setPath(p => p.slice(0, -1)); setQuery(''); setDiscPage(0) }}>← Voltar nível</button><span>{path.map(node => node.nome).join(' / ') || 'Regiões e acesso geral'}</span></div>
    <div className="piece-options">{nodes.map(node => option(node))}</div>{!nodes.length && <p>Nenhuma peça encontrada.</p>}
  </section>
  async function flag(scenario: Scenario, field: 'pieceFlags' | 'serviceFlags' | 'componentFlags', id: string, enabled: boolean) {
    await mutate(async()=> { await api(`/api/atendimentos/${atendimentoId}/cenarios/${scenario.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:scenario.revision,[field]:{[id]:enabled}})}); await load() })
  }
  const active = scenarios.find(s=>s.id===scenarioId)
  const mapMarkup = useMemo(() => {
    const codesIn = (node?: HierarchyNode): string[] => node ? [...(node.codigo_peca ? [node.codigo_peca] : []), ...(node.gera_codigos_peca ?? []), ...(node.itens ?? []).flatMap(codesIn)] : []
    return carMap.replace(/(<g data-region="([^"]+)"[^>]*>)([\s\S]*?)(<\/g>)/g, (_match, opening: string, region: string, body: string, closing: string) => {
      const codes = new Set(codesIn(catalog?.hierarchy.regioes[region]))
      const count = items.filter(item => active?.pieceFlags[item.id] && codes.has(catalog?.items.find(c => c.id === item.pieceId)?.code ?? '')).length
      const tag = opening.replace(/aria-label="([^"]+)"/, `aria-label="$1: ${count} peça(s) incluída(s)"`).slice(0, -1) + ` data-selected="${count > 0}">`
      const xy = body.match(/<text x="([\d.]+)" y="([\d.]+)"/)
      const marker = count && xy ? `<g class="map-region-count" aria-hidden="true"><circle cx="${Number(xy[1]) + 26}" cy="${Number(xy[2]) - 15}" r="10"/><text x="${Number(xy[1]) + 26}" y="${Number(xy[2]) - 15}" text-anchor="middle" dy=".35em">${count}</text></g>` : ''
      return tag + body + marker + closing
    })
  }, [catalog, items, active])
  const differs = (values: boolean[]) => values.some(value=>value!==values[0])
  const matrixValue = (scenarioId:string,lineId:string) => {const line=workspace?.calculations.find(c=>c.scenarioId===scenarioId)?.lines.find(l=>l.id===lineId);return line?.included?money(line.total):'Não incluído'}
  const comparison = <div className="scenario-matrix" role="region" aria-label="Matriz de cenários" tabIndex={0}><table><thead><tr><th>Composição mestre</th>{scenarios.map(s=><th key={s.id}>{scenarioLabel(s)}</th>)}</tr></thead><tbody>{items.map(item=>{
    const parentDiff = differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id])))
    const lines = item.services.filter(line=>!differences || differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id] && s.serviceFlags[line.id]))))
    const components = (workspace?.components ?? []).filter(c=>c.pieceId===item.id).filter(c=>!differences || differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id] && s.componentFlags[c.id]))))
    if (differences && !parentDiff && !lines.length && !components.length) return null
    return [<tr className="matrix-parent" key={item.id}><th>{byId(item.pieceId)?.name}</th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${scenarioLabel(s)}: incluir peça ${byId(item.pieceId)?.name}`} checked={Boolean(s.pieceFlags[item.id])} disabled={busy || refreshNeeded || scenarioGone} onChange={e=>flag(s,'pieceFlags',item.id,e.target.checked)} /></td>)}</tr>,...lines.map((line,index)=><tr key={line.id}><th>{byId(line.serviceId)?.name} · {byId(line.dimensionId)?.name ?? 'dimensão pendente'} · {line.quantity}<small>Lançamento {index+1} · {[byId(line.diagnosisId ?? item.diagnosisId)?.name,line.notes].filter(Boolean).join(' · ')}</small></th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${scenarioLabel(s)}: incluir serviço ${line.id}`} checked={Boolean(s.pieceFlags[item.id] && s.serviceFlags[line.id])} disabled={busy || refreshNeeded || scenarioGone || !s.pieceFlags[item.id]} onChange={e=>flag(s,'serviceFlags',line.id,e.target.checked)} />{!s.pieceFlags[item.id] && <small>Peça desmarcada</small>}<small>{matrixValue(s.id,line.id)}</small></td>)}</tr>),...components.map(component=><tr key={component.id}><th>{component.name} · {component.quantity}<small>Componente monetário · MR global</small></th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${scenarioLabel(s)}: incluir componente ${component.id}`} checked={Boolean(s.pieceFlags[item.id] && s.componentFlags[component.id])} disabled={busy || refreshNeeded || scenarioGone || !s.pieceFlags[item.id]} onChange={e=>flag(s,'componentFlags',component.id,e.target.checked)}/><small>{matrixValue(s.id,component.id)}</small></td>)}</tr>)]
  })}</tbody><tfoot>{(['serviceSubtotal','componentSubtotal','total','energy','days'] as const).map((field,i)=><tr key={field}><th>{['Serviços','Componentes','Total antes da negociação','Energia','Dias técnicos'][i]}</th>{scenarios.map(s=>{const c=workspace?.calculations.find(c=>c.scenarioId===s.id),value=c?.[field];return <td key={s.id}>{field==='energy'||field==='days'?value??'Indisponível':money(value)}</td>})}</tr>)}</tfoot></table></div>
  const calculation = workspace?.calculations.find(c => c.scenarioId === scenarioId)
  const mapSelecting = tab === 'mapa' && selecting && !draft && !matrix && !budget && !reauth && Boolean(catalog)
  useEffect(() => {
    if (mapSelecting) document.querySelector<HTMLElement>('.map-piece-dialog [data-initial-focus]')?.focus()
  }, [path, discPage, mapSelecting])
  const feedback = <>
    {failure && <p className="form-error" role="alert">{failure}</p>}{message && <p className="at-save-success" role="status">{message}</p>}
      {(refreshNeeded || failure) && <button className="fh-filter" disabled={busy} onClick={refresh}>{busy ? 'Atualizando…' : 'Atualizar dados'}</button>}
      {failureDetails?.method && <details className="at-form-hint"><summary>Detalhes da falha</summary><p>{failureDetails.method} {failureDetails.endpoint} · {failureDetails.kind === 'network' ? 'Transporte sem resposta HTTP' : failureDetails.kind === 'response' ? 'Resposta não legível' : 'Resposta HTTP'}{failureDetails.status ? ` · HTTP ${failureDetails.status}` : ''}{failureDetails.elapsedMs !== undefined ? ` · ${failureDetails.elapsedMs} ms` : ''}{failureDetails.requestId ? ` · Referência ${failureDetails.requestId}` : ''}</p></details>}
  </>
  const visibleNodes = nodes.slice(discPage * 7, discPage * 7 + 7)
  const discCount = visibleNodes.length + (nodes.length > 7 ? 1 : 0)
  function openRegion(region: string) {
    const node = catalog?.hierarchy.regioes[region]
    if (node) { mapOpener.current = `[data-region="${region}"]`; setPath([node]); setQuery(''); setDiscPage(0); setSelecting(true) }
  }
  function deleteEditingPiece(){
    const current=workspace?.items.find(p=>p.id===draft?.id)
    if(!current||busy||refreshNeeded||scenarioGone)return
    if(!window.confirm('Excluir esta peça e todos os serviços/componentes de TODOS os cenários deste Atendimento? Os campos locais desta peça não salvos serão descartados. Orçamentos emitidos serão preservados.'))return
    void mutate(async()=>{await api(`/api/atendimentos/${atendimentoId}/diagnosticos/${current.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision})});await load();onDirty(false);setEditorDirty(false);setPendingBack(true);setMessage('Peça excluída de todos os cenários. Orçamentos emitidos preservados.')})
  }
  const scenarioControl=<ScenarioMenu scenarios={scenarios} selected={scenarioId} busy={busy || refreshNeeded} comparing={matrix} onSelect={chooseScenario} onAdd={addScenario} onDelete={deleteScenario} onArchive={()=>onView('orcamentos')} onCompare={()=>onView('comparacao')}/>
  return <>{scenarioSlot && createPortal(scenarioControl,scenarioSlot)}{tab==='chat'&&!screen?<div className="chat-with-scenarios">{(failure || scenarioGone)&&<div className="chat-commercial-alert">{feedback}{scenarioGone&&<p role="alert">Cenário anterior excluído. Selecione um cenário no menu para continuar.</p>}</div>}{reauth&&<div className="commercial-reauth"><p>Entre novamente. Os campos em edição foram preservados.</p><Login session={{authenticated:false,configured:true}} error="" refresh={()=>{}} onSession={()=>setReauth(false)}/></div>}{chat}</div>:<div className={`detail-page commercial-page ${screen?'internal-page':''} ${tab === 'mapa' && !screen ? 'map-page' : ''}`}>

    <div className="diagnostics-body" ref={body} onScroll={e=>{if(loaded)scrollPositions.set(viewKey,{top:e.currentTarget.scrollTop,left:0})}}>
      {scenarioGone && <p className="form-error" role="alert">O cenário anterior foi excluído. Seus campos locais foram preservados. Selecione um cenário no menu superior antes de continuar.</p>}
      {reauth && <div className="commercial-reauth"><p>Entre novamente. Os campos em edição foram preservados.</p><Login session={{ authenticated: false, configured: true }} error="" refresh={() => {}} onSession={() => setReauth(false)} /></div>}
      {!mapSelecting && feedback}
      {!catalog ? <p className="at-form-hint">{failure ? 'A seleção ficará disponível após atualizar os dados.' : 'Carregando catálogos e diagnósticos…'}</p> : budget && workspace ? <BudgetPanel key={scenarioId} at={atendimentoId} onBusy={onManagerBusy} onAuthRequired={()=>setReauth(true)} externalBusy={busy || refreshNeeded || scenarioGone} versionId={versionId} onOpenVersion={id=>onView('orcamentos',id)} onTitle={onTitle}/> : matrix ? <><label className="commercial-check"><input type="checkbox" checked={differences} onChange={e=>setDifferences(e.target.checked)} /> Só diferenças</label>{comparison}</> : draft && workspace ? <><DiagnosisEditor key={draft.id+':'+scenarioId} initial={draft} workspace={workspace} catalog={catalog.items} onDirty={onManagerDirty} onBusy={onManagerBusy} onSync={()=>load()} onAuthRequired={()=>setReauth(true)} onCalculationState={setCalculationState} parameterState={parameterState}/><button className="internal-delete-piece fh-filter" disabled={busy||refreshNeeded||scenarioGone} onClick={deleteEditingPiece}>Excluir peça de todos os cenários</button></> : screen==='peca'?<p role="alert">A peça não está disponível neste Atendimento. Use Voltar para retornar.</p> : <>
        {tab === 'mapa' ? <div className="map-stage" ref={mapStage}>
          <button className="fh-filter map-search-trigger" disabled={busy || refreshNeeded || scenarioGone} onClick={() => { mapOpener.current = '.map-search-trigger'; setPath([]); setQuery(''); setDiscPage(0); setSelecting(true) }}><Icon name="search" /> Buscar peça</button>
          <div className="interactive-map" onClick={event => {
            const region = (event.target as Element).closest('[data-region]')?.getAttribute('data-region')
            if (region) openRegion(region)
          }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { const region = (event.target as Element).closest('[data-region]')?.getAttribute('data-region'); if (region) { event.preventDefault(); openRegion(region) } } }} dangerouslySetInnerHTML={{ __html: mapMarkup }} />
          <span className="map-instruction">Toque em uma região para selecionar peças</span>
          {mapSelecting && <PieceDialog busy={busy} onClose={() => setSelecting(false)} returnFocus={returnMapFocus}>
            <header className="map-selector-head"><span>Seleção de peças</span><button className="fh-filter" disabled={busy} aria-label="Fechar seleção" onClick={() => setSelecting(false)}>×</button></header>
            {feedback}
            {searchField}
            {query.trim() ? <div className="piece-options map-search-results">{nodes.map(node => option(node))}{!nodes.length && <p>Nenhuma peça encontrada.</p>}</div> : <div className="disc-wrap">
              <strong className="disc-name">{path.at(-1)?.nome ?? 'Regiões e acesso geral'}</strong>
              <div className="disc-ring piece-options">{visibleNodes.map((node, i) => option(node, i, discCount, true))}
                {nodes.length > 7 && <button className="disc-node disc-more" disabled={busy} style={{left: `${50 + Math.cos((discCount - 1) * 2 * Math.PI / discCount - Math.PI / 2) * 36}%`, top: `${50 + Math.sin((discCount - 1) * 2 * Math.PI / discCount - Math.PI / 2) * 36}%`}} onClick={() => setDiscPage(value => (value + 1) * 7 < nodes.length ? value + 1 : 0)}>{(discPage + 1) * 7 < nodes.length ? 'Ver mais opções' : 'Voltar ao início'}</button>}
              </div>
              <button className="disc-center" data-initial-focus disabled={busy} aria-label={path.length > 1 ? 'Voltar ao nível anterior' : 'Fechar seleção central'} onClick={() => { if (path.length > 1) { setPath(p => p.slice(0, -1)); setDiscPage(0) } else setSelecting(false) }}>{path.length > 1 ? '←' : '×'}</button>
            </div>}
          </PieceDialog>}
        </div> : <>
          <div className="diagnosis-heading"><h1>Diagnósticos</h1><span>{items.length} peça{items.length !== 1 ? 's' : ''}</span></div>
          {!items.length && <p className="at-form-hint diagnosis-empty">Nenhum item adicionado. Use o mapa ou a busca de peças.</p>}
          <div className="diagnosis-list">{items.map(item => {
            const included = Boolean(active?.pieceFlags[item.id])
            const components = workspace?.components.filter(c => c.pieceId === item.id).length ?? 0
            return <article className={`diagnosis-card diagnosis-row ${included ? '' : 'excluded'}`} key={item.id}>
              <input type="checkbox" aria-label={`Incluir peça ${byId(item.pieceId)?.name} neste cenário`} checked={included} disabled={busy || refreshNeeded || scenarioGone || !active} onChange={e => active && flag(active, 'pieceFlags', item.id, e.target.checked)} />
              <button className="diagnosis-open" disabled={busy} onClick={() => {onView('peca',item.id);setMessage('')}}><span className="diagnosis-text"><span className="diagnosis-title"><strong>{(byId(item.pieceId)?.name ?? 'Peça').replace(/\s*·\s*/g,' ')}:</strong> <span>{byId(item.diagnosisId)?.name ?? 'Diagnóstico pendente'}</span></span><span className="diagnosis-counts"><span aria-label={`${item.services.length} serviços`} title={`${item.services.length} serviços`}><Icon name="service" />{item.services.length}</span><span aria-label={`${components} componentes`} title={`${components} componentes`}><Icon name="component" />{components}</span><span className="sr-only">{included?'Incluído':'Desmarcado'} no cenário ativo</span></span></span><strong className="piece-total">{calculation?.pieceTotals?.find(p=>p.pieceId===item.id)?.total==null?'—':money(calculation.pieceTotals.find(p=>p.pieceId===item.id)!.total)}</strong></button>
            </article>
          })}</div>
          <button className="codex-add add-piece" disabled={busy} aria-expanded={selecting} onClick={() => setSelecting(v => !v)}>{selecting ? 'Fechar seleção' : '+ Adicionar peça'}</button>
          {selecting && picker}

        </>}
      </>}
    </div>{workspace && !budget && !matrix && <FinancialPanel parameterState={parameterState} onParameterState={setParameterState} calculationState={refreshNeeded||scenarioGone||calculationState==='error'?'error':localBusy||editorBusy?'pending':calculationState} at={atendimentoId} workspace={workspace} state={dealState} onState={setDealState} fresh={previewFresh} onSync={()=>load()} onBusy={onFinanceBusy} onDirty={onFinanceDirty} externalBusy={localBusy||editorBusy||editorDirty||refreshNeeded||scenarioGone}/>}
  </div>}</>
}

export function CatalogManager({ catalog, onChanged, onDirty, onBusy, onAuthRequired }: {
  catalog: CatalogResponse; onChanged: () => Promise<void>; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onAuthRequired: () => void
}) {
  const [kind, setKind] = useState<CatalogKind>('peca'), [query, setQuery] = useState('')
  const [old, setOld] = useState<CatalogItem | null>(null), [form, setForm] = useState(false)
  const [name, setName] = useState(''), [code, setCode] = useState(''), [serviceId, setServiceId] = useState('')
  const [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [history, setHistory] = useState<{ revision: number; changedAt: string }[]>([])
  const dirty = form && (name !== (old?.name ?? '') || code !== (old?.code ?? '') || active !== (old?.active ?? true) || serviceId !== (old?.serviceId ?? ''))
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => { onDirty(false); onBusy(false) }, [onDirty, onBusy])
  async function refreshCatalogs() {
    if (busy) return
    setBusy(true); onBusy(true); setFailure('')
    try { await onChanged() }
    catch (cause) { setFailure((cause as Error).message); if ((cause as RequestFailure).status === 401) onAuthRequired() }
    finally { setBusy(false); onBusy(false) }
  }
  function edit(item: CatalogItem | null) {
    setOld(item); setForm(true); setName(item?.name ?? ''); setCode(item?.code ?? ''); setServiceId(item?.serviceId ?? ''); setActive(item?.active ?? true); setFailure(''); setHistory([])
  }
  return <section aria-label="Manutenção de catálogos"><p className="at-form-hint">Catálogo único. Itens ativos e identificados ficam disponíveis imediatamente. Nenhum preço ou fator é criado aqui.</p>
    {failure && <p className="form-error" role="alert">{failure}</p>}
    {form ? <form aria-label="Editar catálogo" onSubmit={async event => {
      event.preventDefault(); if (busy) return
      setBusy(true); onBusy(true); setFailure('')
      try {
        await api(old ? `/api/catalogos/${encodeURIComponent(old.id)}` : '/api/catalogos', { method: old ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(old ? { revision: old.revision, name, active } : { kind, name, ...(kind === 'peca' ? { code } : {}), ...(kind === 'dimensao' ? { serviceId } : {}) }) })
        onDirty(false); setForm(false); await onChanged()
      } catch (cause) { setFailure((cause as Error).message); if ((cause as RequestFailure).status === 401) onAuthRequired() }
      finally { setBusy(false); onBusy(false) }
    }}><fieldset disabled={busy}>
      <h2>{kindNames[kind]} · {old ? 'Editar' : 'Novo cadastro'}</h2>
      <label className="at-field">Nome do catálogo<input autoFocus required maxLength={250} value={name} onChange={e => setName(e.target.value)} /></label>
      {kind === 'peca' && <label className="at-field">Código da peça<input aria-label="Código da peça" required maxLength={150} readOnly={Boolean(old)} value={code} onChange={e => setCode(e.target.value)} /><small>{old ? 'Código preservado como identidade física.' : 'Informe o código real que identifica a peça.'}</small></label>}
      {kind === 'dimensao' && <label className="at-field">Serviço da dimensão<select aria-label="Serviço da dimensão" required disabled={Boolean(old)} value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">Selecionar serviço</option>{catalog.items.filter(item => item.kind === 'servico' && (usable(item) || item.id === serviceId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {old && <><label className="commercial-check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Ativo para novas seleções</label><p className="at-form-hint">Revisão {old.revision} · {new Date(old.updatedAt).toLocaleString('pt-BR')}</p></>}
      <div className="commercial-toolbar"><button type="button" className="fh-filter" onClick={() => { if (!dirty || window.confirm('Há alterações não salvas. Deseja descartá-las?')) { setForm(false); onDirty(false); void refreshCatalogs() } }}>Cancelar edição</button><button className="primary-btn" type="submit">{busy ? 'Salvando…' : 'Salvar catálogo'}</button></div>
      {old && <button type="button" className="codex-add" onClick={async () => { try { setHistory(await api(`/api/catalogos/${encodeURIComponent(old.id)}/historico`)) } catch (cause) { setFailure((cause as Error).message) } }}>Ver histórico de alterações</button>}
      {history.map(entry => <p className="at-form-hint" key={entry.revision}>Revisão {entry.revision} · {new Date(entry.changedAt).toLocaleString('pt-BR')}</p>)}
    </fieldset></form> : <>
      <label className="at-field">Tipo de catálogo<select aria-label="Tipo de catálogo" value={kind} onChange={e => setKind(e.target.value as CatalogKind)}>{Object.entries(kindNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="at-field">Buscar no catálogo<input value={query} onChange={e => setQuery(e.target.value)} maxLength={150} /></label>
      <div className="commercial-toolbar"><button className="fh-filter" disabled={busy} onClick={() => edit(null)}>+ Novo cadastro</button><button className="fh-filter" disabled={busy} onClick={refreshCatalogs}>Atualizar catálogos</button></div>
      {catalog.items.filter(item => item.kind === kind && fold(`${item.name} ${item.code ?? ''}`).includes(fold(query))).map(item => <button className="catalog-row" key={item.id} disabled={busy} onClick={() => edit(item)}><strong>{item.name}</strong><small>{stateLabel(item)} · {item.code ?? kindNames[item.kind]}</small></button>)}
      {!catalog.items.some(item => item.kind === kind) && <p className="at-form-hint">Catálogo vazio. Aguarda dados próprios da FUNIX.</p>}
    </>}
  </section>
}
