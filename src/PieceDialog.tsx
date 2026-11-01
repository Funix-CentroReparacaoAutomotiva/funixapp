import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// Native dialog provides keyboard containment, Escape and focus restoration.
// This is a visual selector only; all writes remain in CommercialPanel.
export function PieceDialog({ children, busy, onClose, returnFocus }: {
  children: ReactNode; busy: boolean; onClose: () => void; returnFocus: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => { dialog.close(); returnFocus() }
  }, [returnFocus])
  return <dialog ref={ref} className="map-piece-dialog canonical-map" aria-label="Selecionar peça no mapa"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary')].filter(node => node.getClientRects().length > 0)
      const next = event.shiftKey ? controls.at(-1) : controls[0]
      if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
        event.preventDefault(); next?.focus()
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return
      const box = event.currentTarget.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
    }}>
    {children}
  </dialog>
}
