import { createEvolutionChatBridge, type EvolutionChatBridge } from './evolution-bridge.ts'
import { createEvolutionHttpTransport } from '../experimental/evolution-read/http-transport.ts'
import { EvolutionReadPoc } from '../experimental/evolution-read/client.ts'
import { createEvolutionTextSender } from './evolution-send.ts'
import type { V20AssociationRepository } from './v20-associations.ts'
import type { CodaEventSyncRepository } from './coda-sync.ts'

/**
 * Existing VPS only. Operator explicitly controls opt-in; no automatic env discovery.
 * No new container, database, service, network or WhatsApp connection.
 */
const EXISTING_INTERNAL_ORIGIN = 'http://evolution-api-nvzq-api-1:8080'
const EXISTING_INSTANCE = 'funix_comercial'

/** Fails closed before any HTTP if opt-in is absent or malformed. */
export function loadEvolutionChat(
  env: NodeJS.ProcessEnv,
  associations?: V20AssociationRepository,
  codaSync?: CodaEventSyncRepository,
): EvolutionChatBridge | undefined {
  if (env.FUNIX_EVOLUTION_READ_ENABLED !== 'true') return undefined
  const key = env.FUNIX_EVOLUTION_READ_API_KEY
  const instanceId = env.FUNIX_EVOLUTION_INSTANCE_ID
  if (!key || !instanceId || !/^[A-Za-z0-9_-]{1,128}$/.test(instanceId)) {
    throw new Error('Evolution Chat requested but its server-side credentials/instance ID are unavailable')
  }
  const transport = createEvolutionHttpTransport({
    origin: EXISTING_INTERNAL_ORIGIN,
    apiKey: key,
    maxResponseBytes: 1024 * 1024,
  })
  const provider = new EvolutionReadPoc({
    transport,
    instance: EXISTING_INSTANCE,
    instanceId,
    timeoutMs: 5000,
  })
  // Sending is a separate, OFF-by-default, server-side-only opt-in.
  const sender = env.FUNIX_EVOLUTION_SEND_ENABLED === 'true'
    ? createEvolutionTextSender({ origin: EXISTING_INTERNAL_ORIGIN, apiKey: key, instance: EXISTING_INSTANCE })
    : undefined
  return createEvolutionChatBridge(provider, Date.now, associations, codaSync, sender)
}
