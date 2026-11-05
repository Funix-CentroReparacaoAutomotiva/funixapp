/** Local normalized contract, not a promise about Evolution's raw event schema. */
export type ChatKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'unsupported'
export type ChatStatus = 'accepted' | 'failed' | 'delivered' | 'read'
export interface ChatIdentity { remoteJid: string | null; messageId: string | null }
interface ChatEnvelope {
  schemaVersion: 1
  instance: string
  eventId: string
  occurredAt: string
  correlation?: { commandId: string | null; erpEventRef: string | null }
}
export interface ChatUpsert extends ChatEnvelope {
  type: 'message.upsert'
  message: ChatIdentity & {
    fromMe: boolean
    origin: 'external' | 'unknown'
    kind: ChatKind
    text: string | null
    media: { ref: string; mime: string; bytes: number | null } | null
  }
}
export interface ChatStatusEvent extends ChatEnvelope {
  type: 'message.status'
  message: ChatIdentity & { status: ChatStatus }
}
export type ChatEvent = ChatUpsert | ChatStatusEvent
export interface ChatReceipt {
  receiptId: string
  eventId: string
  state: 'persisted'
  disposition: 'projected' | 'pending' | 'quarantined' | 'before_activation'
}
export interface ChatMessage {
  sequence: number
  messageId: string
  occurredAt: string
  fromMe: boolean
  origin: 'external' | 'unknown'
  kind: ChatKind
  text: string | null
  // Retrieval is intentionally absent in this increment.
  mediaState: 'unavailable' | 'none'
  status: ChatStatus | null
}
export interface ChatPage { items: ChatMessage[]; nextCursor: string | null }
