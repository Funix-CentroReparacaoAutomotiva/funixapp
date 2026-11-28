import { workshopPhases, type WorkshopPhase, type WorkshopVehicle } from '../../shared/erp'
import { api } from '../api'

export type PhasePresentation = {
  id:WorkshopPhase
  label:string
  commercial:typeof workshopPhases[number]['commercial']
  tone:typeof workshopPhases[number]['tone']
}
export type YardVehicle = WorkshopVehicle & {revision:number; enteredAt:string|null; year:string|null; requiresClassification:boolean}

export function workshopApi<T>(path: string, body?: unknown, signal?: AbortSignal) {
  return api<T>('/api/erp/workshop' + path, body === undefined ? {signal} : {
    signal, method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  })
}
export const displayDay = (day: string) => day.slice(0,10).split('-').reverse().join('/')
export const phaseDetails = (id: string) => workshopPhases.find(phase => phase.id === id)
