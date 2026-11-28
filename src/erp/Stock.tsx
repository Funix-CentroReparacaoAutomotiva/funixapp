import AcquisitionComponents from './AcquisitionComponents'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { StockKind, StockMaterial, StockMovement, StockMovementType } from '../../shared/erp-stock'
import { api } from '../api'
import './stock.css'

type MaterialDraft = Omit<StockMaterial, 'balance' | 'stockValue' | 'reorder'>
type MovementDraft = Pick<StockMovement, 'id' | 'materialId' | 'date' | 'partner' | 'operator' | 'type' | 'reason' | 'quantity' | 'unitCost'>
type MovementPage = { items: StockMovement[]; nextOffset: number | null }

const labels = { entry: 'Entrada', exit: 'Saída', adjustment: 'Ajuste' }
const typeLabels = { supply: 'Insumos', paint: 'Tintas' }
const decimal = (value: string) => value.replace('.', ',')
const money = (value: string) => {
  const [whole, fraction = ''] = value.split('.')
  return `R$ ${whole},${fraction.padEnd(2, '0')}`
}
const displayDate = (value: string) => value.split('-').reverse().join('/')
const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const base = '/api/erp/stock'

function post<T>(path: string, input: unknown) {
  return api<T>(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="stock-field"><span>{label}</span>{children}</label>
}

function TypeOptions() {
  return <>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</>
}

function MaterialForm({ draft, change, busy, cancel, save }: {
  draft: MaterialDraft; change: (draft: MaterialDraft) => void; busy: boolean; cancel: () => void; save: (event: FormEvent) => void
}) {
  return <form onSubmit={save} className="stock-form">
    <h2>{draft.revision ? 'Editar material' : 'Cadastrar material'}</h2>
    <fieldset disabled={busy}>
      <Field label="Código"><input required maxLength={60} value={draft.code} onChange={e => change({ ...draft, code: e.target.value })}/></Field>
      <Field label="Nome"><input required maxLength={160} value={draft.name} onChange={e => change({ ...draft, name: e.target.value })}/></Field>
      <Field label="Fabricante"><input maxLength={120} value={draft.manufacturer} onChange={e => change({ ...draft, manufacturer: e.target.value })}/></Field>
      <Field label="Unidade"><input required maxLength={30} value={draft.unit} onChange={e => change({ ...draft, unit: e.target.value })}/></Field>
      <Field label="Estoque mínimo"><input required inputMode="decimal" value={draft.minimum} onChange={e => change({ ...draft, minimum: e.target.value })}/></Field>
      <Field label="Custo unitário (R$)"><input required inputMode="decimal" value={draft.unitCost} onChange={e => change({ ...draft, unitCost: e.target.value })}/></Field>
      <label className="stock-check"><input type="checkbox" checked={draft.released} onChange={e => change({ ...draft, released: e.target.checked })}/> Material liberado</label>
      <div className="stock-actions">
        <button type="submit">{busy ? 'Salvando…' : 'Salvar material'}</button>
        <button type="button" onClick={cancel}>Cancelar</button>
      </div>
    </fieldset>
  </form>
}

function MovementForm({ draft, materials, change, busy, cancel, save }: {
  draft: MovementDraft; materials: StockMaterial[]; change: (draft: MovementDraft) => void; busy: boolean; cancel: () => void; save: (event: FormEvent) => void
}) {
  const material = materials.find(item => item.id === draft.materialId)
  return <form onSubmit={save} className="stock-form">
    <h2>Registrar movimentação</h2>
    <fieldset disabled={busy}>
      <Field label="Material"><select aria-label="Material" required value={draft.materialId} onChange={e => {
        const item = materials.find(row => row.id === e.target.value)
        change({ ...draft, materialId: e.target.value, unitCost: item?.unitCost ?? '' })
      }}><option value="">Selecione</option>{materials.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
      <Field label="Tipo"><select aria-label="Tipo de movimentação" value={draft.type} onChange={e => change({ ...draft, type: e.target.value as StockMovementType })}><TypeOptions/></select></Field>
      <Field label="Data"><input required type="date" value={draft.date} onChange={e => change({ ...draft, date: e.target.value })}/></Field>
      <Field label={`Quantidade${material ? ` (${material.unit})` : ''}`}><input required inputMode="decimal" aria-describedby="stock-quantity-help" value={draft.quantity} onChange={e => change({ ...draft, quantity: e.target.value })}/>
        <small id="stock-quantity-help">{draft.type === 'adjustment' ? 'Informe a diferença positiva ou negativa.' : 'Informe uma quantidade positiva.'}{material && ` Saldo atual: ${decimal(material.balance)}.`}</small></Field>
      <Field label="Valor unitário (R$)"><input required inputMode="decimal" value={draft.unitCost} onChange={e => change({ ...draft, unitCost: e.target.value })}/></Field>
      <Field label="Parceiro"><input maxLength={160} value={draft.partner} onChange={e => change({ ...draft, partner: e.target.value })}/></Field>
      <Field label="Responsável"><input required maxLength={160} value={draft.operator} onChange={e => change({ ...draft, operator: e.target.value })}/></Field>
      <Field label="Justificativa"><textarea required={draft.type === 'adjustment'} maxLength={500} value={draft.reason} onChange={e => change({ ...draft, reason: e.target.value })}/></Field>
      <div className="stock-actions">
        <button type="submit">{busy ? 'Registrando…' : 'Registrar movimentação'}</button>
        <button type="button" onClick={cancel}>Cancelar</button>
      </div>
    </fieldset>
  </form>
}

function MaterialsTable({ items, edit, move }: { items: StockMaterial[]; edit: (item: StockMaterial) => void; move: (item: StockMaterial) => void }) {
  if (!items.length) return <p>Nenhum material corresponde aos filtros.</p>
  return <><p className="stock-scroll-hint">Deslize a tabela para ver todas as colunas.</p><div className="stock-table-scroll" role="region" aria-label="Materiais" tabIndex={0}><table>
    <thead><tr>{['Código', 'Nome', 'Fabricante', 'Unidade', 'Saldo', 'Mínimo', 'Custo unitário', 'Valor em estoque', 'Situação', 'Ações'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td>{item.code}</td><th scope="row">{item.name}</th><td>{item.manufacturer || '—'}</td><td>{item.unit}</td>
      <td>{decimal(item.balance)}{item.reorder && <small className="stock-warning">Repor</small>}</td>
      <td>{decimal(item.minimum)}</td><td>{money(item.unitCost)}</td><td>{money(item.stockValue)}</td>
      <td>{item.released ? 'Liberado' : 'Não liberado'}</td>
      <td><div className="stock-actions">
        <button type="button" aria-label={`Editar ${item.name}`} onClick={() => edit(item)}>Editar</button>
        <button type="button" aria-label={`Movimentar ${item.name}`} onClick={() => move(item)}>Movimentar</button>
      </div></td>
    </tr>)}</tbody>
  </table></div></>
}

function MovementsTable({ rows }: { rows: StockMovement[] }) {
  if (!rows.length) return <p>Nenhuma movimentação corresponde aos filtros.</p>
  return <><p className="stock-scroll-hint">Deslize a tabela para ver todas as colunas.</p><div className="stock-table-scroll" role="region" aria-label="Histórico de movimentações" tabIndex={0}><table>
    <thead><tr>{['ID', 'Data', 'Material', 'Tipo', 'Quantidade', 'Valor unitário', 'Valor total', 'Parceiro', 'Responsável', 'Justificativa'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <th scope="row" className="stock-id">{row.id}</th><td>{displayDate(row.date)}</td><td>{row.materialCode} · {row.materialName}</td>
      <td>{labels[row.type]}</td><td>{decimal(row.quantity)} {row.unit}</td><td>{money(row.unitCost)}</td><td>{money(row.total)}</td>
      <td>{row.partner || '—'}</td><td>{row.operator}</td><td>{row.reason || '—'}</td>
    </tr>)}</tbody>
  </table></div></>
}

export default function Stock({ view }: { view: string }) {
  return view==='componentes' ? <AcquisitionComponents stock/> : <StockView key={view} view={view}/>
}

function StockView({ view }: { view: string }) {
  const kind: StockKind = view === 'tintas' ? 'paint' : 'supply'
  const movements = view === 'movimentacoes'
  const [materials, setMaterials] = useState<StockMaterial[]>([])
  const [materialDraft, setMaterialDraft] = useState<MaterialDraft | null>(null)
  const [movementDraft, setMovementDraft] = useState<MovementDraft | null>(null)
  const [search, setSearch] = useState('')
  const [availability, setAvailability] = useState('')
  const [reorder, setReorder] = useState(false)
  const [materialFilter, setMaterialFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [materialResult, setMaterialResult] = useState<{ revision: number; error?: string }>()
  const [historyResult, setHistoryResult] = useState<{ key: string; error?: string; page?: MovementPage }>()
  const historyKey = JSON.stringify([offset, materialFilter, typeFilter, from, to, reload])
  const loading = materialResult?.revision !== reload
  const loadError = loading ? '' : materialResult.error
  const loadingMovements = historyResult?.key !== historyKey
  const historyError = loadingMovements ? '' : historyResult.error
  const page = historyResult?.page ?? { items: [], nextOffset: null }
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api<{ items: StockMaterial[] }>(base + '/materials', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setMaterials(result.items)
        setMaterialResult({ revision: reload })
      })
      .catch(error => {
        if (!controller.signal.aborted) setMaterialResult({ revision: reload, error: error.message })
      })
    return () => controller.abort()
  }, [reload])

  useEffect(() => {
    if (!movements) return
    const controller = new AbortController()
    const params = new URLSearchParams({ offset: String(offset) })
    if (materialFilter) params.set('materialId', materialFilter)
    if (typeFilter) params.set('type', typeFilter)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    api<MovementPage>(`${base}/movements?${params}`, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) setHistoryResult({ key: historyKey, page: result })
      })
      .catch(error => {
        if (!controller.signal.aborted) setHistoryResult({ key: historyKey, error: error.message })
      })
    return () => controller.abort()
  }, [movements, offset, materialFilter, typeFilter, from, to, historyKey])

  const normalized = searchText(search.trim())
  const visible = materials.filter(item => item.kind === kind &&
    (!reorder || item.reorder) &&
    (!availability || item.released === (availability === 'released')) &&
    searchText(`${item.name} ${item.code} ${item.manufacturer}`).includes(normalized))

  function openMaterial(item?: StockMaterial) {
    setMovementDraft(null)
    setSaveError('')
    setMaterialDraft(item ?? {
      id: crypto.randomUUID(), kind, code: '', name: '', manufacturer: '', unit: '',
      minimum: '0', unitCost: '', released: true, revision: 0,
    })
  }

  function openMovement(item?: StockMaterial) {
    setMaterialDraft(null)
    setSaveError('')
    setMovementDraft({
      id: crypto.randomUUID(), materialId: item?.id ?? '', date: today(), partner: '',
      operator: '', type: 'entry', reason: '', quantity: '', unitCost: item?.unitCost ?? '',
    })
  }

  function cancel() {
    setMaterialDraft(null)
    setMovementDraft(null)
    setSaveError('')
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setSaveError('')
    setNotice('')
    try {
      if (materialDraft) {
        await post<StockMaterial>('/materials', materialDraft)
        setNotice('Material salvo.')
      } else if (movementDraft) {
        await post<StockMovement>('/movements', movementDraft)
        setNotice('Movimentação registrada.')
        setOffset(0)
      }
      cancel()
      setReload(value => value + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="stock" aria-labelledby="stock-title">
    <header className="stock-heading">
      <h1 id="stock-title">{movements ? 'Movimentações' : typeLabels[kind]}</h1>
      {movements
        ? <button type="button" disabled={busy || !materials.length} onClick={() => openMovement()}>Registrar movimentação</button>
        : <button type="button" disabled={busy} onClick={() => openMaterial()}>Cadastrar material</button>}
    </header>
    {loadError && <p role="alert">{loadError} <button type="button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></p>}
    {notice && <p role="status">{notice}</p>}
    {saveError && <p role="alert">{saveError}</p>}
    {materialDraft && <MaterialForm draft={materialDraft} change={setMaterialDraft} cancel={cancel} save={save} busy={busy}/>}
    {movementDraft && <MovementForm draft={movementDraft} materials={materials} change={setMovementDraft} cancel={cancel} save={save} busy={busy}/>}
    {movements ? <>
      <div className="stock-filters">
        <Field label="Material"><select aria-label="Filtrar por material" value={materialFilter} onChange={e => { setMaterialFilter(e.target.value); setOffset(0) }}><option value="">Todos</option>{materials.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></Field>
        <Field label="Tipo"><select aria-label="Filtrar por tipo" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setOffset(0) }}><option value="">Todos</option><TypeOptions/></select></Field>
        <Field label="De"><input type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0) }}/></Field>
        <Field label="Até"><input type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0) }}/></Field>
        <button type="button" aria-pressed={reorder} onClick={() => setReorder(value => !value)}>Necessidade de reposição</button>
      </div>
      {reorder && <section aria-label="Materiais para reposição">
        <h2>Materiais para reposição</h2>
        {materials.some(item => item.reorder) ? <ul>{materials.filter(item => item.reorder).map(item => <li key={item.id}>
          {item.code} · {item.name} · Saldo {decimal(item.balance)} {item.unit} · Mínimo {decimal(item.minimum)} {item.unit}
          <button type="button" onClick={() => openMovement(item)} disabled={busy}>Registrar entrada</button>
        </li>)}</ul> : <p>Nenhum material abaixo do mínimo.</p>}
      </section>}
      {historyError ? <p role="alert">{historyError}</p> : loadingMovements ? <p role="status">Carregando movimentações…</p> : <>
        <MovementsTable rows={page.items}/>
        {(offset > 0 || page.nextOffset !== null) && <div className="stock-actions" aria-label="Paginação de movimentações">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(offset - 100)}>Anterior</button>
          <span>Página {offset / 100 + 1}</span>
          <button type="button" disabled={page.nextOffset === null} onClick={() => { if (page.nextOffset !== null) setOffset(page.nextOffset) }}>Próxima</button>
        </div>}
      </>}
    </> : <>
      <div className="stock-filters">
        <Field label="Buscar materiais"><input type="search" value={search} onChange={e => setSearch(e.target.value)}/></Field>
        <Field label="Situação"><select aria-label="Situação" value={availability} onChange={e => setAvailability(e.target.value)}>
          <option value="">Todas</option><option value="released">Liberado</option><option value="unreleased">Não liberado</option>
        </select></Field>
        <label className="stock-check"><input type="checkbox" checked={reorder} onChange={e => setReorder(e.target.checked)}/> Abaixo do estoque mínimo</label>
      </div>
      {!loadError && (loading ? <p role="status">Carregando materiais…</p> : <MaterialsTable items={visible} edit={openMaterial} move={openMovement}/>)}
    </>}
  </section>
}
