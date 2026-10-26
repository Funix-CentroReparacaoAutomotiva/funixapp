import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogItem, CatalogKind, CatalogResponse, DiagnosisItem, DiagnosisService, HierarchyNode, Scenario, CommercialWorkspace } from '../shared/commercial'
import { api } from './api'
import type { RequestFailure } from './api'
import { Login } from './ui'
import {BudgetPanel} from './BudgetPanel'
import {money} from './money'
import carMap from './assets/car-map.svg?raw'

const kindNames: Record<CatalogKind, string> = { peca: 'Peças', diagnostico: 'Diagnósticos', servico: 'Serviços', dimensao: 'Dimensões' }
function stateLabel(item?: CatalogItem) { return item ? `${item.status === 'validado' ? 'Validado' : item.suggestion ? 'Sugestão V2' : 'Proposta'}${item.active ? '' : ' · Inativo'}` : 'Sem código · pendente' }
const usable = (item: CatalogItem) => item.active && item.status === 'validado'
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function CommercialPanel({ atendimentoId, tab, onDirty, onBusy, scenarioContext }: {
  atendimentoId: string; tab: string; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; scenarioContext: Map<string,string>
}) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null), [items, setItems] = useState<DiagnosisItem[]>([])
  const [workspace,setWorkspace] = useState<CommercialWorkspace|null>(null), [budget,setBudget] = useState(false)
  const [scenarios,setScenarios] = useState<Scenario[]>([]), [scenarioId,setScenarioId] = useState(scenarioContext.get(atendimentoId) ?? '')
  const selection = useRef(scenarioId)
  const [matrix,setMatrix] = useState(false), [differences,setDifferences] = useState(false)
  const [failure, setFailure] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  const [reauth, setReauth] = useState(false), [manager, setManager] = useState(false), [selecting, setSelecting] = useState(tab === 'mapa')
  const [path, setPath] = useState<HierarchyNode[]>([]), [query, setQuery] = useState('')
  const [editing, setEditing] = useState<DiagnosisItem | null>(null), [draft, setDraft] = useState<DiagnosisItem | null>(null)
  const managerDirty = useRef(false)
  const onManagerDirty = useCallback((value: boolean) => { managerDirty.current = value; onDirty(value) }, [onDirty])
  const onManagerBusy = useCallback((value: boolean) => { setBusy(value); onBusy(value) }, [onBusy])
  const dirty = Boolean(editing && draft && JSON.stringify(editing) !== JSON.stringify(draft))
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => { onDirty(false); onBusy(false) }, [onDirty, onBusy])
  const load = useCallback(async (signal?: AbortSignal, preferred = selection.current) => {
    const suffix = preferred ? '?scenarioId='+encodeURIComponent(preferred) : ''
    const [c, workspace] = await Promise.all([api<CatalogResponse>('/api/catalogos', { signal }), api<CommercialWorkspace>(`/api/atendimentos/${atendimentoId}/cenarios${suffix}`, { signal })])
    if (signal?.aborted) return
    setCatalog(c); setWorkspace(workspace); setItems(workspace.items); setScenarios(workspace.scenarios); setScenarioId(workspace.selectedId)
    selection.current = workspace.selectedId; scenarioContext.set(atendimentoId,workspace.selectedId)
  }, [atendimentoId,scenarioContext])
  function failed(cause: unknown) {
    if ((cause as Error).name === 'AbortError') return
    setFailure((cause as Error).message)
    if ((cause as RequestFailure).status === 401) setReauth(true)
  }
  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(() => load(controller.signal)).catch(cause => { if (!controller.signal.aborted) failed(cause) })
    return () => controller.abort()
  }, [load, reload])
  async function mutate(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true); onBusy(true); setFailure(''); setMessage('')
    try { await operation() } catch (cause) { failed(cause) }
    finally { setBusy(false); onBusy(false) }
  }
  const byId = (id: string | null) => catalog?.items.find(item => item.id === id)
  const byCode = (code?: string) => catalog?.items.find(item => item.code === code)
  function closeEditor(refresh = true) {
    if (busy || ((dirty || managerDirty.current) && !window.confirm('Há alterações não salvas. Deseja descartá-las?'))) return false
    if (editing && refresh) setReload(value => value + 1)
    setEditing(null); setDraft(null); onDirty(false); return true
  }
  async function select(codes: string[]) {
    const existing = codes.length===1 ? items.find(p=>p.pieceId===byCode(codes[0])?.id) : undefined
    await mutate(async () => {
      const result = await api<DiagnosisItem[]>(`/api/atendimentos/${atendimentoId}/diagnosticos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceCodes: codes, scenarioId, scenarioRevision: scenarios.find(s=>s.id===scenarioId)?.revision }) })
      setItems(result); await load(); if(existing){const item=result.find(p=>p.id===existing.id)!;setEditing(item);setDraft(structuredClone(item))}; setMessage('Peça(s) salva(s) no Atendimento. Seleções repetidas não duplicam a peça.')
    })
  }
  function showNode(node: HierarchyNode) {
    if (node.tipo === 'grupo' || node.tipo === 'grupo_lados') { setPath(previous => [...previous, node]); setQuery(''); return }
    const codes = node.tipo === 'acao_ambos' ? node.gera_codigos_peca! : node.codigo_peca ? [node.codigo_peca] : []
    if (codes.length) void select(codes)
  }
  const roots = catalog ? [...Object.values(catalog.hierarchy.regioes), catalog.hierarchy.acesso_geral] : []
  function searchNodes(): HierarchyNode[] {
    const seen = new Set<string>(), found: HierarchyNode[] = []
    function visit(node: HierarchyNode, parent = '') {
      const key = node.codigo_peca ?? node.id
      if (node.tipo === 'peca' && !seen.has(key) && fold(`${parent} ${node.nome} ${node.codigo_peca ?? ''}`).includes(fold(query))) {
        seen.add(key); found.push({ ...node, nome: node.lado ? `${parent} · ${node.nome}` : node.nome })
      }
      node.itens?.forEach(child => visit(child, node.nome))
    }
    roots.forEach(node => visit(node)); return found
  }
  const nodes = query.trim() ? searchNodes() : path.length ? path[path.length - 1].itens ?? [] : roots
  const picker = <section className="piece-picker" aria-label="Selecionar peça">
    <p className="at-form-hint">Hierarquia V2 proposta. Valide a peça em Catálogos antes de adicioná-la. A seleção não confirma aplicabilidade ao veículo.</p>
    <label className="at-field">Buscar peça em todas as vistas<input value={query} onChange={e => setQuery(e.target.value)} maxLength={150} /></label>
    <div className="commercial-toolbar"><button className="fh-filter" disabled={!path.length || busy} onClick={() => { setPath(p => p.slice(0, -1)); setQuery('') }}>← Voltar nível</button><span>{path.map(node => node.nome).join(' / ') || 'Regiões e acesso geral'}</span></div>
    <div className="piece-options">{nodes.map(node => {
      const group = node.tipo === 'grupo' || node.tipo === 'grupo_lados'
      const codes = node.tipo === 'acao_ambos' ? node.gera_codigos_peca ?? [] : node.codigo_peca ? [node.codigo_peca] : []
      const available = codes.length > 0 && codes.every(code => { const item = byCode(code); return item && usable(item) })
      return <button key={node.id} disabled={busy || (!group && !available)} onClick={() => showNode(node)} title={!group && !available ? 'Validação ou código pendente no catálogo' : undefined}><strong>{node.nome}{group ? ' ›' : ''}</strong><small>{group ? 'Abrir grupo' : node.tipo === 'acao_ambos' ? `Duas peças · ${available ? 'validadas' : 'validação pendente'}` : `${stateLabel(byCode(node.codigo_peca))}${node.codigo_peca ? ` · ${node.codigo_peca}` : ''}`}</small></button>
    })}</div>{!nodes.length && <p>Nenhuma peça encontrada.</p>}
    {/* Operator-created codes do not silently change or resolve the supplied V2. */}
    {!path.length && <details><summary>Peças próprias fora da árvore V2</summary>{catalog?.items.filter(item => item.kind === 'peca' && item.source === 'operador' && (!query || fold(item.name).includes(fold(query)))).map(item => <button className="codex-add" key={item.id} disabled={busy || !usable(item)} onClick={() => select([item.code!])}>{item.name} · {stateLabel(item)}</button>)}</details>}
  </section>
  const patchDraft = (value: Partial<DiagnosisItem>) => setDraft(previous => previous ? { ...previous, ...value } : null)
  function updateLine(index: number, value: Partial<DiagnosisService>) { if (draft) patchDraft({ services: draft.services.map((line, i) => i === index ? { ...line, ...value } : line) }) }
  const options = (kind: CatalogKind, current?: string | null) => catalog?.items.filter(item => item.kind === kind && (usable(item) || item.id === current)) ?? []
  async function flag(scenario: Scenario, field: 'pieceFlags' | 'serviceFlags' | 'componentFlags', id: string, enabled: boolean) {
    await mutate(async()=> { await api(`/api/atendimentos/${atendimentoId}/cenarios/${scenario.id}`, {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:scenario.revision,[field]:{[id]:enabled}})}); await load() })
  }
  const active = scenarios.find(s=>s.id===scenarioId)
  const differs = (values: boolean[]) => values.some(value=>value!==values[0])
  const matrixValue = (scenarioId:string,lineId:string) => {const line=workspace?.calculations.find(c=>c.scenarioId===scenarioId)?.lines.find(l=>l.id===lineId);return line?.included?money(line.total):'Não incluído'}
  const comparison = <div className="scenario-matrix" role="region" aria-label="Matriz de cenários" tabIndex={0}><table><thead><tr><th>Composição mestre</th>{scenarios.map(s=><th key={s.id}>{s.name}</th>)}</tr></thead><tbody>{items.map(item=>{
    const parentDiff = differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id])))
    const lines = item.services.filter(line=>!differences || differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id] && s.serviceFlags[line.id]))))
    const components = (workspace?.components ?? []).filter(c=>c.pieceId===item.id).filter(c=>!differences || differs(scenarios.map(s=>Boolean(s.pieceFlags[item.id] && s.componentFlags[c.id]))))
    if (differences && !parentDiff && !lines.length && !components.length) return null
    return [<tr className="matrix-parent" key={item.id}><th>{byId(item.pieceId)?.name}</th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${s.name}: incluir peça ${byId(item.pieceId)?.name}`} checked={Boolean(s.pieceFlags[item.id])} disabled={busy} onChange={e=>flag(s,'pieceFlags',item.id,e.target.checked)} /></td>)}</tr>,...lines.map((line,index)=><tr key={line.id}><th>{byId(line.serviceId)?.name} · {byId(line.dimensionId)?.name ?? 'dimensão pendente'} · {line.quantity}<small>Lançamento {index+1} · {[byId(line.diagnosisId ?? item.diagnosisId)?.name,line.notes].filter(Boolean).join(' · ')}</small></th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${s.name}: incluir serviço ${line.id}`} checked={Boolean(s.pieceFlags[item.id] && s.serviceFlags[line.id])} disabled={busy || !s.pieceFlags[item.id]} onChange={e=>flag(s,'serviceFlags',line.id,e.target.checked)} />{!s.pieceFlags[item.id] && <small>Peça desmarcada</small>}<small>{matrixValue(s.id,line.id)}</small></td>)}</tr>),...components.map(component=><tr key={component.id}><th>{component.name} · {component.quantity}<small>Componente monetário · FCT {component.fct??'pendente'}</small></th>{scenarios.map(s=><td key={s.id}><input type="checkbox" aria-label={`${s.name}: incluir componente ${component.id}`} checked={Boolean(s.pieceFlags[item.id] && s.componentFlags[component.id])} disabled={busy || !s.pieceFlags[item.id]} onChange={e=>flag(s,'componentFlags',component.id,e.target.checked)}/><small>{matrixValue(s.id,component.id)}</small></td>)}</tr>)]
  })}</tbody><tfoot>{(['serviceSubtotal','componentSubtotal','total','energy','days'] as const).map((field,i)=><tr key={field}><th>{['Serviços','Componentes','Total antes da negociação','Energia','Dias técnicos'][i]}</th>{scenarios.map(s=>{const c=workspace?.calculations.find(c=>c.scenarioId===s.id),value=c?.[field];return <td key={s.id}>{field==='energy'||field==='days'?value??'Indisponível':money(value)}</td>})}</tr>)}</tfoot></table></div>
  return <div className="detail-page commercial-page">
    <div className="diagnostics-body">
      <div className="commercial-toolbar"><h1>{manager ? 'Catálogos comerciais' : tab === 'mapa' ? 'Mapa do veículo' : 'Diagnósticos'}</h1><button className="fh-filter" disabled={busy} onClick={() => { if (closeEditor()) { setManager(v => !v); setFailure(''); setMessage('') } }}>{manager ? 'Voltar aos itens' : 'Catálogos'}</button></div>
      {!manager && active && <section className="scenario-controls" aria-label="Cenários">
        <label className="at-field">Cenário em edição<select aria-label="Cenário em edição" value={scenarioId} disabled={busy} onChange={e=>{ if(closeEditor(false)) void mutate(()=>load(undefined,e.target.value)) }}>{scenarios.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <div className="commercial-toolbar"><button className="fh-filter" disabled={busy} onClick={()=>{ if(!closeEditor(false))return; const name=window.prompt('Nome do novo cenário (sem itens habilitados):'); if(name) void mutate(async()=>{const s=await api<Scenario>(`/api/atendimentos/${atendimentoId}/cenarios`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});await load(undefined,s.id)}) }}>Novo cenário</button>
        <button className="fh-filter" disabled={busy} onClick={()=>{if(!closeEditor(false))return; const name=window.prompt('Nome da cópia do cenário:',active.name+' — cópia'); if(name) void mutate(async()=>{const s=await api<Scenario>(`/api/atendimentos/${atendimentoId}/cenarios`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,duplicateFrom:active.id,sourceRevision:active.revision})});await load(undefined,s.id)})}}>Duplicar cenário</button>
        <button className="fh-filter" disabled={busy} onClick={()=>{if(!closeEditor(false))return;const name=window.prompt('Nome do cenário:',active.name);if(name)void mutate(async()=>{await api(`/api/atendimentos/${atendimentoId}/cenarios/${active.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:active.revision,name})});await load()})}}>Renomear cenário</button>
        <button className="fh-filter" disabled={busy} onClick={()=>{if(closeEditor()){setBudget(false);setMatrix(v=>!v)}}}>{matrix?'Editar cenário':'Matriz comparativa'}</button></div>
        <p className="at-form-hint">A composição e seus atributos são comuns a todos os cenários. Inclusão é individual. Novos itens são habilitados somente no cenário ativo.</p>
      </section>}
      {reauth && <div className="commercial-reauth"><p>Entre novamente. Os campos em edição foram preservados.</p><Login session={{ authenticated: false, configured: true }} error="" refresh={() => {}} onSession={() => setReauth(false)} /></div>}
      {failure && <p className="form-error" role="alert">{failure}</p>}{message && <p className="at-save-success" role="status">{message}</p>}
      {!catalog ? <button className="codex-add" onClick={() => setReload(v => v + 1)}>Carregar catálogos e diagnósticos</button> : manager ? <CatalogManager catalog={catalog} onChanged={() => load()} onDirty={onManagerDirty} onBusy={onManagerBusy} onAuthRequired={() => setReauth(true)} /> : budget && workspace ? <BudgetPanel key={scenarioId} at={atendimentoId} workspace={workspace} catalog={catalog.items} onRefresh={()=>load()} onDirty={onManagerDirty} onBusy={onManagerBusy} onAuthRequired={()=>setReauth(true)}/> : matrix ? <><label className="commercial-check"><input type="checkbox" checked={differences} onChange={e=>setDifferences(e.target.checked)} /> Só diferenças</label>{comparison}</> : draft ? <form aria-label="Editar item de diagnóstico" onSubmit={event => {
        event.preventDefault()
        void mutate(async () => {
          const updated = await api<DiagnosisItem>(`/api/atendimentos/${atendimentoId}/diagnosticos/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision, scenarioId, scenarioRevision: scenarios.find(s=>s.id===scenarioId)?.revision, diagnosisId: draft.diagnosisId, notes: draft.notes, enabled: draft.enabled, services: draft.services.map(line => ({ ...line, ...(line.id.startsWith('new:') ? { id: undefined } : {}) })) }) })
          setItems(previous => previous.map(item => item.id === updated.id ? updated : item)); setDraft(updated); setEditing(updated); await load(); onDirty(false); setMessage('Diagnóstico salvo no Atendimento.')
        })
      }}>
        <h2>{byId(draft.pieceId)?.name}</h2>
        <fieldset disabled={busy}><label className="commercial-check"><input type="checkbox" checked={draft.enabled} onChange={e => patchDraft({ enabled: e.target.checked })} /> Incluir item</label>
        <label className="at-field">Diagnóstico<select aria-label="Diagnóstico" value={draft.diagnosisId ?? ''} onChange={e => patchDraft({ diagnosisId: e.target.value || null })}><option value="">Ainda não definido</option>{options('diagnostico', draft.diagnosisId).map(item => <option key={item.id} value={item.id}>{item.name}{!usable(item) ? ' (indisponível para novas seleções)' : ''}</option>)}</select></label>
        <label className="at-field">Observações do diagnóstico<textarea aria-label="Observações do diagnóstico" value={draft.notes} rows={3} maxLength={8000} onChange={e => patchDraft({ notes: e.target.value })} /></label>
        <p className="at-form-hint">Editar atributos altera TODOS os cenários; incluir/desmarcar altera somente o cenário selecionado.</p><h2>Serviços</h2>{draft.services.map((line, i) => <section className="service-line" key={line.id} aria-label={`Serviço ${i + 1}`}>
          <label className="at-field">Serviço<select aria-label="Serviço" required value={line.serviceId} onChange={e => updateLine(i, { serviceId: e.target.value, dimensionId: null })}><option value="">Selecionar serviço</option>{options('servico', line.serviceId).map(item => <option key={item.id} value={item.id}>{item.name}{!usable(item) ? ' (indisponível)' : ''}</option>)}</select></label>
          <label className="at-field">Dimensão<select aria-label="Dimensão" value={line.dimensionId ?? ''} onChange={e => updateLine(i, { dimensionId: e.target.value || null })}><option value="">Ainda não definida</option>{options('dimensao', line.dimensionId).filter(item => item.serviceId === line.serviceId).map(item => <option key={item.id} value={item.id}>{item.name}{!usable(item) ? ' (indisponível)' : ''}</option>)}</select></label>
          <label className="at-field">Quantidade<input type="number" min="0.000001" max="999999999.999999" step="any" required value={line.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} /></label>
          <label className="at-field">Diagnóstico do lançamento<select aria-label="Diagnóstico do lançamento" value={line.diagnosisId ?? ''} onChange={e=>updateLine(i,{diagnosisId:e.target.value || null})}><option value="">Usar diagnóstico da peça</option>{options('diagnostico',line.diagnosisId).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="at-field">Observação do lançamento<textarea aria-label="Observação do lançamento" rows={2} maxLength={8000} value={line.notes ?? ''} onChange={e=>updateLine(i,{notes:e.target.value})} /></label>
          <label className="commercial-check"><input type="checkbox" checked={line.enabled} onChange={e => updateLine(i, { enabled: e.target.checked })} /> Incluir serviço</label>
          <button type="button" className="fh-filter" onClick={() => { if (window.confirm('Excluir este lançamento de TODOS os cenários?')) patchDraft({ services: draft.services.filter((_, index) => i !== index) }) }}>Remover serviço {i + 1}</button>
        </section>)}
        <button className="codex-add" type="button" disabled={draft.services.length >= 50} onClick={() => patchDraft({ services: [...draft.services, { id: `new:${crypto.randomUUID()}`, serviceId: '', dimensionId: null, quantity: '1', enabled: true }] })}>+ Adicionar serviço</button>
        <p className="at-form-hint">Seleções manuais. Confira valores e emissão em Orçamento e componentes.</p>
        <div className="commercial-toolbar"><button className="fh-filter" type="button" onClick={()=>closeEditor()}>Voltar à lista</button><button className="primary-btn" disabled={!dirty} type="submit">{busy ? 'Salvando…' : 'Salvar diagnóstico'}</button></div></fieldset>
      </form> : <>
        {tab === 'mapa' && <div className="interactive-map" onClick={event => {
          const region = (event.target as Element).closest('[data-region]')?.getAttribute('data-region')
          if (region) { setPath([catalog.hierarchy.regioes[region]]); setQuery(''); setSelecting(true) }
        }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { const node = (event.target as Element).closest('[data-region]'); if (node) { event.preventDefault(); setPath([catalog.hierarchy.regioes[node.getAttribute('data-region')!]]); setQuery(''); setSelecting(true) } } }} dangerouslySetInnerHTML={{ __html: carMap }} />}
        <button className="codex-add" disabled={busy} onClick={() => setSelecting(v => !v)}>{selecting ? 'Recolher seleção de peças' : '+ Adicionar peça / item'}</button>
        {selecting && picker}
        <h2>Itens do Atendimento · {items.length}</h2>
        {!items.length && <p className="at-form-hint">Nenhum item adicionado. Use o mapa ou a busca de peças.</p>}
        {items.map(item => <article className={`diagnosis-card ${item.enabled ? '' : 'excluded'}`} key={item.id}>
          <button className="diagnosis-open" disabled={busy} onClick={() => { setEditing(item); setDraft(structuredClone(item)); setMessage('') }}><strong>{byId(item.pieceId)?.name}</strong><span>{byId(item.diagnosisId)?.name ?? 'Diagnóstico pendente'}</span><small>{item.services.length} serviço(s) · {item.enabled ? 'Incluído' : 'Desmarcado'} · {stateLabel(byId(item.pieceId))}</small><span>Editar ›</span></button>
          <button className="fh-filter" disabled={busy} onClick={() => {
            if (window.confirm('Remover esta peça e todos os seus serviços de TODOS os cenários deste Atendimento?')) void mutate(async () => { await api(`/api/atendimentos/${atendimentoId}/diagnosticos/${item.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: item.revision }) }); setItems(previous => previous.filter(old => old.id !== item.id)); await load(); setMessage('Item e serviços removidos de todos os cenários.') })
          }}>Remover item</button>
        </article>)}
      </>}
    </div><footer className="detail-footer"><button className="primary-btn" disabled={busy||!workspace} onClick={()=>{if(closeEditor()){setManager(false);setMatrix(false);setBudget(v=>!v)}}}>{budget?'Voltar aos diagnósticos':'Orçamento e componentes'}</button></footer>
  </div>
}

function CatalogManager({ catalog, onChanged, onDirty, onBusy, onAuthRequired }: {
  catalog: CatalogResponse; onChanged: () => Promise<void>; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; onAuthRequired: () => void
}) {
  const [kind, setKind] = useState<CatalogKind>('peca'), [query, setQuery] = useState('')
  const [old, setOld] = useState<CatalogItem | null>(null), [form, setForm] = useState(false)
  const [name, setName] = useState(''), [code, setCode] = useState(''), [serviceId, setServiceId] = useState('')
  const [validated, setValidated] = useState(false), [active, setActive] = useState(true)
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [history, setHistory] = useState<{ revision: number; changedAt: string }[]>([])
  const dirty = form && (name !== (old?.name ?? '') || code !== (old?.code ?? '') || validated !== (old?.status === 'validado') || active !== (old?.active ?? true) || serviceId !== (old?.serviceId ?? ''))
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
    setOld(item); setForm(true); setName(item?.name ?? ''); setCode(item?.code ?? ''); setServiceId(item?.serviceId ?? ''); setValidated(item?.status === 'validado'); setActive(item?.active ?? true); setFailure(''); setHistory([])
  }
  return <section aria-label="Manutenção de catálogos"><p className="at-form-hint">Catálogos próprios. Validar confirma a identificação para uso comercial, sem atestar aplicabilidade ao veículo. Nenhum preço ou fator é criado aqui.</p>
    {failure && <p className="form-error" role="alert">{failure}</p>}
    {form ? <form aria-label="Editar catálogo" onSubmit={async event => {
      event.preventDefault(); if (busy) return
      setBusy(true); onBusy(true); setFailure('')
      try {
        await api(old ? `/api/catalogos/${encodeURIComponent(old.id)}` : '/api/catalogos', { method: old ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(old ? { revision: old.revision, name, status: validated ? 'validado' : 'proposta', active } : { kind, name, status: validated ? 'validado' : 'proposta', ...(kind === 'peca' ? { code } : {}), ...(kind === 'dimensao' ? { serviceId } : {}) }) })
        onDirty(false); setForm(false); await onChanged()
      } catch (cause) { setFailure((cause as Error).message); if ((cause as RequestFailure).status === 401) onAuthRequired() }
      finally { setBusy(false); onBusy(false) }
    }}><fieldset disabled={busy}>
      <h2>{kindNames[kind]} · {old ? 'Editar' : 'Novo cadastro'}</h2>
      <label className="at-field">Nome do catálogo<input autoFocus required maxLength={250} value={name} onChange={e => setName(e.target.value)} /></label>
      {kind === 'peca' && <label className="at-field">Código da peça<input required maxLength={150} readOnly={Boolean(old)} value={code} onChange={e => setCode(e.target.value)} /><small>{old ? 'Código preservado como identidade física.' : 'Informe somente um código fornecido/validado pela direção.'}</small></label>}
      {kind === 'dimensao' && <label className="at-field">Serviço da dimensão<select required disabled={Boolean(old)} value={serviceId} onChange={e => setServiceId(e.target.value)}><option value="">Selecionar serviço</option>{catalog.items.filter(item => item.kind === 'servico' && (usable(item) || item.id === serviceId)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="commercial-check"><input type="checkbox" checked={validated} onChange={e => setValidated(e.target.checked)} /> Validado pelo operador</label>
      {old && <><label className="commercial-check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Ativo para novas seleções</label><p className="at-form-hint">{old.source} · revisão {old.revision} · {new Date(old.updatedAt).toLocaleString('pt-BR')}</p></>}
      <div className="commercial-toolbar"><button type="button" className="fh-filter" onClick={() => { if (!dirty || window.confirm('Há alterações não salvas. Deseja descartá-las?')) { setForm(false); onDirty(false); void refreshCatalogs() } }}>Cancelar edição</button><button className="primary-btn" type="submit">{busy ? 'Salvando…' : 'Salvar catálogo'}</button></div>
      {old && <button type="button" className="codex-add" onClick={async () => { try { setHistory(await api(`/api/catalogos/${encodeURIComponent(old.id)}/historico`)) } catch (cause) { setFailure((cause as Error).message) } }}>Ver histórico de alterações</button>}
      {history.map(entry => <p className="at-form-hint" key={entry.revision}>Revisão {entry.revision} · {new Date(entry.changedAt).toLocaleString('pt-BR')}</p>)}
    </fieldset></form> : <>
      <label className="at-field">Tipo de catálogo<select value={kind} onChange={e => setKind(e.target.value as CatalogKind)}>{Object.entries(kindNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="at-field">Buscar no catálogo<input value={query} onChange={e => setQuery(e.target.value)} maxLength={150} /></label>
      <div className="commercial-toolbar"><button className="fh-filter" disabled={busy} onClick={() => edit(null)}>+ Novo cadastro</button><button className="fh-filter" disabled={busy} onClick={refreshCatalogs}>Atualizar catálogos</button></div>
      {catalog.items.filter(item => item.kind === kind && fold(`${item.name} ${item.code ?? ''}`).includes(fold(query))).map(item => <button className="catalog-row" key={item.id} disabled={busy} onClick={() => edit(item)}><strong>{item.name}</strong><small>{stateLabel(item)} · {item.code ?? kindNames[item.kind]}</small></button>)}
      {!catalog.items.some(item => item.kind === kind) && <p className="at-form-hint">Catálogo vazio. Aguarda dados próprios da FUNIX.</p>}
    </>}
  </section>
}
