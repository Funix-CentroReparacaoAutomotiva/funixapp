import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import type { CatalogItem, CatalogKind, CatalogResponse, DiagnosisItem, HierarchyNode, Scenario, CommercialWorkspace } from '../shared/commercial'
import { catalogItemUsable as usable, scenarioLabel } from '../shared/commercial'
import { api } from './api'
import type { RequestFailure } from './api'
import { Icon, Login } from './ui'
import { PieceDialog } from './PieceDialog'
import {PieceSheet} from './PieceSheet'
import {DiagnosisEditor} from './DiagnosisEditor'
import type {PricingConfiguration} from '../shared/pricing'
import type {CalculationState} from './calculation-state'
import {FinancialPanel} from './FinancialPanel'
import {BudgetPanel} from './BudgetPanel'
import type {DetailScreen} from './detail-navigation'
import {ScenarioMenu} from './ScenarioMenu'
import {emptyNegotiationState,negotiationSignature,negotiationIsDirty} from './negotiation'
import type {RemovalReview} from '../shared/piece-removal'
import {RemovalConfirmation} from './RemovalConfirmation'
import type {NegotiationState} from './negotiation'
import {money} from './money'
import {usePieceSelection} from './usePieceSelection'
import {selectablePieces,functionalTree,groupSelection,nodeCodes} from './piece-navigation'
import{mapTree,mapPage,radialPosition,radialLabel}from'./map-navigation'
import './map-radial.css'
import {ApprovedIcon} from './ApprovedIcon'
import './piece-selection.css'
import carMap from './assets/car-map.svg?raw'

const kindNames: Record<CatalogKind, string> = { peca: 'Peças', diagnostico: 'Diagnósticos', servico: 'Serviços', dimensao: 'Dimensões' }
function stateLabel(item?: CatalogItem) { return !item || (item.kind === 'peca' && !item.code?.trim()) ? 'Sem código · indisponível' : item.active ? 'Ativo' : 'Inativo' }
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function CommercialPanel({ atendimentoId, tab, onDirty, onBusy, scenarioContext, scenarioSlot, chat, onNegotiationDirty, screen, pieceId, versionId, onView, onBack, onTitle, scrollPositions }: {
  atendimentoId: string; tab: string; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; scenarioContext: Map<string,string>; scenarioSlot: HTMLElement | null; chat: ReactNode; onNegotiationDirty:(value:boolean)=>void; screen:DetailScreen|null;pieceId:string|null;versionId:string|null;onView:(screen:DetailScreen,id?:string)=>boolean;onBack:()=>void;onTitle:(title:string)=>void;scrollPositions:Map<string,{top:number;left:number}>
}) {
  const [dealState,setDealState] = useState<NegotiationState>(emptyNegotiationState)
  const [scenarioGone,setScenarioGone] = useState(false)
  const negotiationDirty = negotiationIsDirty(dealState.draft)
  useEffect(()=>{onNegotiationDirty(negotiationDirty);return()=>onNegotiationDirty(false)},[negotiationDirty,onNegotiationDirty])
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null), [items, setItems] = useState<DiagnosisItem[]>([])
  const [pricingConfiguration,setPricingConfiguration]=useState<PricingConfiguration|null>(null)
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
  const sheetOpener=useRef<HTMLButtonElement>(null)
  const returnSheetFocus=useCallback(()=>sheetOpener.current?.focus(),[])
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
  const baseBusy=localBusy||editorBusy||financeBusy
  const [pendingBack,setPendingBack]=useState(false)
  const [removal,setRemoval]=useState<RemovalReview|null>(null)
  const removalAnswer=useRef<((answer:boolean)=>void)|null>(null)
  useEffect(()=>()=>{removalAnswer.current?.(false)},[])
  function confirmRemoval(review:RemovalReview){return new Promise<boolean>(resolve=>{removalAnswer.current?.(false);removalAnswer.current=resolve;setRemoval(review)})}
  function answerRemoval(answer:boolean){const resolve=removalAnswer.current;removalAnswer.current=null;setRemoval(null);resolve?.(answer)}
  const onManagerDirty=useCallback((v:boolean)=>setEditorDirty(v),[])
  const onFinanceDirty=useCallback((v:boolean)=>setFinanceDirty(v),[])
  const onManagerBusy=useCallback((v:boolean)=>setEditorBusy(v),[])
  const onFinanceBusy=useCallback((v:boolean)=>setFinanceBusy(v),[])
  const managerDirty=editorDirty||financeDirty
  const acceptWorkspace=useCallback((workspace:CommercialWorkspace,preferred=selection.current)=>{
      if(preferred && preferred!==workspace.selectedId)setScenarioGone(true)
      setDealState(old=>{
        const snapshot=old.preview?.snapshot
        if(snapshot && (snapshot.compositionRevision!==workspace.revision || snapshot.configuration.revision!==workspace.configurationRevision || snapshot.scenarioId!==workspace.selectedId || snapshot.scenarioRevision!==workspace.scenarios.find(s=>s.id===workspace.selectedId)?.revision))return {...old,draft:{...old.draft,acknowledgeResidual:false},signature:''}
        return old
      })
      setWorkspace(workspace);setItems(workspace.items);setScenarios(workspace.scenarios);setScenarioId(workspace.selectedId)
      selection.current=workspace.selectedId;scenarioContext.set(atendimentoId,workspace.selectedId)
  },[atendimentoId,scenarioContext])
  const {queue:selectionQueue,state:selectionState}=usePieceSelection(atendimentoId,{
    read:async id=>{const version=++loadVersion.current,w=await api<CommercialWorkspace>(`/api/atendimentos/${atendimentoId}/cenarios?scenarioId=${encodeURIComponent(id)}`);if(version!==loadVersion.current)throw new Error('Atualização substituída. Confira os dados antes de retomar.');return w},
    add:(codes,id,revision)=>api<DiagnosisItem[]>(`/api/atendimentos/${atendimentoId}/diagnosticos`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pieceCodes:codes,scenarioId:id,scenarioRevision:revision})}),
    setEnabled:(id,revision,flags)=>api<Scenario>(`/api/atendimentos/${atendimentoId}/cenarios/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,pieceFlags:flags})}),
    remove:request=>api<{removedIds:string[]}>(`/api/atendimentos/${atendimentoId}/diagnosticos`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)}),
    confirmRemoval,
    confirmed:w=>acceptWorkspace(w),failed:error=>{setRefreshNeeded(true);failed(error,'As seleções pendentes foram preservadas. '+(error as Error).message)}
  })
  const selectionSaving=selectionState.phase==='saving',selectionBlocked=selectionState.phase==='blocked'
  const busy=baseBusy||selectionSaving
  const pieceLocked=baseBusy||selectionBlocked||refreshNeeded||scenarioGone||Boolean(selectionState.deleting)||Boolean(removal)
  useEffect(()=>{onBusy(busy)},[busy,onBusy])
  useEffect(() => { onDirty(editorDirty||financeDirty||selectionState.phase!=='idle') }, [editorDirty,financeDirty,selectionState.phase,onDirty])
  useEffect(() => () => { onDirty(false); onBusy(false) }, [onDirty, onBusy])
  useEffect(()=>{
    if(busy||!pendingBack)return
    let active=true
    Promise.resolve().then(()=>{if(!active)return;if(pendingBack){setPendingBack(false);onBack()}})
    return()=>{active=false}
  },[busy,pendingBack,onBack])
  const load = useCallback(async (signal?: AbortSignal, preferred = selection.current, refreshCatalog = false) => {
    const version = ++loadVersion.current
    const suffix = preferred ? '?scenarioId='+encodeURIComponent(preferred) : ''
    try {
      const [c, workspace] = await Promise.all([refreshCatalog || !catalogCache.current ? api<CatalogResponse>('/api/catalogos', { signal }) : Promise.resolve(catalogCache.current), api<CommercialWorkspace>(`/api/atendimentos/${atendimentoId}/cenarios${suffix}`, { signal })])
      if (signal?.aborted || version !== loadVersion.current) return
      acceptWorkspace(workspace,preferred);catalogCache.current=c;setCatalog(c)
      return workspace

    } catch(cause) {if(!signal?.aborted && version === loadVersion.current)throw cause}
  }, [atendimentoId,acceptWorkspace])
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
    if (busy || mutationInFlight.current || selectionQueue.status!=='idle') return false
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
    const ok=await mutate(async()=>{await load(undefined,id)});if(ok){discardContext();setRefreshNeeded(false)};return ok
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
  const validPieces=useMemo(()=>selectablePieces(catalog?.items??[]),[catalog])
  const pieceIdentities=useMemo(()=>new Map((catalog?.items??[]).filter(c=>c.kind==='peca'&&c.code).map(c=>[c.code!,c.id])),[catalog])
  const selectedCode=useCallback((code:string)=>selectionState.intents.get(code)??Boolean(workspace?.items.some(p=>p.pieceId===pieceIdentities.get(code)&&workspace.scenarios.find(s=>s.id===workspace.selectedId)?.pieceFlags[p.id])),[selectionState.intents,workspace,pieceIdentities])
  function select(codes:string[],enabled?:boolean){
    if(!workspace||pieceLocked||mutationInFlight.current||!codes.length)return
    setMessage('')
    void selectionQueue.enqueue(codes,enabled??!codes.every(code=>selectionQueue.desired(code,selectedCode(code))),workspace,pieceIdentities)
  }
  async function discardSelections(){
    if(!window.confirm('Descartar apenas as seleções locais pendentes e consultar a composição salva? Gravações já realizadas não serão apagadas.'))return
    if(!selectionQueue.discard())return
    await mutate(async()=>{await load(undefined,selection.current,true);setRefreshNeeded(false);setFailure('');setFailureDetails(null)})
  }
  async function refresh() {
    if(selectionBlocked){
      if(!window.confirm('Consultar o estado salvo e retomar minhas seleções pendentes neste cenário? Exclusões pendentes exigem nova confirmação se o conteúdo mudar.'))return
      const ok=await selectionQueue.recover()
      if(ok){setRefreshNeeded(false);setFailure('');setFailureDetails(null)}
      return
    }
    await mutate(async()=>{
      await load(undefined,selection.current,true); setRefreshNeeded(false)
      setMessage(managerDirty ? 'Dados atualizados. Os campos em edição foram preservados; confira antes de salvar.' : 'Dados atualizados. Confira os itens antes de adicionar novamente.')
    }, true)
  }
  function showNode(node: HierarchyNode) {
    if (node.tipo === 'grupo' || node.tipo === 'grupo_lados') { setPath(previous => [...previous, node]); setQuery(''); setDiscPage(0); return }
    const codes = node.tipo === 'acao_ambos' ? node.gera_codigos_peca! : node.codigo_peca ? [node.codigo_peca] : []
    if (codes.length) select(codes)
  }
  const [regionKey,setRegionKey]=useState<string|null>(null)
  const geographicRoots=useMemo(()=>catalog?mapTree(catalog.items):[],[catalog])
  const roots=tab==='mapa'?geographicRoots:functionalTree(catalog?.items??[])
  const regionRoot=geographicRoots.find(r=>r.id===regionKey)

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
    ;(tab==='mapa'?(regionRoot?[regionRoot]:[]):roots).forEach(node => visit(node))
    for (const item of tab==='mapa'?[]:catalog?.items ?? []) {
      const key = item.code ?? item.id
      if (item.kind === 'peca' && !seen.has(key) && fold(`${item.name} ${item.code ?? ''}`).includes(fold(query.trim()))) {
        seen.add(key); found.push({ id: item.id, tipo: 'peca', nome: item.name, codigo_peca: item.code ?? undefined })
      }
    }
    return found
  }
  const nodes = query.trim() ? searchNodes() : path.length ? path[path.length - 1].itens ?? [] : roots
  const searchField = <label className="piece-search"><Icon name="search" /><input aria-label="Buscar peça em todas as vistas" placeholder="Buscar peça…" value={query} onChange={e => { setQuery(e.target.value); setDiscPage(0) }} maxLength={150} /></label>
  function option(node: HierarchyNode, radial = false) {
    const group = node.tipo === 'grupo' || node.tipo === 'grupo_lados'
    const codes = node.tipo === 'acao_ambos' ? node.gera_codigos_peca ?? [] : node.codigo_peca ? [node.codigo_peca] : []
    const stats=groupSelection(node,validPieces,selectedCode)
    const available=codes.length>0&&codes.every(code=>validPieces.has(code))
    const selected=!group&&codes.length>0&&codes.every(selectedCode)
    const pending=nodeCodes(node,validPieces).some(code=>selectionState.intents.has(code))
    const position=radial?radialPosition(node,visibleNodes,path.at(-1),regionKey):null
    return <button key={node.id} className={radial ? 'disc-node' : undefined}
      style={position?{left:position.left+'%',top:position.top+'%'}:undefined} data-ring={position&&'inner'in position&&position.inner?'inner':'outer'} data-node-id={node.id}
      aria-label={node.nome} data-selection-state={group?stats.state:selected?'all':'none'} data-pending={pending} aria-pressed={!group && codes.length ? selected : undefined}
      disabled={pieceLocked || (group?stats.total===0:!available&&!codes.every(selectedCode))} onClick={() => showNode(node)}
      title={group?`${stats.count} de ${stats.total} peças habilitadas neste cenário${pending?' — salvando':''}`:!available?'Peça inativa ou sem código cadastrado':pending?'Seleção pendente de confirmação':selected?'Selecionada':'Não selecionada'}>
      {group&&<span className="selection-indicator" aria-hidden="true"/>}<span>{radial?radialLabel(node.nome):node.nome}</span>{group && <span aria-hidden="true">›</span>}
    </button>
  }
  const picker = <section className="piece-picker" aria-label="Selecionar peça">
    {searchField}
    <div className="commercial-toolbar"><button className="fh-filter" disabled={!path.length || baseBusy} onClick={() => { setPath(p => p.slice(0, -1)); setQuery(''); setDiscPage(0) }}>← Voltar nível</button><span>{path.map(node => node.nome).join(' / ') || 'Classificação funcional'}</span></div>
    <div className="piece-options">{nodes.map(node => option(node))}</div>{!nodes.length && <p>Nenhuma peça encontrada.</p>}
  </section>
  async function flag(scenario: Scenario, field: 'pieceFlags' | 'serviceFlags' | 'componentFlags', id: string, enabled: boolean) {
    await mutate(async()=> { await api(`/api/atendimentos/${atendimentoId}/cenarios/${scenario.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:scenario.revision,[field]:{[id]:enabled}})}); await load() })
  }
  const active = scenarios.find(s=>s.id===scenarioId)
  const mapMarkup = useMemo(() => {
    return carMap.replace(/(<g data-region="([^"]+)"[^>]*>)([\s\S]*?)(<\/g>)/g, (_match, opening:string,region:string,body:string,closing:string)=>{
      const root=geographicRoots.find(r=>r.id===region)
      const stats=root?groupSelection(root,validPieces,selectedCode):{count:0,total:0,state:'none'}
      const pending=root?nodeCodes(root,validPieces).some(code=>selectionState.intents.has(code)):false
      const tag=opening.replace(/aria-label="([^"]+)"/,`aria-label="$1: ${stats.count} de ${stats.total} peças habilitadas neste cenário${pending?' — salvando':''}"`).slice(0,-1)+` data-selected="${stats.count>0}" data-selection-state="${stats.state}">`
      const xy=body.match(/<text x="([\d.]+)" y="([\d.]+)"/)
      const count=xy?`<tspan class="map-region-count" x="${xy[1]}" dy="1.3em" font-size="10">${stats.count}/${stats.total}</tspan>`:''
      return tag+body.replace('</text>',count+'</text>')+closing
    })
  },[geographicRoots,validPieces,selectedCode,selectionState.intents])
  const differs = (values: boolean[]) => values.some(value=>value!==values[0])
  const matrixValue = (scenarioId:string,lineId:string) => {const line=workspace?.calculations.find(c=>c.scenarioId===scenarioId)?.lines.find(l=>l.id===lineId);return line?.included?line.billing==='not_billed'?'Sem cobrança':line.execution==='external_confirmation'&&!line.executionConfirmed?'Confirmar terceiro':money(line.total):'Não incluído'}
  const comparison = <div className="scenario-matrix" role="region" aria-label="Matriz de cenários" tabIndex={0}><table><thead><tr><th>Composição mestre</th>{scenarios.map(s=><th key={s.id}>{scenarioLabel(s)}</th>)}</tr></thead><tbody>{items.map(item=>{
    const parentDiff = differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id])))
    const lines = item.services.filter(line=>!differences || differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id] && s.serviceFlags[line.id]))))
    const components = (workspace?.components ?? []).filter(c=>c.pieceId===item.id).filter(c=>!differences || differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id] && s.componentFlags[c.id]))))
    if (differences && !parentDiff && !lines.length && !components.length) return null
    return [<tr className="matrix-parent" key={item.id}><th>{byId(item.pieceId)?.name}</th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${scenarioLabel(s)}: habilitar peça ${byId(item.pieceId)?.name}`} checked={Boolean(s.pieceFlags[item.id])} disabled={busy || refreshNeeded || scenarioGone} onChange={e=>flag(s,'pieceFlags',item.id,e.target.checked)} /></td>)}</tr>,...lines.map((line,index)=><tr key={line.id}><th>{byId(line.serviceId)?.name} · {byId(line.dimensionId)?.name ?? 'dimensão pendente'} · {line.quantity}<small>Lançamento {index+1} · {[byId(line.diagnosisId ?? item.diagnosisId)?.name,line.notes].filter(Boolean).join(' · ')}</small></th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${scenarioLabel(s)}: habilitar serviço ${line.id}`} checked={Boolean(s.pieceFlags[item.id] && s.serviceFlags[line.id])} disabled={busy || refreshNeeded || scenarioGone || !s.pieceFlags[item.id]} onChange={e=>flag(s,'serviceFlags',line.id,e.target.checked)} />{!s.pieceFlags[item.id] && <small>Peça desmarcada</small>}<small>{matrixValue(s.id,line.id)}</small></td>)}</tr>),...components.map(component=><tr key={component.id}><th>{component.name} · {component.quantity}<small>Componente monetário · MR global</small></th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${scenarioLabel(s)}: habilitar componente ${component.id}`} checked={Boolean(s.pieceFlags[item.id] && s.componentFlags[component.id])} disabled={busy || refreshNeeded || scenarioGone || !s.pieceFlags[item.id]} onChange={e=>flag(s,'componentFlags',component.id,e.target.checked)}/><small>{matrixValue(s.id,component.id)}</small></td>)}</tr>)]
  })}</tbody><tfoot>{(['serviceSubtotal','componentSubtotal','total','energy','days'] as const).map((field,i)=><tr key={field}><th>{['Serviços','Componentes','Total antes da negociação','Energia','Dias técnicos'][i]}</th>{scenarios.map(s=>{const c=workspace?.calculations.find(c=>c.scenarioId===s.id),value=c?.[field];return <td key={s.id}>{field==='energy'||field==='days'?value??'Indisponível':money(value)}</td>})}</tr>)}</tfoot></table></div>
  const calculation = workspace?.calculations.find(c => c.scenarioId === scenarioId)
  const mapSelecting = tab === 'mapa' && selecting && !draft && !matrix && !budget && !reauth && Boolean(catalog)
  const sheetSelecting=tab==='diagnosticos'&&selecting&&!screen&&!reauth&&Boolean(catalog)
  useEffect(() => {
    if (mapSelecting) document.querySelector<HTMLElement>('.map-piece-dialog [data-initial-focus]')?.focus()
  }, [path, discPage, mapSelecting])
  const selectionFeedback=<div className={'piece-selection-status'+(selectionBlocked?'':' selection-announcement')} role="status" id="piece-selection-status" aria-live="polite">{selectionSaving?'Salvando seleções…':selectionBlocked?'Seleções pendentes: confira o erro e escolha como recuperar.':''}</div>
  const feedback = <>
    {selectionFeedback}

    {failure && <p className="form-error" role="alert">{failure}</p>}{message && <p className="at-save-success selection-announcement" role="status">{message}</p>}
      {(refreshNeeded || failure) && <button className="fh-filter" disabled={busy} onClick={refresh}>{busy ? 'Atualizando…' : selectionBlocked?'Atualizar dados e retomar seleções':'Atualizar dados'}</button>}
      {selectionBlocked&&<button className="fh-filter" disabled={busy} onClick={discardSelections}>Descartar seleções pendentes e atualizar</button>}
      {failureDetails?.method && <details className="at-form-hint"><summary>Detalhes da falha</summary><p>{failureDetails.method} {failureDetails.endpoint} · {failureDetails.kind === 'network' ? 'Transporte sem resposta HTTP' : failureDetails.kind === 'response' ? 'Resposta não legível' : 'Resposta HTTP'}{failureDetails.status ? ` · HTTP ${failureDetails.status}` : ''}{failureDetails.elapsedMs !== undefined ? ` · ${failureDetails.elapsedMs} ms` : ''}{failureDetails.requestId ? ` · Referência ${failureDetails.requestId}` : ''}</p></details>}
  </>
  const page=mapPage(nodes,discPage,path.length<=1)
  const visibleNodes=page.nodes
  function openRegion(region: string) {
    const node=geographicRoots.find(r=>r.id===region)
    if(node){mapOpener.current=`[data-region="${region}"]`;setRegionKey(region);setPath([node]);setQuery('');setDiscPage(0);setSelecting(true)}
  }
  const scenarioControl=<ScenarioMenu scenarios={scenarios} selected={scenarioId} busy={busy || refreshNeeded} comparing={matrix} onSelect={chooseScenario} onAdd={addScenario} onDelete={deleteScenario} onArchive={()=>onView('orcamentos')} onCompare={()=>onView('comparacao')}/>
  return <div className="commercial-workspace">{removal&&<RemovalConfirmation review={removal} onAnswer={answerRemoval}/>}{scenarioSlot && createPortal(scenarioControl,scenarioSlot)}{tab==='chat'&&!screen?<div className="chat-with-scenarios">{(failure || scenarioGone)&&<div className="chat-commercial-alert">{feedback}{scenarioGone&&<p role="alert">Cenário anterior excluído. Selecione um cenário no menu para continuar.</p>}</div>}{reauth&&<div className="commercial-reauth"><p>Entre novamente. Os campos em edição foram preservados.</p><Login session={{authenticated:false,configured:true}} error="" refresh={()=>{}} onSession={()=>setReauth(false)}/></div>}{chat}</div>:<div className={`detail-page commercial-page ${screen?'internal-page':''} ${tab === 'mapa' && !screen ? 'map-page' : ''}`}>

    <div className="diagnostics-body" ref={body} onScroll={e=>{if(loaded)scrollPositions.set(viewKey,{top:e.currentTarget.scrollTop,left:0})}}>
      {scenarioGone && <p className="form-error" role="alert">O cenário anterior foi excluído. Seus campos locais foram preservados. Selecione um cenário no menu superior antes de continuar.</p>}
      {reauth && <div className="commercial-reauth"><p>Entre novamente. Os campos em edição foram preservados.</p><Login session={{ authenticated: false, configured: true }} error="" refresh={() => {}} onSession={() => setReauth(false)} /></div>}
      {!mapSelecting && !sheetSelecting && feedback}
      {!catalog ? <p className="at-form-hint">{failure ? 'A seleção ficará disponível após atualizar os dados.' : 'Carregando catálogos e diagnósticos…'}</p> : budget && workspace ? <BudgetPanel key={scenarioId} at={atendimentoId} onBusy={onManagerBusy} onAuthRequired={()=>setReauth(true)} externalBusy={busy || refreshNeeded || scenarioGone} versionId={versionId} onOpenVersion={id=>onView('orcamentos',id)} onTitle={onTitle}/> : matrix ? <><label className="commercial-check"><input type="checkbox" checked={differences} onChange={e=>setDifferences(e.target.checked)} /> Só diferenças</label>{comparison}</> : draft && workspace ? <><DiagnosisEditor pricingConfiguration={pricingConfiguration} key={draft.id+':'+scenarioId} initial={draft} workspace={workspace} catalog={catalog.items} onDirty={onManagerDirty} onBusy={onManagerBusy} onSync={async()=>{await load()}} onAuthRequired={()=>setReauth(true)} onCalculationState={setCalculationState} parameterState={parameterState}/></> : screen==='peca'?<p role="alert">A peça não está disponível neste Atendimento. Use Voltar para retornar.</p> : <>
        {tab === 'mapa' ? <div className="map-stage" ref={mapStage}>

          <div className="interactive-map" onClick={event => {
            const region = (event.target as Element).closest('[data-region]')?.getAttribute('data-region')
            if (region) openRegion(region)
          }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { const region = (event.target as Element).closest('[data-region]')?.getAttribute('data-region'); if (region) { event.preventDefault(); openRegion(region) } } }} dangerouslySetInnerHTML={{ __html: mapMarkup }} />
          {mapSelecting && <PieceDialog busy={baseBusy} onClose={() => setSelecting(false)} returnFocus={returnMapFocus}>
            <header className="map-selector-head"><button className="fh-filter" disabled={baseBusy} aria-label="Fechar seleção" onClick={()=>setSelecting(false)}>×</button></header>
            {feedback}
            <div className="disc-wrap" data-region-key={regionKey} data-depth={path.length}>
              <strong className="disc-name">{path.at(-1)?.nome??'Regiões'}</strong>
              <div className="disc-ring piece-options" data-count={visibleNodes.length}>{visibleNodes.map(node=>option(node,true))}</div>
              <button className="disc-center" data-initial-focus disabled={baseBusy} aria-label={path.length>1?'Voltar ao nível anterior':'Fechar seleção central'} onClick={()=>{if(path.length>1){setPath(p=>p.slice(0,-1));setDiscPage(0)}else setSelecting(false)}}>{path.length>1?'←':'×'}</button>
            </div>
            {page.pages>1&&<button className="disc-more" disabled={baseBusy} onClick={()=>setDiscPage((page.page+1)%page.pages)}>{page.page+1<page.pages?'Ver mais opções':'Voltar ao início'}</button>}
          </PieceDialog>}
        </div> : <>
          <div className="diagnosis-heading"><h1>Diagnósticos</h1><span>{items.length} peça{items.length !== 1 ? 's' : ''}</span></div>
          {!items.length && <p className="at-form-hint diagnosis-empty">Nenhum item adicionado. Use o mapa ou a busca de peças.</p>}
          <div className="diagnosis-list">{items.map(item => {
            const included = byId(item.pieceId)?.code?selectedCode(byId(item.pieceId)!.code!):Boolean(active?.pieceFlags[item.id])
            const components = workspace?.components.filter(c => c.pieceId === item.id).length ?? 0
            return <article className={`diagnosis-card diagnosis-row ${included ? '' : 'excluded'}`} key={item.id}>
              <button type="button" role="switch" className="piece-inclusion-toggle" aria-label={`Habilitar peça ${byId(item.pieceId)?.name} neste cenário`} aria-checked={byId(item.pieceId)?.code?selectedCode(byId(item.pieceId)!.code!):included} aria-describedby="piece-selection-status" data-pending={selectionState.intents.has(byId(item.pieceId)?.code??'')} disabled={pieceLocked||!active||!byId(item.pieceId)||(!included&&!usable(byId(item.pieceId)!))} onClick={()=>{const code=byId(item.pieceId)?.code;if(code)select([code])}}><ApprovedIcon name={(byId(item.pieceId)?.code?selectedCode(byId(item.pieceId)!.code!):included)?'toggle':'off'}/></button>
              <button className="diagnosis-open" disabled={busy} onClick={() => {if(selectionQueue.status==='idle'){onView('peca',item.id);setMessage('')}}}><span className="diagnosis-text"><span className="diagnosis-title"><strong>{(byId(item.pieceId)?.name ?? 'Peça').replace(/\s*·\s*/g,' ')}:</strong> <span>{byId(item.diagnosisId)?.name ?? 'Diagnóstico pendente'}</span></span><span className="diagnosis-counts"><span aria-label={`${item.services.length} serviços`} title={`${item.services.length} serviços`}><Icon name="service" />{item.services.length}</span><span aria-label={`${components} componentes`} title={`${components} componentes`}><Icon name="component" />{components}</span><span className="sr-only">{included?'Habilitada':'Desabilitada'} neste cenário</span></span></span><strong className="piece-total">{selectionSaving?'Calculando…':selectionBlocked?'Não atualizado':calculation?.pieceTotals?.find(p=>p.pieceId===item.id)?.total==null?'—':calculation.pieceTotals.find(p=>p.pieceId===item.id)?.nonBillableOnly?'Sem cobrança':money(calculation.pieceTotals.find(p=>p.pieceId===item.id)!.total)}</strong></button>
              <button type="button" className="piece-delete" aria-label={`Excluir peça ${byId(item.pieceId)?.name} de todos os cenários`} disabled={busy||pieceLocked} onClick={()=>{const code=byId(item.pieceId)?.code;if(code&&workspace)void selectionQueue.enqueueRemoval([code],workspace,pieceIdentities)}}><ApprovedIcon name="trash"/></button>
            </article>
          })}</div>
          <button ref={sheetOpener} aria-haspopup="dialog" className="codex-add add-piece" disabled={baseBusy} aria-expanded={selecting} onClick={() => {if(!selecting){setPath([]);setQuery('');setDiscPage(0)}setSelecting(v=>!v)}}>+ Adicionar peça</button>
          {sheetSelecting&&<PieceSheet busy={baseBusy} onClose={()=>setSelecting(false)} returnFocus={returnSheetFocus}>{feedback}{picker}</PieceSheet>}

        </>}
      </>}
    </div>
  </div>}{workspace && !budget && !matrix && <FinancialPanel onArchive={()=>onView('orcamentos')} onConfiguration={setPricingConfiguration} parameterState={parameterState} onParameterState={setParameterState} calculationState={refreshNeeded||scenarioGone||selectionBlocked||calculationState==='error'?'error':calculationState==='incomplete'?'incomplete':localBusy||editorBusy||selectionSaving?'pending':calculationState} at={atendimentoId} workspace={workspace} state={dealState} onState={setDealState} fresh={previewFresh} onSync={()=>load()} onBusy={onFinanceBusy} onDirty={onFinanceDirty} externalBusy={localBusy||editorBusy||editorDirty||selectionSaving||selectionBlocked||refreshNeeded||scenarioGone}/>}</div>

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
