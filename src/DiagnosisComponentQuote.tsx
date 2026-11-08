import {useEffect,useRef,useState} from 'react'
import {ApprovedIcon} from './ApprovedIcon'
import {api} from './api'
import type {Atendimento} from '../shared/contracts'
import {manualComponentSearchLinks} from './diagnosis-search-links'

// A link launcher only: no OpenAI, no quote API, no price selection or writes.
export function DiagnosisComponentQuote({atendimentoId,componentName,selected,enabled}:{atendimentoId:string;componentName:string;selected:boolean;enabled:boolean}){
 const [links,setLinks]=useState<ReturnType<typeof manualComponentSearchLinks>|null>(null)
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState('')
 const epoch=useRef(0)
 useEffect(()=>{epoch.current++;setOpen(false);setLinks(null);setMessage('');setLoading(false)},[atendimentoId,componentName,selected])
 useEffect(()=>()=>{epoch.current++},[])
 async function reveal(){
  if(!selected||!enabled||loading)return
  if(open){setOpen(false);return}
  const version=++epoch.current
  setLoading(true);setMessage('')
  try{
   const vehicle=await api<Atendimento>('/api/atendimentos/'+encodeURIComponent(atendimentoId))
   if(version!==epoch.current)return
   const next=manualComponentSearchLinks(vehicle,componentName)
   setLinks(next);setOpen(true)
   if(!next)setMessage('Informe montadora, modelo e descrição técnica da peça para pesquisar.')
  }catch{
   if(version===epoch.current){setOpen(false);setMessage('Não foi possível consultar os dados do veículo.')}
  }finally{if(version===epoch.current)setLoading(false)}
 }
 const choices=links?[{key:'general',label:'Geral',url:links.general},{key:'original',label:'Original',url:links.original},{key:'official',label:'Loja oficial',url:links.official}]:[]
 return <>
  <button type="button" className="diagnosis-quote-button" aria-label="Pesquisar componente" aria-expanded={selected&&open} title={selected?'Abrir opções de pesquisa sem custo':'Selecione o componente para pesquisar'} disabled={!selected||!enabled||loading} onClick={()=>void reveal()}><ApprovedIcon name="receipt-text"/></button>
  {selected&&open&&<div className="diagnosis-quote-options" role="group" aria-label="Pesquisar componente em lojas">
   {links&&<div className="diagnosis-quote-prices">
    {choices.map(c=><span className="diagnosis-quote-option" key={c.key}>{c.url?
     <a href={c.url} target="_blank" rel="noopener noreferrer" aria-label={'Pesquisar '+c.label+' em nova aba'}>{c.label}</a>:
     <span className="diagnosis-quote-unavailable" aria-label="Loja oficial não cadastrada" title="Loja oficial não cadastrada">{c.label}</span>}</span>)}
   </div>}
   {message&&<span role="status" className="diagnosis-quote-status">{message}</span>}
  </div>}
  {selected&&message&&!open&&<span className="sr-only" role="status">{message}</span>}
 </>
}
