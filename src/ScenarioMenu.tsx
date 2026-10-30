import {useEffect,useRef,useState} from 'react'
import type {Scenario} from '../shared/commercial'
import {scenarioLabel} from '../shared/commercial'

export function ScenarioMenu({scenarios,selected,busy,comparing,onSelect,onAdd,onDelete,onCompare,onArchive,onDeletePiece}:{
 scenarios:Scenario[];selected:string;busy:boolean;comparing:boolean
 onSelect:(id:string)=>Promise<boolean>;onAdd:()=>Promise<boolean>;onDelete:(s:Scenario)=>Promise<boolean>;onCompare:()=>boolean;onArchive?:()=>void;onDeletePiece?:()=>void
}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null)
 const active=scenarios.find(s=>s.id===selected)
 useEffect(()=>{
  if(!open)return
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)}
  document.addEventListener('pointerdown',outside)
  root.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus()
  return()=>document.removeEventListener('pointerdown',outside)
 },[open])
 function close(){setOpen(false);trigger.current?.focus()}
 return <div className="scenario-menu" ref={root} onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();close();return}
  if(!open || !['ArrowDown','ArrowUp','Home','End'].includes(e.key))return
  e.preventDefault();const buttons=[...root.current!.querySelectorAll<HTMLButtonElement>('[role=menu] button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length
  buttons[next]?.focus()
 }}>
  <button ref={trigger} className="scenario-trigger" disabled={busy || !active} aria-label={active?`Cenários: ${scenarioLabel(active)}`:'Cenários indisponíveis'} title={active?`Cenários: ${scenarioLabel(active)}`:'Cenários indisponíveis'} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m3 7 9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5"/></svg><span>{active?.position??'—'}</span></button>
  {open&&<div className="scenario-dropdown" role="menu" aria-label="Cenários do Atendimento">{scenarios.map(s=><div className="scenario-menu-row" key={s.id} role="none"><button role="menuitemradio" aria-checked={s.id===selected} disabled={busy} onClick={async()=>{if(await onSelect(s.id))close()}} aria-label={scenarioLabel(s)} title={scenarioLabel(s)}>{s.position}{s.id===selected&&<span aria-hidden="true">✓</span>}</button><button className="scenario-delete" aria-label={`Excluir ${scenarioLabel(s)}`} disabled={busy||scenarios.length===1} title={scenarios.length===1?'Não é possível excluir o último cenário':'Excluir somente este cenário'} onClick={async()=>{if(await onDelete(s))close()}}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg></button></div>)}<button role="menuitem" disabled={busy} aria-label="+ Nova variação" title="Nova variação: copiar inclusões do cenário ativo" onClick={async()=>{if(await onAdd())close()}}>+</button><button role="menuitem" disabled={busy} aria-pressed={comparing} aria-label="Comparação" title="Comparação de cenários" onClick={()=>{if(onCompare())close()}}><svg className="scenario-matrix-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 5h18v14H3zM9 5v14M15 5v14M3 10h18"/></svg></button>{onDeletePiece&&<button role="menuitem" disabled={busy} onClick={()=>{onDeletePiece();close()}}>Excluir peça de todos os cenários</button>}{onArchive&&<button role="menuitem" disabled={busy} onClick={()=>{onArchive();close()}}>Orçamentos emitidos</button>}</div>}
 </div>
}
