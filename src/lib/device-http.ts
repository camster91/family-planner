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
import { log } from '@/lib/logger'
import type { RateLimitResult } from '@/lib/rate-limit-db'

/** Read at call time (Node runtime), so flipping the env needs no rebuild. */
export function isSharedDeviceEnabled(): boolean {
  const raw = (process.env.SHARED_DEVICE_ENABLED ?? '').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

/** Indirection so tests can fix "now"; production always uses the wall clock. */
export const deviceClock = {
  now: (): Date => new Date(),
}

export const NO_STORE = 'private, no-store'

export type DeviceErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'PARENT_REQUIRED'
  | 'FAMILY_REQUIRED'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'DEVICE_LIMIT_REACHED'
  | 'DEVICE_ACCESS_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_SESSION_INVALID'
  | 'DEVICE_MODE_LOGIN_BLOCKED'
  | 'PAIRING_CODE_INVALID'
  | 'PAIRING_DIGITS_MISMATCH'
  | 'PAIRING_EXPIRED'
  | 'PAIRING_CANCELLED'
  | 'PAIRING_NOT_CLAIMED'
  | 'ELEVATION_INVALID_CREDENTIAL'
  | 'ELEVATION_LOCKED'
  | 'ELEVATION_REQUIRED'
  | 'ELEVATION_EXPIRED'
  | 'PIN_TOO_WEAK'
  | 'INVALID_PASSWORD'

const DEFAULT_MESSAGES: Record<DeviceErrorCode, string> = {
  NOT_FOUND: 'Not found.',
  UNAUTHORIZED: 'Sign in to continue.',
  PARENT_REQUIRED: 'Only a parent can do this.',
  FAMILY_REQUIRED: 'Join or create a household first.',
  VALIDATION_ERROR: 'The request is not valid.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  SERVICE_UNAVAILABLE: 'Tablet mode is temporarily unavailable. Try again shortly.',
  INTERNAL_ERROR: 'Something went wrong.',
  DEVICE_LIMIT_REACHED: 'This household already has the maximum number of tablets.',
  DEVICE_ACCESS_EXPIRED: 'The tablet session needs refreshing.',
  DEVICE_REVOKED: 'This tablet was disconnected from its household.',
  DEVICE_SESSION_INVALID: 'This tablet is not connected to a household.',
  DEVICE_MODE_LOGIN_BLOCKED: 'This is a shared household tablet. Use the Parent button instead of signing in.',
  PAIRING_CODE_INVALID: 'That code did not work. Check it and try again, or ask for a new code.',
  PAIRING_DIGITS_MISMATCH: 'That number does not match the tablet.',
  PAIRING_EXPIRED: 'This pairing has expired.',
  PAIRING_CANCELLED: 'This pairing was cancelled.',
  PAIRING_NOT_CLAIMED: 'The tablet has not entered the code yet.',
  ELEVATION_INVALID_CREDENTIAL: 'That did not work.',
  ELEVATION_LOCKED: 'Too many wrong attempts. Try again later or use your password.',
  ELEVATION_REQUIRED: 'A parent needs to confirm this.',
  ELEVATION_EXPIRED: 'Parent mode ended.',
  PIN_TOO_WEAK: 'Choose a 6-digit PIN that is harder to guess.',
  INVALID_PASSWORD: 'Current password is incorrect.',
}

const RETRYABLE = new Set<DeviceErrorCode>(['RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR', 'DEVICE_ACCESS_EXPIRED'])

export function deviceJson(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': NO_STORE, ...headers } })
}

export function deviceEmpty(status = 204): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': NO_STORE } })
}

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

/** Returns the kill-switch 404, or null when shared-device mode is enabled. */
export function killSwitch(): NextResponse | null {
  return isSharedDeviceEnabled() ? null : deviceNotFound()
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

/** Log and turn an unexpected error into the envelope, without echoing it. */
export function deviceInternalError(event: string, error: unknown): NextResponse {
  log.error(event, error instanceof Error ? error : new Error(String(error)))
  return deviceError(500, 'INTERNAL_ERROR')
}
