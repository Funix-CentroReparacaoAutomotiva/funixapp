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
  desempenho: 'M4 19h16M6 15V9m6 6V5m6 10v-4',
  funil: 'M3 5h18l-7 8v5l-4 2v-7z',
  acompanhamento: 'M5 17v2m14-2v2M3 12l2-6h14l2 6v5H3zm0 0h18M6 15h2m8 0h2',
  conversas: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.5-4A8.5 8.5 0 1 1 21 11.5zM8 11h8m-8 4h5',
  conta: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 8a8 8 0 0 1 16 0z',
  sair: 'M10 4H4v16h6m4-12 4 4-4 4m-6-4h10',
  plus: 'M12 5v14M5 12h14',
  calendar: 'M5 5h14v15H5zM8 3v5m8-5v5M5 10h14',
  filter: 'M4 6h16M7 12h10m-7 6h4',
  search: 'M15 15l5 5M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  document: 'M6 3h9l3 3v15H6zM10 10h4m-4 4h4m-4 4h4',
  board: 'M4 5h16v14H4zm5 0v14m6-14v14',
  table: 'M4 5h16v14H4zm0 5h16M4 15h16m-8-5v9',
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
export function WorkspaceSidebar({ module, collapsed, toggle, navigate, onAccount, children }: Omit<Navigation, 'path'> & {
  collapsed: boolean; toggle: () => void; onAccount: () => void; children: ReactNode
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
    <button className="workspace-sidebar-account" type="button" aria-label="Minha conta" title="Minha conta"
      aria-haspopup="dialog" onClick={onAccount}><WorkspaceIcon name="conta" />{!collapsed && <span>Minha conta</span>}</button>
  </aside>
}

export function WorkspacePages({ module, path, navigate }: Navigation) {
  function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (path !== href) navigate(href)
  }
  const salesIcons = { '/vendas/desempenho': 'desempenho', '/vendas/funil': 'funil',
    '/vendas/acompanhamento': 'acompanhamento', '/conversas': 'conversas' } as const
  return <nav className={`workspace-pages ${module.id === 'vendas' ? 'workspace-sales-pages' : ''}`} aria-label={`Páginas de ${module.label}`}>
    {module.links.map(([href, title]) => <a key={href} href={href}
      aria-current={selectedPage(path) === href ? 'page' : undefined}
      onClick={event => follow(event, href)}>{href in salesIcons && <WorkspaceIcon name={salesIcons[href as keyof typeof salesIcons]} />}<span>{title}</span></a>)}
  </nav>
}

export function WorkspacePicker({ module, navigate, close, onAccount }: Omit<Navigation, 'path'> & { close: () => void; onAccount: () => void }) {
  return <WorkspaceDialog label="Selecionar módulo" close={close} className="workspace-picker">
    <div className="workspace-dialog-heading"><h2>Módulos</h2>
      <button className="workspace-icon" aria-label="Fechar seletor" onClick={close}><WorkspaceIcon name="close" /></button></div>
    <div className="workspace-mosaic">{modules.map(item => <button key={item.id} type="button"
      aria-pressed={item.id === module.id}
      onClick={() => { if (item.id === module.id || navigate(preferredPage(item))) close() }}>
      <WorkspaceIcon name={item.icon} /><span>{item.label}</span>
    </button>)}</div>
    <button className="workspace-account-exit workspace-picker-account" type="button" aria-haspopup="dialog"
      onClick={onAccount}><WorkspaceIcon name="conta" />Minha conta</button>
  </WorkspaceDialog>
}
