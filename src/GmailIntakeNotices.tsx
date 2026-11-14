import { useCallback, useEffect, useState } from 'react'
import type { GmailIntakeDecision, GmailIntakeNotice, GmailIntakeNoticeList } from '../shared/gmail-intake'
import { api } from './api'
import './gmail-intake-notices.css'

type View = 'open'|'closed'
const compactStatusLabel = {
  awaiting_authorization:'Aguardando decisão',
  authorized:'Autorizado, não executado',
  denied:'Não autorizado'
} as const
function createdAtLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', {
    day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'
  }).format(date)
}
const statusLabel = {
  awaiting_authorization:'Aguardando sua decisão',
  authorized:'Processamento autorizado (não executado)',
  denied:'Processamento não autorizado'
} as const

/** Separate authorization to read/process an email, not approval of its proposed changes. */
export function GmailIntakeNotices({onUnauthorized}:{onUnauthorized:()=>void}) {
  const [view,setView]=useState<View>('open')
  const [notices,setNotices]=useState<GmailIntakeNoticeList|null>(null)
  const [refresh,setRefresh]=useState(0)
  const [busy,setBusy]=useState<string|null>(null)
  const [expandedId,setExpandedId]=useState<string|null>(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  const load=useCallback(()=>{
    const controller=new AbortController()
    setLoading(true)
    api<GmailIntakeNoticeList>('/api/atualizacoes/avisos-gmail?visao='+view,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){setNotices(data);setError('')}})
      .catch(cause=>{
        if(controller.signal.aborted||cause?.name==='AbortError')return
        if(cause?.status===401)onUnauthorized()
        setNotices(null)
        setError(cause?.message||'Não foi possível consultar os avisos.')
      })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[view,onUnauthorized])

  useEffect(()=>{
    const abort=load()
    const timer=window.setInterval(()=>setRefresh(x=>x+1),30000)
    return ()=>{abort();window.clearInterval(timer)}
  },[load,refresh])

  async function decide(notice:GmailIntakeNotice,decision:GmailIntakeDecision){
    if(!notices?.decisionsEnabled||busy||notice.status!=='awaiting_authorization')return
    const confirmation = [
      'Confirme sua decisão para a mensagem:',
      '',
      notice.title,
      '',
      'Resumo: '+notice.summary.slice(0,260),
      '',
      'DECISÃO: '+(decision==='authorize'?'AUTORIZAR ANÁLISE':'NÃO AUTORIZAR ANÁLISE'),
      '',
      'Isso não aprova reparos, alterações no ERP, arquivamentos nem respostas ao cliente.'
    ].join('\n')
    if(!window.confirm(confirmation))return
    setBusy(notice.id);setMessage('');setError('')
    try{
      const response=await api<GmailIntakeNotice>(
        '/api/atualizacoes/avisos-gmail/'+encodeURIComponent(notice.id)+'/decisao',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({decision,revision:notice.revision,snapshotHash:notice.snapshotHash,requestId:crypto.randomUUID()})
      })
      setMessage(response.status==='authorized'?
        'Autorização de triagem registrada. Nenhuma alteração ou resposta ao cliente foi executada.':
        'Triagem não autorizada. O e-mail não será encaminhado para processamento.')
      setExpandedId(null)
      setRefresh(x=>x+1)
    }catch(cause){
      const e=cause as {status?:number,message:string}
      if(e.status===401)onUnauthorized()
      setError(e.status===409?'Este aviso foi alterado. Atualize antes de decidir.':e.message)
      setRefresh(x=>x+1)
    }finally{setBusy(null)}
  }

  return <section className="gmail-intake-notices" aria-label="Avisos de e-mails sobre veículos">
    <header className="gmail-intake-head">
      <div><h2>E-mails para sua autorização</h2>
        <p>Autorize somente a análise do assunto. Nenhum reparo ou alteração é aprovado aqui.</p>
      </div>
      <button type="button" className="fh-filter" onClick={()=>{setMessage('');setRefresh(x=>x+1)}}>Atualizar avisos</button>
    </header>
    <div className="gmail-intake-switch" role="group" aria-label="Situação dos avisos">
      <button type="button" aria-pressed={view==='open'} className={view==='open'?'selected':''}
        onClick={()=>{setView('open');setExpandedId(null);setMessage('')}}>Aguardando decisão</button>
      <button type="button" aria-pressed={view==='closed'} className={view==='closed'?'selected':''}
        onClick={()=>{setView('closed');setExpandedId(null);setMessage('')}}>Decididos</button>
    </div>
    {message&&<p role="status" className="gmail-intake-success">{message}</p>}
    {error&&<p role="alert" className="updates-error">{error}</p>}
    {loading&&<p role="status">Consultando avisos…</p>}
    {!loading&&!error&&notices&&<>
      {!notices.items.length&&<p className="gmail-intake-empty">
        {view==='open'?'Nenhum e-mail aguardando autorização.':'Nenhuma decisão registrada.'}
      </p>}
      {notices.items.map(notice=>{
        const expanded = expandedId===notice.id
        return <article key={notice.id} className={'gmail-intake-card'+(expanded?' is-expanded':'')}>
          <button type="button" className="gmail-intake-card-toggle"
            aria-expanded={expanded} aria-controls={'gmail-aviso-detalhes-'+notice.id}
            onClick={()=>setExpandedId(current=>current===notice.id?null:notice.id)}>
            <span className="gmail-intake-card-main">
              <strong className="gmail-intake-card-title">{notice.title}</strong>
              <span className="gmail-intake-card-subline">
                <span className={'gmail-intake-status status-'+notice.status}>{compactStatusLabel[notice.status]}</span>
                <span>Registrado em {createdAtLabel(notice.createdAt)}</span>
              </span>
            </span>
            <span className="gmail-intake-card-expand">
              <span>{expanded?'Recolher':'Ver detalhes'}</span>
              <span aria-hidden="true" className={'gmail-intake-chevron'+(expanded?' is-expanded':'')}>▾</span>
            </span>
          </button>
          {expanded&&<div id={'gmail-aviso-detalhes-'+notice.id} className="gmail-intake-detail">
            <p className="gmail-intake-detail-label">Resumo da mensagem</p>
            <p className="gmail-intake-detail-summary">{notice.summary}</p>
            <div className="gmail-intake-meta">
              <span>{notice.relevance==='uncertain'?'Possivelmente relacionado a veículo':'Relacionado a serviço de veículo'}</span>
              {notice.plateHint&&<span>Placa sugerida: {notice.plateHint}</span>}
              {notice.xpHint&&<span>XP sugerida: {notice.xpHint}</span>}
            </div>
            <p className="gmail-intake-explain">Identificação e vínculo ainda exigem conferência. Autorizar permite somente a análise do e-mail, sem executar ações externas.</p>
            {notice.status==='awaiting_authorization'&&<>
              <div className="gmail-intake-actions">
                <button type="button" disabled={!notices.decisionsEnabled||busy!==null}
                  onClick={()=>void decide(notice,'deny')}>Não autorizar</button>
                <button type="button" className="primary-btn" disabled={!notices.decisionsEnabled||busy!==null}
                  onClick={()=>void decide(notice,'authorize')}>Autorizar análise</button>
              </div>
              {!notices.decisionsEnabled&&<small>Decisões de triagem ainda não habilitadas.</small>}
            </>}
            {notice.status!=='awaiting_authorization'&&<p className="gmail-intake-decided">{statusLabel[notice.status]}</p>}
          </div>}
        </article>
      })}
    </>}
  </section>
}
