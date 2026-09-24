// Resolve the client IP for rate limiting.
//
// Production runs behind a reverse proxy that APPENDS the connecting address to
// X-Forwarded-For. Everything to the left of the proxy's entry was supplied by
// the client and is forgeable, so the first entry must never be trusted.
// We take the entry TRUSTED_PROXY_HOPS positions from the right (default 1:
// the address our own edge proxy saw). Set TRUSTED_PROXY_HOPS to the number of
// proxies in front of the app if there is more than one (e.g. CDN + Traefik).

type HeaderSource = { headers: Headers }

function trustedHops(): number {
  const raw = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 1
}

export function getClientIp(req: HeaderSource): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length > 0) {
      // With fewer entries than hops, the leftmost is the best we have.
      const index = Math.max(0, parts.length - trustedHops())
      return parts[index]
    }
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
