/**
 * Route latency/error instrumentation (#161, docs/architecture/OBSERVABILITY.md
 * "Route timing").
 *
 * `withRouteTelemetry('/api/audit', handler)` wraps a route handler. It always
 * makes sure the response carries `X-Request-Id` (the middleware normally sets
 * it already; this covers direct handler calls). When `ROUTE_TIMING_LOG=1`, it
 * also writes ONE JSON line per request:
 *
 *   { ts, level: 'info', event: 'http.request', method, route, status,
 *     durationMs, requestId, release }
 *
 * `route` is the fixed template passed in (never the raw URL, path ids or query
 * string), `release` is the first 12 characters of the commit (or "unknown").
 * No body, header, cookie, user, household or device value is read or logged.
 *
 * Off by default. `ROUTE_TIMING_SAMPLE_RATE` (0-1, default 1) samples the lines
 * when on; 5xx responses are always written while it is on.
 */
import { getBuildInfo } from '@/lib/build-info'
import { getRequestId } from '@/lib/request-id'

type RequestLike = { method?: string; headers?: { get(name: string): string | null } | null }
type ResponseLike = { status?: number; headers?: unknown } | null | undefined

export type RouteTimingLine = {
  ts: string
  level: 'info'
  event: 'http.request'
  method: string
  route: string
  status: number
  durationMs: number
  requestId: string
  release: string
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

let release: string | undefined

function releaseTag(): string {
  if (release === undefined) release = getBuildInfo().commit.slice(0, 12)
  return release
}

/** Whether to write a line for this response, from `ROUTE_TIMING_LOG` / `ROUTE_TIMING_SAMPLE_RATE`. */
export function shouldLogTiming(
  status: number,
  env: Record<string, string | undefined> = process.env,
  random: () => number = Math.random
): boolean {
  if (env.ROUTE_TIMING_LOG !== '1') return false
  if (status >= 500) return true
  const raw = env.ROUTE_TIMING_SAMPLE_RATE
  const rate = raw === undefined || raw === '' ? 1 : Number(raw)
  if (!Number.isFinite(rate) || rate >= 1) return true
  if (rate <= 0) return false
  return random() < rate
}

export function timingLine(
  route: string,
  method: string | undefined,
  status: number,
  durationMs: number,
  requestId: string
): RouteTimingLine {
  const m = (method ?? '').toUpperCase()
  return {
    ts: new Date().toISOString(),
    level: 'info',
    event: 'http.request',
    method: METHODS.has(m) ? m : 'OTHER',
    route: route.slice(0, 120),
    status,
    durationMs: Math.round(durationMs * 10) / 10,
    requestId,
    release: releaseTag(),
  }
}

function setRequestIdHeader(response: ResponseLike, requestId: string): void {
  const headers = response?.headers as { has?: (n: string) => boolean; set?: (n: string, v: string) => void } | undefined
  if (!headers || typeof headers.set !== 'function' || typeof headers.has !== 'function') return
  try {
    if (!headers.has('X-Request-Id')) headers.set('X-Request-Id', requestId)
  } catch {
    // Immutable headers (e.g. a Response.redirect): leave the response alone.
  }
}

export function withRouteTelemetry<Args extends [RequestLike, ...unknown[]], R extends ResponseLike>(
  route: string,
  handler: (...args: Args) => Promise<R>
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const request = args[0]
    const requestId = getRequestId(request)
    const started = performance.now()
    let status = 500
    try {
      const response = await handler(...args)
      status = typeof response?.status === 'number' ? response.status : 200
      setRequestIdHeader(response, requestId)
      return response
    } finally {
      if (shouldLogTiming(status)) {
        console.log(JSON.stringify(timingLine(route, request?.method, status, performance.now() - started, requestId)))
      }
    }
  }
}
