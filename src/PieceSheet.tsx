import{useEffect,useRef}from'react'
import type{ReactNode}from'react'
import './piece-sheet.css'
// Selection state and writes stay in CommercialPanel/the audited queue.
export function PieceSheet({children,busy,onClose,returnFocus}:{children:ReactNode;busy:boolean;onClose:()=>void;returnFocus:()=>void}){
 const ref=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const d=ref.current!;d.showModal();d.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});return()=>{d.close();returnFocus()}},[returnFocus])
 return <dialog ref={ref} className="piece-sheet" aria-label="Adicionar peça à composição" onCancel={e=>{e.preventDefault();if(!busy)onClose()}} onClick={e=>{if(e.target!==e.currentTarget||busy)return;const b=e.currentTarget.getBoundingClientRect();if(e.clientY<b.top||e.clientY>b.bottom||e.clientX<b.left||e.clientX>b.right)onClose()}} onKeyDown={e=>{
  if(e.key!=='Tab')return
  const nodes=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(n=>n.getClientRects().length)
  if(document.activeElement===(e.shiftKey?nodes[0]:nodes.at(-1))){e.preventDefault();(e.shiftKey?nodes.at(-1):nodes[0])?.focus()}
 }}><header><h2>Adicionar peça</h2><button type="button" aria-label="Fechar seleção" disabled={busy} onClick={onClose}>×</button></header><div className="piece-sheet-body">{children}</div></dialog>
}
