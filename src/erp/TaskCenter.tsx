import { useEffect, useState } from 'react'
import type { Task } from '../../shared/erp-tasks'
import { api } from '../api'
import Tasks, { newTask, saveTask, TaskEditor } from './Tasks'
import { WorkspaceDialog, WorkspaceIcon } from './Navigation'

const pendingTask = (task: Task) => task.status !== 'done' && task.status !== 'approved'
const highPriority = (task: Task) => /^(alt[ao]|urgent[ea]|crític[ao]|imediat[ao]|p0|p1)$/i.test(task.priority.trim())

export function TaskCenter({ recordId, openRecord }: { recordId?: string; openRecord: (id: string) => boolean }) {
  const [items, setItems] = useState<Task[] | null>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('rapida')
  const [editing, setEditing] = useState<Task | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [request, setRequest] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api<{ items: Task[] }>('/api/erp/tasks/items', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setItems(data.items); setError('') } })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message) })
    return () => controller.abort()
  }, [request])
  useEffect(() => {
    const refresh = () => setRequest(value => value + 1)
    window.addEventListener('funix:task-saved', refresh)
    return () => window.removeEventListener('funix:task-saved', refresh)
  }, [])

  const pending = items?.filter(pendingTask) ?? []
  const priority = pending.filter(highPriority).length
  async function complete(task: Task) {
    if (busy) return
    setBusy(task.id)
    setError('')
    try { await saveTask({ ...task, status: 'done' }) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy('') }
  }
  function close() {
    setOpen(false)
    setEditing(null)
  }

  return <>
    <button className="workspace-icon workspace-task-button" type="button" aria-haspopup="dialog"
      aria-label={items && !error ? `Central de tarefas · ${priority} prioritárias pendentes` : 'Central de tarefas'}
      onClick={() => { setView('rapida'); setRequest(value => value + 1); setOpen(true) }}>
      <WorkspaceIcon name="tarefas" />{items && !error && priority > 0 && <span className="workspace-task-count" aria-hidden="true">{priority}</span>}
    </button>
    {open && <WorkspaceDialog className="workspace-task-dialog" label="Central de tarefas" close={close}>
      <div className="workspace-dialog-heading"><h2>Central de tarefas</h2>
        <button className="workspace-icon" aria-label="Fechar central" onClick={close}><WorkspaceIcon name="close" /></button></div>
      <div className="workspace-task-links" role="group" aria-label="Visões de tarefas">
        {[['rapida', 'Pendentes'], ['painel', 'Painel'], ['catalogo', 'Catálogo']].map(([id, title]) =>
          <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{title}</button>)}
      </div>
      {view === 'rapida' ? <>
        <button className="primary-btn" onClick={() => setEditing(newTask())}>Nova tarefa</button>
        {error && <p role="alert">{error} <button onClick={() => setRequest(value => value + 1)}>Atualizar</button></p>}
        {!items && !error && <p role="status">Carregando tarefas…</p>}
        {items && !pending.length && <p>Nenhuma tarefa pendente.</p>}
        <ul className="workspace-task-list">{[...pending].sort((a, b) => Number(highPriority(b)) - Number(highPriority(a))).map(task =>
          <li key={task.id}><div><button className="workspace-task-record" type="button" onClick={() => setEditing(task)}>{task.title}</button>
            {(task.priority || task.owner) && <small>{[task.priority, task.owner].filter(Boolean).join(' · ')}</small>}
            {task.atendimentoId && <button className="workspace-task-record" type="button" onClick={() => {
              if (task.atendimentoId && openRecord(task.atendimentoId)) close()
            }}>Abrir Atendimento vinculado</button>}
          </div>
          <button type="button" disabled={Boolean(busy)} aria-label={`Concluir ${task.title}`} onClick={() => void complete(task)}>
            {busy === task.id ? 'Salvando…' : 'Concluir'}
          </button></li>)}</ul>
      </> : <Tasks key={view} view={view} recordId={recordId} />}
      {editing && <TaskEditor initial={editing} quick={!editing.revision} recordId={recordId} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
    </WorkspaceDialog>}
  </>
}
