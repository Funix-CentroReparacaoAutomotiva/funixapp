/**
 * Minimal WhatsApp text send, using the existing Evolution instance.
 * No Coda/n8n mutation, browser JID, provider URLs or API keys in responses.
 * Deliberately no automatic retry: a timeout may mean WhatsApp accepted the text.
 */
export type EvolutionSendReceipt = { messageId: string }
export type EvolutionTextSender = (remoteJid: string, text: string) => Promise<EvolutionSendReceipt>

export type EvolutionSendOptions = {
  origin: string
  apiKey: string
  instance: string
  fetcher?: typeof fetch
}

export function createEvolutionTextSender(options: EvolutionSendOptions): EvolutionTextSender {
  let base: URL
  try { base = new URL(options.origin) } catch { throw new Error('EVOLUTION_SEND_CONFIG_INVALID') }
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' ||
      base.search || base.hash || base.username || base.password || !base.hostname ||
      ![base.origin, base.origin + '/'].includes(options.origin) ||
      typeof options.apiKey !== 'string' || options.apiKey.length < 1 || options.apiKey.length > 2048 ||
      /[\r\n]/.test(options.apiKey) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(options.instance)) {
    throw new Error('EVOLUTION_SEND_CONFIG_INVALID')
  }
  const fetcher = options.fetcher ?? fetch
  return async (remoteJid, text) => {
    if (!/^[0-9]{8,15}@s\.whatsapp\.net$/.test(remoteJid) ||
        typeof text !== 'string' || text.trim().length === 0 ||
        [...text].length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      throw new Error('EVOLUTION_SEND_INPUT_INVALID')
    }
    const response = await fetcher(new URL(`/message/sendText/${options.instance}`, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: options.apiKey },
      body: JSON.stringify({ number: remoteJid.split('@')[0], text, linkPreview: false }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    if (response.status !== 200 && response.status !== 201) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('EVOLUTION_SEND_REJECTED')
    }
    // A success must include a provider message ID. Never echo a raw provider body.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('EVOLUTION_SEND_INVALID_RECEIPT')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 16_384) { await reader.cancel(); throw new Error('EVOLUTION_SEND_INVALID_RECEIPT') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    let body: unknown
    try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')) }
    catch { throw new Error('EVOLUTION_SEND_INVALID_RECEIPT') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('EVOLUTION_SEND_INVALID_RECEIPT')
    const item = body as Record<string, unknown>
    const key = item.key && typeof item.key === 'object' && !Array.isArray(item.key)
      ? item.key as Record<string, unknown> : null
    const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data)
      ? item.data as Record<string, unknown> : null
    const info = data?.Info && typeof data.Info === 'object' && !Array.isArray(data.Info)
      ? data.Info as Record<string, unknown> : null
    const messageId = key?.id ?? info?.ID
    if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(messageId)) throw new Error('EVOLUTION_SEND_INVALID_RECEIPT')
    return { messageId }
  }
}
