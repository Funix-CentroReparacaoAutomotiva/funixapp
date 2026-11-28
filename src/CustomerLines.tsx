import {EntityEditor} from './EntityEditor'
import type {EntityRecord,EntityContact} from '../shared/customer'
import {groupedCustomerReferences,participantGroups,payerTypes} from '../shared/customer'
import {useEffect,useId,useRef,useState} from 'react'
import type {CustomerRecord,CustomerReference,CustomerReferences,ReferenceKind} from '../shared/customer'
import {api} from './api'
import {montadoraSuggestions, vehicleSuggestions} from './vehicle-registration'
import './customer-lines.css'
function VehicleIdentityFields({row, onChange, disabled, locked=false, onFocus, onBlur}: {
 row: CustomerReference
 onChange: (row: CustomerReference) => void
 disabled?: boolean
 locked?: boolean
 onFocus?: () => void
 onBlur?: () => void
}) {
 const list = useId()
 const legacyBrand = montadoraSuggestions.find(brand =>
   row.text.toLocaleLowerCase('pt-BR').startsWith(brand.toLocaleLowerCase('pt-BR') + ' '))
 const brand = row.brand ?? legacyBrand ?? ''
 const model = row.model ?? (legacyBrand ? row.text.slice(legacyBrand.length + 1) : row.text)
 const update = (nextBrand: string, nextModel: string) => onChange({
   ...row, brand: nextBrand, model: nextModel, text: [nextBrand.trim(), nextModel.trim()].filter(Boolean).join(' '),
 })
 return <>
   <label>Montadora<input list={list+'-brands'} value={brand} maxLength={120} disabled={disabled} readOnly={locked&&!!brand}
     onFocus={onFocus} onBlur={onBlur} onChange={event=>update(event.target.value, model)}/></label>
   <datalist id={list+'-brands'}>{montadoraSuggestions.map(name=><option key={name} value={name}/>)}</datalist>
   <label>Modelo<input list={list+'-models'} value={model} maxLength={120} disabled={disabled} readOnly={locked&&!!model}
     onFocus={onFocus} onBlur={onBlur} onChange={event=>update(brand, event.target.value)}/></label>
   <datalist id={list+'-models'}>{vehicleSuggestions(brand).map(name=><option key={name} value={name}/>)}</datalist>
 </>
}
function VehicleYear({label,year,onChange,disabled,readOnly}:{label:string;year?:string|null;onChange:(year:string)=>void;disabled?:boolean;readOnly?:boolean}) {
 const prefix=year?.startsWith('19')?'19':'20'
 const suffix=year?.startsWith(prefix)?year.slice(2):''
 return <label className="vehicle-year-label">{label}<span className="vehicle-year-control"><span aria-hidden="true">{prefix}</span><input aria-label={label} inputMode="numeric" pattern="[0-9]{2}" placeholder="__" maxLength={2} value={suffix} disabled={disabled} readOnly={readOnly}
  onChange={e=>{const digits=e.target.value.replace(/[^0-9]/g,'').slice(0,2);onChange(digits?prefix+digits:'')}}
  onPaste={e=>{const full=e.clipboardData.getData('text').trim();if(/^(19|20)\d{2}$/.test(full)){e.preventDefault();if(!readOnly)onChange(full)}}}/></span></label>
}
function validModelYear(fabrication?:string|null,model?:string|null){return !!fabrication&&/^\d{4}$/.test(fabrication)&&(model===fabrication||model===String(Number(fabrication)+1))}
function ModelYearChoice({fabrication,year,onChange,disabled,readOnly}:{fabrication?:string|null;year?:string|null;onChange:(v:string)=>void;disabled?:boolean;readOnly?:boolean}){
 const group=useId()
 const known=!!fabrication&&/^(19|20)\d{2}$/.test(fabrication)
 const options=[
  {slot:'empty',value:'',label:'Não informado',enabled:true},
  {slot:'same',value:fabrication??'',label:known?fabrication!:'Mesmo ano',enabled:known},
  {slot:'next',value:known?String(Number(fabrication)+1):'',label:known?String(Number(fabrication)+1):'Ano seguinte',enabled:known&&Number(fabrication)<2099},
 ]
 if(year&&!validModelYear(fabrication,year))options.push({slot:'legacy',value:year,label:year,enabled:true})
 return <fieldset className="visible-model-year" disabled={disabled||readOnly}>
   <legend>Ano do modelo</legend>
   <div className="model-year-options">{options.map(({slot,value,label,enabled})=><label key={slot}>
     <input type="radio" name={group} value={value} disabled={!enabled} checked={enabled&&(year??'')===value}
       onChange={()=>onChange(value)}/><span>{label}</span>
   </label>)}</div>
 </fieldset>
}
function ContactEmail({row,onChange,disabled}: {
 row:CustomerReference; onChange:(row:CustomerReference)=>void; disabled:boolean
}) {
 const [editing,setEditing]=useState(false)
 if(!row.id&&!row.text.trim())return null
 if(!editing&&!row.email)return <button type="button" className="contact-email-action" disabled={disabled}
   onClick={()=>setEditing(true)}>Adicionar e-mail</button>
 return <label className="contact-email">E-mail
   <input type="email" autoComplete="email" maxLength={254} disabled={disabled} value={row.email??''}
     onChange={event=>onChange({...row,email:event.target.value})}/>
 </label>
}

const titles:Record<ReferenceKind,string>={person:'Pessoas',contact:'Contatos',vehicle:'Veículo',payer:'Pagadores'}
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
  const grouped=kind==='person'||kind==='contact'?groupedCustomerReferences(value):value
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
  const grouped=kind==='person'||kind==='contact'?groupedCustomerReferences(value):value
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
 const line=(kind:ReferenceKind,row:CustomerReference,index:number,key?:string) =>
  <SmartLine key={index} version={version} kind={kind} row={row} disabled={disabled}
    onChange={next=>update(kind,index,{...next,...(kind==='payer'&&row.payerType?{payerType:row.payerType}:{})},key)} onEdit={setEditing}
    onMessage={onMessage?cid=>onMessage(cid,index):undefined}
    onRemove={()=>remove(kind,index,key)}/>
 return <div className="customer-lines">
 <section aria-label="Pessoas">
  <header><strong>Cliente</strong><button type="button" disabled={disabled} className="customer-inline-add" onClick={addPerson}>+ Adicionar entidade</button></header>
  {(groups.length?groups:[{person:{id:null,text:''} as CustomerReference,index:0,key:'legacy:0',contacts:[]}]).map(g=>
    <div className="customer-primary participant-block" key={g.key} role="group" aria-label={'Pessoa '+(g.index+1)}>
      <div><label className="customer-field-label">Nome</label>{line('person',g.person,g.index,g.key)}</div>
      <div className="participant-contacts" role="region" aria-label="Contatos"><label className="customer-field-label">Contato</label>
        {g.contacts.length?g.contacts.map(({contact,index})=>line('contact',contact,index,g.key)):
          <input className="first-contact-input" aria-label="Telefone" placeholder="Telefone" inputMode="tel" value="" disabled={disabled} onChange={e=>{
            const grouped=groupedCustomerReferences(value)
            const person=grouped.person.length?grouped.person:[{id:null,text:'',participantKey:g.key}]
            change({...grouped,person,contact:[...grouped.contact,{id:null,text:e.target.value,participantKey:g.key}]})
          }}/>}
        <button type="button" disabled={disabled||!value.person.length} className="customer-inline-add add-participant-contact" onClick={()=>addPhone(g.key)}><span aria-hidden="true">+ </span>Contato</button>
      </div>
      {groups.length>1&&<button type="button" disabled={disabled} onClick={()=>remove('person',g.index,g.key)}>Remover pessoa do Atendimento</button>}
    </div>)}
  {unassigned.some(({contact})=>contact.id||contact.text)&&<details className="customer-secondary">
    <summary>Revisar titular de telefones antigos</summary>
    <p>Estes registros foram preservados. Não pertencem automaticamente à primeira pessoa.</p>
    {unassigned.filter(({contact})=>contact.id||contact.text).map(({contact,index})=>
      <div key={index}><strong>{contact.text||'Telefone observado no WhatsApp'}</strong>
      {contact.entityId&&<button type="button" disabled={disabled} onClick={async()=>{
        try{
          const owner=await api<EntityRecord>('/api/customer-records/'+encodeURIComponent(contact.entityId!))
          const grouped=groupedCustomerReferences(latest.current)
          const existing=grouped.person.find(p=>p.id===owner.id)
          const key=existing?.participantKey??'entity:'+owner.id
          const person=existing?grouped.person:[...grouped.person,{id:owner.id,text:owner.text,participantKey:key}]
          const contacts=grouped.contact.map(c=>c.id===contact.id?{...c,entityId:owner.id,participantKey:key}:c)
          change({...grouped,person,contact:contacts})
        }catch(e){setGroupError((e as Error).message)}
      }}>Adicionar titular deste telefone</button>}
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
 <section aria-label="Veículo">
  <header><strong>Veículo</strong></header>
  {line('vehicle',value.vehicle[0]??{id:null,text:'',plate:''},0)}
  {value.vehicle.length>1&&<details className="customer-secondary"><summary>Revisar veículos adicionais antigos ({value.vehicle.length-1})</summary>
    <p>Cada Atendimento possui um veículo. Os vínculos anteriores foram preservados para revisão.</p>
    {value.vehicle.slice(1).map((row,index)=><div className="legacy-vehicle-reference" key={index}><span>{[row.text,row.plate].filter(Boolean).join(' · ')||'Veículo não identificado'}</span><button type="button" disabled={disabled} onClick={()=>remove('vehicle',index+1)}>Retirar vínculo</button></div>)}
  </details>}
 </section>
 <section aria-label={titles.payer}><header><strong>Pagamento</strong>{value.payer.filter(row=>row.id||row.text.trim()).length>1&&<span className="mixed-payers">Misto</span>}</header>
 {(value.payer.length?value.payer:[{id:null,text:''} as CustomerReference]).map((row,index)=><div className="payer-reference" key={index}>
   <label>Quem irá pagar?<select aria-label={'Tipo de pagante '+(index+1)} value={row.payerType??''} disabled={disabled} onChange={e=>{
     const type=e.target.value as CustomerReference['payerType'];const next={...row};if(type)next.payerType=type;else delete next.payerType
     update('payer',index,next)
   }}><option value="">Não informado</option>{payerTypes.map(type=><option key={type}>{type}</option>)}</select></label>
   <div><label className="customer-field-label">Nome / Pagante</label>{(!row.payerType&&!row.id&&!row.text.trim())?<input aria-label="Pagador" disabled placeholder="Selecionar entidade"/>:line('payer',row,index)}</div>
 </div>)}
 <button type="button" disabled={disabled||!value.payer.some(r=>r.payerType||r.id||r.text.trim())} onClick={()=>add('payer')}>+ Adicionar pagante</button>
 </section>
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
 }}/>:<><h3>Cadastro compartilhado</h3><p>Alterações aparecem nos Atendimentos que selecionaram este registro.</p>{editing.kind==='vehicle'?<VehicleIdentityFields row={editing} onChange={row=>setEditing({...editing,...row,id:editing.id})} disabled={saving}/>:<label>Telefone<input value={editing.text} readOnly={!!editing.conversationId} onChange={e=>setEditing({...editing,text:e.target.value})}/></label>}{editing.kind==='vehicle'&&<><label>Placa<input value={editing.plate??''} onChange={e=>setEditing({...editing,plate:e.target.value})}/></label><div className="smart-years"><VehicleYear label="Ano de fabricação" year={editing.fabricationYear} disabled={saving} onChange={fabricationYear=>setEditing({...editing,fabricationYear,modelYear:validModelYear(fabricationYear,editing.modelYear)?editing.modelYear:null})}/><ModelYearChoice fabrication={editing.fabricationYear} year={editing.modelYear} disabled={saving} onChange={modelYear=>setEditing({...editing,modelYear})}/></div></>}
 <button type="button" disabled={saving} onClick={()=>{const kind=Object.keys(titles).find(k=>value[k as ReferenceKind].some(r=>r.id===editing.id))as ReferenceKind|undefined;if(kind)onChange({...value,[kind]:value[kind].map(r=>r.id===editing.id?(kind==='vehicle'?{id:null,text:'',plate:''}:{...r,id:null,entityId:undefined}):r)});setEditing(null)}}>Trocar seleção neste Atendimento</button>
 {failure&&<p role="alert">{failure}</p>}<button type="button" disabled={saving} onClick={()=>setEditing(null)}>Fechar</button><button type="button" disabled={saving} onClick={async()=>{setSaving(true);setFailure('');try{const record=await api<CustomerRecord>('/api/customer-records'+(editing.id?'/'+editing.id:''),{method:editing.id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:editing.kind,text:editing.text,revision:editing.revision,...(editing.kind==='vehicle'?{brand:editing.brand,model:editing.model,plate:editing.plate,fabricationYear:editing.fabricationYear,modelYear:editing.modelYear}:{})})});onChange(Object.fromEntries(Object.entries(value).map(([k,rows])=>[k,rows.map((r:CustomerReference)=>r.id===record.id?{...r,id:record.id,text:record.text,...(record.kind==='vehicle'?{brand:record.brand,model:record.model,plate:record.plate,fabricationYear:record.fabricationYear,modelYear:record.modelYear}:{})}:r)]))as CustomerReferences);setEditing(null)}catch(e){setFailure((e as Error).message)}finally{setSaving(false)}}}>Salvar cadastro</button></>}</dialog>}
 </div>
}
function SmartLine({kind,row,version,disabled,onChange,onEdit,onRemove,onMessage}:{kind:ReferenceKind;row:CustomerReference;version:number;disabled:boolean;onChange:(v:CustomerReference)=>void;onEdit:(r:CustomerRecord)=>void;onRemove:()=>void;onMessage?:(conversationId:string|null,contactIndex?:number)=>void}){
 const [suggestions,setSuggestions]=useState<Array<CustomerRecord&{ownerName?:string}>>([]),[record,setRecord]=useState<CustomerRecord|null>(null),[error]=useState(''),[focused,setFocused]=useState(false)
 useEffect(()=>{const c=new AbortController();if(row.id){void api<CustomerRecord>('/api/customer-records/'+row.id,{signal:c.signal}).then(r=>{if(!c.signal.aborted)setRecord(r)}).catch(()=>{});return()=>c.abort()}setRecord(null);return()=>c.abort()},[row.id,version])
 const search=kind==='vehicle'&&row.plate?.trim()?row.plate:row.text
 useEffect(()=>{const c=new AbortController();if(row.id||search.trim().length<2){setSuggestions([]);return()=>c.abort()}const timer=setTimeout(()=>{void api<{items:Array<CustomerRecord&{ownerName?:string}>}>('/api/customer-records?kind='+registryKind(kind)+'&q='+encodeURIComponent(search),{signal:c.signal}).then(r=>{if(!c.signal.aborted)setSuggestions(r.items)}).catch(()=>{})},250);return()=>{clearTimeout(timer);c.abort()}},[kind,row.id,search])
 const invalid=kind==='contact'?/[^\d\s+().-]/.test(row.text):kind==='vehicle'?([row.fabricationYear,row.modelYear].some(y=>y&&!/^(19|20)\d{2}$/.test(y))||!!row.plate&&!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/i.test(row.plate)):false
 const observed=kind==='contact'?(record as EntityContact|null)?.whatsapp?.observedPhone:undefined
 const state=row.id?'recognized':invalid?'invalid':suggestions.length?'attention':'unknown',labels={recognized:'Cadastro selecionado; não comprova identidade',invalid:'Formato inválido ou incompleto',attention:'Há sugestões; selecione somente se corresponder',unknown:'Informação livre; nenhum cadastro associado'}
 return <div className="smart-row"><span className={'reference-state '+state} role="img" aria-label={labels[state]} title={labels[state]}>{row.id?'✓':invalid?'⊗':suggestions.length?'⚠':'?'}</span><div className="smart-main"><div className="smart-fields">
 {kind==='vehicle'?<div className="smart-free vehicle-fields">
   <label>Placa<input aria-label="Placa" placeholder="ABC1D23" value={row.plate??''} disabled={disabled} readOnly={!!row.id&&!!row.plate}
     maxLength={7} autoCapitalize="characters" onFocus={()=>setFocused(true)} onBlur={()=>setTimeout(()=>setFocused(false),150)} onChange={e=>onChange({...row,id:null,plate:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')})}/></label>
   <div className="vehicle-model-fields"><VehicleIdentityFields row={row} onChange={next=>onChange({...next,id:null})} disabled={disabled} locked={!!row.id} onFocus={()=>setFocused(true)} onBlur={()=>setTimeout(()=>setFocused(false),150)}/></div>
   <div className="smart-years"><VehicleYear label="Ano de fabricação" year={row.fabricationYear} disabled={disabled} readOnly={!!row.id&&!!row.fabricationYear} onChange={year=>onChange({...row,id:null,fabricationYear:year,modelYear:validModelYear(year,row.modelYear)?row.modelYear:null})}/><ModelYearChoice fabrication={row.fabricationYear} year={row.modelYear} disabled={disabled} readOnly={!!row.id&&!!row.modelYear} onChange={year=>onChange({...row,id:null,modelYear:year})}/></div>
 </div>:row.id?<span className="smart-locked">{(record?.text??row.text)||(kind==='contact'?observed||'Telefone não informado':'')}{kind==='contact'&&observed&&!record?.text&&<small> · observado pelo WhatsApp</small>}</span>:<div className="smart-free"><input aria-label={kind==='contact'?'Telefone':kind==='payer'?'Pagador':'Pessoa de referência'} inputMode={kind==='contact'?'tel':'text'} placeholder={kind==='contact'?'Telefone':kind==='payer'?'Selecionar entidade':'Nome informado'} value={row.text} maxLength={250} disabled={disabled} onFocus={()=>setFocused(true)} onBlur={()=>setTimeout(()=>setFocused(false),150)} onChange={e=>onChange({...row,text:e.target.value})}/></div>}

 {kind==='contact'&&<button type="button" disabled={disabled||!onMessage||(!record?.conversationId&&!/^\+[1-9]\d{7,14}$/.test(row.text.replace(/[\s().-]/g,'')))} aria-label="Escrever mensagem opcional" title={record?.conversationId?'Abrir Chat; envio exige confirmação':'Abrir conversa para o telefone salvo com + e DDI; nenhum envio automático'} onClick={()=>onMessage?.(record?.conversationId??null)}>✉</button>}
 {row.id&&kind==='contact'?<button type="button" aria-label="Retirar telefone deste Atendimento" disabled={disabled} onClick={onRemove}>×</button>:row.id?<button type="button" aria-label="Editar cadastro selecionado" disabled={disabled||!record} onClick={()=>record&&onEdit(record)}>✎</button>:kind!=='vehicle'?<button type="button" aria-label="Remover linha" disabled={disabled} onClick={onRemove}>×</button>:null}
 </div>{kind==='contact'&&<ContactEmail row={row} onChange={onChange} disabled={disabled}/>}{!row.id&&focused&&suggestions.length>0&&<div className="smart-suggestions">{suggestions.map(r=><button key={r.id} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange({id:r.id,text:r.text,...(kind==='contact'?{entityId:r.entityId,...(row.email!==undefined?{email:row.email}:{})}:{}),...(kind==='vehicle'?{brand:r.brand,model:r.model,plate:r.plate,fabricationYear:r.fabricationYear,modelYear:r.modelYear}:{})});setSuggestions([])}}>{r.text}{r.plate?' · '+r.plate:''}{r.ownerName&&<span aria-hidden="true"> · {r.ownerName}</span>}</button>)}</div>}{error&&<p role="alert">{error}</p>}</div>
 </div>
}
