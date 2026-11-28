import {useEffect, useEffectEvent, useState} from 'react'
import {scheduledEntryLabel} from '../shared/production'
import type {ExperienceInOperation} from '../shared/production'
import {api} from './api'
import type {RequestFailure} from './api'
import './production.css'

export function OperationPanel({onAuthRequired}: {onAuthRequired: () => void}) {
  const [experiences,setExperiences]=useState<ExperienceInOperation[]|null>(null)
  const [error,setError]=useState('')
  const [request,setRequest]=useState(0)
  const requireAuth=useEffectEvent(onAuthRequired)

  useEffect(()=>{
    const controller=new AbortController()
    api<ExperienceInOperation[]>('/api/operacao?agendados=1',{signal:controller.signal}).then(setExperiences).catch((cause: RequestFailure)=>{
      if(controller.signal.aborted)return
      setError(cause.message)
      if(cause.status===401)requireAuth()
    })
    return ()=>controller.abort()
  },[request])

  return <section className="production-panel operation-panel" aria-labelledby="operation-heading">
    <h1 id="operation-heading">Operação</h1>
    {error&&<div className="production-feedback"><p className="form-error" role="alert">{error}</p>
      <button type="button" className="fh-filter" onClick={()=>{setError('');setRequest(previous=>previous+1)}}>Atualizar lista</button>
    </div>}
    {!experiences&&!error&&<p role="status">Carregando experiências…</p>}
    {experiences?.length===0&&<p>Nenhuma experiência agendada.</p>}
    {experiences&&[true,false].map(inOperation=>{
      const group=experiences.filter(item=>item.inOperation===inOperation)
      return group.length>0&&<section key={String(inOperation)}><h2>{inOperation?'Em operação':'Agendados'}</h2><ul className="operation-list">
      {group.map(experience=><li className="diagnosis-card" key={experience.id}>
        <a href={'/atendimentos/'+encodeURIComponent(experience.atendimentoId)+'?aba=diagnosticos&tela=experiencia'}>
          <strong>{[experience.vehicle.text,experience.vehicle.plate].filter(Boolean).join(' · ')}</strong>
          <span>{experience.customer.text}</span>
          <span>Entrada {scheduledEntryLabel(experience.scheduledEntry)}</span>
        </a>
      </li>)}
    </ul></section>
    })}
  </section>
}
