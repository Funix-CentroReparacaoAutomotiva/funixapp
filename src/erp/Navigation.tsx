import { useEffect, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { modules, preferredPage, selectedPage } from './navigation'
import type { Workspace } from './navigation'
import './navigation.css'

const icons = {
  vendas: 'M4 18V6m0 12h16M7 14l4-4 4 2 5-6m-4 0h4v4',
  oficina: 'M14 7l3 3 4-4a6 6 0 0 1-7 8l-6 6a2 2 0 0 1-3-3l6-6a6 6 0 0 1 8-7z',
  estoque: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4m-8 4v10M8 5l8 4',
  financeiro: 'M4 6h16v12H4zM4 10c2 0 4-2 4-4m12 4c-2 0-4-2-4-4M4 14c2 0 4 2 4 4m12-4c-2 0-4 2-4 4M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  biblioteca: 'M4 5h4v14H4zm7 0h4v14h-4zm7 0 3 13-3 1-3-13',
  gestao: 'M5 5v14m7-14v14m7-14v14M3 9h4m3 6h4m3-5h4',
  tarefas: 'M8 5h-3v15h14V5h-3M9 4h6v3H9zm0 9 2 2 4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  collapse: 'M4 4h16v16H4zm6 0v16',
  close: 'M6 6l12 12M18 6 6 18',
}

export function WorkspaceIcon({ name }: { name: keyof typeof icons }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>
}

export function WorkspaceDialog({ label, className, close, children }: { label: string; className: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog className={className} aria-label={label} ref={ref}
    onCancel={event => { event.preventDefault(); close() }}>{children}</dialog>
}

type Navigation = { module: Workspace; path: string; navigate: (href: string) => boolean }
export function WorkspaceSidebar({ module, collapsed, toggle, navigate, children }: Omit<Navigation, 'path'> & {
  collapsed: boolean; toggle: () => void; children: ReactNode
}) {
  return <aside className="workspace-sidebar">
    <div className="workspace-sidebar-heading">
      {!collapsed && <strong>FUNIX</strong>}
      <button className="workspace-icon" type="button" aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
        aria-expanded={!collapsed} onClick={toggle}><WorkspaceIcon name="collapse" /></button>
    </div>
    {!collapsed && <label className="workspace-select">Módulo
      <select aria-label="Módulo" value={module.id} onChange={event => {
        const target = modules.find(item => item.id === event.target.value)
        if (target) navigate(preferredPage(target))
      }}>{modules.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    </label>}
    {children}
  </aside>
}

export function WorkspacePages({ module, path, navigate }: Navigation) {
  function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (path !== href) navigate(href)
  }
  return <nav className="workspace-pages" aria-label={`Páginas de ${module.label}`}>
    {module.links.map(([href, title]) => <a key={href} href={href}
      aria-current={selectedPage(path) === href ? 'page' : undefined}
      onClick={event => follow(event, href)}>{title}</a>)}
  </nav>
}

export function WorkspacePicker({ module, navigate, close }: Omit<Navigation, 'path'> & { close: () => void }) {
  return <WorkspaceDialog label="Selecionar módulo" close={close} className="workspace-picker">
    <div className="workspace-dialog-heading"><h2>Módulos</h2>
      <button className="workspace-icon" aria-label="Fechar seletor" onClick={close}><WorkspaceIcon name="close" /></button></div>
    <div className="workspace-mosaic">{modules.map(item => <button key={item.id} type="button"
      aria-pressed={item.id === module.id}
      onClick={() => { if (item.id === module.id || navigate(preferredPage(item))) close() }}>
      <WorkspaceIcon name={item.icon} /><span>{item.label}</span>
    </button>)}</div>
  </WorkspaceDialog>
}
