import {useEffect,useId,useRef,useState} from 'react'
import type {CatalogItem} from '../shared/commercial'

const plain=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()
const label=(item:CatalogItem)=>item.name.replace(/\s*·\s*/g,' ')

/** Search is only a filter. The selected value always comes from a catalog ID. */
export function PieceSearchPicker({value,items,unavailableIds,disabled,onSelect}:{
 value:string;items:CatalogItem[];unavailableIds:Set<string>;disabled:boolean;onSelect:(pieceId:string)=>void
}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0)
 const root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),listId=useId()
 const current=items.find(item=>item.id===value)
 const available=items.filter(item=>item.id===value||!unavailableIds.has(item.id)).sort((a,b)=>label(a).localeCompare(label(b),'pt-BR'))
 const matches=available.filter(item=>plain(label(item)).includes(plain(query)))
 const selectedName=current?label(current):'Selecionar peça'
 const show=()=>{if(disabled)return;setQuery('');setActive(0);setOpen(true)}
 const close=()=>{setOpen(false);setQuery('');setActive(0)}
 const choose=(pieceId:string)=>{
  if(disabled||!available.some(item=>item.id===pieceId))return
  close()
  if(pieceId!==value)onSelect(pieceId)
 }
 useEffect(()=>{if(open&&!disabled)input.current?.focus()},[open,disabled])
 useEffect(()=>{if(disabled&&open)close()},[disabled,open])
 useEffect(()=>{
  if(!open)return
  const outside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))close()}
  document.addEventListener('pointerdown',outside)
  return()=>document.removeEventListener('pointerdown',outside)
 },[open])
 return <div className="piece-name piece-search-picker" ref={root}>
  {!open?<button type="button" className="piece-search-trigger" aria-label={'Peça: '+selectedName} aria-haspopup="listbox" aria-expanded={false} onClick={show} disabled={disabled}><span>{selectedName}</span><span className="piece-chevron" aria-hidden="true">⌄</span></button>:
   <div className="piece-search-open">
    <div className="piece-search-field">
     <input ref={input} type="search" role="combobox" aria-label="Pesquisar peça" aria-autocomplete="list" aria-expanded={true} aria-controls={listId} aria-activedescendant={matches.length?listId+'-option-'+Math.min(active,matches.length-1):undefined} value={query} placeholder="Pesquisar peça…" autoComplete="off" onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();close()}
      else if(e.key==='ArrowDown'){e.preventDefault();setActive(n=>Math.min(n+1,matches.length-1))}
      else if(e.key==='ArrowUp'){e.preventDefault();setActive(n=>Math.max(n-1,0))}
      else if(e.key==='Enter'){e.preventDefault();if(matches.length)choose(matches[Math.min(active,matches.length-1)]!.id)}
      else if(e.key==='Tab')close()
     }}/>
     <button type="button" className="piece-search-close" aria-label="Fechar pesquisa" onClick={close}>×</button>
    </div>
    <div id={listId} className="piece-search-options" role="listbox" aria-label="Peças existentes">
     {!matches.length?<p className="piece-search-empty">Nenhuma peça encontrada</p>:matches.map((item,index)=>
      <button type="button" id={listId+'-option-'+index} key={item.id} role="option" aria-selected={item.id===value} data-active={index===active} className="piece-search-option" onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(item.id)}>{label(item)}</button>)}
    </div>
   </div>}
 </div>
}
