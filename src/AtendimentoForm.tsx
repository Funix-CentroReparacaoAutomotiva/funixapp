import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ATENDIMENTO_STAGES } from '../shared/contracts'
import type { Atendimento, AtendimentoInput } from '../shared/contracts'
import { api } from './api'
import type { RequestFailure } from './api'
import {montadoraSuggestions,vehicleSuggestions,composeVehicleDescription,readVehicleRegistration,validVehicleYear,yearSuggestions} from './vehicle-registration'
import './vehicle-registration.css'

function initialFields(record?: Atendimento): AtendimentoInput {
  return {
    phone: record?.phone ?? '', name: record?.name ?? '', vehicle: record?.vehicle ?? '',
    brand: record?.brand ?? '', model: record?.model ?? '', plate: record?.plate ?? '',
    reason: record?.reason ?? '', notes: record?.notes ?? '', stage: record?.stage ?? 'novo-lead',
    rejectionReason: record?.rejectionReason ?? '', explicitRefusal: record?.explicitRefusal ?? false,
  }
}

export function AtendimentoForm({ record, onSaved, onDirty, onBusy, onAuthRequired }: {
  record?: Atendimento
  onSaved: (record: Atendimento) => void
  onDirty: (dirty: boolean) => void
  onBusy: (busy: boolean) => void
  onAuthRequired: () => void
}) {
  const initial = useMemo(() => initialFields(record), [record])
  const [fields, setFields] = useState(initial)
  const [vehicleName,setVehicleName]=useState(()=>readVehicleRegistration(initial as {vehicle:string;model:string;brand:string}).name)
  const [year, setYear] = useState(() => readVehicleRegistration(initial as {vehicle:string;model:string;brand:string}).year)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [conflict, setConflict] = useState(false)
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  function update<K extends keyof AtendimentoInput>(name: K, value: AtendimentoInput[K]) {
    setFields(previous => ({ ...previous, [name]: value }))
  }
  function updateVehicleName(value:string){
    setVehicleName(value)
    setFields(previous=>({...previous,model:value,vehicle:composeVehicleDescription(value,year)}))
  }
  function updateYear(value:string){
    setYear(value)
    setFields(previous=>({...previous,model:vehicleName,vehicle:composeVehicleDescription(vehicleName,value)}))
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || conflict) return
    if (!fields.phone.trim()) { setFailure('Informe o telefone para abrir o Atendimento.'); return }
    if (!validVehicleYear(year)) { setFailure('Ano de fabricação/modelo inválido. Use 2020 ou 2019/2020.'); return }
    setBusy(true); onBusy(true); setFailure('')
    try {
      const saved = await api<Atendimento>(record ? `/api/atendimentos/${encodeURIComponent(record.id)}` : '/api/atendimentos', {
        method: record ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record ? { ...fields, revision: record.revision } : fields),
      })
      onDirty(false); onSaved(saved)
    } catch (cause) {
      const error = cause as RequestFailure
      setFailure(error.status === 409 ? 'Este Atendimento foi alterado em outra aba. Seus dados continuam neste formulário. Confira ou copie suas alterações e reabra a edição com os dados atuais.' : error.message)
      setConflict(error.status === 409)
      if (error.status === 401) onAuthRequired()
    } finally { setBusy(false); onBusy(false) }
  }
  const textField = (name: 'phone' | 'name' | 'plate', label: string, maxLength = 250) => <div className="at-field" key={name}><label htmlFor={`at-${name}`}>{label}</label><input id={`at-${name}`} name={name} value={fields[name] ?? ''} onChange={event => update(name, event.target.value)} maxLength={maxLength} required={name === 'phone'} autoFocus={name === 'name'} autoComplete="off" inputMode={name === 'phone' ? 'tel' : 'text'} disabled={busy} /></div>
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
        <div className="at-field"><label htmlFor="at-year">Ano fabricação/modelo</label>
          <input id="at-year" name="year" list="at-year-choices" inputMode="text" placeholder="Ex.: 2019/2020"
           maxLength={15} value={year} onChange={event=>updateYear(event.target.value)} autoComplete="off" disabled={busy}/>
          <datalist id="at-year-choices">{yearSuggestions().map(value=><option key={value} value={value}/>)}</datalist>
        </div>
      </div>
      <p className="at-form-hint at-vehicle-hint">Selecione uma sugestão ou digite livremente. Ex.: Fiat · Punto · 2019/2020.</p>
      {record&&readVehicleRegistration(record).legacy&&fields.vehicle===record.vehicle&&fields.model===record.model&&
       <p className="at-form-hint at-legacy-vehicle">Registro antigo: os campos originais serão preservados até você editar Veículo ou Ano.</p>}
      {textField('plate', 'Placa', 100)}
      <div className="at-field"><label htmlFor="at-reason">Motivo / descrição do ocorrido</label><textarea id="at-reason" value={fields.reason} onChange={event => update('reason', event.target.value)} maxLength={8000} rows={3} disabled={busy} /></div>
      <div className="at-field"><label htmlFor="at-notes">Observações</label><textarea id="at-notes" value={fields.notes} onChange={event => update('notes', event.target.value)} maxLength={8000} rows={3} disabled={busy} /></div>
      {record && <><div className="at-field"><label htmlFor="at-stage">Fase comercial</label><select id="at-stage" value={fields.stage} onChange={event => update('stage', event.target.value as Atendimento['stage'])} disabled={busy}>{ATENDIMENTO_STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div><p className="at-form-hint">Movimentação manual. Os prazos dos nomes não mudam a fase automaticamente.</p></>}
      {fields.stage === 'rejeitados' && <div className="at-refusal"><label><input type="checkbox" checked={fields.explicitRefusal} required onChange={event => update('explicitRefusal', event.target.checked)} disabled={busy} /> Houve recusa explícita do cliente.</label><div className="at-field"><label htmlFor="at-rejection-reason">Motivo da recusa</label><textarea id="at-rejection-reason" required value={fields.rejectionReason} onChange={event => update('rejectionReason', event.target.value)} maxLength={2000} rows={2} disabled={busy} /></div></div>}
      {record && <p className="at-technical-id">ID técnico: {record.id}</p>}
      {failure && <p className="form-error" role="alert">{failure}</p>}
    </div><footer className="at-form-footer"><span aria-live="polite">{busy ? 'Salvando…' : dirty ? 'Alterações não salvas' : record ? 'Dados carregados' : 'Aguardando telefone'}</span><button type="submit" className="primary-btn" disabled={busy || conflict || (Boolean(record) && !dirty)}>{busy ? 'Salvando…' : record ? 'Salvar alterações' : 'Criar Atendimento'}</button></footer>
  </form>
}
