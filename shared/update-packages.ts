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
}

export type UpdatePackageList = {
  items: UpdatePackage[]
  total: number
  decisionsEnabled: boolean
}

export type UpdatePackageDecision = {
  revision: number
  snapshotHash: string
  decision: 'approve' | 'reject'
  requestId: string
}
