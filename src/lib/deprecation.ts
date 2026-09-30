/**
 * Response headers for API routes kept only for older clients (route
 * inventory F-5/F-6, #289). A deprecated route keeps working unchanged; the
 * headers only tell a client or an operator reading logs that a replacement
 * exists.
 *
 * - `Deprecation: @<unix seconds>` (RFC 9745): when the route was deprecated.
 * - `Link: <replacement>; rel="successor-version"` when there is one.
 *
 * No `Sunset` header is sent: a removal date is set only after the ADR-0004
 * review of installed Android clients, and is recorded in
 * docs/architecture/API_CONTRACTS.md "Deprecated routes" first.
 */

/** 2026-09-29T00:00:00Z, the day #289 deprecated the routes below. */
export const DEPRECATED_SINCE_289 = Date.UTC(2026, 8, 29) / 1000

type HasHeaders = { headers: Headers }

export function markDeprecated<T extends HasHeaders>(
  response: T,
  options: { since: number; successor?: string }
): T {
  response.headers.set('Deprecation', `@${options.since}`)
  if (options.successor) response.headers.set('Link', `<${options.successor}>; rel="successor-version"`)
  return response
}
