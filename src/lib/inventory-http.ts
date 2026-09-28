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

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: inventoryError(400, 'INVALID_JSON', 'Invalid JSON') }
  }
}
