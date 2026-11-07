import type { ReadRequest, ReadTransport } from '../../experimental/evolution-read/client.ts'

// Entirely invented. No export, session, customer or production alias used.
export const PN = '000000000001@s.whatsapp.net'
export const LID = 'synthetic-alpha@lid'
export const OTHER = 'synthetic-other@lid'
export const INSTANCE = 'synthetic-instance-id'
export function syntheticMessage(n: number, overrides: Record<string, unknown> = {}) {
  return { id: `row-${n}`, instanceId: INSTANCE, key: { id: `msg-${n}`, remoteJid: PN, fromMe: n % 2 === 0 },
    messageTimestamp: 1700000000 + n, messageType: 'conversation', message: { conversation: `Synthetic ${n}` },
    MessageUpdate: [{ status: 'SERVER_ACK' }], ...overrides }
}
export type SyntheticRecord = ReturnType<typeof syntheticMessage>
export function envelope(records: unknown[], page = 1, total = records.length) {
  return { messages: { total, pages: Math.ceil(total / 50), currentPage: page, records } }
}
/** A model of skip/take and timestamp-only order, not a running Evolution/Prisma. */
export function syntheticSource(initial: SyntheticRecord[]) {
  let records = structuredClone(initial)
  let reverseTies = false
  const requests: ReadRequest[] = []
  const transport: ReadTransport = async request => {
    requests.push(request)
    if (request.path.includes('/findChats/')) {
      const jids = [...new Set(records.map(r => (r.key as { remoteJid: string }).remoteJid))]
      return { status: 200, body: jids.slice(Number(request.body.skip), Number(request.body.skip) + Number(request.body.take))
        .map(remoteJid => ({ remoteJid, updatedAt: '2023-11-14T22:13:20.000Z', unreadCount: 0 })) }
    }
    const where = request.body.where as { key: { remoteJid: string; remoteJidAlt: string } }
    const matched = records.filter(r => {
      const key = r.key as { remoteJid: string; remoteJidAlt?: string }
      return key.remoteJid === where.key.remoteJid || key.remoteJidAlt === where.key.remoteJidAlt
    })
    const order = new Map(records.map((r, i) => [r.id, i]))
    matched.sort((a, b) => b.messageTimestamp - a.messageTimestamp ||
      (reverseTies ? -1 : 1) * (order.get(a.id)! - order.get(b.id)!))
    const page = Number(request.body.page), take = Number(request.body.offset)
    return { status: 200, body: envelope(matched.slice((page - 1) * take, page * take), page, matched.length) }
  }
  return { transport, requests,
    insert(record: SyntheticRecord) { records.push(structuredClone(record)) },
    remove(id: string) { records = records.filter(r => r.id !== id) },
    reorderTies() { reverseTies = !reverseTies },
  }
}
