import type { MouseEvent } from 'react'
import { erpSections } from './navigation'
import './navigation.css'

export function ErpNavigation({ path, navigate }: { path: string; navigate: (href: string) => boolean }) {
  function open(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (navigate(href)) event.currentTarget.closest('details')?.removeAttribute('open')
  }
  return <nav className="erp-navigation" aria-label="Operação FUNIX">
    {erpSections.map(section => {
      const active = section.links.some(([href]) => href === path)
      if (section.links.length === 1) {
        const [href, label] = section.links[0]
        return <a key={href} href={href} aria-current={active ? 'page' : undefined} onClick={event => open(event, href)}>{label === 'Histórico de experiências' ? section.label : label}</a>
      }
      return <details key={section.label}>
        <summary data-current={active}>{section.label}</summary>
        <div>{section.links.map(([href, label]) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined} onClick={event => open(event, href)}>{label}</a>)}</div>
      </details>
    })}
  </nav>
}
