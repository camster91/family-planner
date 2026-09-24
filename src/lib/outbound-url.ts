// Guards for server-side requests to URLs a user typed in (e.g. a family's own
// AI provider base URL). The server must never be steerable at loopback,
// link-local, private-network or metadata addresses (SSRF).

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// True for addresses that must never be reached from a user-supplied URL.
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 || // "this" network
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast + reserved + broadcast
    )
  }
  if (family === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1') return true
    // IPv4-mapped (::ffff:a.b.c.d) — judge the embedded IPv4 address.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return (
      lower.startsWith('fc') || lower.startsWith('fd') || // unique local
      lower.startsWith('fe8') || lower.startsWith('fe9') || // link-local
      lower.startsWith('fea') || lower.startsWith('feb') ||
      lower.startsWith('ff') // multicast
    )
  }
  return false
}

// Synchronous shape check for a user-supplied provider URL. Returns an error
// message, or null when the URL is acceptable to store.
export function checkProviderUrlShape(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'That provider URL is not valid'
  }
  if (url.protocol !== 'https:') return 'The provider URL must start with https://'
  if (url.username || url.password) return 'The provider URL must not contain credentials'

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'The provider URL must be a public address'
  }
  if (isIP(host) && isPrivateAddress(host)) return 'The provider URL must be a public address'
  return null
}

// Full check before connecting: shape plus DNS resolution, so a public-looking
// hostname that resolves to a private address is refused too.
export async function assertPublicProviderUrl(raw: string): Promise<void> {
  const shapeError = checkProviderUrlShape(raw)
  if (shapeError) throw new Error(shapeError)

  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error('Could not reach the provider URL')
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('The provider URL must be a public address')
  }
}
