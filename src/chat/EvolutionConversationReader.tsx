import type {EntityContact} from '../../shared/customer'
import {EvolutionAtendimentoChat} from './ChatPanel'
import {ConversationIdentity} from './ConversationIdentity'
import {EntityDirectory} from '../EntityEditor'
import {useCallback,useEffect,useRef,useState} from 'react'
import {api,type RequestFailure} from '../api'
import {Notice} from '../ui'
import {ConversationLinksPanel} from './ConversationLinksPanel'
import {parseConversationList,type ConversationRow} from './evolution-read-model'
import './evolution-read.css'
const calendar=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Sao_Paulo'})
function messageTime(value:string){const date=new Date(value),today=new Date(),day=calendar.format(date);if(day===calendar.format(today))return clock.format(date);if(day===calendar.format(new Date(today.getTime()-86400000)))return 'Ontem';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',...(date.getUTCFullYear()!==today.getUTCFullYear()?{year:'2-digit' as const}:{}),timeZone:'America/Sao_Paulo'}).format(date)}
const clock=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'})
function visibleIdentity(row:ConversationRow){
 const commercial=(row.commercial?.names??[]).filter(p=>p.name.trim()&&p.name!=='Sem nome')
 const providerHint=commercial.length===0?row.displayName?.trim()||null:null
 const parts=commercial.length?commercial:[{name:providerHint??'Sem nome',entityId:null}]
 return {parts,label:parts.map(p=>p.name).join(' / '),providerHint:Boolean(providerHint)}
}
const name=(row:ConversationRow)=>visibleIdentity(row).label
function phoneLine(row:ConversationRow){
 if(row.phoneNumber)return {text:'+'+row.phoneNumber,hint:'Número apresentado ou confirmado pelo canal WhatsApp'}
 if(row.atendimentoPhone)return {text:'Ficha: +'+row.atendimentoPhone,hint:'Número cadastrado no Atendimento; não confirma que seja o número desta conversa WhatsApp'}
 return {text:'Telefone pendente',hint:'Número do WhatsApp ainda não confirmado'}
}
type Links={items:{linkId:string;atendimentoId:string;name:string;vehicle:string;plate:string}[]}
export function EvolutionConversationReader({searchTerm='',onUnauthorized,onOpenAtendimento}:{searchTerm?:string;onUnauthorized:()=>void;onOpenAtendimento?:(id:string,tab:'chat'|'diagnosticos'|'mapa',conversationId?:string)=>void}) {
 const [rows,setRows]=useState<ConversationRow[]>([]),[next,setNext]=useState<number|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[available,setAvailable]=useState(true),[linksEnabled,setLinksEnabled]=useState(false)
 const [selected,setSelected]=useState<ConversationRow|null>(null),[links,setLinks]=useState<Links|null>(null),[version,setVersion]=useState(0)
 const [source,setSource]=useState<'evolution'|'local'>('evolution')
 const extraPagesLoaded=useRef(false),lastRefresh=useRef(Date.now())
 const [verified,setVerified]=useState<{conversationId:string;contact:EntityContact}|null>(null),[drafts]=useState(()=>new Map<string,string>())
 const [confirmedName,setConfirmedName]=useState(''),[sending,setSending]=useState(false)
 const contact=verified?.conversationId===selected?.conversationId?verified?.contact??null:null
 const dialog=useRef<HTMLDialogElement>(null),request=useRef<AbortController|null>(null)
 const fail=useCallback((e:unknown)=>{if((e as RequestFailure).status===401)onUnauthorized();else setError((e as Error).message||'Não foi possível carregar as conversas.')},[onUnauthorized])
 const load=useCallback(async(skip:number,signal:AbortSignal)=>{
  setBusy(true);setError('')
  try{const result=parseConversationList(await api('/api/chat/conversations?skip='+skip,{signal}));if(signal.aborted)return;setRows(p=>skip?[...p,...result.items.filter(r=>!p.some(x=>x.conversationId===r.conversationId))]:result.items);setNext(result.nextSkip);setSource(result.source);extraPagesLoaded.current=skip>0;setAvailable(true);setLinksEnabled(result.linksEnabled===true)}
  catch(e){if(!signal.aborted){if((e as RequestFailure).status===404)setAvailable(false);else fail(e)}}finally{if(!signal.aborted)setBusy(false)}
 },[fail])
 useEffect(()=>{const c=new AbortController();request.current=c;void load(0,c.signal);return()=>c.abort()},[load,version])
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal()},[selected])
 useEffect(()=>()=>request.current?.abort(),[])
 // Bounded refresh of the first page only. Never poll in hidden tabs, dialogs, or
 // after loading more offset pages (refresh would discard/shift that pagination).
 // This is provider polling, not a replacement for authenticated event ingestion.
 useEffect(()=>{
  const refresh=()=>{
   if(document.visibilityState!=='visible'||busy||selected||extraPagesLoaded.current||Date.now()-lastRefresh.current<60_000)return
   lastRefresh.current=Date.now()
   setVersion(v=>v+1)
  }
  const timer=window.setInterval(refresh,60_000)
  document.addEventListener('visibilitychange',refresh)
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
 },[busy,selected])
 useEffect(()=>{
  const id=selected?.commercial?.contactId
  if(!id||!selected)return
  const controller=new AbortController(),conversationId=selected.conversationId
  void api<EntityContact>('/api/customer-records/'+id,{signal:controller.signal}).then(item=>{
   if(!controller.signal.aborted&&item.whatsapp?.state==='available')setVerified({conversationId,contact:item})
  }).catch(error=>{if(!controller.signal.aborted)fail(error)})
  return ()=>controller.abort()
 },[selected,fail])
 function details(row:ConversationRow){
  setSelected(row);setLinks(null);setVerified(null);setError('');setConfirmedName('')
 }
 async function open(row:ConversationRow){
  if(linksEnabled||row.commercial?.contactId){details(row);return}
  if((row.commercial?.atendimentoCount??0)!==1&&!row.atendimentoId){details(row);return}
  try{const value=await api<{atendimentoId:string|null}>('/api/chat/conversations/'+row.conversationId+'/active-atendimento');if(value.atendimentoId)onOpenAtendimento?.(value.atendimentoId,'chat',row.conversationId);else details(row)}catch(e){fail(e)}
 }
 async function choose(row:ConversationRow,linkId:string,id:string){
  try{
   await api('/api/chat/conversations/'+row.conversationId+'/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({linkId})})
   setSelected(null);onOpenAtendimento?.(id,'chat',row.conversationId)
  }catch(e){fail(e)}
 }
 function close(){
  if(sending)return
  if(contact&&drafts.get(contact.id)?.trim()&&!window.confirm('Fechar a conversa? O rascunho será mantido nesta sessão.'))return
  setSelected(null)
 }
 const q=searchTerm.trim().toLocaleLowerCase('pt-BR'),matches=rows.filter(r=>[name(r),r.displayName,r.phoneNumber,r.atendimentoPhone,r.commercial?.preview].join(' ').toLocaleLowerCase('pt-BR').includes(q))
 return <section className="ev-reader"><header className="ev-header"><strong>Conversas</strong><EntityDirectory/><button className="fh-filter" disabled={busy} onClick={()=>{lastRefresh.current=Date.now();setVersion(v=>v+1)}}>Atualizar</button></header>
  {!available&&<Notice title="Canal ainda não habilitado">Os Atendimentos podem ser criados pelo Funil.</Notice>}
  {error&&<Notice title="Não foi possível concluir" error>{error}</Notice>}
  {busy&&<p role="status">Carregando conversas…</p>}
  {available&&!busy&&!matches.length&&<Notice title="Nenhuma conversa encontrada"/>}
  <div className="ev-list" aria-label="Lista de Conversas">{matches.map(row=>{
   const {parts,label,providerHint}=visibleIdentity(row),count=row.commercial?.atendimentoCount??(row.atendimentoId?1:0),initials=label==='Sem nome'?'':label.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toLocaleUpperCase('pt-BR')
   return <article className="conversation-row" key={row.conversationId}>
    <button className="conversation-hit" aria-label={'Abrir conversa: '+label} onClick={()=>void open(row)}/>
    <ConversationAvatar initials={initials} photo={row.commercial?.profilePhoto??null}/>
    <div className="conversation-info"><strong className="conversation-names" title={label}>{parts.map((p,i)=><span key={i}>{i?' / ':''}{p.name}{p.entityId&&<span className="entity-seal" role="img" aria-label={'Cadastro associado a '+p.name+'; não confirma identidade'} title="Cadastro associado; não confirma identidade"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="7" r="3"/><path d="M3 19c0-4 2-6 6-6 3 0 5 1 6 4m0 0 2 2 5-5"/></svg></span>}</span>)}{providerHint&&<span className="conversation-channel-hint" title="Nome informado pelo canal WhatsApp; identidade não confirmada"> · canal</span>}</strong><span className="conversation-phone" title={phoneLine(row).hint} aria-label={phoneLine(row).hint+': '+phoneLine(row).text}>{phoneLine(row).text}</span><span className="conversation-preview">{row.commercial?.preview??(source==='local'?'Sem mensagens salvas no FunixApp':'Prévia indisponível neste modo')}</span></div>
    <div className="conversation-right"><button className={'conversation-count '+(count===0?'warning':'')} aria-label={'Detalhes: '+count+' Atendimentos'} onClick={()=>details(row)}>{count===0?'⚠':count>1?count+' atend.':<span aria-hidden="true"> </span>}</button><time dateTime={row.updatedAt??undefined}>{row.updatedAt?messageTime(row.updatedAt):'—'}</time>{!!row.unreadCount&&<span className="conversation-unread" aria-label={row.unreadCount+' mensagens não lidas'}>{row.unreadCount}</span>}</div>
   </article>
  })}</div>
  {next!==null&&<button className="fh-filter ev-more" disabled={busy} onClick={()=>{request.current?.abort();const c=new AbortController();request.current=c;void load(next,c.signal)}}>Carregar mais conversas</button>}
  {selected&&<dialog className="ev-choice-dialog conversation-workspace" ref={dialog} onClose={()=>setSelected(null)} onCancel={event=>{event.preventDefault();close()}} aria-label="Detalhes da conversa">
   <header><div><strong>{confirmedName||name(selected)}</strong><div>{phoneLine(selected).text}</div></div><button disabled={sending} aria-label="Fechar detalhes" onClick={close}>×</button></header>
   {linksEnabled&&<ConversationIdentity key={selected.conversationId} conversationId={selected.conversationId} onSaved={identified=>{
     setConfirmedName(identified);setVersion(value=>value+1)
   }}/>}
   {(selected.commercial?.names.length??0)>1&&<ul>{selected.commercial?.names.map((person,index)=><li key={index}>{person.name}</li>)}</ul>}
   <div className="ev-choice-items">{links?.items.map(link=><button key={link.linkId} disabled={sending} onClick={()=>void choose(selected,link.linkId,link.atendimentoId)}><strong>{links.items.length===1?'Abrir Atendimento':link.name||'Abrir Atendimento'}</strong><span>{[link.name,link.vehicle,link.plate].filter(Boolean).join(' · ')}</span></button>)}</div>
   {linksEnabled&&<details><summary>Gerenciar vínculos</summary><ConversationLinksPanel conversationId={selected.conversationId} onUnauthorized={onUnauthorized} onLinksChange={setLinks}/></details>}
   <EvolutionAtendimentoChat key={selected.conversationId} atendimentoId="" conversationId={contact?.whatsapp.conversationId??selected.conversationId}
     contactId={contact?.id} contactLinksEnabled={linksEnabled} readOnly={!contact} onUnauthorized={onUnauthorized} drafts={drafts} onSendBusy={setSending}>{null}</EvolutionAtendimentoChat>
  </dialog>}
 </section>
}
function ConversationAvatar({initials,photo}:{initials:string;photo:string|null}){
 const [failed,setFailed]=useState(false)
 return <span className="conversation-avatar" aria-hidden="true">{photo&&!failed?<img src={photo} alt="" loading="lazy" onError={()=>setFailed(true)}/>:initials||<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 11a8 8 0 0 1-8 8 8 8 0 0 1-4-.9L3 20l1.8-4.9A8 8 0 1 1 20 11Z"/></svg>}</span>
}