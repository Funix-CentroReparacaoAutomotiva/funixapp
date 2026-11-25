import {CustomerLines} from './CustomerLines'
import type {CustomerReferences} from '../shared/customer'
import {participantGroups,contactSelectionKey} from '../shared/customer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ATENDIMENTO_PURPOSES, ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento, AtendimentoInput, DuplicateAtendimento } from '../shared/contracts'
import { api } from './api'
import type { RequestFailure } from './api'
import {validVehicleYear} from './vehicle-registration'
import {validDeliveryDate} from '../shared/delivery-date'
import './vehicle-registration.css'

function initialFields(record?: Atendimento): AtendimentoInput {
  return {
    closed:!!record?.closedAt,
    purpose:record ? record.purpose : 'unclassified',
    references:record?.references??{person:[{id:null,text:record?.name??''}],contact:[{id:null,text:record?.phone??''}],vehicle:[{id:null,text:record?.vehicle??'',plate:record?.plate??'',fabricationYear:record?.fabricationYear??'',modelYear:record?.modelYear??''}],payer:[]},
    phone: record?.phone ?? '', name: record?.name ?? '', vehicle: record?.vehicle ?? '',
    brand: record?.brand ?? '', model: record?.model ?? '', plate: record?.plate ?? '',
    fabricationYear: record?.fabricationYear ?? (record ? null : ''),
    modelYear: record?.modelYear ?? (record ? null : ''),
    deliveryDate: record?.deliveryDate ?? null,
    reason: record?.reason ?? '', notes: record?.notes ?? '', stage: record?.stage ?? 'novo-lead',
    rejectionReason: record?.rejectionReason ?? '', explicitRefusal: record?.explicitRefusal ?? false,
  }
}

export function AtendimentoForm({ record, conversationId, onSaved, onAutoSaved, onDirty, onBusy, onAuthRequired, onMessage, onOpenExisting }: {
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
  const initial = useMemo(() => initialFields(record), [record])
  const [fields, setFields] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [conflict, setConflict] = useState(false)
  const [duplicates,setDuplicates] = useState<{items:DuplicateAtendimento[];confirmationToken:string}|null>(null)
  const [baseline,setBaseline] = useState(initial)
  const [lastSaved,setLastSaved] = useState(false)
  const revisionRef=useRef(record?.revision??0)
  const fieldsRef=useRef(fields)
  const inFlight=useRef(false)
  const dirty = JSON.stringify(fields) !== JSON.stringify(baseline)
  fieldsRef.current=fields
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  function setDraft(updater:(previous:AtendimentoInput)=>AtendimentoInput) {
    setLastSaved(false);setFailure('');setDuplicates(null)
    // Marca edição imediatamente para proteger navegação no mesmo evento de input.
    onDirty(true)
    if(!conflict)setFailure('')
    setFields(previous=>{const next=updater(previous);fieldsRef.current=next;return next})
  }
  function update<K extends keyof AtendimentoInput>(name: K, value: AtendimentoInput[K]) {
    setDraft(previous=>({...previous,[name]:value}))
  }
  // Um PATCH por vez. A revisão usada é a última confirmada pelo servidor.
  // Edições novas durante o PATCH permanecem no rascunho e são enviadas depois.
  async function persistEdit() {
    if (!record || inFlight.current || conflict || !dirty) return
    const snapshot=fieldsRef.current
    if ((snapshot.deliveryDate&&!validDeliveryDate(snapshot.deliveryDate)) || !validVehicleYear(snapshot.fabricationYear??'') ||
        !validVehicleYear(snapshot.modelYear??'') ||
        (snapshot.stage==='rejeitados' && (!snapshot.explicitRefusal || !snapshot.rejectionReason?.trim()))) return
    inFlight.current=true
    setBusy(true);onBusy(true);setFailure('')
    try {
      const saved=await api<Atendimento>(`/api/atendimentos/${encodeURIComponent(record.id)}${conversationId?'?conversa='+encodeURIComponent(conversationId):''}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...snapshot,revision:revisionRef.current})
      })
      revisionRef.current=saved.revision
      const canonical=saved.references?{...snapshot,references:saved.references,name:saved.name,phone:saved.phone}:snapshot
      const current=fieldsRef.current
      const referencesUnchanged=JSON.stringify(current.references)===JSON.stringify(snapshot.references)
      const next=referencesUnchanged?{...current,references:canonical.references,name:canonical.name,phone:canonical.phone}:current
      const pending=JSON.stringify(next)!==JSON.stringify(canonical)
      setBaseline(canonical)
      fieldsRef.current=next
      setFields(next)
      onDirty(pending)
      setLastSaved(!pending)
      onAutoSaved?.(saved,contactSelectionKey(saved.references?.contact)!==contactSelectionKey(baseline.references?.contact))
    } catch(cause) {
      const error=cause as RequestFailure
      setFailure(error.code==='VERSION_CONFLICT'
        ? 'Conflito: este Atendimento foi atualizado em outra aba. Suas alterações permanecem aqui. Copie os dados antes de reabrir.'
        : 'Não foi possível salvar automaticamente. Suas alterações permanecem no formulário. '+error.message)
      setConflict(error.code==='VERSION_CONFLICT')
      if(error.status===401)onAuthRequired()
    } finally {inFlight.current=false;setBusy(false);onBusy(false)}
  }
  useEffect(()=>{
    if(!record || !dirty || conflict || failure || busy)return
    const timer=window.setTimeout(()=>{void persistEdit()},750)
    return()=>window.clearTimeout(timer)
    // A atualização do baseline após uma resposta aciona nova gravação se houve digitação durante o PATCH.
  },[fields,baseline,record?.id,conflict,failure,busy])

  async function createAtendimento(confirmationToken?:string) {
    if (busy || conflict) return
    const snapshot=fieldsRef.current
    if (snapshot.deliveryDate&&!validDeliveryDate(snapshot.deliveryDate)) {setFailure('Informe uma data de entrega válida ou deixe em branco.');return}
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
  return <form className="at-form" onSubmit={save} aria-label={record ? 'Editar Atendimento' : 'Novo Atendimento'}>
    <div className="at-form-scroll"><p className="at-form-hint">Comece com as informações disponíveis. Nenhum cadastro completo é obrigatório.</p>
      <CustomerLines value={fields.references!} disabled={busy&&!record} onMessage={record?async(cid,index)=>{if(dirty||busy){setFailure('Aguarde o salvamento antes de abrir a conversa.');return}void cid;try{const result=await api<{conversationId:string}>(`/api/atendimentos/${record.id}/prepare-conversation`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contactIndex:index,revision:revisionRef.current})});onMessage?.(result.conversationId)}catch(e){setFailure((e as Error).message)}}:undefined} onChange={(references:CustomerReferences)=>setDraft(previous=>({...previous,references,name:references.person[0]?.text??'',phone:participantGroups(references).groups[0]?.contacts[0]?.contact.text??'',vehicle:references.vehicle[0]?.text??'',plate:references.vehicle[0]?.plate??'',fabricationYear:references.vehicle[0]?.fabricationYear??'',modelYear:references.vehicle[0]?.modelYear??''}))}/>
      <div className="at-field"><label htmlFor="at-reason">Motivo / descrição do ocorrido</label><textarea id="at-reason" value={fields.reason} onChange={event => update('reason', event.target.value)} maxLength={8000} rows={3} disabled={busy && !record} /></div>
      <div className="at-field"><label htmlFor="at-delivery-date">Data prevista de entrega (opcional)</label><input id="at-delivery-date" type="date" value={fields.deliveryDate??''} onChange={event=>update('deliveryDate',event.target.value||null)} disabled={busy&&!record}/><small>Preenchimento manual; não altera o prazo de execução do orçamento. Uma mudança exige nova emissão das OS existentes.</small></div>
       <div className="at-field"><label htmlFor="at-notes">Observações</label><textarea id="at-notes" value={fields.notes} onChange={event => update('notes', event.target.value)} maxLength={8000} rows={3} disabled={busy && !record} /></div>
      <div className="at-field"><label htmlFor="at-purpose">Finalidade</label><select id="at-purpose" value={fields.purpose??'commercial'} disabled={busy} onChange={event=>{
        const purpose=event.target.value as Atendimento['purpose']
        setDraft(previous=>({...previous,purpose,...(purpose==='commercial'?{}:{stage:'novo-lead',explicitRefusal:false,rejectionReason:''})}))
      }}>{Object.entries(ATENDIMENTO_PURPOSES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div>
      {record && (!fields.purpose||fields.purpose==='commercial') && <><div className="at-field"><label htmlFor="at-stage">Fase comercial</label><select id="at-stage" value={fields.stage} onChange={event => update('stage', event.target.value as Atendimento['stage'])} disabled={busy}>{ATENDIMENTO_STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div><p className="at-form-hint">Movimentação manual. Os prazos dos nomes não mudam a fase automaticamente.</p></>}
      {fields.stage === 'rejeitados' && <div className="at-refusal"><label><input type="checkbox" checked={fields.explicitRefusal} required onChange={event => update('explicitRefusal', event.target.checked)} disabled={busy} /> Houve recusa explícita do cliente.</label><div className="at-field"><label htmlFor="at-rejection-reason">Motivo da recusa</label><textarea id="at-rejection-reason" required value={fields.rejectionReason} onChange={event => update('rejectionReason', event.target.value)} maxLength={2000} rows={2} disabled={busy} /></div></div>}
      {record && <label><input type="checkbox" checked={!!fields.closed} onChange={e=>update('closed',e.target.checked)}/> Atendimento encerrado</label>}
      {record && <p className="at-technical-id">ID técnico: {record.id}</p>}
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
    <footer className="at-form-footer"><span aria-live="polite">{conflict?'Conflito de edição':failure?'Falha ao salvar':busy?'Salvando…':record?(dirty?'Alterações pendentes':lastSaved?'Salvo automaticamente':'Dados carregados'):'Preenchimento progressivo'}</span><button type="submit" className="primary-btn" disabled={busy || conflict || (Boolean(record) && !dirty)}>{busy?'Salvando…':record?'Salvar agora':'Criar Atendimento'}</button></footer>
  </form>
}
