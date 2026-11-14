import { writeFileSync,renameSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { createApp } from '../../app.ts'
import { openDatabase } from '../../database.ts'
import { AtendimentoRepository } from '../../atendimentos.ts'
import { loadIngestOptions } from '../../chat/ingest-config.ts'

// Test-only process. Registration is performed explicitly by the parent before
// startup; neither this process nor the receiver creates an instance.
const db = openDatabase(process.argv[2]!)
const server = createApp({ atendimentos: new AtendimentoRepository(db), voiceProvider: null,
  whatsappIngest: loadIngestOptions({ FUNIX_WHATSAPP_INGEST_ENABLED: 'true', FUNIX_WHATSAPP_INGEST_CONFIG_FILE: process.argv[3]! }) })
server.listen(0, '127.0.0.1', () => {const target=process.argv[4]!;writeFileSync(target+'.tmp', JSON.stringify({ port: (server.address() as AddressInfo).port }));renameSync(target+'.tmp',target)})
process.on('SIGTERM', () => { server.close(() => { db.close(); process.exit(0) }); server.closeAllConnections() })
