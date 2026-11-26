export const taskStatuses = {
  'not-started': 'Não iniciado',
  'in-progress': 'Em progresso',
  blocked: 'Bloqueado',
  done: 'Feito',
  approved: 'Aprovado',
} as const

export const taskRiceScales = {
  reach: ['1', '3', '6', '10', '100'],
  impact: ['0.25', '0.5', '1', '2', '3', '100'],
  confidence: ['0.5', '0.8', '1'],
} as const

export type TaskStatus = keyof typeof taskStatuses
export type TaskFields = {
  title: string
  owner: string
  sector: string
  work: string
  addedValue: string
  investment: string
  reach: string
  impact: string
  confidence: string
  effort: string
  status: TaskStatus
  priority: string
  position: string
  dueDate: string
  description: string
}
export type Task = TaskFields & { id: string; revision: number; rice: string | null }
