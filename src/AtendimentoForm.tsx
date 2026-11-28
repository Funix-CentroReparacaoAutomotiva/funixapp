import {CustomerLines} from './CustomerLines'
import type {CustomerReferences} from '../shared/customer'
import {participantGroups,contactSelectionKey} from '../shared/customer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento, AtendimentoInput, DuplicateAtendimento } from '../shared/contracts'
import { api } from './api'
import {Login} from './ui'
import type { RequestFailure } from './api'
import {validVehicleYear} from './vehicle-registration'
import { salesChannels } from '../shared/sales'
import type { SalesContext, SalesStage } from '../shared/sales'

type InlineData = {context:SalesContext;stages:SalesStage[];scheduled:boolean}
type Draft = AtendimentoInput & {nextContactAt?:string}
const localDateTime = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
import './vehicle-registration.css'

function initialFields(record?: Atendimento, inline?:InlineData): Draft {
  return {
    ...(inline?{nextContactAt:inline.context.nextContactAt?localDateTime.format(new Date(inline.context.nextContactAt)).replace(' ','T'):''}:{}),
    closed:!!record?.closedAt,
    purpose:record ? record.purpose : 'commercial',
    channel:record?.channel??(record?'':'Balcão'),
    references:record?.references??{person:[{id:null,text:record?.name??''}],contact:[{id:null,text:record?.phone??''}],vehicle:[{id:null,text:record?.vehicle??'',plate:record?.plate??'',fabricationYear:record?.fabricationYear??'',modelYear:record?.modelYear??''}],payer:[]},
    phone: record?.phone ?? '', name: record?.name ?? '', vehicle: record?.vehicle ?? '',
    brand: record?.brand ?? '', model: record?.model ?? '', plate: record?.plate ?? '',
    fabricationYear: record?.fabricationYear ?? (record ? null : ''),
    modelYear: record?.modelYear ?? (record ? null : ''),
    notes: record?.notes ?? '', stage: record?.stage ?? 'novo-lead',
    rejectionReason: record?.rejectionReason ?? '', explicitRefusal: record?.explicitRefusal ?? false,
  }
}

export function AtendimentoForm({ record, conversationId, onSaved, onAutoSaved, onDirty, onBusy, onAuthRequired, onMessage, onOpenExisting, inline }: {
  inline?: InlineData
  record?: Atendimento
  conversationId?:string|null
  onSaved: (record: Atendimento) => void
  onAutoSaved?: (record: Atendimento, contactsChanged: boolean) => void
  onDirty: (dirty: boolean) => void
  onBusy: (busy: boolean) => void
  onMessage?: (id:string)=>void
  onOpenExisting?: (id:string)=>void
  onAuthRequired: () => void
}) {
  const initial = useMemo(() => initialFields(record,inline), [record,inline])
  const [fields, setFields] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [reauth,setReauth]=useState(false)
  const [conflict, setConflict] = useState(false)
  const [duplicates,setDuplicates] = useState<{items:DuplicateAtendimento[];confirmationToken:string}|null>(null)
  const [baseline,setBaseline] = useState(initial)
  const revisionRef=useRef(record?.revision??0)
  const salesRevisionRef=useRef(inline?.context.revision??0)
  const fieldsRef=useRef(fields)
  const inFlight=useRef(false)
  const dirty = JSON.stringify(fields) !== JSON.stringify(baseline)
  fieldsRef.current=fields
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])
  useEffect(()=>{
    if(!inline||!record||dirty||inFlight.current||record.revision<revisionRef.current||inline.context.revision<salesRevisionRef.current)return
    if(record.revision===revisionRef.current&&inline.context.revision===salesRevisionRef.current)return
    revisionRef.current=record.revision;salesRevisionRef.current=inline.context.revision
    const fresh=initialFields(record,inline)
    setBaseline(fresh);fieldsRef.current=fresh;setFields(fresh)
  },[record,inline,dirty])


  function setDraft(updater:(previous:Draft)=>Draft) {
    setFailure('');setDuplicates(null)
    // Marca edição imediatamente para proteger navegação no mesmo evento de input.
    onDirty(true)
    if(!conflict)setFailure('')
    setFields(previous=>{const next=updater(previous);fieldsRef.current=next;return next})
  }
  function update<K extends keyof Draft>(name: K, value: Draft[K]) {
    setDraft(previous=>({...previous,[name]:value}))
  }
  // Um PATCH por vez. A revisão usada é a última confirmada pelo servidor.
  // Edições novas durante o PATCH permanecem no rascunho e são enviadas depois.
  async function persistEdit() {
    if (!record || inFlight.current || conflict || reauth || !dirty) return
    const snapshot=fieldsRef.current
    if (!validVehicleYear(snapshot.fabricationYear??'') ||
        !validVehicleYear(snapshot.modelYear??'') ||
        (snapshot.stage==='rejeitados' && (!snapshot.explicitRefusal || !snapshot.rejectionReason?.trim()))) return
    inFlight.current=true
    setBusy(true);onBusy(true);setFailure('')
    try {
      const {nextContactAt,...identityFields}=snapshot
      const patch={...identityFields,channel:snapshot.channel!==baseline.channel?snapshot.channel:undefined,
        closed:snapshot.closed!==baseline.closed?snapshot.closed:undefined,revision:revisionRef.current}
      let saved:Atendimento
      if(inline){
        const result=await api<{record:Atendimento;context:SalesContext}>(`/api/erp/sales/records/${encodeURIComponent(record.id)}/data`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({record:patch,contextRevision:salesRevisionRef.current,nextContactAt:nextContactAt===baseline.nextContactAt?undefined:nextContactAt?new Date(nextContactAt+'-03:00').toISOString():null})
        })
        saved=result.record;salesRevisionRef.current=result.context.revision
      }else saved=await api<Atendimento>(`/api/atendimentos/${encodeURIComponent(record.id)}${conversationId?'?conversa='+encodeURIComponent(conversationId):''}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)
      })
      revisionRef.current=saved.revision
      const identity={references:saved.references,name:saved.name,phone:saved.phone,vehicle:saved.vehicle,brand:saved.brand,model:saved.model,plate:saved.plate,fabricationYear:saved.fabricationYear,modelYear:saved.modelYear}
      const canonical=saved.references?{...snapshot,...identity}:snapshot
      const current=fieldsRef.current
      const referencesUnchanged=JSON.stringify(current.references)===JSON.stringify(snapshot.references)
      const next=referencesUnchanged&&saved.references?{...current,...identity}:current
      const pending=JSON.stringify(next)!==JSON.stringify(canonical)
      setBaseline(canonical)
      fieldsRef.current=next
      setFields(next)
      onDirty(pending)
      onAutoSaved?.(saved,contactSelectionKey(saved.references?.contact)!==contactSelectionKey(baseline.references?.contact))
    } catch(cause) {
      const error=cause as RequestFailure
      setFailure(error.code==='VERSION_CONFLICT'
        ? 'Conflito: este Atendimento foi atualizado em outra aba. Suas alterações permanecem aqui. Copie os dados antes de reabrir.'
        : 'Não foi possível salvar automaticamente. Suas alterações permanecem no formulário. '+error.message)
      setConflict(error.code==='VERSION_CONFLICT')
      if(error.status===401){if(inline)setReauth(true);else onAuthRequired()}
    } finally {inFlight.current=false;setBusy(false);onBusy(false)}
  }
  useEffect(()=>{
    if(!record || !dirty || conflict || failure || busy || reauth)return
    const timer=window.setTimeout(()=>{void persistEdit()},750)
    return()=>window.clearTimeout(timer)
    // A atualização do baseline após uma resposta aciona nova gravação se houve digitação durante o PATCH.
  },[fields,baseline,record?.id,conflict,failure,busy,reauth])

  async function createAtendimento(confirmationToken?:string) {
    if (busy || conflict) return
    const snapshot=fieldsRef.current
    if (!validVehicleYear(snapshot.fabricationYear ?? '') || !validVehicleYear(snapshot.modelYear ?? '')) {setFailure('Informe anos válidos com quatro dígitos ou deixe os campos vazios.'); return}
    setBusy(true); onBusy(true); setFailure('')
    try {
      const saved = await api<Atendimento>('/api/atendimentos', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...snapshot,...(confirmationToken?{duplicateConfirmation:confirmationToken}:{})})
      })
      setDuplicates(null);onDirty(false);onSaved(saved)
    } catch (cause) {
      const error=cause as RequestFailure
      if(error.code==='ATENDIMENTO_DUPLICATE_REVIEW'&&error.candidates?.length&&error.confirmationToken){
        setDuplicates({items:error.candidates,confirmationToken:error.confirmationToken})
      } else {
        setFailure(error.message)
      }
      if(error.status===401)onAuthRequired()
    } finally {setBusy(false);onBusy(false)}
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if(record){await persistEdit();return}
    await createAtendimento()
  }
  return <>{reauth&&<section className="commercial-reauth"><p>Entre novamente. Suas alterações foram preservadas.</p><Login session={{authenticated:false,configured:true}} error="" refresh={()=>{}} onSession={()=>{setReauth(false);setFailure('')}}/></section>}<form className={'at-form'+(inline?' at-form-inline':'')} onSubmit={save} inert={reauth} data-save-state={failure||conflict?'error':busy?'saving':dirty?'pending':'saved'} aria-label={record ? 'Editar Atendimento' : 'Novo Atendimento'}>
    <div className="at-form-scroll">{!inline&&<p className="at-form-hint">Comece com as informações disponíveis. Nenhum cadastro completo é obrigatório.</p>}
      <CustomerLines value={fields.references!} disabled={busy&&!record} onMessage={record?async(cid,index)=>{if(dirty||busy){setFailure('Aguarde o salvamento antes de abrir a conversa.');return}void cid;try{const result=await api<{conversationId:string}>(`/api/atendimentos/${record.id}/prepare-conversation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contactIndex:index,revision:revisionRef.current})});onMessage?.(result.conversationId)}catch(e){setFailure((e as Error).message)}}:undefined} onChange={(references:CustomerReferences)=>setDraft(previous=>({...previous,references,name:references.person[0]?.text??'',phone:participantGroups(references).groups[0]?.contacts[0]?.contact.text??'',vehicle:references.vehicle[0]?.text??'',brand:references.vehicle[0]?.brand??'',model:references.vehicle[0]?.model??'',plate:references.vehicle[0]?.plate??'',fabricationYear:references.vehicle[0]?.fabricationYear??'',modelYear:references.vehicle[0]?.modelYear??''}))}/>
      <section className="at-customer-context" aria-label="Dados comerciais">
        <h3>Dados comerciais</h3>
        <div className="at-field"><label htmlFor="at-channel">Canal de aquisição</label><select id="at-channel" value={inline&&fields.purpose==='non_commercial'?'non_commercial':fields.channel??''} disabled={busy&&!record} onChange={event=>{
          const value=event.target.value
          if(inline)setDraft(previous=>value==='non_commercial'?{...previous,purpose:'non_commercial',stage:'novo-lead',explicitRefusal:false,rejectionReason:''}:{...previous,channel:value,purpose:'commercial'})
          else update('channel',value)
        }}>
          <option value="">A definir</option>{[...new Set([...salesChannels.filter(channel=>channel!=='Recorrência'),fields.channel??''])].filter(Boolean).map(channel=><option key={channel}>{channel}</option>)}
          {inline&&!inline.scheduled&&<option value="non_commercial">Não comercial</option>}
        </select></div>
        {inline&&fields.purpose==='non_commercial'&&<p className="at-form-hint">Canal de entrada preservado: {fields.channel||'não informado'}</p>}
        {inline&&fields.purpose==='unclassified'&&<button type="button" className="at-inline-classify" onClick={()=>update('purpose','commercial')}>Confirmar atendimento comercial</button>}
        {inline&&<div className="at-field"><label htmlFor="at-next-contact">Próximo contato</label><input id="at-next-contact" type="datetime-local" value={fields.nextContactAt??''} onChange={e=>update('nextContactAt',e.target.value)} /></div>}
        {record && (!fields.purpose||fields.purpose==='commercial') && (!inline?.scheduled) && <><div className="at-field"><label htmlFor="at-stage">{inline?'Etapa comercial':'Fase comercial'}</label><select id="at-stage" value={fields.stage} onChange={event=>setDraft(previous=>({...previous,stage:event.target.value as Atendimento['stage'],...(event.target.value!=='rejeitados'?{explicitRefusal:false,rejectionReason:''}:{})}))} disabled={busy||!!fields.closed}>{(inline?.stages??ATENDIMENTO_STAGES.map(s=>({id:s.id,label:s.name}))).map(stage=><option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></div>{!inline&&<p className="at-form-hint">Movimentação manual. Os prazos dos nomes não mudam a fase automaticamente.</p>}</>}
        {!inline&&<div className="at-field"><label htmlFor="at-notes">Anotações</label><textarea id="at-notes" value={fields.notes} onChange={event => update('notes', event.target.value)} maxLength={8000} rows={3} disabled={busy && !record} /></div>}
      {fields.stage === 'rejeitados' && <div className="at-refusal"><label><input type="checkbox" checked={fields.explicitRefusal} required onChange={event => update('explicitRefusal', event.target.checked)} disabled={busy} /> Houve recusa explícita do cliente.</label><div className="at-field"><label htmlFor="at-rejection-reason">Motivo da recusa</label><textarea id="at-rejection-reason" required value={fields.rejectionReason} onChange={event => update('rejectionReason', event.target.value)} maxLength={2000} rows={2} disabled={busy} /></div></div>}
      </section>
      {record && !inline && <p className="at-technical-id">ID técnico: {record.id}</p>}
      {failure && <p className="form-error" role="alert">{failure}</p>}
    </div>
    {duplicates&&<section className="at-duplicate-review" role="alert" aria-label="Possível Atendimento duplicado">
      <strong>Já existe Atendimento em aberto para este contato</strong>
      <p>Confira os registros abaixo. A placa é igual ou está ausente em pelo menos uma ficha.</p>
      <div className="at-duplicate-items">{duplicates.items.map(item=><div key={item.id} className="at-duplicate-item">
        <div><strong>{item.name||'Pessoa não informada'}</strong><small>{[item.vehicle,item.plate||'Placa não informada'].filter(Boolean).join(' · ')}</small></div>
        <button type="button" disabled={busy} onClick={()=>onOpenExisting?.(item.id)}>Abrir existente</button>
      </div>)}</div>
      <p>Você realmente deseja criar um novo Atendimento?</p>
      <div className="at-duplicate-actions">
        <button type="button" disabled={busy} onClick={()=>setDuplicates(null)}>Voltar ao formulário</button>
        <button type="button" className="at-duplicate-confirm" disabled={busy} onClick={()=>void createAtendimento(duplicates.confirmationToken)}>{busy?'Criando…':'Criar novo mesmo assim'}</button>
      </div>
    </section>}
    <footer className="at-form-footer"><span aria-live="polite">{conflict?'Conflito de edição':failure?'Falha ao salvar':busy?'Salvando…':record?(dirty?'Alterações pendentes':''):'Preenchimento progressivo'}</span>{(!inline||!!failure)&&<button type="submit" className="primary-btn" disabled={busy || conflict || (Boolean(record) && !dirty)}>{busy?'Salvando…':record?'Salvar agora':'Criar Atendimento'}</button>}</footer>
  </form></>
}
