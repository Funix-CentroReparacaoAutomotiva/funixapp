import {useEffect,useState} from 'react'
import type {CustomerRecord} from '../../shared/customer'
import {api} from '../api'

type Person={id:string|null;text:string;index:number}
type Identity={
  phone:string|null; blocked:boolean; token:string
  owner:{id:string;text:string;confirmed:boolean}|null
  targets:{id:string;name:string;people:Person[];reconciled:boolean}[]
}

export function ConversationIdentity({conversationId,onSaved}:{conversationId:string;onSaved:(name:string)=>void}){
  const path='/api/chat/conversations/'+conversationId+'/identity'
  const [view,setView]=useState<Identity|null>(null),[target,setTarget]=useState('')
  const [name,setName]=useState(''),[selected,setSelected]=useState<Person|null>(null)
  const [suggestions,setSuggestions]=useState<CustomerRecord[]>([])
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const [operation,setOperation]=useState<{key:string;id:string}|null>(null)
  const [done,setDone]=useState(false)

  function suggest(identity:Identity,id:string){
    const people=identity.targets.find(item=>item.id===id)?.people??[]
    const person=identity.owner?{...identity.owner,index:-1}:people.length===1?people[0]!:null
    setSelected(person)
    setName(person?.text??'')
  }
  useEffect(()=>{
    const controller=new AbortController()
    void api<Identity>(path,{signal:controller.signal}).then(identity=>{
      if(controller.signal.aborted)return
      const id=identity.targets.length===1?identity.targets[0]!.id:''
      setView(identity);setTarget(id);suggest(identity,id)
    }).catch(error=>{if(!controller.signal.aborted)setError(error.message)})
    return ()=>controller.abort()
  },[path])
  useEffect(()=>{
    if(name.trim().length<2||selected?.id||view?.owner)return
    const controller=new AbortController()
    const timer=setTimeout(()=>{
      void api<{items:CustomerRecord[]}>('/api/customer-records?kind=entity&q='+encodeURIComponent(name.trim().slice(0,150)),{signal:controller.signal})
        .then(result=>{if(!controller.signal.aborted)setSuggestions(result.items)})
        .catch(()=>{})
    },250)
    return ()=>{controller.abort();clearTimeout(timer)}
  },[name,selected?.id,view?.owner])

  async function confirm(){
    if(!view||busy)return
    const people=view.targets.find(item=>item.id===target)?.people??[]
    const matching=people.filter(person=>!person.id&&person.text===selected?.text)
    const legacy=selected&&!selected.id?selected.index:
      matching.length===1&&people.length===1?matching[0]!.index:undefined
    const body={token:view.token,atendimentoId:target||null,entityId:selected?.id??null,
      ...(selected?.id?{}:{name:name.trim()}),...(legacy===undefined?{}:{legacyIndex:legacy})}
    const key=JSON.stringify(body),requestId=operation?.key===key?operation.id:crypto.randomUUID()
    setOperation({key,id:requestId});setBusy(true);setError('')
    try{
      await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId})})
      setDone(true);onSaved(selected?.text??name.trim())
    }catch(cause){setError((cause as Error).message)}
    finally{setBusy(false)}
  }

  if(!view)return error?<p role="alert">{error}</p>:null
  if(view.blocked)return <p role="status">A titularidade do número precisa de revisão.</p>
  if(!view.phone)return <p role="status">Telefone do WhatsApp pendente de confirmação.</p>
  if(done||view.targets.length===1&&view.targets[0]!.reconciled||view.owner?.confirmed&&!view.targets.length)return <p role="status">Pessoa confirmada nesta conversa.</p>
  const people=view.targets.find(item=>item.id===target)?.people??[]
  const waitingForTarget=view.targets.length>1&&!target
  return <form className="conversation-identity" onSubmit={event=>{event.preventDefault();void confirm()}}>
    {view.targets.length>1&&<label>Atendimento para identificação<select aria-label="Atendimento para identificação" value={target} disabled={busy} onChange={event=>{
      setTarget(event.target.value);suggest(view,event.target.value);setSuggestions([])
    }}><option value="">Selecione o Atendimento</option>{view.targets.map(item=><option key={item.id} value={item.id}>{item.name||'Atendimento '+item.id.slice(0,8)}</option>)}</select></label>}
    {!waitingForTarget&&<>
      {view.owner?<p>{view.owner.text}</p>:<>
        {people.length>1&&<label>Pessoa da ficha<select aria-label="Pessoa da ficha" value={selected&&selected.index>=0?String(selected.index):''} disabled={busy} onChange={event=>{
          const person=people.find(item=>String(item.index)===event.target.value)??null
          setSelected(person);setName(person?.text??'');setSuggestions([])
        }}><option value="">Outra pessoa ou organização</option>{people.map(person=><option key={person.index} value={person.index}>{person.text}</option>)}</select></label>}
        <label>Pessoa deste número<input aria-label="Pessoa deste número" value={name} maxLength={250} disabled={busy} onChange={event=>{
          setName(event.target.value);setSelected(null);setSuggestions([])
        }}/></label>
        {!selected?.id&&suggestions.map(person=><button key={person.id} type="button" disabled={busy} onClick={()=>{
          setSelected({...person,index:-1});setName(person.text);setSuggestions([])
        }}>Selecionar {person.text}</button>)}
      </>}
      <button type="submit" disabled={busy||!name.trim()}>{busy?'Confirmando…':selected?.id?'Confirmar pessoa':'Identificar pessoa'}</button>
    </>}
    {error&&<p role="alert">{error}</p>}
  </form>
}
