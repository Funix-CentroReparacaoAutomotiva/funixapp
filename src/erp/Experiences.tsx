import { useTaskRecord } from './task-record'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../api'
import './experiences.css'

const endpoint = '/api/erp/experiences'
const date = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'})
const origins = {initial:'Atendimento inicial',recurrence:'Recorrência',rework:'Retrabalho',unknown:'Origem não registrada'}
const statuses = {scheduled:'Agendado',present:'Presente',departed:'Saiu',closed:'Fechamento concluído',unknown:'A classificar'}
const labels: Record<string,string> = {atendimento:'Atendimento',diagnostico:'Diagnóstico',orcamento:'Orçamento',os:'OS',experiencia:'Experiência',commercial:'Vendas',oficina:'Oficina',sac:'SAC'}
type Context = {origin:'atendimento'|'diagnostico'|'orcamento'|'os'|'experiencia'|'commercial';recordId?:string}
type Attachment = {name:string;type:string;data:string}
type Entry = {id:string;source:string;relatedId:string;kind:'comment'|'note'|'event';body:string;author:string|null;occurredAt:string;attachments:Attachment[]}
type Item = {id:string;atendimentoId:string;customer:string;vehicle:string;plate:string;payer:string;createdAt:string;scheduledEntry:string;deliveryDate:string|null;origin:keyof typeof origins;channel:string|null;status:keyof typeof statuses}
type Results = {items:Item[];total:number;nextOffset:number|null}
type Origin = {origin:keyof typeof origins;channel:string|null;previous_experience_id:string|null}
type Detail = {sequences:{atendimento_id:string;origin:keyof typeof origins;reason:string;experience_id:string|null}[];previous:{id:string;atendimento_id:string}|null;budgets:{id:string;label:string}[];orders:{id:string;budget_version_id:string;budget_label:string;experience_id:string|null}[];financialSummary:{issuedCents:number;settledCents:number;outstandingCents:number}|null;warranty:null}
type Complaint = {id:string;atendimento_id:string;experience_id:string;followup_atendimento_id:string|null;description:string;author:string;created_at:string;cause:string|null;resolution:string|null;resolved_at:string|null;resolved_by:string|null}
const post = <T,>(path:string,body:unknown) => api<T>(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
const formatDate = (value:string) => Number.isNaN(Date.parse(value)) ? value : date.format(new Date(value))
const ficha = (id:string) => '/atendimentos/'+encodeURIComponent(id)
const money = (value:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100)

function useRead<T>(path:string) {
  const [data,setData] = useState<T|null>(null)
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [revision,setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('');setLoading(true)
    api<T>(endpoint+path,{signal:controller.signal}).then(setData).catch((error:Error) => {
      if (error.name !== 'AbortError') {setData(null);setError(error.message)}
    }).finally(() => {if (!controller.signal.aborted) setLoading(false)})
    return () => controller.abort()
  },[path,revision])
  return {data,error,loading,refresh:() => setRevision(value=>value+1)}
}

async function toAttachments(form: HTMLFormElement) {
  const input = form.elements.namedItem('attachments') as HTMLInputElement|null
  const files = Array.from(input?.files ?? [])
  if (files.length>3 || files.reduce((sum,file)=>sum+file.size,0)>40960) throw Error('Selecione até três anexos somando 40 KB.')
  return Promise.all(files.map(async file => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const data = btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''))
    return {name:file.name,type:file.type,data}
  }))
}

function Diary({atendimentoId,context}:{atendimentoId:string;context?:Context}) {
  const [source,setSource] = useState('')
  const [error,setError] = useState('')
  const [saved,setSaved] = useState('')
  const [busy,setBusy] = useState(false)
  const requestId = useRef('')
  const params = new URLSearchParams({atendimentoId})
  const filter = source || (context?.recordId ? context.origin : '')
  if (filter && filter !== '*') params.set('source',filter)
  if (!source && context?.recordId) params.set('relatedId',context.recordId)
  const {data,error:readError,loading,refresh} = useRead<{items:Entry[];legacyNotes:{source:string;relatedId:string;body:string}[]}>('/diario?'+params)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    requestId.current ||= crypto.randomUUID()
    setBusy(true);setError('');setSaved('')
    try {
      const attachments = await toAttachments(form)
      await post('/diario',{atendimentoId,source:context?.origin ?? values.source ?? 'atendimento',
        relatedId:context?.recordId,requestId:requestId.current,kind:values.kind,body:values.body,author:values.author,attachments})
      requestId.current = ''; form.reset(); setSaved('Entrada registrada.');refresh()
    } catch (cause) {setError((cause as Error).message)}
    finally {setBusy(false)}
  }
  return <section className="erp-experiences">
    <h2>Diário da Experiência</h2>
    <label>Origem <select value={source} onChange={e=>setSource(e.target.value)}>
      {context?.recordId && <option value="">Neste registro</option>}
      <option value={context?.recordId ? '*' : ''}>Todas as origens</option>
      {Object.entries(labels).map(([id,label])=><option value={id} key={id}>{label}</option>)}
    </select></label>
    {loading && <p role="status">Carregando entradas…</p>}
    {readError && <p role="alert">{readError}</p>}
    {!loading && data?.items.length===0 && !data.legacyNotes.length && <p>Nenhuma entrada nesta consulta.</p>}
    {Boolean(data?.legacyNotes.length) && <details>
      <summary>Notas legadas</summary>
      <ul>{data?.legacyNotes.map((note,index)=><li key={index}><strong>{labels[note.source]}</strong> · {note.body}</li>)}</ul>
    </details>}
    <ol className="erp-experiences-timeline">
      {data?.items.map(entry=><li key={entry.id}>
        <header><strong>{labels[entry.source] ?? entry.source}</strong><span>{formatDate(entry.occurredAt)} · {entry.author ?? 'Autor não identificado'}</span></header>
        <p>{entry.body}</p>
        {entry.kind!=='event' && <small>{entry.kind==='comment'?'Comentário':'Anotação'}</small>}
        {entry.attachments.map((file,index)=><a className="erp-experiences-attachment" key={index} download={file.name} href={`data:${file.type};base64,${file.data}`}>{file.name}</a>)}
      </li>)}
    </ol>
    <form className="erp-experiences-form" onSubmit={save} onChange={()=>{ if (!busy) requestId.current = '' }}>
      <fieldset disabled={busy}>
        <legend>Registrar entrada{context ? ' em '+labels[context.origin] : ''}</legend>
        {!context && <label>Contexto <select name="source"><option value="atendimento">Atendimento</option><option value="commercial">Vendas</option></select></label>}
        <label>Tipo <select name="kind"><option value="note">Anotação</option><option value="comment">Comentário</option></select></label>
        <label>Autor informado <input name="author" maxLength={100} required /></label>
        <label className="erp-experiences-wide">Texto <textarea name="body" maxLength={2000} required /></label>
        <label className="erp-experiences-wide">Anexos (até 40 KB) <input name="attachments" type="file" multiple accept="application/pdf,image/jpeg,image/png,text/plain" /></label>
        <button type="submit">Registrar</button>
      </fieldset>
    </form>
    {saved && <p role="status">{saved}</p>}
    {error && <p role="alert">{error}</p>}
    {(!context || context.origin==='atendimento') && <OriginEditor atendimentoId={atendimentoId}/>}
  </section>
}

function OriginEditor({atendimentoId}:{atendimentoId:string}) {
  const {data,error,loading,refresh} = useRead<{record:Origin|null}>('/origem?'+new URLSearchParams({atendimentoId}))
  const [status,setStatus] = useState('')
  const [failure,setFailure] = useState('')
  const [busy,setBusy] = useState(false)
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('');setFailure('');setBusy(true)
    const values = new FormData(event.currentTarget)
    try {await post('/origem',{atendimentoId,channel:values.get('channel')});setStatus('Origem e canal salvos.');refresh()}
    catch (error) {setFailure((error as Error).message)}
    finally {setBusy(false)}
  }
  return <details>
    <summary>Origem e canal de aquisição</summary>
    {error && <p role="alert">{error}</p>}
    {!loading && data && <form className="erp-experiences-form" onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>{origins[data.record?.origin ?? 'unknown']}</legend>
        <label>Canal de aquisição <input name="channel" maxLength={100} defaultValue={data.record?.channel ?? ''} /></label>
        <button type="submit">{data.record?'Salvar canal':'Registrar atendimento inicial'}</button>
      </fieldset>
    </form>}
    {status && <p role="status">{status}</p>}{failure && <p role="alert">{failure}</p>}
  </details>
}

function ExperienceDetail({item}:{item:Item}) {
  useTaskRecord(item.atendimentoId)
  const {data,error,loading,refresh} = useRead<Detail>('/detalhe?'+new URLSearchParams({id:item.id}))
  const [openDiary,setOpenDiary] = useState(false)
  const [orderDiary,setOrderDiary] = useState('')
  return <div className="erp-experiences-detail">
    <dl className="erp-experiences-facts">
      <div><dt>Experiência</dt><dd>{item.id}</dd></div><div><dt>Pagador</dt><dd>{item.payer || 'A confirmar'}</dd></div>
      <div><dt>Entrada agendada</dt><dd>{item.scheduledEntry.replace('T',' às ')}</dd></div>
      <div><dt>Entrega prevista</dt><dd>{item.deliveryDate || 'A confirmar'}</dd></div>
      <div><dt>Canal de aquisição</dt><dd>{item.channel || 'Não registrado'}</dd></div>
    </dl>
    <div className="erp-experiences-actions">
      <a href={ficha(item.atendimentoId)}>Abrir Atendimento</a>
      <a href={ficha(item.atendimentoId)+'?tela=experiencia'}>Abrir Experiência e OS</a>
      <a href={'/gestao/sac?'+new URLSearchParams({experienceId:item.id})}>Abrir SAC</a>
      <button type="button" onClick={()=>setOpenDiary(!openDiary)} aria-expanded={openDiary}>Diário e etapas</button>
    </div>
    {loading && <p role="status">Carregando vínculos…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      {data.previous && <p><a href={ficha(data.previous.atendimento_id)+'?tela=experiencia'}>Abrir Experiência anterior</a></p>}
      {data.budgets.length>0 && <div><h4>Orçamentos</h4><ul>{data.budgets.map(budget=><li key={budget.id}><a href={ficha(item.atendimentoId)+'?'+new URLSearchParams({tela:'orcamentos',versao:budget.id})}>Orçamento {budget.label}</a></li>)}</ul></div>}
      {data.orders.length>0 && <div>
        <h4>Ordens de serviço</h4>
        <ul>{data.orders.map(order=><li key={order.id}>
          <div className="erp-experiences-actions">
            <a href={ficha(item.atendimentoId)+'?tela=experiencia'}>OS do orçamento {order.budget_label}</a>
            {!order.experience_id && <span>Vínculo legado a confirmar</span>}
            <button type="button" aria-expanded={orderDiary===order.id}
              onClick={()=>setOrderDiary(orderDiary===order.id?'':order.id)}>Diário da OS</button>
          </div>
          {orderDiary===order.id && <Diary key={order.id} atendimentoId={item.atendimentoId} context={{origin:'os',recordId:order.id}}/>}
        </li>)}</ul>
      </div>}
      <p>{data.financialSummary ? `A receber: ${money(data.financialSummary.outstandingCents)} · liquidado: ${money(data.financialSummary.settledCents)}` : 'Recebíveis indisponíveis para esta Experiência.'}</p>
      {data.sequences.length>0 && <div><h4>Sequências</h4><ul>{data.sequences.map(sequence=><li key={sequence.atendimento_id}>
        <a href={ficha(sequence.atendimento_id)+(sequence.experience_id?'?tela=experiencia':'')}>{origins[sequence.origin]}</a> · {sequence.reason}
      </li>)}</ul></div>}
    </>}
    <Followup item={item} onSaved={refresh}/>
    {openDiary && <Diary atendimentoId={item.atendimentoId}/>}
  </div>
}

function Followup({item,onSaved}:{item:Item;onSaved:()=>void}) {
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [next,setNext] = useState('')
  const requestId = useRef('')
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true);setError('');setNext('')
    requestId.current ||= crypto.randomUUID()
    try {
      const {record} = await post<{record:{atendimentoId:string}}>('/sequencia',{
        ...Object.fromEntries(new FormData(form)),experienceId:item.id,requestId:requestId.current,
      })
      requestId.current = '';form.reset();setNext(record.atendimentoId);onSaved()
    } catch (error) {setError((error as Error).message)}
    finally {setBusy(false)}
  }
  return <details>
    <summary>Abrir sequência</summary>
    <form className="erp-experiences-form" onSubmit={submit} onChange={()=>{if(!busy) requestId.current=''}}>
      <fieldset disabled={busy}>
        <legend>Nova sequência da Experiência</legend>
        <label>Origem <select name="origin"><option value="recurrence">Recorrência</option><option value="rework">Retrabalho</option></select></label>
        <label>Canal de aquisição <input name="channel" maxLength={100} /></label>
        <label className="erp-experiences-wide">Motivo <textarea name="reason" maxLength={8000} required /></label>
        <button type="submit">Criar Atendimento vinculado</button>
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
    {next && <p role="status">Sequência criada. <a href={ficha(next)}>Abrir novo Atendimento</a></p>}
  </details>
}

function Library() {
  const [query,setQuery] = useState('')
  const [offset,setOffset] = useState(0)
  const [expanded,setExpanded] = useState('')
  const params = new URLSearchParams(query)
  params.set('offset',String(offset))
  const {data,error,loading} = useRead<Results>('/historico?'+params)
  function search(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const params = new URLSearchParams()
    new FormData(event.currentTarget).forEach((value,key)=>{if(value)params.set(key,String(value))})
    setExpanded('');setOffset(0);setQuery(params.toString())
  }
  return <section className="erp-experiences">
    <h1>Histórico de experiências</h1>
    <form className="erp-experiences-search" onSubmit={search}>
      <label>Cliente, placa ou ID <input name="q" type="search" maxLength={150} /></label>
      <label>De <input name="from" type="date" /></label>
      <label>Até <input name="to" type="date" /></label>
      <label>Origem <select name="origin"><option value="">Todas</option>{Object.entries(origins).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
      <label>Situação <select name="status"><option value="">Todas</option>{Object.entries(statuses).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
      <button type="submit">Buscar</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Buscando experiências…</p>}
    {!loading && data && <>
      <p role="status">{data.total} {data.total===1?'experiência encontrada':'experiências encontradas'}</p>
      <ul className="erp-experiences-results">{data.items.map(item=><li key={item.id}>
        <button type="button" className="erp-experiences-result" aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?'':item.id)}>
          <strong>{item.customer || 'Cliente a confirmar'}</strong><span>{[item.vehicle,item.plate].filter(Boolean).join(' · ') || 'Veículo a confirmar'}</span>
          <span>{origins[item.origin]} · {statuses[item.status]}</span>
        </button>
        {expanded===item.id && <ExperienceDetail item={item}/>}
      </li>)}</ul>
      <div className="erp-experiences-actions">
        {offset>0 && <button type="button" onClick={()=>{setExpanded('');setOffset(Math.max(0,offset-50))}}>Página anterior</button>}
        {data.nextOffset!=null && <button type="button" onClick={()=>{setExpanded('');setOffset(data.nextOffset!)}}>Próxima página</button>}
      </div>
    </>}
  </section>
}

function Sac() {
  const [selected,setSelected] = useState(new URLSearchParams(window.location.search).get('experienceId') ?? '')
  const [search,setSearch] = useState('')
  const candidates = useRead<Results>('/historico?'+new URLSearchParams({q:search}))
  useTaskRecord(candidates.data?.items.find(item => item.id === selected)?.atendimentoId)
  const {data,error,loading,refresh} = useRead<{items:Complaint[]}>('/sac?'+new URLSearchParams({experienceId:selected}))
  const [failure,setFailure] = useState('')
  const [saved,setSaved] = useState('')
  const [busy,setBusy] = useState(false)
  const requestId = useRef('')
  async function submit(event:FormEvent<HTMLFormElement>, path:string, complaintId?:string) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    setBusy(true);setFailure('');setSaved('')
    try {
      if (complaintId) await post(path,{...values,id:complaintId})
      else {
        requestId.current ||= crypto.randomUUID()
        await post(path,{...values,experienceId:selected,requestId:requestId.current})
        requestId.current=''
      }
      form.reset()
      setSaved(complaintId?'Resolução registrada.':'Reclamação registrada.')
      refresh()
    } catch (error) {setFailure((error as Error).message)}
    finally {setBusy(false)}
  }
  return <section className="erp-experiences">
    <h1>SAC</h1>
    <form className="erp-experiences-search" onSubmit={event=>{event.preventDefault();setSearch(String(new FormData(event.currentTarget).get('search') ?? ''))}}>
      <label>Buscar Experiência <input name="search" type="search" maxLength={150} placeholder="Cliente, placa ou ID" /></label>
      <button type="submit">Buscar</button>
    </form>
    {candidates.error && <p role="alert">{candidates.error}</p>}
    <label>Experiência <select value={selected} onChange={event=>{setSelected(event.target.value);requestId.current='';setSaved('');setFailure('')}} disabled={busy}>
      <option value="">Todas as reclamações</option>
      {selected&&!candidates.data?.items.some(item=>item.id===selected) && <option value={selected}>{selected}</option>}
      {candidates.data?.items.map(item=><option key={item.id} value={item.id}>{[item.customer,item.vehicle,item.plate].filter(Boolean).join(' · ') || item.id}</option>)}
    </select></label>
    {candidates.data?.nextOffset != null && <p>Refine a busca para localizar outras experiências.</p>}
    <form className="erp-experiences-form" onSubmit={event=>submit(event,'/sac')} onChange={()=>{if(!busy)requestId.current=''}}>
      <fieldset disabled={busy||!selected}>
        <legend>Registrar reclamação</legend>
        <label>Responsável informado <input name="author" required maxLength={100} /></label>
        <label>Sequência <select name="origin"><option value="">Apenas registrar reclamação</option><option value="recurrence">Abrir sequência de Recorrência</option><option value="rework">Abrir sequência de Retrabalho</option></select></label>
        <label>Canal de aquisição da sequência <input name="channel" maxLength={100} /></label>
        <label className="erp-experiences-wide">Reclamação <textarea name="description" required maxLength={8000} /></label>
        <button type="submit">Registrar</button>
      </fieldset>
    </form>
    {saved && <p role="status">{saved}</p>}
    {failure && <p role="alert">{failure}</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Buscando reclamações…</p>}
    {!loading && data?.items.length===0 && <p>Nenhuma reclamação nesta consulta.</p>}
    {!loading && <ol className="erp-experiences-timeline">{data?.items.map(item=><li key={item.id}>
      <header><strong>{item.resolved_at?'Resolvida':'Aberta'}</strong><span>{formatDate(item.created_at)} · {item.author}</span></header>
      <p>{item.description}</p>
      <div className="erp-experiences-actions"><a href={ficha(item.atendimento_id)+'?tela=experiencia'}>Experiência anterior</a>
        {item.followup_atendimento_id && <a href={ficha(item.followup_atendimento_id)}>Abrir sequência</a>}</div>
      {item.resolved_at ? <dl><dt>Causa</dt><dd>{item.cause}</dd><dt>Resolução</dt><dd>{item.resolution}</dd><dt>Registrada por</dt><dd>{item.resolved_by} · {formatDate(item.resolved_at)}</dd></dl> :
        <details><summary>Registrar resolução</summary><form className="erp-experiences-form" onSubmit={event=>submit(event,'/sac/resolver',item.id)}>
          <fieldset disabled={busy}>
            <legend>Resolução da reclamação</legend>
            <label>Responsável informado <input name="author" required maxLength={100} /></label>
            <label className="erp-experiences-wide">Causa <textarea name="cause" required maxLength={4000} /></label>
            <label className="erp-experiences-wide">Resolução <textarea name="resolution" required maxLength={4000} /></label>
            <button type="submit">Resolver</button>
          </fieldset>
        </form></details>}
    </li>)}</ol>}
  </section>
}

export default function Experiences({view,atendimentoId,context}:{view:string;atendimentoId?:string;context?:Context}) {
  if (view==='diario' && atendimentoId) return <Diary atendimentoId={atendimentoId} context={context}/>
  if (view==='sac') return <Sac/>
  return <Library/>
}
