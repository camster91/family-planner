import { D1DeviceManagerRefused } from '@/lib/cloudflare/device-manager'
/**
 * HTTP plumbing shared by the shared-device routes (#157 contract, #240).
 *
 * - Kill switch: `SHARED_DEVICE_ENABLED` (server env, default off). When off,
 *   every `/api/device/*`, `/api/family/devices/*` and `/api/users/elevation-pin`
 *   route answers 404 and the middleware ignores device cookies
 *   (docs/architecture/SHARED_DEVICE.md §12, §13).
 * - Error envelope: `{ error: { code, message, retryable } }` (API_CONTRACTS.md
 *   target shape), always with `Cache-Control: private, no-store`.
 * - A replaceable clock so tests can move time without faking timers.
 */
import { NextResponse } from 'next/server'
import { logRouteError } from '@/lib/api-error'
import type { RateLimitResult } from '@/lib/rate-limit-db'
import { clearDeviceCookies } from '@/lib/device-cookies'
import { DEVICE_ERROR_MESSAGES, type DeviceErrorCode } from '@/lib/device-error'

export { DEVICE_ERROR_MESSAGES, deviceErrorBody } from '@/lib/device-error'
export type { DeviceErrorCode } from '@/lib/device-error'

export { isSharedDeviceEnabled } from '@/lib/device-cookies'
import { isSharedDeviceEnabled } from '@/lib/device-cookies'

/** Indirection so tests can fix "now"; production always uses the wall clock. */
export const deviceClock = {
  now: (): Date => new Date(),
}

export const NO_STORE = 'private, no-store'

const DEFAULT_MESSAGES: Record<DeviceErrorCode, string> = DEVICE_ERROR_MESSAGES

const RETRYABLE = new Set<DeviceErrorCode>(['RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR', 'DEVICE_ACCESS_EXPIRED'])

export function deviceJson(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE, ...headers } })
}

export function deviceEmpty(status = 204): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': NO_STORE } })
}

/** The error envelope as a plain body (for idempotent effects that return `{ status, body }`). */
export function deviceError(
  status: number,
  code: DeviceErrorCode,
  options: { message?: string; extra?: Record<string, unknown>; headers?: Record<string, string> } = {}
): NextResponse {
  return deviceJson(
    {
      error: {
        code,
        message: options.message ?? DEFAULT_MESSAGES[code],
        retryable: RETRYABLE.has(code),
        ...(options.extra ?? {}),
      },
    },
    status,
    options.headers
  )
}

/** The 404 every device route returns while the kill switch is off. */
export function deviceNotFound(): NextResponse {
  return deviceError(404, 'NOT_FOUND')
}

/**
 * Returns the kill-switch 404, or null when shared-device mode is enabled.
 * The 404 also expires both device cookies (HttpOnly, so the tablet's own
 * purge cannot): a tablet that was open when the switch went off must
 * re-pair, not silently resume when it is turned back on (§13). It writes
 * nothing to the database. Harmless on person routes, which carry no device
 * cookies.
 */
export function killSwitch(): NextResponse | null {
  if (isSharedDeviceEnabled()) return null
  const res = deviceNotFound()
  clearDeviceCookies(res)
  return res
}

export function rateLimited(result: RateLimitResult): NextResponse {
  return deviceError(429, 'RATE_LIMITED', {
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) },
  })
}

export async function readJson(request: { json: () => Promise<unknown> }): Promise<unknown | undefined> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/**
 * Log and turn an unexpected error into the envelope, without echoing it. The
 * log line is `logRouteError`'s: `where` (a stable name such as
 * `device.chore_complete`), the request id when given, and the error's class
 * name and machine code; never its message or stack.
 */
export function deviceInternalError(where: string, error: unknown, requestId?: string): NextResponse {
  if (error instanceof D1DeviceManagerRefused) return deviceError(error.status,error.code)
  logRouteError(where, error, requestId)
  return deviceError(500, 'INTERNAL_ERROR')
}
