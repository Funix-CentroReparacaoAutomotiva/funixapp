import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'

export interface IngestOptions {
  enabled: boolean
  config: unknown
  telemetry?: (metric: { outcome: 'accepted' | 'rejected' | 'disabled'; status: number; elapsedMs: number }) => void
}

/** No file is opened unless the dedicated flag is exactly true. No DB writes. */
export function loadIngestOptions(env: NodeJS.ProcessEnv): IngestOptions | undefined {
  if (env.FUNIX_WHATSAPP_INGEST_ENABLED !== 'true') return undefined
  let file: number | undefined
  try {
    const path = env.FUNIX_WHATSAPP_INGEST_CONFIG_FILE
    if (!path) return { enabled: true, config: null }
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(file)
    if (!stat.isFile() || stat.size > 16 * 1024 || (stat.mode & 0o077) !== 0) return { enabled: true, config: null }
    const buffer = Buffer.alloc(16 * 1024 + 1)
    let length = 0
    while (length < buffer.length) {
      const size = readSync(file, buffer, length, buffer.length - length, null)
      if (size === 0) break
      length += size
    }
    if (length > 16 * 1024) return { enabled: true, config: null }
    return { enabled: true, config: JSON.parse(buffer.subarray(0, length).toString('utf8')) }
  } catch { return { enabled: true, config: null } }
  finally { if (file !== undefined) closeSync(file) }
}

export function ingestKeys(options?: IngestOptions) {
  if (options?.enabled !== true) return null
  const input = options.config as { version?: unknown; keys?: unknown }
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1 ||
    Object.keys(input).some(key => !['version', 'keys'].includes(key)) || !Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > 8) return null
  const keys = new Map<string, { secret: Buffer; instances: Set<string> }>()
  for (const item of input.keys) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['keyId', 'secretBase64', 'instances'].includes(key)) ||
      typeof item.keyId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.keyId) || keys.has(item.keyId) ||
      typeof item.secretBase64 !== 'string' || item.secretBase64.length > 88 || !Array.isArray(item.instances) || item.instances.length < 1 || item.instances.length > 16 ||
      !item.instances.every((instance: unknown) => typeof instance === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(instance)) || new Set(item.instances).size !== item.instances.length) return null
    const secret = Buffer.from(item.secretBase64, 'base64')
    if (secret.length < 32 || secret.length > 64 || secret.toString('base64') !== item.secretBase64) return null
    keys.set(item.keyId, { secret, instances: new Set<string>(item.instances) })
  }
  return keys
}
