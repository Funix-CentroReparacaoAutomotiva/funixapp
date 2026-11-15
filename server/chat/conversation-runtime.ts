import { LocalConversationAssociations } from './local-associations.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { CodaEventSyncRepository } from './coda-sync.ts'
import { ConversationStore, createConversationStoreSchema } from './conversation-store.ts'
import { SendOperations, createSendOperationSchema } from './send-operations.ts'

export type ConversationRuntime = {
  store: ConversationStore
  sends: SendOperations
  read: boolean
  authority?: LocalConversationAssociations
  providerIdentity?: { instance: string; instanceId: string }
}
export function loadConversationRuntime(
  env: NodeJS.ProcessEnv,
  db: DatabaseSync,
  identities?: CodaEventSyncRepository,
): ConversationRuntime | undefined {
  if(env.FUNIX_CHAT_AUTONOMOUS_ENABLED==='true'&&env.FUNIX_CHAT_LOCAL_ENABLED!=='true')throw Error('CHAT_AUTONOMOUS_REQUIRES_LOCAL_STORAGE')
  if (env.FUNIX_CHAT_LOCAL_ENABLED !== 'true') {
    if (env.FUNIX_CHAT_LOCAL_READ_ENABLED === 'true')
      throw Error('CHAT_LOCAL_READ_REQUIRES_STORAGE')
    return undefined
  }
  const authority = !identities || env.FUNIX_CHAT_AUTONOMOUS_ENABLED === 'true' ? new LocalConversationAssociations(db) : undefined
  createConversationStoreSchema(db)
  createSendOperationSchema(db)
  const sends = new SendOperations(db)
  sends.recoverInterrupted()
  return {
    store: new ConversationStore(db, authority ?? identities!),
    authority,
    sends,
    providerIdentity: env.FUNIX_EVOLUTION_INSTANCE_ID
      ? { instance: 'funix_comercial', instanceId: env.FUNIX_EVOLUTION_INSTANCE_ID }
      : undefined,
    read: env.FUNIX_CHAT_LOCAL_READ_ENABLED === 'true',
  }
}
