import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { taskRiceScales, taskStatuses } from '../../shared/erp-tasks'
import type { Task, TaskFields, TaskStatus } from '../../shared/erp-tasks'
import { api } from '../api'
import { money } from '../money'
import { Notice } from '../ui'
import './tasks.css'

const statuses = Object.entries(taskStatuses) as [TaskStatus, string][]
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent' })
const labels = {
  owner: 'Responsável', sector: 'Setor', status: 'Situação', priority: 'Prioridade',
} as const

const catalogColumns: { key: keyof Task; label: string; render?: (task: Task) => string }[] = [
  { key: 'title', label: 'Tarefa' },
  { key: 'owner', label: 'Dono' },
  { key: 'sector', label: 'Setor' },
  { key: 'investment', label: 'Investimento', render: task => task.investment ? money(task.investment) : '—' },
  { key: 'reach', label: 'Alcance' },
  { key: 'impact', label: 'Impacto', render: task => task.impact ? number.format(Number(task.impact)) : '—' },
  { key: 'confidence', label: 'Confiança', render: task => task.confidence ? percent.format(Number(task.confidence)) : '—' },
  { key: 'effort', label: 'Esforço' },
  { key: 'rice', label: 'RICE', render: task => task.rice === null ? '—' : number.format(Number(task.rice)) },
  { key: 'status', label: 'Situação', render: task => taskStatuses[task.status] },
  { key: 'priority', label: 'Prioridade' },
  { key: 'position', label: 'Ordem' },
  { key: 'dueDate', label: 'Prazo', render: task => task.dueDate ? task.dueDate.split('-').reverse().join('/') : '—' },
]

function newTask(): Task {
  return {
    id: crypto.randomUUID(), revision: 0, rice: null, title: '', owner: '', sector: '', work: '',
    addedValue: '', investment: '', reach: '', impact: '', confidence: '', effort: '', status: 'not-started',
    priority: '', position: '', dueDate: '', description: '',
  }
}

const editorFields: { key: keyof TaskFields; label: string; max?: number; inputMode?: 'decimal' | 'numeric'; type?: 'date' }[] = [
  { key: 'title', label: 'Tarefa', max: 250 },
  { key: 'owner', label: 'Dono / responsável', max: 160 },
  { key: 'sector', label: 'Setor', max: 160 },
  { key: 'work', label: 'Trabalho', max: 160 },
  { key: 'addedValue', label: 'Valor agregado', max: 500 },
  { key: 'investment', label: 'Investimento (R$)', inputMode: 'decimal', max: 15 },
  { key: 'effort', label: 'Esforço', inputMode: 'decimal', max: 19 },
  { key: 'priority', label: 'Prioridade', max: 80 },
  { key: 'position', label: 'Ordem da prioridade', inputMode: 'numeric', max: 6 },
  { key: 'dueDate', label: 'Prazo', type: 'date' },
]

function TaskEditor({ initial, onClose, onSaved }: { initial: Task; onClose: () => void; onSaved: (task: Task) => void }) {
  const [draft, setDraft] = useState(initial)
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function update(key: keyof TaskFields, value: string) {
    setDraft(previous => ({ ...previous, [key]: value }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setFailure('')
    setBusy(true)
    try {
      const saved = await api<Task>('/api/erp/tasks/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      onSaved(saved)
    } catch (cause) {
      setFailure((cause as Error).message)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <dialog ref={dialog} className="tasks-editor" aria-labelledby="task-editor-heading" onCancel={event => {
    event.preventDefault()
    if (!pending.current) onClose()
  }}>
    <form onSubmit={save}>
      <h2 id="task-editor-heading">{initial.revision ? 'Editar tarefa' : 'Cadastrar tarefa'}</h2>
      <fieldset className="tasks-editor-fields" disabled={busy}>
        {editorFields.map(({ key, label, max, inputMode, type }) =>
          <label key={key}>{label}<input required={key === 'title'} type={type} inputMode={inputMode}
            maxLength={max} value={draft[key]} onChange={event => update(key, event.target.value)} /></label>)}
        <label>Situação<select value={draft.status} onChange={event => update('status', event.target.value)}>
          {statuses.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        {(['reach', 'impact', 'confidence'] as const).map((key, index) =>
          <label key={key}>{['Alcance', 'Impacto', 'Confiança'][index]}
            <select value={draft[key]} onChange={event => update(key, event.target.value)}>
              <option value="">A definir</option>
              {taskRiceScales[key].map(value => <option key={value} value={value}>
                {value === '100' ? 'Obrigatório (100)' : (key === 'confidence' ? percent : number).format(Number(value))}
              </option>)}
            </select>
          </label>)}
        <label className="tasks-description">Descrição<textarea maxLength={4000} rows={3} value={draft.description} onChange={event => update('description', event.target.value)} /></label>
      </fieldset>
      {failure && <p role="alert" className="form-error">{failure}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="primary-btn" disabled={busy}>{busy ? 'Salvando…' : 'Salvar tarefa'}</button></footer>
    </form>
  </dialog>
}

export default function Tasks({ view }: { view: string }) {
  const board = view === 'painel'
  const [sort, setSort] = useState('position')
  const [query, setQuery] = useState('')
  const [filtersRevealed, setFiltersRevealed] = useState(false)
  const [filters, setFilters] = useState({ owner: '', sector: '', status: '', priority: '' })
  const [dueBefore, setDueBefore] = useState('')
  const [dueAfter, setDueAfter] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [result, setResult] = useState<{ key: string; items: Task[]; failure: string } | null>(null)
  const [reload, setReload] = useState(0)
  const [confirmation, setConfirmation] = useState('')
  const activeSort = board ? 'position' : sort
  const requestKey = activeSort + ':' + reload
  const loading = result?.key !== requestKey
  const tasks = result?.items ?? []
  const failure = loading ? '' : result.failure

  useEffect(() => {
    const controller = new AbortController()
    api<{ items: Task[] }>('/api/erp/tasks/items?' + new URLSearchParams({ sort: activeSort }), { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ key: requestKey, items: data.items, failure: '' }) })
      .catch((error: Error) => { if (!controller.signal.aborted) setResult({ key: requestKey, items: [], failure: error.message }) })
    return () => controller.abort()
  }, [activeSort, requestKey])

  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
  const visible = tasks.filter(task => task.title.toLocaleLowerCase('pt-BR').includes(normalizedQuery) &&
    Object.entries(filters).every(([key, value]) => !value || task[key as keyof typeof filters] === value) &&
    (!dueBefore || task.dueDate && task.dueDate <= dueBefore) &&
    (!dueAfter || task.dueDate && task.dueDate >= dueAfter))

  const hasFilters = Boolean(query || dueBefore || dueAfter || Object.values(filters).some(Boolean))

  function onSaved(saved: Task) {
    setEditing(null)
    setConfirmation('Tarefa salva: ' + saved.title)
    setReload(previous => previous + 1)
  }

  return <section className="tasks-workspace">
    <header className="tasks-toolbar">
      <h1>{board ? 'Painel de tarefas' : 'Catálogo de tarefas'}</h1>
      <button className="primary-btn" onClick={() => { setConfirmation(''); setEditing(newTask()) }}>Nova tarefa</button>
    </header>
    {confirmation && <p className="tasks-confirmation" role="status">{confirmation}</p>}
    <button type="button" className="tasks-filter-toggle" aria-controls="tasks-filters" aria-expanded={filtersRevealed}
      onClick={() => setFiltersRevealed(value => !value)}>{hasFilters ? 'Filtros ativos' : 'Filtros'}{!board && ' e ordenação'}</button>
    <div id="tasks-filters" className="tasks-filters" data-expanded={filtersRevealed} aria-label="Filtros de tarefas">
      <label>Busca<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome da tarefa" /></label>
      {(Object.keys(filters) as (keyof typeof filters)[]).map(key => {
        const options = key === 'status' ? statuses : [...new Set(tasks.map(task => task[key]).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR')).map(value => [value, value])
        return <label key={key}>{labels[key]}<select value={filters[key]}
          onChange={event => setFilters({ ...filters, [key]: event.target.value })}>
          <option value="">Todos</option>{options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
      })}
      <label>Prazo a partir de<input type="date" value={dueAfter} onChange={event => setDueAfter(event.target.value)} /></label>
      <label>Prazo até<input type="date" value={dueBefore} onChange={event => setDueBefore(event.target.value)} /></label>
      {!board && <label>Ordenar por<select value={sort} onChange={event => setSort(event.target.value)}>
        <option value="position">Ordem</option><option value="priority">Nome da prioridade</option>
        <option value="rice">Maior RICE</option><option value="deadline">Prazo</option><option value="title">Nome da tarefa</option>
      </select></label>}
    </div>
    {failure ? <Notice title="Falha ao carregar tarefas" error retry={() => setReload(value => value + 1)}>{failure}</Notice>
      : loading ? <p role="status">Carregando tarefas…</p>
      : board ? <div className="tasks-board" tabIndex={0} role="region" aria-label="Quadro por situação">
        {statuses.map(([id, label]) => {
          const lane = visible.filter(task => task.status === id)
          return <section className="tasks-lane" key={id}>
            <h2>{label} <span>{lane.length}</span></h2>
            {lane.map(task => <button type="button" className="tasks-card" key={task.id} onClick={() => setEditing(task)}>
              <strong>{task.title}</strong>
              <small>{task.owner || 'Sem responsável'}{task.priority && ' · ' + task.priority}</small>
              {task.work && <span>Trabalho: {task.work}</span>}
              {task.addedValue && <span>Valor agregado: {task.addedValue}</span>}
            </button>)}
            {!lane.length && <p>Sem tarefas</p>}
          </section>
        })}
      </div>
      : visible.length ? <div className="tasks-table" tabIndex={0} role="region" aria-label="Backlog de tarefas">
        <table><thead><tr>{catalogColumns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
          <tbody>{visible.map(task => <tr key={task.id}>{catalogColumns.map(({ key, render }) => key === 'title'
            ? <th key={key} scope="row"><button type="button" onClick={() => setEditing(task)}>{task.title}</button></th>
            : <td key={key}>{render ? render(task) : task[key] || '—'}</td>)}</tr>)}</tbody></table>
      </div> : <Notice title={tasks.length ? 'Nenhuma tarefa para estes filtros' : 'Nenhuma tarefa cadastrada'} />}
    {editing && <TaskEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
  </section>
}
