// Guards for server-side requests to URLs a user typed in (e.g. a family's own
// AI provider base URL). The server must never be steerable at loopback,
// link-local, private-network or metadata addresses (SSRF).

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// True for an IPv4 address (dotted quad) that must never be reached.
function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments + TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51) || // TEST-NET-2 (198.51.100.0/24)
    (a === 203 && b === 0) || // TEST-NET-3 (203.0.113.0/24)
    a >= 224 // multicast + reserved + broadcast
  )
}

// Expand any valid IPv6 text form (compressed, embedded dotted IPv4, zone id)
// into exactly eight 16-bit groups. Returns null when it cannot be parsed.
function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)

  // Trailing dotted IPv4 (e.g. ::ffff:1.2.3.4, 64:ff9b::1.2.3.4) -> two groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null
    const [a, b, c, d] = dotted[2].split('.').map(Number)
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out.push(parseInt(g, 16))
  }
  return out
}

function v4FromGroups(hi: number, lo: number): string {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.')
}

// True for an IPv6 address that must never be reached. Addresses that embed an
// IPv4 address (mapped, compatible, NAT64, 6to4) are judged by that IPv4
// address, whatever text form the embedding uses.
function isPrivateIPv6(address: string): boolean {
  const g = expandIPv6(address)
  if (!g) return true // unparseable: fail closed

  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0)

  // ::/128 unspecified and ::1/128 loopback.
  if (zeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true
  // ::ffff:0:0/96 IPv4-mapped.
  if (zeroUpTo(5) && g[5] === 0xffff) return isPrivateIPv4(v4FromGroups(g[6], g[7]))
  // ::ffff:0:0:0/96 IPv4-translated (SIIT).
  if (zeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIPv4(v4FromGroups(g[6], g[7]))
  // ::/96 deprecated IPv4-compatible (::a.b.c.d). Never a legitimate public target.
  if (zeroUpTo(6)) return true
  // 64:ff9b::/96 well-known NAT64 prefix.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(v4FromGroups(g[6], g[7]))
  }
  // 64:ff9b:1::/48 local-use NAT64 prefix: the IPv4 position varies, refuse.
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true
  // 2002::/16 6to4: the IPv4 address sits in groups 1-2.
  if (g[0] === 0x2002) return isPrivateIPv4(v4FromGroups(g[1], g[2]))
  // 2001:0::/32 Teredo: the client address is obfuscated, refuse.
  if (g[0] === 0x2001 && g[1] === 0) return true
  // 2001:db8::/32 documentation.
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true
  // 100::/64 discard-only.
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true

  return (
    (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 deprecated site-local
    (g[0] & 0xff00) === 0xff00 // ff00::/8 multicast
  )
}

// True for addresses that must never be reached from a user-supplied URL.
// Accepts a bare IP literal (IPv6 with or without surrounding brackets).
export function isPrivateAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '')
  const family = isIP(bare)
  if (family === 4) return isPrivateIPv4(bare)
  if (family === 6) return isPrivateIPv6(bare)
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

  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'The provider URL must be a public address'
  }
  if (isIP(host) && isPrivateAddress(host)) return 'The provider URL must be a public address'
  return null
}

// Full check before connecting: shape plus DNS resolution, so a public-looking
// hostname that resolves to a private address is refused too.
//
// Known gap (follow-up): this is a check-then-connect guard. fetch() resolves
// the hostname again when it connects, so a DNS server that answers with a
// public address here and a private one moments later (DNS rebinding) can
// still steer the request. Closing that needs the resolved address pinned at
// connect time (an undici Agent with a validating connect.lookup), which needs
// the `undici` package as a direct dependency. See docs/architecture/CALENDAR_IMPORT.md.
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
