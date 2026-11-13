/** Synthetic loopback fixture only. Never imported by production bootstrap. */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { createApp } from '../../app.ts'
import { openDatabase } from '../../database.ts'
import { AtendimentoRepository } from '../../atendimentos.ts'
import { createCodaEventSchema, CodaEventSyncRepository } from '../../chat/coda-sync.ts'
import { loadConversationRuntime } from '../../chat/conversation-runtime.ts'
import { createEvolutionChatBridge } from '../../chat/evolution-bridge.ts'

const path = resolve(process.env.FUNIX_DATABASE_PATH ?? ''),
  meta = resolve(process.env.CHAT_FIXTURE_METADATA_PATH ?? '')
if (
  process.env.NODE_ENV !== 'development' ||
  !path.startsWith(resolve(tmpdir()) + sep) ||
  !meta.startsWith(resolve(tmpdir()) + sep)
)
  throw Error('SYNTHETIC_FIXTURE_REQUIRES_TEMP_DIRECTORY')
const db = openDatabase(path)
createCodaEventSchema(db)
const identities = new CodaEventSyncRepository(db)
const runtime = loadConversationRuntime(
  {
    FUNIX_CHAT_LOCAL_ENABLED: 'true',
    FUNIX_CHAT_LOCAL_READ_ENABLED: 'true',
    FUNIX_EVOLUTION_READ_ENABLED: 'true',
  },
  db,
  identities,
)!
const pn = '000000000001@s.whatsapp.net',
  lid = 'browser-synthetic@lid'
for (let n = 1; n <= 125; n++)
  runtime.store.ingest(
    JSON.stringify({
      schemaVersion: 2,
      instance: 'funix_comercial',
      eventId: 'fixture:' + n,
      occurredAt: '2026-11-01T00:00:00.000Z',
      type: 'message.upsert',
      message: {
        remoteJid: lid,
        remoteJidAlt: pn,
        messageId: 'fixture-' + n,
        timestamp: 1700000000 + n,
        fromMe: false,
        kind: 'text',
        text: 'Mensagem local ' + n,
        media: null,
      },
    }),
  )
const atendimentoId = identities.sync({
  version: 1,
  source: 'coda',
  eventId: 'fixture:coda',
  codaRowId: 'i-BROWSER_LOCAL',
  instance: 'funix_comercial',
  remoteJid: pn,
  phoneE164: null,
  displayName: 'Cliente Sintético Local',
  occurredAt: 100,
}).atendimentoId
runtime.store.observeChats([
  {
    remoteJid: lid,
    remoteJidAlt: pn,
    displayName: 'Cliente Sintético Local',
    phoneNumber: null,
    updatedAt: null,
    unreadCount: 0,
  },
])
let sends = 0
const bridge = createEvolutionChatBridge(
  {
    findChatsPage: async () => {
      throw Error('synthetic offline')
    },
    findMessages: async () => {
      throw Error('synthetic offline')
    },
  },
  Date.now,
  undefined,
  identities,
  async () => ({ messageId: 'fixture-send-' + ++sends }),
  undefined,
  runtime,
)
const key = Buffer.alloc(32, 1)
const app = createApp({
  atendimentos: new AtendimentoRepository(db),
  password: process.env.FUNIX_OPERATOR_PASSWORD,
  origin: process.env.FUNIX_APP_ORIGIN,
  voiceProvider: null,
  evolutionChat: bridge,
  conversationRuntime: runtime,
  codaSync: { repo: identities, secret: key },
  whatsappIngest: {
    enabled: true,
    config: {
      version: 1,
      keys: [
        {
          keyId: 'synthetic',
          secretBase64: key.toString('base64'),
          instances: ['funix_comercial'],
        },
      ],
    },
  },
})
writeFileSync(
  meta,
  JSON.stringify({ atendimentoId, conversationId: identities.rememberProviderConversation(lid) }),
)
app.listen(8787, '127.0.0.1')
process.once('SIGTERM', () =>
  app.close(() => {
    db.close()
    process.exit(0)
  }),
)
