/**
 * Shared HTTP pieces of the grocery store-section routes (#273):
 * `PATCH /api/lists/items/section` ("Move to…") and
 * `PATCH /api/lists/section-sort` (the per-list switch). Route-owned errors
 * use the target envelope `{ error: { code, message, retryable } }`
 * (API_CONTRACTS.md); authentication (401), the feature gate (403) and the
 * paired-device refusal keep their shared shapes.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { GROCERY_SECTIONS } from '@/lib/grocery-sections'

export type SectionErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'ITEM_NOT_FOUND'
  | 'LIST_NOT_FOUND'
  | 'LIST_NOT_GROCERY'
  | 'SECTION_SORT_FORBIDDEN'
  | 'INTERNAL_ERROR'

export function sectionError(status: number, code: SectionErrorCode, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message, retryable: code === 'INTERNAL_ERROR' } },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export function sectionJson(body: unknown): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function readSectionJson(
  request: Request
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, body: await request.json() }
  } catch {
    return { ok: false, response: sectionError(400, 'INVALID_JSON', 'Invalid JSON') }
  }
}

/** `section: null` clears the household's choice (back to automatic). */
export const moveItemSectionSchema = z
  .object({
    itemId: z.string().min(1).max(128),
    section: z.enum(GROCERY_SECTIONS).nullable(),
  })
  .strict()

export const sectionSortSchema = z
  .object({
    listId: z.string().min(1).max(128),
    sortBySection: z.boolean(),
  })
  .strict()
