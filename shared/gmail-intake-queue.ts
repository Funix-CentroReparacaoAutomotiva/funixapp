/** Technical queue only. Authorization to triage remains solely in GmailIntakeNotice. */
export type GmailQueueState = 'queued' | 'leased' | 'retry' | 'notified' | 'ignored' | 'blocked'
export type GmailQueueEnqueue = { messageId: string }
export type GmailQueueClaimRequest = { limit: number }
export type GmailQueueClaim = {
  messageId: string
  leaseToken: string
  attempt: number
  leaseExpiresAt: string
}
export type GmailQueueAck = {
  messageId: string
  leaseToken: string
  result: 'notified' | 'ignored' | 'retry' | 'blocked'
  noticeId: string | null
  errorCode: string | null
}
export type GmailQueueReceipt = {
  messageId: string
  state: GmailQueueState
  attempts: number
  nextAttemptAt: string | null
}
