import {useEffect,useState} from 'react'
import type {FormEvent} from 'react'
import {api} from '../api'
import {acquisitionLabels,acquisitionStatuses,acquisitionOrigins,custodyLabels,type AcquisitionComponent,type AcquisitionStatus} from '../../shared/acquisition'
import './acquisition.css'

const endpoint='/api/erp/acquisition'
const formatDate=(value:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(value))
const keyFor=(item:AcquisitionComponent)=>item.budgetVersionId+':'+item.lineId

export default function AcquisitionComponents({experienceId,readOnly=false,stock=false}:{experienceId?:string;readOnly?:boolean;stock?:boolean}) {
  const [items,setItems]=useState<AcquisitionComponent[]|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState(false)
  const [reload,setReload]=useState(0)
  const [edit,setEdit]=useState('')
  const [filter,setFilter]=useState('')
  const [custodyFilter,setCustodyFilter]=useState('')
  const [search,setSearch]=useState('')
  const path='/items'+(experienceId?'?'+new URLSearchParams({experienceId}):'')
  useEffect(()=>{
    const abort=new AbortController()
    setLoading(true);setError('')
    api<{items:AcquisitionComponent[]}>(endpoint+path,{signal:abort.signal})
      .then(result=>setItems(result.items)).catch(error=>{if(!abort.signal.aborted)setError(error.message)})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false)})
    return ()=>abort.abort()
  },[path,reload])

  async function update(item:AcquisitionComponent,data:Record<string,unknown>) {
    if(busy)return
    setBusy(true);setError('')
    try {
      const updated=await api<AcquisitionComponent>(endpoint+'/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        experienceId:item.experienceId,budgetVersionId:item.budgetVersionId,lineId:item.lineId,revision:item.revision,...data,
      })})
      setItems(previous=>previous?.map(row=>keyFor(row)===keyFor(updated)?updated:row)??null)
      setEdit('')
    } catch(cause) {setError((cause as Error).message)}
    finally{setBusy(false)}
  }
  function submit(event:FormEvent<HTMLFormElement>,item:AcquisitionComponent) {
    event.preventDefault()
    const data=new FormData(event.currentTarget)
    const status=data.get('status') as AcquisitionStatus
    if(status==='received'&&item.status!=='received'&&!window.confirm('Confirma a chegada física da quantidade total ('+item.quantity+') deste componente?'))return
    void update(item,{status,origin:data.get('origin')})
  }
  const normalized=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')
  const visible=items?.filter(item=>(!filter||filter===item.status)&&(!custodyFilter||custodyFilter===item.custody)&&
    (!search||normalized([item.code,item.name,item.pieceName,item.plate,item.vehicle,item.orderNumber,item.budgetNumber,item.origin].join(' ')).includes(normalized(search))))??[]
  return <section className="acquisition" aria-label={stock?'Componentes no Estoque':'Componentes da experiência'}>
    <header className="acquisition-header">
      {stock?<h1>Componentes</h1>:<h2>Componentes</h2>}
      <button type="button" onClick={()=>{setEdit('');setReload(v=>v+1)}} disabled={busy||loading}>Atualizar</button>
    </header>
    {stock&&<div className="acquisition-filters">
      <label>Buscar<input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Placa, componente ou OS"/></label>
      <label>Aquisição<select value={filter} onChange={event=>setFilter(event.target.value)}>
        <option value="">Todos</option>{acquisitionStatuses.map(status=><option key={status} value={status}>{acquisitionLabels[status]}</option>)}
      </select></label>
      <label>Situação física<select value={custodyFilter} onChange={event=>setCustodyFilter(event.target.value)}>
        <option value="">Todas</option><option value="stored">Armazenado</option><option value="out">Saiu</option>
      </select></label>
    </div>}
    {error&&<p role="alert" className="acquisition-error">{error}</p>}
    {loading&&!items&&<p role="status">Carregando componentes…</p>}
    {items&&!visible.length&&<p>Nenhum componente corresponde à consulta.</p>}
    <ul className="acquisition-list">
      {visible.map(item=><li key={keyFor(item)}>
        <div className="acquisition-row">
          <span className="acquisition-code" title={item.orderNumber?'Código na OS':'Código previsto na OS'}>{item.code}</span>
          <div className="acquisition-desc">
            <strong>{item.name}</strong>
            <small>{item.pieceName} · {item.quantity} un.</small>
            <small>{item.origin||'Origem a definir'}</small>
            <small>{item.orderNumber??item.budgetNumber}{!item.orderNumber?' · OS ainda não emitida':''}</small>
            {stock&&<small>{[item.vehicle,item.plate].filter(Boolean).join(' · ')}</small>}
            {item.cancelled&&<small>Escopo cancelado · estoque preservado</small>}
          </div>
          <div className="acquisition-state">
            <span className={'acquisition-status status-'+item.status}>{acquisitionLabels[item.status]}</span>
            <small>{formatDate(item.statusUpdatedAt)}</small>
          {stock&&item.custody&&<><span className={'acquisition-custody custody-'+item.custody}>{custodyLabels[item.custody]}</span>
              {item.custodyUpdatedAt&&<small>{formatDate(item.custodyUpdatedAt)}</small>}</>}
          </div>
        </div>
        {!readOnly&&<div className="acquisition-actions">
          {!item.cancelled&&<button type="button" disabled={busy||loading} aria-expanded={edit===keyFor(item)} onClick={()=>setEdit(current=>current===keyFor(item)?'':keyFor(item))}>Atualizar aquisição</button>}
          {item.origin&&item.status!=='received'&&<button type="button" disabled={busy||loading} onClick={()=>{
            if(window.confirm('Confirma a chegada física da quantidade total ('+item.quantity+') deste componente?'))void update(item,{status:'received'})
          }}>Registrar recebimento</button>}
          {stock&&item.custody&&<button type="button" disabled={busy||loading} onClick={()=>{
            const next=item.custody==='stored'?'out':'stored'
            if(window.confirm(next==='out'?'Confirma que o componente deixou de estar armazenado na FUNIX?':'Confirma o retorno físico do componente à FUNIX?'))
              void update(item,{custody:next})
          }}>{item.custody==='stored'?'Registrar saída':'Registrar retorno'}</button>}
        </div>}
        {!readOnly&&edit===keyFor(item)&&<form className="acquisition-edit" key={keyFor(item)+':'+item.revision} onSubmit={event=>submit(event,item)}>
          <label>Origem<select name="origin" defaultValue={item.origin} required><option value="">A definir</option>
            {acquisitionOrigins.map(origin=><option value={origin} key={origin}>{origin}</option>)}</select></label>
          <label>Status<select name="status" defaultValue={item.status}>
            {acquisitionStatuses.slice(acquisitionStatuses.indexOf(item.status)).map(status=><option value={status} key={status}>{acquisitionLabels[status]}</option>)}</select></label>
          <div className="acquisition-actions"><button type="submit" disabled={busy||loading}>Confirmar</button><button type="button" disabled={busy} onClick={()=>setEdit('')}>Cancelar</button></div>
        </form>}
      </li>)}
    </ul>
  </section>
}
