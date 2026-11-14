import { useEffect, useMemo, useState } from 'react'
import type { UpdatePackage, UpdatePackageList, UpdatePackageStatus } from '../shared/update-packages'
import { api } from './api'
import { GmailIntakeCard } from './GmailIntakeNotices'
import type { GmailIntakeNotice, GmailIntakeNoticeList } from '../shared/gmail-intake'
import './updates.css'

type View = 'pending' | 'all'
type FeedItem = {kind:'gmail',data:GmailIntakeNotice}|{kind:'package',data:UpdatePackage}
const statusLabel: Record<UpdatePackageStatus,string> = {
  awaiting_review:'Aguardando aprovação',
  approved_pending_execution:'Aguardando execução',
  execution_failed:'Execução pendente de correção',
  executed:'Executado',
  rejected:'Rejeitado',
  superseded:'Substituído por proposta revalidada'
}
function updatedDate(value:string){
  const date=new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data indisponível' :
    new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(date)
}
const sourceLabel={gmail:'E-mail',whatsapp:'WhatsApp',other:'Outro canal'} as const

export function UpdatesPage({onUnauthorized}:{onUnauthorized:()=>void}) {
  const [view,setView]=useState<View>('pending')
  const [query,setQuery]=useState('')
  const [gmail,setGmail]=useState<GmailIntakeNoticeList|null>(null)
  const [refresh,setRefresh]=useState(0)
  const [result,setResult]=useState<UpdatePackageList|null>(null)
  const [expanded,setExpanded]=useState<string|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState<string|null>(null)
  const [notice,setNotice]=useState('')
  const [answers,setAnswers]=useState<Record<string,string>>({})
  useEffect(()=>{
    const controller=new AbortController()
    setLoading(true);setError('')
    const timer=setTimeout(()=>{
      const search=new URLSearchParams({visao:view==='pending'?'open':'all',q:query})
      Promise.all([
        api<UpdatePackageList>(`/api/atualizacoes?${search}`,{signal:controller.signal}),
        api<GmailIntakeNoticeList>(`/api/atualizacoes/avisos-gmail?${search}`,{signal:controller.signal})
      ]).then(([packages,mail])=>{
        if(!controller.signal.aborted){setResult(packages);setGmail(mail)}
      }).catch(cause=>{
        if(controller.signal.aborted||cause?.name==='AbortError')return
        if(cause?.status===401)onUnauthorized()
        setError(cause?.message||'Não foi possível consultar as atualizações.')
        setResult(null);setGmail(null)
      }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    },query?250:0)
    return()=>{clearTimeout(timer);controller.abort()}
  },[view,query,refresh,onUnauthorized])
  const items=useMemo<FeedItem[]>(()=>{
    const entries:FeedItem[]=[
      ...(result?.items??[]).map(data=>({kind:'package' as const,data})),
      ...(gmail?.items??[]).map(data=>({kind:'gmail' as const,data}))
    ]
    entries.sort((a,b)=>b.data.createdAt.localeCompare(a.data.createdAt)||a.data.id.localeCompare(b.data.id))
    return entries
  },[result,gmail])
  const count=(result?.total??0)+(gmail?.total??0)
  async function clarify(pkg:UpdatePackage){
    if(!result?.clarificationsEnabled||busy||pkg.clarificationPending||pkg.status!=='awaiting_review')return
    setBusy(pkg.id);setError('');setNotice('')
    try{
      const updated=await api<UpdatePackage>(`/api/atualizacoes/${encodeURIComponent(pkg.id)}/complementar`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({revision:pkg.revision,snapshotHash:pkg.snapshotHash,
          requestId:crypto.randomUUID(),answers})
      })
      if(updated.clarificationPending)setNotice('Informações recebidas. Aguardando nova conferência do pacote antes da aprovação.')
      setRefresh(v=>v+1);setExpanded(null);setAnswers({})
    }catch(cause){
      const error=cause as {status?:number,message:string}
      if(error.status===401)onUnauthorized()
      setError(error.message);setRefresh(v=>v+1)
    }finally{setBusy(null)}
  }
  async function decide(pkg:UpdatePackage,decision:'approve'|'reject'){
    if(!result?.decisionsEnabled||busy||pkg.status!=='awaiting_review'||(decision==='approve'&&(pkg.missingFields.length||pkg.clarificationPending)))return
    const word=decision==='approve'?'aprovar':'rejeitar'
    if(!window.confirm(`Deseja ${word} o pacote "${pkg.title}"? Esta decisão será registrada.`))return
    setBusy(pkg.id);setNotice('');setError('')
    try{
      const updated=await api<UpdatePackage>(`/api/atualizacoes/${encodeURIComponent(pkg.id)}/decisao`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({decision,revision:pkg.revision,snapshotHash:pkg.snapshotHash,requestId:crypto.randomUUID()})
      })
      setNotice(updated.status==='approved_pending_execution'?
        'Aprovação registrada. A execução ainda não começou.':
        'Rejeição registrada.')
      setRefresh(v=>v+1);setExpanded(null)
    }catch(cause){
      const e=cause as {status?:number,message:string}
      if(e.status===401)onUnauthorized()
      setError(e.status===409?'O pacote foi alterado. Atualize antes de decidir.':e.message)
      setRefresh(v=>v+1)
    }finally{setBusy(null)}
  }
  return <section className="updates-page" aria-label="Pacotes de atualizações">
    <div className="updates-toolbar">
      <label className="fh-search"><span aria-hidden="true">⌕</span>
        <input aria-label="Buscar atualizações por assunto, experiência, placa ou origem" value={query}
          onChange={e=>{setNotice('');setQuery(e.target.value)}} placeholder="Buscar assunto, experiência, placa ou origem…" autoComplete="off" />
      </label>
      <button className="fh-filter" onClick={()=>{setNotice('');setRefresh(v=>v+1)}}>Atualizar</button>
    </div>
    <div className="updates-switch" role="group" aria-label="Filtro de atualizações">
      <button aria-pressed={view==='pending'} className={view==='pending'?'selected':''} onClick={()=>{setNotice('');setView('pending');setExpanded(null)}}>Pendentes</button>
      <button aria-pressed={view==='all'} className={view==='all'?'selected':''} onClick={()=>{setNotice('');setView('all');setExpanded(null)}}>Todos</button>
    </div>
    {notice&&<p className="updates-message" role="status">{notice}</p>}
    {error&&<p className="updates-error" role="alert">{error}</p>}
    {loading&&<p className="updates-placeholder" role="status">Carregando atualizações…</p>}
    {!loading&&!error&&result&&gmail&&<>
      <p className="updates-count">{count} atualização{count===1?'':'ões'} {view==='pending'?'pendente'+(count===1?'':'s'):'no histórico'}{items.length<count?' · exibindo '+items.length+' mais recentes':''}</p>
      {!count&&<div className="fh-surface updates-empty"><strong>{view==='pending'?'Nenhuma atualização pendente':'Nenhuma atualização registrada'}</strong><p>Novas mensagens e propostas aparecerão aqui quando forem registradas.</p></div>}
      <div className="updates-cards">
        {items.map(item=>item.kind==='gmail'?
          <GmailIntakeCard key={'gmail-'+item.data.id} notice={item.data}
            decisionsEnabled={gmail.decisionsEnabled}
            expanded={expanded==='gmail-'+item.data.id}
            onToggle={()=>{setExpanded(expanded==='gmail-'+item.data.id?null:'gmail-'+item.data.id);setAnswers({})}}
            onSuccess={()=>{setRefresh(v=>v+1);setExpanded(null)}}
            onUnauthorized={onUnauthorized}/>:
          (()=>{const pkg=item.data;return <article key={'package-'+pkg.id} className={'updates-card '+(pkg.status==='rejected'?'is-rejected':pkg.status==='executed'?'is-executed':pkg.status==='superseded'?'is-superseded':'')}>
          <button type="button" className="updates-card-summary" aria-expanded={expanded==='package-'+pkg.id} onClick={()=>{setExpanded(expanded==='package-'+pkg.id?null:'package-'+pkg.id);setAnswers({})}}>
            <span className="updates-card-top"><strong>{pkg.title}</strong><span aria-hidden="true">{expanded==='package-'+pkg.id?'▴':'▾'}</span></span>
            <span className="updates-source">{sourceLabel[pkg.source]} · {updatedDate(pkg.createdAt)}</span>
            <span className="updates-description">{pkg.summary}</span>
            <span className="updates-card-foot"><span className={'updates-state '+(pkg.status==='rejected'?'state-rejected':pkg.status==='executed'?'state-executed':'')}>{statusLabel[pkg.status]}</span>
              {pkg.missingFields.length>0&&<span className="updates-pending">⚠ {pkg.missingFields.length} pendência{pkg.missingFields.length===1?'':'s'}</span>}
            </span>
          </button>
          {expanded==='package-'+pkg.id&&<div className="updates-detail">
            <p className="updates-meta">{[pkg.experienceId,pkg.plate].filter(Boolean).join(' · ')||'Experiência não identificada'}</p>
            <h3>Ações propostas</h3>
            <ul>{pkg.actions.map(action=><li key={action.id}><strong>{action.title}</strong>{action.detail&&<span>{action.detail}</span>}</li>)}</ul>
            {pkg.missingFields.length>0&&<div className="updates-missing"><strong>Informações necessárias antes de aprovar</strong>
              <ul>{pkg.missingFields.map(field=><li key={field.key}><strong>{field.label}</strong>{field.hint&&<span>{field.hint}</span>}</li>)}</ul>
              {pkg.clarificationPending?<p role="status">Suas respostas foram registradas. O sistema deve preparar e conferir uma nova proposta antes de liberar a aprovação.</p>:
                result.clarificationsEnabled && pkg.status==='awaiting_review'?<form onSubmit={e=>{e.preventDefault();void clarify(pkg)}} className="updates-answer-form">
                  {pkg.missingFields.map(field=><label key={field.key}>{field.label}
                    {field.options?.length?<select required value={answers[field.key]??''} onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))}>
                      <option value="">Escolha uma opção</option>
                      {field.options.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>:<input required maxLength={250} value={answers[field.key]??''} placeholder={field.hint||'Informar dado'}
                      onChange={e=>setAnswers(a=>({...a,[field.key]:e.target.value}))}/>}
                  </label>)}
                  <button type="submit" className="primary-btn" disabled={busy===pkg.id||pkg.missingFields.some(f=>!answers[f.key]?.trim())}>Enviar para conferência</button>
                  <small>O envio não aprova o pacote nem executa ações.</small>
                </form>:<p>A complementação ainda está desativada. Não é permitido aprovar o pacote com pendências.</p>}
            </div>}
            {pkg.status==='awaiting_review'&&<div className="updates-decisions">
              <button type="button" disabled={!result.decisionsEnabled||busy===pkg.id}
                onClick={()=>void decide(pkg,'reject')}>Rejeitar</button>
              <button type="button" className="primary-btn" disabled={!result.decisionsEnabled||busy===pkg.id||pkg.missingFields.length>0||pkg.clarificationPending}
                onClick={()=>void decide(pkg,'approve')}>Aprovar pacote</button>
            </div>}
            {pkg.status==='awaiting_review'&&!result.decisionsEnabled&&<p className="updates-note">Decisões ainda desabilitadas. Nenhuma alteração será executada.</p>}
            {pkg.status==='approved_pending_execution'&&<p className="updates-note">Aprovado; aguardando executor autorizado. Não significa que as ações já foram aplicadas.</p>}
            {pkg.status==='execution_failed'&&<p className="updates-note">Pacote aprovado com execução pendente. Verifique a falha antes de tentar novamente.</p>}
            {pkg.decidedAt&&<p className="updates-note">Decisão registrada em {updatedDate(pkg.decidedAt)}.</p>}
          </div>}
        </article>})())}
      </div>
    </>}
  </section>
}
