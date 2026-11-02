import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// Native dialog provides keyboard containment, Escape and focus restoration.
// This is a visual selector only; all writes remain in CommercialPanel.
export function PieceDialog({ children, busy, onClose, returnFocus, closeOutsideDisk = false }: {
  children: ReactNode; busy: boolean; onClose: () => void; returnFocus: () => void; closeOutsideDisk?: boolean
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
      if (busy) return
      const target = event.target
      if (closeOutsideDisk) {
        if (target instanceof Element && target.closest('.map-quick-shade,.disc-node,.disc-center,.disc-more,.disc-back,.form-error,.fh-filter,details')) return
        const disc = event.currentTarget.querySelector('.disc-wrap')?.getBoundingClientRect()
        if (!disc) return
        const dx = event.clientX - disc.left - disc.width / 2
        const dy = event.clientY - disc.top - disc.height / 2
        if (Math.hypot(dx, dy) > Math.min(disc.width, disc.height) / 2) onClose()
        return
      }
      if (target !== event.currentTarget) return
      const box = event.currentTarget.getBoundingClientRect()
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
    }}>
    {children}
  </dialog>
}
