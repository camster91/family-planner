/**
 * Request identity (#161, docs/architecture/OBSERVABILITY.md "Request ID").
 *
 * Every response that goes through `src/middleware.ts` carries `X-Request-Id`.
 * The middleware accepts a well-formed inbound value (so a proxy or a client can
 * correlate its own logs) and otherwise generates a random one, then forwards it
 * to route handlers as the `x-request-id` request header. Route code reads it
 * with `getRequestId(request)` for error envelopes and log lines.
 *
 * The id is correlation only: it is not a secret, not an authenticator and not
 * guaranteed unique when a caller supplies it. The strict charset keeps it safe
 * to write into JSON logs and response headers (no whitespace, quotes or control
 * characters) and too short to smuggle meaningful free text.
 *
 * No imports: the middleware bundle pulls this in, and it must stay cheap.
 */

export const REQUEST_ID_HEADER = 'x-request-id'

/** Letters, digits, `-` and `_`; 8 to 64 characters. A UUID fits. */
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_RE.test(value)
}

/** A fresh random id (UUID v4, 36 characters). */
export function newRequestId(): string {
  return crypto.randomUUID()
}

/** The inbound id when it is well formed, otherwise a new one. Never throws. */
export function resolveRequestId(inbound: string | null | undefined): string {
  return isValidRequestId(inbound) ? inbound : newRequestId()
}

type HasHeaders = { headers?: { get(name: string): string | null } | null }

// One id per request object, so a route wrapper and the handler it wraps agree
// even when the middleware did not run (unit tests, direct handler calls).
const assigned = new WeakMap<object, string>()

/**
 * The request id for a route handler: the value the middleware forwarded, or,
 * without one, a new id remembered for this request object.
 */
export function getRequestId(request: HasHeaders | null | undefined): string {
  if (!request || typeof request !== 'object') return newRequestId()
  const cached = assigned.get(request)
  if (cached) return cached
  let inbound: string | null = null
  try {
    inbound = request.headers?.get(REQUEST_ID_HEADER) ?? null
  } catch {
    inbound = null
  }
  const id = resolveRequestId(inbound)
  assigned.set(request, id)
  return id
}
