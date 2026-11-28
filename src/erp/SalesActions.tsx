import { useRef, useState } from 'react'
import { WorkspaceIcon } from './Navigation'

export function SalesActions({term,searchEnabled,onAdd,onSearch}:{term:string;searchEnabled:boolean;onAdd:()=>void;onSearch:(value:string)=>void}) {
  const [expanded,setExpanded]=useState(false)
  const [draft,setDraft]=useState(term)
  const toggle=useRef<HTMLButtonElement>(null)

  function close() {
    setExpanded(false)
    requestAnimationFrame(()=>toggle.current?.focus())
  }

  return <div className="workspace-sales-actions">
    <button className="workspace-new-atendimento" type="button" aria-label="+ Novo Atendimento"
      title="Novo Atendimento" onClick={onAdd}><WorkspaceIcon name="plus"/></button>
    {searchEnabled&&(expanded?<form className="workspace-search-pill" role="search" aria-label="Busca de Vendas"
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close()}}}
      onSubmit={event=>{event.preventDefault();onSearch(draft.trim());close()}}>
      <button className="workspace-search-close" type="button" aria-label="Fechar busca" onClick={close}><WorkspaceIcon name="close"/></button>
      <input type="search" aria-label="Pesquisar em Vendas" maxLength={150} value={draft} autoFocus autoComplete="off"
        placeholder="Cliente, placa ou modelo" onChange={event=>setDraft(event.target.value)}/>
      <button type="submit" aria-label="Buscar" title="Buscar"><WorkspaceIcon name="search"/></button>
    </form>:<div className="workspace-sales-search-trigger">
      <button ref={toggle} className={term?'workspace-search-term':'workspace-search-toggle'} type="button"
        aria-label={term?'Editar busca: '+term:'Abrir busca de Vendas'}
        onClick={()=>{setDraft(term);setExpanded(true)}}>
        {term?<span>{term}</span>:<WorkspaceIcon name="search"/>}
      </button>
      {term&&<button type="button" className="workspace-search-clear" title="Limpar busca" aria-label="Limpar busca"
        onClick={()=>{onSearch('');toggle.current?.focus()}}><WorkspaceIcon name="close"/></button>}
    </div>)}
  </div>
}
