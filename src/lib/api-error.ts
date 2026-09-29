/**
 * Machine-readable API errors and privacy-safe route error logs (#161,
 * docs/architecture/OBSERVABILITY.md "Error envelope", API_CONTRACTS.md).
 *
 * Two body shapes, so adopting this never breaks an installed client:
 *
 * - `flat` (default) for routes whose clients read `error` as a string:
 *   `{ error: message, code, requestId }`. `error` keeps its meaning; `code`
 *   and `requestId` are additive.
 * - `nested` for routes already on the API_CONTRACTS.md target shape:
 *   `{ error: { code, message, requestId } }` (plus `retryable` when given).
 *
 * `message` must be a fixed, human-safe sentence written by the route, never
 * text derived from the request or from an exception.
 */
import { NextResponse } from 'next/server'
import { log } from '@/lib/logger'

export type ApiErrorShape = 'flat' | 'nested'

export type ApiErrorOptions = {
  requestId: string
  shape?: ApiErrorShape
  retryable?: boolean
  headers?: Record<string, string>
}

export type FlatErrorBody = { error: string; code: string; requestId: string }
export type NestedErrorBody = {
  error: { code: string; message: string; requestId: string; retryable?: boolean }
}

/** UPPER_SNAKE_CASE, like the codes routes already return (`VALIDATION_ERROR`, `QUERY_TOO_SHORT`). */
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/

export function apiErrorBody(
  code: string,
  message: string,
  options: Pick<ApiErrorOptions, 'requestId' | 'shape' | 'retryable'>
): FlatErrorBody | NestedErrorBody {
  const safeCode = CODE_RE.test(code) ? code : 'INTERNAL_ERROR'
  if (options.shape === 'nested') {
    return {
      error: {
        code: safeCode,
        message,
        requestId: options.requestId,
        ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
      },
    }
  }
  return { error: message, code: safeCode, requestId: options.requestId }
}

/** A JSON error response with a stable code and the request id (also in `X-Request-Id`). */
export function apiError(status: number, code: string, message: string, options: ApiErrorOptions): NextResponse {
  return NextResponse.json(apiErrorBody(code, message, options), {
    status,
    headers: { ...(options.headers ?? {}), 'X-Request-Id': options.requestId },
  })
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
/** Prisma (`P2002`) and Node (`ECONNREFUSED`) style codes only. */
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/

/** The loggable identity of an exception: its class name and a short machine code, nothing else. */
export function describeError(error: unknown): { errorName: string; errorCode?: string } {
  if (!error || typeof error !== 'object') return { errorName: 'unknown' }
  const name = (error as { name?: unknown }).name
  const code = (error as { code?: unknown }).code
  return {
    errorName: typeof name === 'string' && NAME_RE.test(name) ? name : 'unknown',
    ...(typeof code === 'string' && ERROR_CODE_RE.test(code) ? { errorCode: code } : {}),
  }
}

/**
 * Log an unexpected route failure as one structured line:
 * `{ event: 'route.error', route, requestId, errorName, errorCode? }`.
 *
 * Deliberately NOT logged: the exception message (Prisma and pg messages can
 * quote column values), the stack, the request body, query string, URL, user,
 * household or any other identifier. `route` must be a template such as
 * `GET /api/audit`, never a raw URL.
 */
export function logRouteError(route: string, error: unknown, requestId: string): void {
  log.error('route.error', { route: route.slice(0, 120), requestId, ...describeError(error) })
}
