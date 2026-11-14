import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento, AtendimentoInput } from '../shared/contracts'
import { api } from './api'
import type { RequestFailure } from './api'
import {montadoraSuggestions,vehicleSuggestions,composeVehicleDescription,readVehicleRegistration,validVehicleYear,yearSuggestions} from './vehicle-registration'
import { formatPhoneDraft, phoneCursorPosition } from './phone-mask'
import './vehicle-registration.css'

function initialFields(record?: Atendimento): AtendimentoInput {
  return {
    phone: record?.phone ?? '', name: record?.name ?? '', vehicle: record?.vehicle ?? '',
    brand: record?.brand ?? '', model: record?.model ?? '', plate: record?.plate ?? '',
    fabricationYear: record?.fabricationYear ?? (record ? null : ''),
    modelYear: record?.modelYear ?? (record ? null : ''),
    reason: record?.reason ?? '', notes: record?.notes ?? '', stage: record?.stage ?? 'novo-lead',
    rejectionReason: record?.rejectionReason ?? '', explicitRefusal: record?.explicitRefusal ?? false,
  }
}

export function AtendimentoForm({ record, onSaved, onAutoSaved, onDirty, onBusy, onAuthRequired }: {
  record?: Atendimento
  onSaved: (record: Atendimento) => void
  onAutoSaved?: (record: Atendimento) => void
  onDirty: (dirty: boolean) => void
  onBusy: (busy: boolean) => void
  onAuthRequired: () => void
}) {
  const initial = useMemo(() => initialFields(record), [record])
  const [fields, setFields] = useState(initial)
  const [vehicleName,setVehicleName]=useState(()=>readVehicleRegistration(initial as {vehicle:string;model:string;brand:string}).name)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [conflict, setConflict] = useState(false)
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
    setLastSaved(false)
    setFields(previous=>{const next=updater(previous);fieldsRef.current=next;onDirty(true);return next})
  }
  function update<K extends keyof AtendimentoInput>(name: K, value: AtendimentoInput[K]) {
    setDraft(previous=>({...previous,[name]:value}))
  }
  function description(name:string, fabrication:string|null|undefined, model:string|null|undefined):string {
    const year=fabrication&&model?fabrication+'/'+model:model||fabrication||''
    return composeVehicleDescription(name,year)
  }
  function updateVehicleName(value:string){
    setVehicleName(value)
    setDraft(previous=>({...previous,model:value,
      vehicle:description(value,previous.fabricationYear,previous.modelYear)}))
  }
  function updateYear(key:'fabricationYear'|'modelYear', value:string){
    setDraft(previous=>{
      // Ao editar um dos anos, deixa de tratar ambos como informação legada implícita.
      const next={...previous,fabricationYear:previous.fabricationYear??'',modelYear:previous.modelYear??'',[key]:value}
      return {...next,model:vehicleName,vehicle:description(vehicleName,next.fabricationYear,next.modelYear)}
    })
  }
  // Um PATCH por vez. A revisão usada é a última confirmada pelo servidor.
  // Edições novas durante o PATCH permanecem no rascunho e são enviadas depois.
  async function persistEdit() {
    if (!record || inFlight.current || conflict || !dirty) return
    const snapshot=fieldsRef.current
    if (!snapshot.phone?.trim() || !validVehicleYear(snapshot.fabricationYear??'') ||
        !validVehicleYear(snapshot.modelYear??'') ||
        (snapshot.stage==='rejeitados' && (!snapshot.explicitRefusal || !snapshot.rejectionReason?.trim()))) return
    inFlight.current=true
    setBusy(true);onBusy(true);setFailure('')
    try {
      const saved=await api<Atendimento>(`/api/atendimentos/${encodeURIComponent(record.id)}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...snapshot,revision:revisionRef.current})
      })
      revisionRef.current=saved.revision
      setBaseline(snapshot)
      const pending=JSON.stringify(fieldsRef.current)!==JSON.stringify(snapshot)
      onDirty(pending)
      setLastSaved(!pending)
      onAutoSaved?.(saved)
    } catch(cause) {
      const error=cause as RequestFailure
      setFailure(error.status===409
        ? 'Conflito: este Atendimento foi atualizado em outra aba. Suas alterações permanecem aqui. Copie os dados antes de reabrir.'
        : 'Não foi possível salvar automaticamente. Suas alterações permanecem no formulário. '+error.message)
      setConflict(error.status===409)
      if(error.status===401)onAuthRequired()
    } finally {inFlight.current=false;setBusy(false);onBusy(false)}
  }
  useEffect(()=>{
    if(!record || !dirty || conflict || failure || busy)return
    const timer=window.setTimeout(()=>{void persistEdit()},750)
    return()=>window.clearTimeout(timer)
    // A atualização do baseline após uma resposta aciona nova gravação se houve digitação durante o PATCH.
  },[fields,baseline,record?.id,conflict,failure,busy])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (record) {await persistEdit();return}
    if (busy || conflict) return
    if (!fields.phone.trim()) { setFailure('Informe o telefone para abrir o Atendimento.'); return }
    if (!validVehicleYear(fields.fabricationYear ?? '') || !validVehicleYear(fields.modelYear ?? '')) { setFailure('Informe anos válidos com quatro dígitos ou deixe os campos vazios.'); return }
    setBusy(true); onBusy(true); setFailure('')
    try {
      const saved = await api<Atendimento>('/api/atendimentos', {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)
      })
      onDirty(false);onSaved(saved)
    } catch (cause) {
      const error=cause as RequestFailure
      setFailure(error.message)
      if(error.status===401)onAuthRequired()
    } finally {setBusy(false);onBusy(false)}
  }
  function updatePhone(value: string, caret: number | null, input: HTMLInputElement) {
    const formatted = formatPhoneDraft(value)
    const count = (value.slice(0, caret ?? value.length).match(/\\d/g) ?? []).length
    update('phone', formatted)
    // React atualiza o input controlado no próximo commit.
    requestAnimationFrame(() => {
      if (document.activeElement === input) {
        const position = phoneCursorPosition(formatted, count)
        input.setSelectionRange(position, position)
      }
    })
  }
  const textField = (name: 'phone' | 'name' | 'plate', label: string, maxLength = 250) => <div className="at-field" key={name}><label htmlFor={`at-${name}`}>{label}</label><input id={`at-${name}`} name={name} value={fields[name] ?? ''} onChange={event => name === 'phone' ? updatePhone(event.target.value, event.target.selectionStart, event.target) : update(name, name === 'plate' ? event.target.value.toUpperCase() : event.target.value)} maxLength={maxLength} required={name === 'phone'} autoFocus={name === 'name'} autoComplete="off" inputMode={name === 'phone' ? 'tel' : 'text'} disabled={busy && !record} /></div>
  const suggestionField=(name:'brand'|'model',label:string,choices:readonly string[],onValue:(next:string)=>void)=>
    <div className="at-field" key={name}><label htmlFor={`at-${name}`}>{label}</label>
      <input id={`at-${name}`} name={name} value={name==='model'?vehicleName:fields.brand??''} onChange={event=>onValue(event.target.value)}
       list={`at-${name}-choices`} maxLength={name==='brand'?150:120} autoComplete="off" disabled={busy}/>
      <datalist id={`at-${name}-choices`}>{choices.map(choice=><option key={choice} value={choice}/>)}</datalist>
    </div>
  return <form className="at-form" onSubmit={save} aria-label={record ? 'Editar Atendimento' : 'Novo Atendimento'}>
    <div className="at-form-scroll"><p className="at-form-hint">Somente o telefone é obrigatório. Os demais dados podem ser completados depois.</p>
      {textField('name', 'Nome')}{textField('phone', 'Telefone *', 100)}
      <div className="at-vehicle-fields" aria-label="Identificação do veículo">
        {suggestionField('brand','Montadora',montadoraSuggestions,next=>update('brand',next))}
        {suggestionField('model','Veículo',vehicleSuggestions(fields.brand??''),updateVehicleName)}
        {(['fabricationYear','modelYear'] as const).map(key=><div className="at-field" key={key}>
          <label htmlFor={`at-${key}`}>{key==='fabricationYear'?'Ano de fabricação':'Ano do modelo'}</label>
          <input id={`at-${key}`} name={key} list="at-year-choices" inputMode="numeric" placeholder="Ex.: 2020"
           maxLength={4} value={fields[key]??''} onChange={event=>updateYear(key,event.target.value)} autoComplete="off" disabled={busy}/>
        </div>)}
        <datalist id="at-year-choices">{yearSuggestions().filter(value=>/^\\d{4}$/.test(value)).map(value=><option key={value} value={value}/>)}</datalist>
      </div>
      <p className="at-form-hint at-vehicle-hint">Selecione uma sugestão ou digite livremente. Ex.: Fiat · Punto · 2019/2020.</p>
      {record&&record.fabricationYear===null&&record.modelYear===null&&readVehicleRegistration(record).year&&
       <p className="at-form-hint at-legacy-vehicle">Ano no cadastro antigo: {readVehicleRegistration(record).year}. Confirme separadamente os anos de fabricação e modelo. Nenhum ano será atribuído automaticamente.</p>}
      {textField('plate', 'Placa', 100)}
      <div className="at-field"><label htmlFor="at-reason">Motivo / descrição do ocorrido</label><textarea id="at-reason" value={fields.reason} onChange={event => update('reason', event.target.value)} maxLength={8000} rows={3} disabled={busy} /></div>
      <div className="at-field"><label htmlFor="at-notes">Observações</label><textarea id="at-notes" value={fields.notes} onChange={event => update('notes', event.target.value)} maxLength={8000} rows={3} disabled={busy} /></div>
      {record && <><div className="at-field"><label htmlFor="at-stage">Fase comercial</label><select id="at-stage" value={fields.stage} onChange={event => update('stage', event.target.value as Atendimento['stage'])} disabled={busy}>{ATENDIMENTO_STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div><p className="at-form-hint">Movimentação manual. Os prazos dos nomes não mudam a fase automaticamente.</p></>}
      {fields.stage === 'rejeitados' && <div className="at-refusal"><label><input type="checkbox" checked={fields.explicitRefusal} required onChange={event => update('explicitRefusal', event.target.checked)} disabled={busy} /> Houve recusa explícita do cliente.</label><div className="at-field"><label htmlFor="at-rejection-reason">Motivo da recusa</label><textarea id="at-rejection-reason" required value={fields.rejectionReason} onChange={event => update('rejectionReason', event.target.value)} maxLength={2000} rows={2} disabled={busy} /></div></div>}
      {record && <p className="at-technical-id">ID técnico: {record.id}</p>}
      {failure && <p className="form-error" role="alert">{failure}</p>}
    </div><footer className="at-form-footer"><span aria-live="polite">{conflict?'Conflito de edição':failure?'Falha ao salvar':busy?'Salvando…':record?(dirty?'Alterações pendentes':lastSaved?'Salvo automaticamente':'Dados carregados'):'Aguardando telefone'}</span><button type="submit" className="primary-btn" disabled={busy || conflict || (Boolean(record) && !dirty)}>{busy?'Salvando…':record?'Salvar agora':'Criar Atendimento'}</button></footer>
  </form>
}
