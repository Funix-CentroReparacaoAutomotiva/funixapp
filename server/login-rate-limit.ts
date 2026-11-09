import { isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'

// Never trust forwarding headers unless the TCP peer is an explicitly approved proxy.
// Configure exact proxy addresses, not an entire shared Docker subnet.
function normalizeAddress(address: string): string {
  const normalized = address.trim()
  const mapped = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized
  if (!isIP(mapped)) return ''
  return mapped.toLowerCase()
}

export function parseTrustedLoginProxies(raw: string | undefined): ReadonlySet<string> {
  if (!raw?.trim()) return new Set()
  const items = raw.split(',').map(item => normalizeAddress(item))
  if (items.length > 8 || items.some(item => !item) || new Set(items).size !== items.length) {
    throw new Error('FUNIX_LOGIN_TRUSTED_PROXY_IPS deve conter até 8 IPs únicos, exatos, separados por vírgulas.')
  }
  return new Set(items)
}

export function loginRateLimitIdentity(
  peerAddress: string | undefined,
  headers: IncomingHttpHeaders,
  trustedProxies: ReadonlySet<string>,
): string {
  const peer = normalizeAddress(peerAddress ?? '')
  // The default remains the socket peer; an untrusted request cannot spoof its bucket.
  const fallback = 'peer:' + (peer || 'unknown')
  if (!peer || !trustedProxies.has(peer)) return fallback
  const forwarded = headers['x-forwarded-for']
  if (typeof forwarded !== 'string' || forwarded.length > 512) return fallback
  const chain = forwarded.split(',').map(item => normalizeAddress(item))
  // Traefik's normal behavior sanitizes untrusted forwarded headers and appends
  // the actual directly-connected client. Use only the rightmost (closest) hop.
  // Fail closed to the proxy bucket if the chain is malformed or absent.
  if (!chain.length || chain.length > 12 || chain.some(item => !item)) return fallback
  return 'client:' + chain[chain.length - 1]
}
