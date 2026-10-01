// Resolve the client IP for rate limiting.
//
// Production runs behind a reverse proxy that APPENDS the connecting address to
// X-Forwarded-For. Everything to the left of the proxy's entry was supplied by
// the client and is forgeable, so the first entry must never be trusted.
// We take the entry TRUSTED_PROXY_HOPS positions from the right (default 1:
// the address our own edge proxy saw). Set TRUSTED_PROXY_HOPS to the number of
// proxies in front of the app if there is more than one (e.g. CDN + Traefik).
//
// X-Real-IP is a single client-settable value with no proxy-appended part, so
// it is only read when TRUSTED_PROXY_HOPS is explicitly set (a proxy chain is
// declared, and that proxy overwrites the header). Without a declared proxy a
// request with no X-Forwarded-For falls into the shared 'unknown' bucket rather
// than letting the caller pick a fresh rate-limit key per request.
//
// All of this assumes the app is reachable ONLY through the declared proxy
// chain: a client that can connect to the origin directly can forge both
// headers (docs/runbooks/COOLIFY_DEPLOY.md section 8).

type HeaderSource = { headers: Headers }

/** The explicitly configured hop count, or null when TRUSTED_PROXY_HOPS is unset or invalid. */
function declaredHops(): number | null {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim() ?? ''
  if (!/^\d+$/.test(raw)) return null
  const hops = Number(raw)
  return hops >= 1 ? hops : null
}

export function getClientIp(req: HeaderSource): string {
  const hops = declaredHops()
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length > 0) {
      // With fewer entries than hops, the leftmost is the best we have.
      const index = Math.max(0, parts.length - (hops ?? 1))
      return parts[index]
    }
  }
  if (hops !== null) {
    const realIp = req.headers.get('x-real-ip')?.trim()
    if (realIp) return realIp
  }
  return 'unknown'
}
