/**
 * Opt-in paging for `GET /api/chores` (provisional decision O-19).
 *
 * Without `limit` the route returns every chore exactly as before, so installed
 * Android builds are unaffected. With `?limit=N` (1–200) it returns at most N
 * chores ordered by due date then id, plus `nextCursor` (an opaque string to
 * pass back as `?cursor=` for the next page, or null on the last page).
 * The cursor encodes only a due date and a chore id; the route still filters
 * by the caller's household, so a cursor can never reveal another household.
 */
export const CHORE_PAGE_MAX = 200

export type ChoreCursor = { dueDate: Date; id: string }

export type ChorePaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: ChoreCursor | null }
  | { ok: false; error: string }

export function encodeChoreCursor(row: { due_date: Date; id: string }): string {
  return Buffer.from(`${row.due_date.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

export function decodeChoreCursor(raw: string): ChoreCursor | null {
  if (raw.length === 0 || raw.length > 200) return null
  const text = Buffer.from(raw, 'base64url').toString('utf8')
  const bar = text.indexOf('|')
  if (bar <= 0) return null
  const dueDate = new Date(text.slice(0, bar))
  const id = text.slice(bar + 1)
  if (Number.isNaN(dueDate.getTime()) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  return { dueDate, id }
}

const LIMIT_ERROR = `limit must be a whole number from 1 to ${CHORE_PAGE_MAX}`

export function parseChorePaging(params: URLSearchParams): ChorePaging {
  const rawLimit = params.get('limit')
  const rawCursor = params.get('cursor')
  if (rawLimit === null) {
    // A cursor only makes sense with a page size.
    return rawCursor === null ? { ok: true, paged: false } : { ok: false, error: 'cursor requires limit' }
  }
  if (!/^\d{1,3}$/.test(rawLimit)) return { ok: false, error: LIMIT_ERROR }
  const limit = Number(rawLimit)
  if (limit < 1 || limit > CHORE_PAGE_MAX) return { ok: false, error: LIMIT_ERROR }
  let cursor: ChoreCursor | null = null
  if (rawCursor !== null) {
    cursor = decodeChoreCursor(rawCursor)
    if (!cursor) return { ok: false, error: 'Invalid cursor' }
  }
  return { ok: true, paged: true, limit, cursor }
}

/** Prisma `where` fragment for rows after the cursor in (due_date, id) order. */
export function afterChoreCursor(cursor: ChoreCursor) {
  return {
    OR: [{ due_date: { gt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { gt: cursor.id } }],
  }
}
