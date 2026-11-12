/** An email intake notice authorizes analysis only, never repair or system writes. */
export type GmailIntakeRelevance = 'relevant' | 'uncertain'
export type GmailIntakeStatus = 'awaiting_authorization' | 'authorized' | 'denied'
export type GmailIntakeDecision = 'authorize' | 'deny'

export type GmailIntakeNoticeInput = {
  messageId: string
  title: string
  summary: string
  relevance: GmailIntakeRelevance
  reason: string
  plateHint: string | null
  xpHint: string | null
}
export type GmailIntakeNotice = GmailIntakeNoticeInput & {
  id: string
  revision: number
  snapshotHash: string
  status: GmailIntakeStatus
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
}
export type GmailIntakeNoticeList = {
  items: GmailIntakeNotice[]
  total: number
  decisionsEnabled: boolean
}
export type GmailIntakeDecisionInput = {
  decision: GmailIntakeDecision
  revision: number
  snapshotHash: string
  requestId: string
}
