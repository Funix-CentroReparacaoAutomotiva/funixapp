import {EntityEditor,EntityContacts} from './EntityEditor'
import type {EntityRecord} from '../shared/customer'
import {groupedCustomerReferences,participantGroups} from '../shared/customer'
import {useEffect,useRef,useState} from 'react'
import type {CustomerRecord,CustomerReference,CustomerReferences,ReferenceKind} from '../shared/customer'
import {api} from './api'
import './customer-lines.css'
const titles:Record<ReferenceKind,string>={person:'Pessoas',contact:'Contatos',vehicle:'Veículos',payer:'Pagadores'}
const registryKind=(kind:ReferenceKind)=>kind==='person'||kind==='payer'?'entity':kind
export function CustomerLines({value,onChange,disabled,onMessage}:{value:CustomerReferences;onChange:(v:CustomerReferences)=>void;disabled:boolean;onMessage?:(conversationId:string|null,contactIndex?:number)=>void}){
 const [editing,setEditing]=useState<CustomerRecord|null>(null),[failure,setFailure]=useState(''),[saving,setSaving]=useState(false),[version,setVersion]=useState(0)
 const dialog=useRef<HTMLDialogElement>(null)
 const latest=useRef(value)
 latest.current=value
 useEffect(()=>{if(editing&&!dialog.current?.open)dialog.current?.showModal()},[editing])
 const {groups,unassigned}=participantGroups(value)
 const [groupError,setGroupError]=useState('')
 function change(next:CustomerReferences){latest.current=next;onChange(next)}
 function update(kind:ReferenceKind,index:number,next:CustomerReference,participantKey?:string){
  setGroupError('')
  const grouped=groupedCustomerReferences(value)
  const rows=[...grouped[kind]]
  const key=participantKey??rows[index]?.participantKey
  if(kind==='contact'&&key&&next.entityId){
    const owner=grouped.person.find(p=>p.participantKey===key)
    if(owner?.id&&owner.id!==next.entityId){setGroupError('Este telefone pertence a outra pessoa. Adicione essa pessoa ao Atendimento.');return}
  }
  rows[index]={...next,...(key?{participantKey:key}:{})}
  const changed={...grouped,[kind]:rows}
  change(changed)
  if(kind==='person'&&next.id&&key)
    void api<EntityRecord>('/api/customer-records/'+encodeURIComponent(next.id)).then(entity=>{
      const current=latest.current
      if(!current.person.some(p=>p.participantKey===key&&p.id===next.id)||
        current.contact.some(c=>c.participantKey===key&&(c.id||c.text.trim())))return
      const phones=entity.contacts.filter(contact=>!!contact.text.trim()&&contact.whatsapp.state!=='conflict')
      if(phones.length!==1)return
      const contact=phones[0]!
      change({...current,contact:[...current.contact.filter(c=>c.participantKey!==key),{id:contact.id,text:contact.text,entityId:entity.id,participantKey:key}]})
    }).catch(()=>{})
 }
 function add(kind:ReferenceKind){change({...value,[kind]:[...value[kind],{id:null,text:''}]})}
 function remove(kind:ReferenceKind,index:number,participantKey?:string){
  const grouped=groupedCustomerReferences(value)
  if(kind==='person'&&participantKey){
    const person=grouped.person.filter((_,n)=>n!==index)
    change({...grouped,person:person.length?person:[{id:null,text:'',participantKey:crypto.randomUUID()}],
      contact:grouped.contact.filter(c=>c.participantKey!==participantKey)})
  }else change({...grouped,[kind]:grouped[kind].filter((_,n)=>n!==index)})
 }
 function addPerson(){
  const grouped=groupedCustomerReferences(value)
  change({...grouped,person:[...grouped.person,{id:null,text:'',participantKey:crypto.randomUUID()}]})
 }
 function addPhone(key:string){
  const grouped=groupedCustomerReferences(value)
  change({...grouped,contact:[...grouped.contact,{id:null,text:'',participantKey:key}]})
 }
 const line=(kind:ReferenceKind,row:CustomerReference,index:number,key?:string,selectedIds:string[]=[]) =>
  <SmartLine key={index} version={version} kind={kind} row={row} primaryContactId={selectedIds[0]??null} disabled={disabled}
    onChange={next=>update(kind,index,next,key)} onEdit={setEditing}
    onMessage={onMessage?cid=>onMessage(cid,index):undefined}
    onRemove={()=>remove(kind,index,key)}/>
 return <div className="customer-lines">
 <section aria-label="Pessoas">
  <header><strong>Pessoa e telefone</strong><button type="button" disabled={disabled} onClick={addPerson}>+ Adicionar pessoa</button></header>
  {(groups.length?groups:[{person:{id:null,text:''} as CustomerReference,index:0,key:'legacy:0',contacts:[]}]).map(g=>
    <div className="customer-primary participant-block" key={g.key} role="group" aria-label={'Pessoa '+(g.index+1)}>
      <div><label className="customer-field-label">Nome</label>{line('person',g.person,g.index,g.key,g.contacts.filter(c=>c.contact.text).flatMap(c=>c.contact.id?[c.contact.id]:[]))}</div>
      <div role="region" aria-label="Contatos"><label className="customer-field-label">Telefone desta pessoa</label>
        {g.contacts.length?g.contacts.map(({contact,index})=>line('contact',contact,index,g.key)):
          <input aria-label="Telefone" placeholder="Telefone" inputMode="tel" value="" disabled={disabled} onChange={e=>{
            const grouped=groupedCustomerReferences(value)
            const person=grouped.person.length?grouped.person:[{id:null,text:'',participantKey:g.key}]
            change({...grouped,person,contact:[...grouped.contact,{id:null,text:e.target.value,participantKey:g.key}]})
          }}/>}
        <button type="button" disabled={disabled||!value.person.length} onClick={()=>addPhone(g.key)}>+ Outro telefone desta pessoa</button>
      </div>
      {groups.length>1&&<button type="button" disabled={disabled} onClick={()=>remove('person',g.index,g.key)}>Remover pessoa do Atendimento</button>}
    </div>)}
  {unassigned.some(({contact})=>contact.id||contact.text)&&<details open className="customer-secondary">
    <summary>Telefones antigos sem pessoa identificada</summary>
    <p>Estes registros foram preservados. Não pertencem automaticamente à primeira pessoa.</p>
    {unassigned.filter(({contact})=>contact.id||contact.text).map(({contact,index})=>
      <div key={index}><strong>{contact.text||'Telefone observado no WhatsApp'}</strong>
      {!contact.entityId&&<select aria-label="Pessoa deste telefone antigo" value="" disabled={disabled} onChange={e=>{
        const grouped=groupedCustomerReferences(value)
        if(!e.target.value)return
        const contacts=[...grouped.contact];contacts[index]={...contact,participantKey:e.target.value}
        change({...grouped,contact:contacts})
      }}><option value="">Identificar pessoa</option>{groups.map(g=><option key={g.key} value={g.key}>{g.person.text||'Pessoa '+(g.index+1)}</option>)}</select>}
      </div>)}
  </details>}
  {groupError&&<p role="alert">{groupError}</p>}
 </section>
 {(['vehicle','payer'] as const).map(kind=><section key={kind} aria-label={titles[kind]}><header><strong>{titles[kind]}</strong><button type="button" disabled={disabled} onClick={()=>add(kind)}>+ Adicionar</button></header>
 {value[kind].map((row,index)=>line(kind,row,index))}
 {kind==='vehicle'&&<button type="button" disabled={disabled} onClick={()=>setEditing({id:'',kind:'vehicle',text:'',revision:0})}>Cadastrar veículo</button>}
 </section>)}
 {editing&&<dialog className="customer-record-dialog" onKeyDown={e=>e.stopPropagation()} ref={dialog} aria-label="Editar cadastro selecionado" onClose={()=>setEditing(null)}>{editing.kind==='entity'?<EntityEditor key={editing.id} record={editing} onClose={()=>setEditing(null)} onSaved={record=>{
  const next=groupedCustomerReferences(latest.current)
  const index=next.person.findIndex(r=>r.id===record.id)
  if(index>=0){
    const person=next.person[index]!
    next.person[index]={...person,text:record.text}
    const sole=record.contacts.length===1?record.contacts[0]:null
    if(sole?.text.trim()&&!next.contact.some(c=>c.participantKey===person.participantKey&&(c.id||c.text.trim())))
      next.contact.push({id:sole.id,text:sole.text,entityId:record.id,participantKey:person.participantKey})
  }
  onChange(next);setEditing(null);setVersion(v=>v+1)
 }}/>:<><h3>Cadastro compartilhado</h3><p>Alterações aparecem nos Atendimentos que selecionaram este registro.</p><label>{editing.kind==='contact'?'Telefone':'Nome / marca e modelo'}<input value={editing.text} readOnly={!!editing.conversationId} onChange={e=>setEditing({...editing,text:e.target.value})}/></label>{editing.kind==='vehicle'&&<><label>Placa<input value={editing.plate??''} onChange={e=>setEditing({...editing,plate:e.target.value})}/></label><label>Fabricação<input value={editing.fabricationYear??''} onChange={e=>setEditing({...editing,fabricationYear:e.target.value})}/></label><label>Ano-modelo<input value={editing.modelYear??''} onChange={e=>setEditing({...editing,modelYear:e.target.value})}/></label></>}
 <button type="button" disabled={saving} onClick={()=>{const kind=Object.keys(titles).find(k=>value[k as ReferenceKind].some(r=>r.id===editing.id))as ReferenceKind|undefined;if(kind)onChange({...value,[kind]:value[kind].map(r=>r.id===editing.id?{...r,id:null,entityId:undefined}:r)});setEditing(null)}}>Trocar seleção neste Atendimento</button>
 {failure&&<p role="alert">{failure}</p>}<button type="button" disabled={saving} onClick={()=>setEditing(null)}>Fechar</button><button type="button" disabled={saving} onClick={async()=>{setSaving(true);setFailure('');try{const record=await api<CustomerRecord>('/api/customer-records'+(editing.id?'/'+editing.id:''),{method:editing.id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:editing.kind,text:editing.text,revision:editing.revision,...(editing.kind==='vehicle'?{plate:editing.plate,fabricationYear:editing.fabricationYear,modelYear:editing.modelYear}:{})})});onChange(Object.fromEntries(Object.entries(value).map(([k,rows])=>[k,rows.map((r:CustomerReference)=>r.id===record.id?{...r,id:record.id,text:record.text,...(record.kind==='vehicle'?{plate:record.plate,fabricationYear:record.fabricationYear,modelYear:record.modelYear}:{})}:r)]))as CustomerReferences);setEditing(null)}catch(e){setFailure((e as Error).message)}finally{setSaving(false)}}}>Salvar cadastro</button></>}</dialog>}
 </div>
}
function SmartLine({kind,row,primaryContactId,version,disabled,onChange,onEdit,onRemove,onMessage}:{kind:ReferenceKind;row:CustomerReference;primaryContactId:string|null;version:number;disabled:boolean;onChange:(v:CustomerReference)=>void;onEdit:(r:CustomerRecord)=>void;onRemove:()=>void;onMessage?:(conversationId:string|null,contactIndex?:number)=>void}){
 const [suggestions,setSuggestions]=useState<Array<CustomerRecord&{ownerName?:string}>>([]),[record,setRecord]=useState<CustomerRecord|null>(null),[error]=useState(''),[focused,setFocused]=useState(false)
 useEffect(()=>{const c=new AbortController();if(row.id){void api<CustomerRecord>('/api/customer-records/'+row.id,{signal:c.signal}).then(r=>{if(!c.signal.aborted)setRecord(r)}).catch(()=>{});return()=>c.abort()}setRecord(null);return()=>c.abort()},[row.id,version])
 useEffect(()=>{const c=new AbortController();if(row.id||row.text.trim().length<2){setSuggestions([]);return()=>c.abort()}const timer=setTimeout(()=>{void api<{items:Array<CustomerRecord&{ownerName?:string}>}>('/api/customer-records?kind='+registryKind(kind)+'&q='+encodeURIComponent(row.text),{signal:c.signal}).then(r=>{if(!c.signal.aborted)setSuggestions(r.items)}).catch(()=>{})},250);return()=>{clearTimeout(timer);c.abort()}},[kind,row.id,row.text])
 const invalid=kind==='contact'?/[^\d\s+().-]/.test(row.text):kind==='vehicle'?([row.fabricationYear,row.modelYear].some(y=>y&&!/^(19|20)\d{2}$/.test(y))||!!row.plate&&!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/i.test(row.plate)):false
 const state=row.id?'recognized':invalid?'invalid':suggestions.length?'attention':'unknown',labels={recognized:'Cadastro selecionado; não comprova identidade',invalid:'Formato inválido ou incompleto',attention:'Há sugestões; selecione somente se corresponder',unknown:'Informação livre; nenhum cadastro associado'}
 return <div className="smart-row"><span className={'reference-state '+state} role="img" aria-label={labels[state]} title={labels[state]}>{row.id?'✓':invalid?'⊗':suggestions.length?'⚠':'?'}</span><div className="smart-main"><div className="smart-fields">
 {row.id?<span className="smart-locked">{record?.text??row.text}{kind==='vehicle'&&[record?.plate,record?.fabricationYear,record?.modelYear].filter(Boolean).map(v=>' · '+v)}</span>:<div className="smart-free"><input aria-label={kind==='contact'?'Telefone':kind==='vehicle'?'Marca e modelo':kind==='payer'?'Pagador':'Pessoa de referência'} inputMode={kind==='contact'?'tel':'text'} placeholder={kind==='contact'?'Telefone':kind==='vehicle'?'Marca e modelo':'Nome informado'} value={row.text} maxLength={250} disabled={disabled} onFocus={()=>setFocused(true)} onBlur={()=>setTimeout(()=>setFocused(false),150)} onChange={e=>onChange({...row,text:e.target.value})}/>{kind==='vehicle'&&<><input aria-label="Placa" placeholder="Placa" value={row.plate??''} onChange={e=>onChange({...row,plate:e.target.value.toUpperCase()})}/><div className="smart-years">{(['fabricationYear','modelYear']as const).map(key=><label key={key}>{key==='fabricationYear'?'Fabricação':'Ano-modelo'}<input aria-label={key==='fabricationYear'?'Ano de fabricação':'Ano do modelo'} inputMode="numeric" maxLength={4} value={row[key]??''} onChange={e=>onChange({...row,[key]:e.target.value})}/></label>)}</div></>}</div>}
 {kind==='contact'&&<button type="button" disabled={disabled||!onMessage||(!record?.conversationId&&!/^\+[1-9]\d{7,14}$/.test(row.text.replace(/[\s().-]/g,'')))} aria-label="Escrever mensagem opcional" title={record?.conversationId?'Abrir Chat; envio exige confirmação':'Abrir conversa para o telefone salvo com + e DDI; nenhum envio automático'} onClick={()=>onMessage?.(record?.conversationId??null)}>✉</button>}
 {row.id?<button type="button" aria-label="Editar cadastro selecionado" disabled={disabled||!record} onClick={()=>record&&onEdit(record)}>✎</button>:<button type="button" aria-label="Remover linha" disabled={disabled} onClick={onRemove}>×</button>}
 </div>{!row.id&&focused&&suggestions.length>0&&<div className="smart-suggestions">{suggestions.map(r=><button key={r.id} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange({id:r.id,text:r.text,...(kind==='contact'?{entityId:r.entityId}:{}),...(kind==='vehicle'?{plate:r.plate,fabricationYear:r.fabricationYear,modelYear:r.modelYear}:{})});setSuggestions([])}}>{r.text}{r.plate?' · '+r.plate:''}{r.ownerName&&<span aria-hidden="true"> · {r.ownerName}</span>}</button>)}</div>}{row.id&&kind==='person'&&!!(record as EntityRecord|null)?.contacts?.length&&<details className="customer-linked-phones" open={(record as EntityRecord).contacts.some(c=>c.whatsapp?.state==='available'||c.whatsapp?.state==='history_only')}><summary>WhatsApp e números cadastrados</summary><EntityContacts contacts={(record as EntityRecord).contacts} primaryContactId={primaryContactId} onRefresh={()=>{void api<EntityRecord>('/api/customer-records/'+row.id).then(setRecord).catch(()=>{})}}/></details>}{error&&<p role="alert">{error}</p>}</div>
 </div>
}
