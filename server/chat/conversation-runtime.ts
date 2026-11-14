import type { DatabaseSync } from 'node:sqlite'
import type { CodaEventSyncRepository } from './coda-sync.ts'
import { ConversationStore, createConversationStoreSchema } from './conversation-store.ts'
import { SendOperations, createSendOperationSchema } from './send-operations.ts'

export type ConversationRuntime = {
  store: ConversationStore
  sends: SendOperations
  read: boolean
  providerIdentity?: { instance: string; instanceId: string }
}
export function loadConversationRuntime(
  env: NodeJS.ProcessEnv,
  db: DatabaseSync,
  identities?: CodaEventSyncRepository,
): ConversationRuntime | undefined {
  if (env.FUNIX_CHAT_LOCAL_ENABLED !== 'true') {
    if (env.FUNIX_CHAT_LOCAL_READ_ENABLED === 'true')
      throw Error('CHAT_LOCAL_READ_REQUIRES_STORAGE')
    return undefined
  }
  if (!identities || env.FUNIX_EVOLUTION_READ_ENABLED !== 'true')
    throw Error('CHAT_LOCAL_REQUIRES_CANONICAL_SYNC_AND_PROVIDER')
  createConversationStoreSchema(db)
  createSendOperationSchema(db)
  const sends = new SendOperations(db)
  sends.recoverInterrupted()
  return {
    store: new ConversationStore(db, identities),
    sends,
    providerIdentity: env.FUNIX_EVOLUTION_INSTANCE_ID
      ? { instance: 'funix_comercial', instanceId: env.FUNIX_EVOLUTION_INSTANCE_ID }
      : undefined,
    read: env.FUNIX_CHAT_LOCAL_READ_ENABLED === 'true',
  }
}
