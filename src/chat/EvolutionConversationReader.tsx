import {useCallback,useEffect,useRef,useState} from 'react'
import {api,type RequestFailure} from '../api'
import {Notice} from '../ui'
import {ConversationLinksPanel} from './ConversationLinksPanel'
import {parseConversationList,type ConversationRow} from './evolution-read-model'
import './evolution-read.css'
const calendar=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Sao_Paulo'})
function messageTime(value:string){const date=new Date(value),today=new Date(),day=calendar.format(date);if(day===calendar.format(today))return clock.format(date);if(day===calendar.format(new Date(today.getTime()-86400000)))return 'Ontem';return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',...(date.getUTCFullYear()!==today.getUTCFullYear()?{year:'2-digit' as const}:{}),timeZone:'America/Sao_Paulo'}).format(date)}
const clock=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'})
const name=(row:ConversationRow)=>row.commercial?.names.map(p=>p.name).join(' / ')||'Sem nome'
type Links={items:{linkId:string;atendimentoId:string;name:string;vehicle:string;plate:string}[]}
export function EvolutionConversationReader({searchTerm='',onUnauthorized,onOpenAtendimento}:{searchTerm?:string;onUnauthorized:()=>void;onOpenAtendimento?:(id:string,tab:'chat'|'diagnosticos'|'mapa',conversationId?:string)=>void}) {
 const [rows,setRows]=useState<ConversationRow[]>([]),[next,setNext]=useState<number|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[available,setAvailable]=useState(true),[linksEnabled,setLinksEnabled]=useState(false)
 const [selected,setSelected]=useState<ConversationRow|null>(null),[links,setLinks]=useState<Links|null>(null),[version,setVersion]=useState(0)
 const dialog=useRef<HTMLDialogElement>(null),request=useRef<AbortController|null>(null)
 const fail=useCallback((e:unknown)=>{if((e as RequestFailure).status===401)onUnauthorized();else setError((e as Error).message||'Não foi possível carregar as conversas.')},[onUnauthorized])
 const load=useCallback(async(skip:number,signal:AbortSignal)=>{
  setBusy(true);setError('')
  try{const result=parseConversationList(await api('/api/chat/conversations?skip='+skip,{signal}));if(signal.aborted)return;setRows(p=>skip?[...p,...result.items.filter(r=>!p.some(x=>x.conversationId===r.conversationId))]:result.items);setNext(result.nextSkip);setAvailable(true);setLinksEnabled(result.linksEnabled===true)}
  catch(e){if(!signal.aborted){if((e as RequestFailure).status===404)setAvailable(false);else fail(e)}}finally{if(!signal.aborted)setBusy(false)}
 },[fail])
 useEffect(()=>{const c=new AbortController();request.current=c;void load(0,c.signal);return()=>c.abort()},[load,version])
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal()},[selected])
 useEffect(()=>()=>request.current?.abort(),[])
 async function details(row:ConversationRow){setSelected(row);setLinks(null);setError('');if(!linksEnabled)return;try{setLinks(await api<Links>('/api/chat/conversations/'+row.conversationId+'/atendimentos'))}catch(e){fail(e)}}
 async function open(row:ConversationRow){
  if((row.commercial?.atendimentoCount??0)!==1&&!row.atendimentoId){await details(row);return}
  try{const value=await api<{atendimentoId:string|null;state?:string}>('/api/chat/conversations/'+row.conversationId+'/active-atendimento');if(value.atendimentoId)onOpenAtendimento?.(value.atendimentoId,'chat',row.conversationId);else await details(row)}catch(e){fail(e)}
 }
 async function choose(row:ConversationRow,linkId:string,id:string){try{await api('/api/chat/conversations/'+row.conversationId+'/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({linkId})});setSelected(null);onOpenAtendimento?.(id,'chat',row.conversationId)}catch(e){fail(e)}}
 const q=searchTerm.trim().toLocaleLowerCase('pt-BR'),matches=rows.filter(r=>[name(r),r.phoneNumber,r.commercial?.preview].join(' ').toLocaleLowerCase('pt-BR').includes(q))
 return <section className="ev-reader"><header className="ev-header"><strong>Conversas</strong><button className="fh-filter" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Atualizar</button></header>
  {!available&&<Notice title="Canal ainda não habilitado">Os Atendimentos podem ser criados pelo Funil.</Notice>}
  {error&&<Notice title="Não foi possível concluir" error>{error}</Notice>}
  {busy&&<p role="status">Carregando conversas…</p>}
  {available&&!busy&&!matches.length&&<Notice title="Nenhuma conversa encontrada"/>}
  <div className="ev-list" aria-label="Lista de Conversas">{matches.map(row=>{
   const parts=row.commercial?.names??[{name:'Sem nome',entityId:null}],label=name(row),count=row.commercial?.atendimentoCount??0,initials=label==='Sem nome'?'':label.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toLocaleUpperCase('pt-BR')
   return <article className="conversation-row" key={row.conversationId}>
    <button className="conversation-hit" aria-label={'Abrir conversa: '+label} onClick={()=>void open(row)}/>
    <ConversationAvatar initials={initials} photo={row.commercial?.profilePhoto??null}/>
    <div className="conversation-info"><strong className="conversation-names" title={label}>{parts.map((p,i)=><span key={i}>{i?' / ':''}{p.name}{p.entityId&&<span className="entity-seal" role="img" aria-label={'Cadastro associado a '+p.name+'; não confirma identidade'} title="Cadastro associado; não confirma identidade"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="7" r="3"/><path d="M3 19c0-4 2-6 6-6 3 0 5 1 6 4m0 0 2 2 5-5"/></svg></span>}</span>)}</strong><span className="conversation-phone">{row.phoneNumber?'+'+row.phoneNumber:'Telefone pendente'}</span><span className="conversation-preview">{row.commercial?.preview??'Sem mensagens locais'}</span></div>
    <div className="conversation-right"><button className={'conversation-count '+(count===0?'warning':'')} aria-label={'Detalhes: '+count+' Atendimentos'} onClick={()=>void details(row)}>{count===0?'⚠':count>1?count+' atend.':<span aria-hidden="true"> </span>}</button><time dateTime={row.updatedAt??undefined}>{row.updatedAt?messageTime(row.updatedAt):'—'}</time>{!!row.unreadCount&&<span className="conversation-unread" aria-label={row.unreadCount+' mensagens não lidas'}>{row.unreadCount}</span>}</div>
   </article>
  })}</div>
  {next!==null&&<button className="fh-filter ev-more" disabled={busy} onClick={()=>{request.current?.abort();const c=new AbortController();request.current=c;void load(next,c.signal)}}>Carregar mais conversas</button>}
  {selected&&<dialog className="ev-choice-dialog" ref={dialog} onClose={()=>setSelected(null)} aria-label="Detalhes da conversa"><header><strong>Conversa · {selected.phoneNumber?'+'+selected.phoneNumber:'Telefone pendente'}</strong><button aria-label="Fechar detalhes" onClick={()=>setSelected(null)}>×</button></header>
   <p>O histórico pertence à conversa. A pessoa de referência pode ser diferente de quem usa o número.</p>
   <ul>{(selected.commercial?.names??[]).map((p,i)=><li key={i}>{p.name}{p.entityId?' · cadastro associado':''}</li>)}</ul>
   <div className="ev-choice-items">{links?.items.map(l=><button key={l.linkId} onClick={()=>void choose(selected,l.linkId,l.atendimentoId)}><strong>{l.name||'Sem nome'}</strong><span>{[l.vehicle,l.plate].filter(Boolean).join(' · ')||l.atendimentoId}</span></button>)}</div>
   <ContactNickname row={selected} onSaved={()=>{setSelected(null);setVersion(v=>v+1)}} onFailure={fail}/>
   {linksEnabled&&<ConversationLinksPanel conversationId={selected.conversationId} onUnauthorized={onUnauthorized}/>}
  </dialog>}
 </section>
}
function ConversationAvatar({initials,photo}:{initials:string;photo:string|null}){
 const [failed,setFailed]=useState(false)
 return <span className="conversation-avatar" aria-hidden="true">{photo&&!failed?<img src={photo} alt="" loading="lazy" onError={()=>setFailed(true)}/>:initials||<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 11a8 8 0 0 1-8 8 8 8 0 0 1-4-.9L3 20l1.8-4.9A8 8 0 1 1 20 11Z"/></svg>}</span>
}
function ContactNickname({row,onSaved,onFailure}:{row:ConversationRow;onSaved:()=>void;onFailure:(e:unknown)=>void}){
 const [nickname,setNickname]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[entityId,setEntityId]=useState<string|null>(null),[query,setQuery]=useState(''),[suggestions,setSuggestions]=useState<{id:string;text:string}[]>([]),[record,setRecord]=useState<{text:string;revision:number;nickname?:string;entityId:string|null}|null>(null),[failure,setFailure]=useState('')
 const id=row.commercial?.contactId
 useEffect(()=>{const c=new AbortController();if(!id)return;void api<{text:string;revision:number;nickname?:string;entityId:string|null}>('/api/customer-records/'+id,{signal:c.signal}).then(r=>{if(!c.signal.aborted){setRecord(r);setNickname(r.nickname??'');setEntityId(r.entityId)}}).catch(e=>{if(!c.signal.aborted){setFailure((e as Error).message);onFailure(e)}}).finally(()=>{if(!c.signal.aborted)setLoading(false)});return()=>c.abort()},[id,onFailure])
 useEffect(()=>{const c=new AbortController();if(query.trim().length<2){setSuggestions([]);return()=>c.abort()}const timer=setTimeout(()=>{void api<{items:{id:string;text:string}[]}>('/api/customer-records?kind=entity&q='+encodeURIComponent(query),{signal:c.signal}).then(r=>{if(!c.signal.aborted)setSuggestions(r.items)}).catch(()=>{})},250);return()=>{clearTimeout(timer);c.abort()}},[query])
 if(!id)return null
 return <form onSubmit={async e=>{e.preventDefault();if(!record)return;setBusy(true);setFailure('');try{await api('/api/customer-records/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:record.text,revision:record.revision,nickname,entityId})});onSaved()}catch(e){setFailure((e as Error).message);onFailure(e)}finally{setBusy(false)}}}><label>Nome opcional do Contato<input aria-label="Nome opcional do Contato" disabled={loading} maxLength={250} value={nickname} onChange={e=>setNickname(e.target.value)}/></label><p>Deixe vazio para usar os nomes dos Atendimentos.</p>
 <label>Buscar pessoa ou organização cadastrada<input aria-label="Associar cadastro ao Contato" value={query} onChange={e=>setQuery(e.target.value)}/></label>{suggestions.map(e=><button type="button" key={e.id} onClick={()=>{setEntityId(e.id);setNickname(e.text);setQuery('');setSuggestions([])}}>{e.text} · selecionar cadastro</button>)}{entityId&&<p>Cadastro associado; não comprova identidade. <button type="button" onClick={()=>setEntityId(null)}>Desassociar cadastro</button></p>}
 {failure&&<p role="alert">{failure}</p>}<button disabled={busy||loading||!record}>Salvar nome do Contato</button></form>
}
