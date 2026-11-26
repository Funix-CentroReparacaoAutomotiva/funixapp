export const workshopPhases = [
  { id: 'scheduled', label: 'Agendado', commercial: 'Agendado', tone: 'neutral' },
  { id: 'entry-inspection', label: 'Inspeção de entrada', commercial: 'Inspeção', tone: 'blue' },
  { id: 'disassembly', label: 'Desmontagem', commercial: 'Produção', tone: 'yellow' },
  { id: 'bodywork', label: 'Funilaria', commercial: 'Produção', tone: 'yellow' },
  { id: 'preparation', label: 'Preparação', commercial: 'Produção', tone: 'yellow' },
  { id: 'paint', label: 'Pintura', commercial: 'Produção', tone: 'yellow' },
  { id: 'technical-services', label: 'Serviços técnicos', commercial: 'Produção', tone: 'yellow' },
  { id: 'detailing', label: 'Estética', commercial: 'Produção', tone: 'yellow' },
  { id: 'cleaning', label: 'Limpeza', commercial: 'Acabamento', tone: 'orange' },
  { id: 'exit-inspection', label: 'Inspeção de saída', commercial: 'Acabamento', tone: 'orange' },
  { id: 'finished', label: 'Finalizado', commercial: 'Finalizado', tone: 'green' },
  { id: 'departed', label: 'Saiu', commercial: 'Fechamento', tone: 'purple' },
] as const

export type WorkshopPhase = typeof workshopPhases[number]['id']
export type WorkshopVehicle = {
  experienceId: string
  atendimentoId: string
  model: string
  plate: string
  customer: string
  payer: string
  scheduledEntry: string
  deliveryDate: string | null
  phase: WorkshopPhase
  present: boolean
  blocked: boolean
  departedAt: string | null
  commercialClosedAt: string | null
}
