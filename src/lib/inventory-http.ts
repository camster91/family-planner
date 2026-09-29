/**
 * Shared HTTP pieces of the `/api/inventory/**` routes (#263). Route-owned
 * errors use the target envelope `{ error: { code, message, retryable } }`
 * (API_CONTRACTS.md); authentication (401) and the feature gate (403) keep
 * their shared shapes.
 */
import { NextResponse } from 'next/server'
import { resolveToday } from '@/lib/inventory'

export type InventoryErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'INGREDIENT_NOT_FOUND'
  | 'INVENTORY_ITEM_NOT_FOUND'
  | 'INVENTORY_WRITE_FORBIDDEN'
  | 'INTERNAL_ERROR'
  // Consume / discard / undo (#158)
  | 'INVENTORY_ITEM_FINISHED'
  | 'INVENTORY_CONFLICT'
  | 'INVENTORY_ADJUSTMENT_NOT_FOUND'
  | 'INVENTORY_UNDO_CONFLICT'
  // Fridge photo scan (#265)
  | 'INVENTORY_SCAN_DISABLED'
  | 'INVENTORY_SCAN_FORBIDDEN'
  | 'INVALID_FORM'
  | 'LENGTH_REQUIRED'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'RATE_LIMITED'
  | 'SCAN_DAILY_LIMIT'
  | 'SCAN_PROVIDER_UNAVAILABLE'
  | 'SCAN_UNREADABLE'

const RETRYABLE: ReadonlySet<InventoryErrorCode> = new Set([
  'INTERNAL_ERROR',
  'INVENTORY_CONFLICT',
  'RATE_LIMITED',
  'SCAN_DAILY_LIMIT',
  'SCAN_PROVIDER_UNAVAILABLE',
  'SCAN_UNREADABLE',
])

export function inventoryError(
  status: number,
  code: InventoryErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(
    { error: { code, message, retryable: RETRYABLE.has(code) } },
    { status, headers: { 'Cache-Control': 'private, no-store', ...extraHeaders } }
  )
}

export function inventoryJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/** A foreign item id and a missing one get this same response. */
export const itemNotFound = () => inventoryError(404, 'INVENTORY_ITEM_NOT_FOUND', 'Item not found')

/** A foreign adjustment id and a missing one get this same response. */
export const adjustmentNotFound = () => inventoryError(404, 'INVENTORY_ADJUSTMENT_NOT_FOUND', 'That change was not found')

/**
 * Route outcomes inside `withIdempotency` effects, which return a status and
 * body rather than a response (non-2xx outcomes are never stored).
 */
function errorBody(code: InventoryErrorCode, message: string) {
  return { error: { code, message, retryable: RETRYABLE.has(code) } }
}
export const notFoundResult = () => ({ status: 404, body: errorBody('INVENTORY_ITEM_NOT_FOUND', 'Item not found') })
export const finishedResult = () => ({
  status: 409,
  body: errorBody('INVENTORY_ITEM_FINISHED', 'This item was already used up or thrown away.'),
})
export const effectError = (status: number, code: InventoryErrorCode, message: string) => ({
  status,
  body: errorBody(code, message),
})

export const writeForbidden = () =>
  inventoryError(403, 'INVENTORY_WRITE_FORBIDDEN', 'Ask a parent or teen to change the inventory.')

/** `today` query parameter → UTC midnight, or a 400 response. */
export function todayFrom(searchParams: URLSearchParams): Date | NextResponse {
  const today = resolveToday(searchParams.get('today'))
  if (!today) {
    return inventoryError(400, 'VALIDATION_ERROR', 'today must be YYYY-MM-DD within one day of the server date')
  }
  return today
}

/** Like `readJson`, but an empty or `null` body reads as `{}` (actions with no required fields). */
export async function readOptionalJson(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: inventoryError(400, 'INVALID_JSON', 'Invalid JSON') }
  }
  if (text.trim() === '') return { ok: true, body: {} }
  try {
    const body: unknown = JSON.parse(text)
    return { ok: true, body: body === null ? {} : body }
  } catch {
    return { ok: false, response: inventoryError(400, 'INVALID_JSON', 'Invalid JSON') }
  }
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: inventoryError(400, 'INVALID_JSON', 'Invalid JSON') }
  }
}
