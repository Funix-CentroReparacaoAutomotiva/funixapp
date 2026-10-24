import { useCallback, useEffect, useRef, useState } from 'react'
import type { CatalogItem, CatalogKind, CatalogResponse, DiagnosisItem, DiagnosisService, HierarchyNode } from '../shared/commercial'
import { api } from './api'
import type { RequestFailure } from './api'
import { Login } from './ui'
import carMap from './assets/car-map.svg?raw'

const kindNames: Record<CatalogKind, string> = { peca: 'Peças', diagnostico: 'Diagnósticos', servico: 'Serviços', dimensao: 'Dimensões' }
function stateLabel(item?: CatalogItem) { return item ? `${item.status === 'validado' ? 'Validado' : item.suggestion ? 'Sugestão V2' : 'Proposta'}${item.active ? '' : ' · Inativo'}` : 'Sem código · pendente' }
const usable = (item: CatalogItem) => item.active && item.status === 'validado'
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function CommercialPanel({ atendimentoId, tab, onDirty, onBusy }: {
  atendimentoId: string; tab: string; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void
}) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null), [items, setItems] = useState<DiagnosisItem[]>([])
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
  const load = useCallback(async (signal?: AbortSignal) => {
    const [c, d] = await Promise.all([api<CatalogResponse>('/api/catalogos', { signal }), api<DiagnosisItem[]>(`/api/atendimentos/${atendimentoId}/diagnosticos`, { signal })])
    setCatalog(c); setItems(d)
  }, [atendimentoId])
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
  function closeEditor() {
    if (busy || ((dirty || managerDirty.current) && !window.confirm('Há alterações não salvas. Deseja descartá-las?'))) return false
    if (editing) setReload(value => value + 1)
    setEditing(null); setDraft(null); onDirty(false); return true
  }
  async function select(codes: string[]) {
    await mutate(async () => {
      const result = await api<DiagnosisItem[]>(`/api/atendimentos/${atendimentoId}/diagnosticos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pieceCodes: codes }) })
      setItems(result); setMessage('Peça(s) salva(s) no Atendimento. Seleções repetidas não duplicam a peça.')
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
  return <div className="detail-page commercial-page">
    <div className="diagnostics-body">
      <div className="commercial-toolbar"><h1>{manager ? 'Catálogos comerciais' : tab === 'mapa' ? 'Mapa do veículo' : 'Diagnósticos'}</h1><button className="fh-filter" disabled={busy} onClick={() => { if (closeEditor()) { setManager(v => !v); setFailure(''); setMessage('') } }}>{manager ? 'Voltar aos itens' : 'Catálogos'}</button></div>
      {reauth && <div className="commercial-reauth"><p>Entre novamente. Os campos em edição foram preservados.</p><Login session={{ authenticated: false, configured: true }} error="" refresh={() => {}} onSession={() => setReauth(false)} /></div>}
      {failure && <p className="form-error" role="alert">{failure}</p>}{message && <p className="at-save-success" role="status">{message}</p>}
      {!catalog ? <button className="codex-add" onClick={() => setReload(v => v + 1)}>Carregar catálogos e diagnósticos</button> : manager ? <CatalogManager catalog={catalog} onChanged={() => load()} onDirty={onManagerDirty} onBusy={onManagerBusy} onAuthRequired={() => setReauth(true)} /> : draft ? <form aria-label="Editar item de diagnóstico" onSubmit={event => {
        event.preventDefault()
        void mutate(async () => {
          const updated = await api<DiagnosisItem>(`/api/atendimentos/${atendimentoId}/diagnosticos/${draft.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: draft.revision, diagnosisId: draft.diagnosisId, notes: draft.notes, enabled: draft.enabled, services: draft.services.map(line => ({ ...line, ...(line.id.startsWith('new:') ? { id: undefined } : {}) })) }) })
          setItems(previous => previous.map(item => item.id === updated.id ? updated : item)); setDraft(updated); setEditing(updated); onDirty(false); setMessage('Diagnóstico salvo no Atendimento.')
        })
      }}>
        <h2>{byId(draft.pieceId)?.name}</h2>
        <fieldset disabled={busy}><label className="commercial-check"><input type="checkbox" checked={draft.enabled} onChange={e => patchDraft({ enabled: e.target.checked })} /> Incluir item</label>
        <label className="at-field">Diagnóstico<select aria-label="Diagnóstico" value={draft.diagnosisId ?? ''} onChange={e => patchDraft({ diagnosisId: e.target.value || null })}><option value="">Ainda não definido</option>{options('diagnostico', draft.diagnosisId).map(item => <option key={item.id} value={item.id}>{item.name}{!usable(item) ? ' (indisponível para novas seleções)' : ''}</option>)}</select></label>
        <label className="at-field">Observações do diagnóstico<textarea value={draft.notes} rows={3} maxLength={8000} onChange={e => patchDraft({ notes: e.target.value })} /></label>
        <h2>Serviços</h2>{draft.services.map((line, i) => <section className="service-line" key={line.id} aria-label={`Serviço ${i + 1}`}>
          <label className="at-field">Serviço<select aria-label="Serviço" required value={line.serviceId} onChange={e => updateLine(i, { serviceId: e.target.value, dimensionId: null })}><option value="">Selecionar serviço</option>{options('servico', line.serviceId).map(item => <option key={item.id} value={item.id}>{item.name}{!usable(item) ? ' (indisponível)' : ''}</option>)}</select></label>
          <label className="at-field">Dimensão<select aria-label="Dimensão" value={line.dimensionId ?? ''} onChange={e => updateLine(i, { dimensionId: e.target.value || null })}><option value="">Ainda não definida</option>{options('dimensao', line.dimensionId).filter(item => item.serviceId === line.serviceId).map(item => <option key={item.id} value={item.id}>{item.name}{!usable(item) ? ' (indisponível)' : ''}</option>)}</select></label>
          <label className="at-field">Quantidade<input type="number" min="0.000001" max="999999999.999999" step="any" required value={line.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} /></label>
          <label className="commercial-check"><input type="checkbox" checked={line.enabled} onChange={e => updateLine(i, { enabled: e.target.checked })} /> Incluir serviço</label>
          <button type="button" className="fh-filter" onClick={() => patchDraft({ services: draft.services.filter((_, index) => i !== index) })}>Remover serviço {i + 1}</button>
        </section>)}
        <button className="codex-add" type="button" disabled={draft.services.length >= 50} onClick={() => patchDraft({ services: [...draft.services, { id: `new:${crypto.randomUUID()}`, serviceId: '', dimensionId: null, quantity: '1', enabled: true }] })}>+ Adicionar serviço</button>
        <p className="at-form-hint">Seleções manuais. Sem cálculo de preço, etapas técnicas ou orçamento emitido.</p>
        <div className="commercial-toolbar"><button className="fh-filter" type="button" onClick={closeEditor}>Voltar à lista</button><button className="primary-btn" disabled={!dirty} type="submit">{busy ? 'Salvando…' : 'Salvar diagnóstico'}</button></div></fieldset>
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
            if (window.confirm('Remover esta peça e todos os seus serviços deste Atendimento?')) void mutate(async () => { await api(`/api/atendimentos/${atendimentoId}/diagnosticos/${item.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: item.revision }) }); setItems(previous => previous.filter(old => old.id !== item.id)); setMessage('Item e serviços removidos.') })
          }}>Remover item</button>
        </article>)}
      </>}
    </div><footer className="detail-footer"><button className="primary-btn" disabled>Criar orçamento · indisponível</button></footer>
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
