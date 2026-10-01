/**
 * Opt-in paging for `GET /api/chores` (provisional decision O-19).
 *
 * Without `limit` the route returns every chore exactly as before, so installed
 * Android builds are unaffected. With `?limit=N` (1–200) it returns at most N
 * chores ordered by due date then id, plus `nextCursor` (an opaque string to
 * pass back as `?cursor=` for the next page, or null on the last page).
 * `?order=desc` (with `limit`) walks newest first instead; the default `asc`
 * keeps existing callers unchanged. Send the same `order` with every page.
 * The cursor encodes only a due date and a chore id; the route still filters
 * by the caller's household, so a cursor can never reveal another household.
 */
import { addUTCDays, parseDateOnly } from '@/lib/dates'

export const CHORE_PAGE_MAX = 200

/** Page size the web chores page uses for verified-chore history ("Load more"). */
export const CHORE_HISTORY_PAGE_SIZE = 50

/**
 * History is paged newest first: the first page is the latest verified
 * chores, and "Load more" goes further back. The server page's first page and
 * the client's `GET /api/chores?order=` use this same value, so the cursor the
 * server hands over continues the same walk.
 */
export const CHORE_HISTORY_ORDER = 'desc' as const

export type ChoreCursor = { dueDate: Date; id: string }

/** Paged order on (due_date, id): `asc` oldest first (default), `desc` newest first. */
export type ChoreOrder = 'asc' | 'desc'

export type ChorePaging =
  | { ok: true; paged: false }
  | { ok: true; paged: true; limit: number; cursor: ChoreCursor | null; order: ChoreOrder }
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
  const rawOrder = params.get('order')
  if (rawLimit === null) {
    // A cursor or an order only makes sense with a page size.
    if (rawCursor !== null) return { ok: false, error: 'cursor requires limit' }
    if (rawOrder !== null) return { ok: false, error: 'order requires limit' }
    return { ok: true, paged: false }
  }
  if (rawOrder !== null && rawOrder !== 'asc' && rawOrder !== 'desc') {
    return { ok: false, error: 'order must be asc or desc' }
  }
  const order: ChoreOrder = rawOrder ?? 'asc'
  if (!/^\d{1,3}$/.test(rawLimit)) return { ok: false, error: LIMIT_ERROR }
  const limit = Number(rawLimit)
  if (limit < 1 || limit > CHORE_PAGE_MAX) return { ok: false, error: LIMIT_ERROR }
  let cursor: ChoreCursor | null = null
  if (rawCursor !== null) {
    cursor = decodeChoreCursor(rawCursor)
    if (!cursor) return { ok: false, error: 'Invalid cursor' }
  }
  return { ok: true, paged: true, limit, cursor, order }
}

/**
 * Prisma `where` fragment for rows after the cursor in (due_date, id) order,
 * or before it (the next page of a newest-first walk) for `desc`.
 */
export function afterChoreCursor(cursor: ChoreCursor, order: ChoreOrder = 'asc') {
  if (order === 'desc') {
    return {
      OR: [{ due_date: { lt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { lt: cursor.id } }],
    }
  }
  return {
    OR: [{ due_date: { gt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { gt: cursor.id } }],
  }
}

/** Prisma `orderBy` for a paged read in `order`. */
export function choreOrderBy(order: ChoreOrder = 'asc'): [{ due_date: ChoreOrder }, { id: ChoreOrder }] {
  return [{ due_date: order }, { id: order }]
}

/** Sort comparator matching the paged order: due date, then id. Accepts Date or ISO string. */
export function compareChoreOrder(
  a: { due_date: Date | string; id: string },
  b: { due_date: Date | string; id: string }
): number {
  const byDue = new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  if (byDue !== 0) return byDue
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Most chores `GET /api/chores` returns without `limit`. Installed Android
 * builds call it unpaged, so the default stays a plain list, but a household
 * with years of chores no longer downloads all of them: the latest
 * `CHORE_UNPAGED_MAX` by due date are returned, still in due-date order.
 */
export const CHORE_UNPAGED_MAX = 500

/** How far back the web chores page loads chores that are still open. */
export const CHORE_CURRENT_LOOKBACK_DAYS = 60

/** Most rows each "current" query of the web chores page loads. */
export const CHORE_CURRENT_MAX = 500

/**
 * The bounded "current" chores the web chores page loads in full (Today,
 * Week, the pending count and the parent-check queue), split in two so one
 * cannot crowd out the other:
 *
 * - `open`: chores not done yet due in the last `CHORE_CURRENT_LOOKBACK_DAYS`
 *   days or later, plus verified chores due from yesterday (UTC) on.
 * - `awaitingCheck`: every `completed` chore (waiting for a parent's check),
 *   whatever its date, so the verify queue is complete.
 *
 * Each is read latest-first with `take: CHORE_CURRENT_MAX` (so a cap drops the
 * oldest rows, never today's) and the page re-sorts the union. Older verified
 * chores are history, paged separately (`historyBefore`).
 */
export function currentChoreQueries(familyId: string, now: Date = new Date()) {
  const historyBefore = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  const openSince = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - CHORE_CURRENT_LOOKBACK_DAYS)
  )
  const latestFirst = [{ due_date: 'desc' as const }, { id: 'desc' as const }]
  return {
    historyBefore,
    open: {
      where: {
        family_id: familyId,
        OR: [
          { status: { notIn: ['verified', 'completed'] }, due_date: { gte: openSince } },
          { status: 'verified', due_date: { gte: historyBefore } },
        ],
      },
      orderBy: latestFirst,
      take: CHORE_CURRENT_MAX,
    },
    awaitingCheck: {
      where: { family_id: familyId, status: 'completed' },
      orderBy: latestFirst,
      take: CHORE_CURRENT_MAX,
    },
  }
}

export type ChoreDateRange = { ok: true; from: Date | null; toExclusive: Date | null } | { ok: false; error: string }

/**
 * Optional `from` / `to` filters for `GET /api/chores`: `YYYY-MM-DD` days,
 * both inclusive, compared with the date-only `due_date` (UTC midnight).
 */
export function parseChoreDateRange(params: URLSearchParams): ChoreDateRange {
  const rawFrom = params.get('from')
  const rawTo = params.get('to')
  const from = rawFrom === null ? null : parseDateOnly(rawFrom)
  const to = rawTo === null ? null : parseDateOnly(rawTo)
  if (rawFrom !== null && !from) return { ok: false, error: 'from must be a date (YYYY-MM-DD)' }
  if (rawTo !== null && !to) return { ok: false, error: 'to must be a date (YYYY-MM-DD)' }
  if (from && to && from > to) return { ok: false, error: 'from must not be after to' }
  return { ok: true, from, toExclusive: to ? addUTCDays(to, 1) : null }
}
