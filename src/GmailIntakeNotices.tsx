import { useState } from 'react'
import type { GmailIntakeDecision, GmailIntakeNotice } from '../shared/gmail-intake'
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

/** An email decision is independent from approving a proposed system update. */
export function GmailIntakeCard({notice,decisionsEnabled,expanded,onToggle,onSuccess,onUnauthorized}:{
  notice:GmailIntakeNotice
  decisionsEnabled:boolean
  expanded:boolean
  onToggle:()=>void
  onSuccess:()=>void
  onUnauthorized:()=>void
}) {
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')

  async function decide(decision:GmailIntakeDecision){
    if(!decisionsEnabled||busy||notice.status!=='awaiting_authorization')return
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
    ].join('\\n')
    if(!window.confirm(confirmation))return
    setBusy(true);setMessage('');setError('')
    try {
      const response=await api<GmailIntakeNotice>(
        '/api/atualizacoes/avisos-gmail/'+encodeURIComponent(notice.id)+'/decisao',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({decision,revision:notice.revision,snapshotHash:notice.snapshotHash,requestId:crypto.randomUUID()})
      })
      setMessage(response.status==='authorized'?
        'Autorização de triagem registrada. Nenhuma alteração ou resposta ao cliente foi executada.':
        'Triagem não autorizada. O e-mail não será encaminhado para processamento.')
      onSuccess()
    } catch(cause) {
      const e=cause as {status?:number,message:string}
      if(e.status===401)onUnauthorized()
      setError(e.status===409?'Este aviso foi alterado. Atualize antes de decidir.':e.message)
      onSuccess()
    } finally {setBusy(false)}
  }

  return <article className={'gmail-intake-card'+(expanded?' is-expanded':'')}>
    <button type="button" className="gmail-intake-card-toggle"
      aria-expanded={expanded} aria-controls={'gmail-aviso-detalhes-'+notice.id}
      onClick={onToggle}>
      <span className="gmail-intake-card-main">
        <strong className="gmail-intake-card-title">{notice.title}</strong>
        <span className="gmail-intake-card-subline">
          <span>E-mail</span>
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
          <button type="button" disabled={!decisionsEnabled||busy}
            onClick={()=>void decide('deny')}>Não autorizar</button>
          <button type="button" className="primary-btn" disabled={!decisionsEnabled||busy}
            onClick={()=>void decide('authorize')}>Autorizar análise</button>
        </div>
        {!decisionsEnabled&&<small>Decisões de triagem ainda não habilitadas.</small>}
      </>}
      {notice.status!=='awaiting_authorization'&&<p className="gmail-intake-decided">{statusLabel[notice.status]}</p>}
      {message&&<p className="gmail-intake-success" role="status">{message}</p>}
      {error&&<p className="updates-error" role="alert">{error}</p>}
    </div>}
  </article>
}
