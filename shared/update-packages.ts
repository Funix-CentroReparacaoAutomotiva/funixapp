export type UpdatePackageStatus =
  | 'awaiting_review'
  | 'approved_pending_execution'
  | 'execution_failed'
  | 'executed'
  | 'rejected'

export type UpdatePackageAction = {
  id: string
  type: 'drive_archive' | 'erp_update' | 'other'
  title: string
  detail: string
}

export type UpdatePackageMissingField = {
  key: string
  label: string
  hint: string
  /** Opções de seleção fornecidas pelo planejador; não dispensam revalidação da XP. */
  options?: { value: string; label: string }[]
}

export type UpdatePackage = {
  id: string
  revision: number
  snapshotHash: string
  source: 'gmail' | 'whatsapp' | 'other'
  sourceReference: string
  experienceId: string | null
  plate: string | null
  title: string
  summary: string
  status: UpdatePackageStatus
  actions: UpdatePackageAction[]
  missingFields: UpdatePackageMissingField[]
  createdAt: string
  updatedAt: string
  decidedAt: string | null
  decidedBy: string | null
  /** Respostas humanas aguardam replanejamento; não alteram a proposta aprovada. */
  clarificationPending: boolean
}

export type UpdatePackageList = {
  items: UpdatePackage[]
  total: number
  decisionsEnabled: boolean
  clarificationsEnabled: boolean
}

export type UpdatePackageDecision = {
  revision: number
  snapshotHash: string
  decision: 'approve' | 'reject'
  requestId: string
}

export type UpdatePackageProposal = {
  source: UpdatePackage['source']
  sourceReference: string
  experienceId: string | null
  plate: string | null
  title: string
  summary: string
  actions: UpdatePackageAction[]
  missingFields: UpdatePackageMissingField[]
}

export type UpdatePackageIngest = {
  eventKey: string
  proposal: UpdatePackageProposal
}

export type UpdatePackageClarification = {
  revision: number
  snapshotHash: string
  requestId: string
  answers: Record<string, string>
}
