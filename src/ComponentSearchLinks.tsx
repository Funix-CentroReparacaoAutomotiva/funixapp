import {useEffect,useState} from 'react'
import {api} from './api'
import type {Atendimento} from '../shared/contracts'
import {manualComponentSearchLinks, type ComponentSearchContext} from './diagnosis-search-links'
import './component-search-links.css'

// Display-only navigation. No automatic external searches, quote API or price mutations.
export function ComponentSearchLinks({atendimentoId,componentName,context,className=''}:{atendimentoId:string;componentName:string;context:ComponentSearchContext;className?:string}){
 const [state,setState]=useState<{links:ReturnType<typeof manualComponentSearchLinks>;error:string}>({links:null,error:''})
 useEffect(()=>{
  let active=true
  setState({links:null,error:''})
  void api<Atendimento>('/api/atendimentos/'+encodeURIComponent(atendimentoId))
   .then(vehicle=>{if(active)setState({links:manualComponentSearchLinks(vehicle,componentName,context),error:''})})
   .catch(()=>{if(active)setState({links:null,error:'Não foi possível consultar o veículo.'})})
  return()=>{active=false}
 },[atendimentoId,componentName,context.pieceName,context.position])
 const options=[
  {key:'general',label:'Geral',url:state.links?.general??null},
  {key:'original',label:'Original',url:state.links?.original??null},
  {key:'official',label:'Oficial',url:state.links?.official??null},
  ...(state.links?.montadora?[{key:'montadora',label:'Montadora',url:state.links.montadora}]:[])
 ]
 return <div className={'component-search-links '+className} role="group" aria-label="Pesquisar preços do componente em sites externos">
  <div className="component-search-links-grid">{options.map(option=><span key={option.key} className="component-search-link-cell">{option.url?
   <a href={option.url} target="_blank" rel="noopener noreferrer" aria-label={'Pesquisar '+option.label+' em nova aba'}>{option.label}</a>:
   <span className="component-search-link-disabled" aria-label={option.key==='official'?'Loja oficial não cadastrada':'Pesquisa indisponível'} title={option.key==='official'?'Loja oficial não cadastrada':'Dados técnicos indisponíveis'}>{option.label}</span>}</span>)}</div>
  {state.error&&<span role="status" className="component-search-link-status">{state.error}</span>}
 </div>
}
