import { useLayoutEffect, useRef, useState } from 'react'
import type { Scenario } from '../shared/commercial'
import { scenarioLabel } from '../shared/commercial'

export function ScenarioTabs({ scenarios, selected, busy, comparing, onSelect, onAdd, onCompare }: {
  scenarios: Scenario[]; selected: string; busy: boolean; comparing: boolean
  onSelect: (id: string) => Promise<void>; onAdd: () => Promise<void>; onCompare: () => void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  useLayoutEffect(() => {
    const node = strip.current!
    const measure = () => setEdges({ left: node.scrollLeft > 1, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 })
    const observer = new ResizeObserver(measure)
    observer.observe(node); node.addEventListener('scroll', measure); measure()
    return () => { observer.disconnect(); node.removeEventListener('scroll', measure) }
  }, [scenarios.length])
  useLayoutEffect(() => {
    const node = strip.current!, active = node.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!active) return
    if (active.offsetLeft < node.scrollLeft) node.scrollLeft = active.offsetLeft
    else if (active.offsetLeft + active.offsetWidth > node.scrollLeft + node.clientWidth) node.scrollLeft = active.offsetLeft + active.offsetWidth - node.clientWidth
  }, [selected, scenarios.length])
  async function focusAfter(action: () => Promise<void>) {
    await action()
    requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true }))
  }
  return <section className="scenario-controls" aria-label="Cenários" title="A composição e os atributos são compartilhados. Cada cenário tem sua própria inclusão de itens.">
    <button className="scenario-arrow" type="button" aria-label="Cenários anteriores" disabled={busy || !edges.left} onClick={() => strip.current?.scrollBy({ left: -Math.max(36, strip.current.clientWidth - 36) })}>‹</button>
    <div className="scenario-tabs" ref={strip} role="tablist" aria-label="Selecionar cenário" onKeyDown={event => {
      const index = scenarios.findIndex(s => s.id === selected)
      const next = event.key === 'ArrowRight' ? Math.min(index + 1, scenarios.length - 1) : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? scenarios.length - 1 : -1
      if (next < 0) return
      event.preventDefault(); if (!busy) void focusAfter(() => onSelect(scenarios[next].id))
    }}>{scenarios.map(s => <button type="button" key={s.id} role="tab" aria-label={scenarioLabel(s)} aria-selected={s.id === selected} tabIndex={s.id === selected ? 0 : -1} disabled={busy} onClick={() => void focusAfter(() => onSelect(s.id))}>{s.position}</button>)}</div>
    <button className="scenario-arrow" type="button" aria-label="Próximos cenários" disabled={busy || !edges.right} onClick={() => strip.current?.scrollBy({ left: Math.max(36, strip.current.clientWidth - 36) })}>›</button>
    <button className="scenario-action" type="button" aria-label="Adicionar variação do cenário ativo" title="Criar variação copiando as inclusões do cenário ativo" disabled={busy} onClick={() => void focusAfter(onAdd)}>+</button>
    <button className="scenario-action" type="button" aria-label="Comparação" title="Comparação" aria-pressed={comparing} disabled={busy} onClick={onCompare}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 5h18v14H3zM9 5v14M15 5v14M3 10h18" /></svg></button>
  </section>
}
