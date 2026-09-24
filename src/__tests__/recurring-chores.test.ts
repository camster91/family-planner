// Regression tests for #184 — recurring chores must expand idempotently, keep
// advancing, and not collide across independent series.
//
// The three defects these protect against were real and survived typecheck,
// lint and the full suite, because nothing exercised the cron:
//
//   1. Legacy rows (non-'once' frequency, no series linkage) were re-expanded
//      as if they were templates, multiplying the table.
//   2. Occurrences were generated from the template's ORIGINAL due date, so
//      after the first window every later run found the same dates already
//      present and inserted nothing — the series died.
//   3. Deduplication keyed on (title, assigned_to, due_date) silently swallowed
//      an unrelated chore that happened to share those values.
//
// These tests drive the expander against an in-memory fake of the handful of
// Prisma calls it makes, so they assert BEHAVIOUR (which rows get created, and
// how many) rather than merely that the module loads.

type Row = {
  id: string
  family_id: string
  title: string
  description: string | null
  points: number
  difficulty: string
  frequency: string
  assigned_to: string
  created_by: string
  due_date: Date
  status: string
  recurrence_id: string | null
  is_template: boolean
}

// --- minimal in-memory Chore table -----------------------------------------
let rows: Row[] = []
let nextId = 1

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue
    if (k === 'due_date' && v && typeof v === 'object' && 'in' in (v as object)) {
      const list = (v as { in: Date[] }).in
      if (!list.some((d) => d.getTime() === row.due_date.getTime())) return false
      continue
    }
    if (k === 'due_date' && v && typeof v === 'object' && 'gte' in (v as object)) {
      if (row.due_date.getTime() < (v as { gte: Date }).gte.getTime()) return false
      continue
    }
    if (k === 'frequency' && v && typeof v === 'object' && 'not' in (v as object)) {
      if (row.frequency === (v as { not: string }).not) return false
      continue
    }
    if ((row as Record<string, unknown>)[k] !== v) return false
  }
  return true
}

const chore = {
  findUnique: async ({ where }: { where: { id: string } }) =>
    rows.find((r) => r.id === where.id) ?? null,
  findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Record<string, string> }) => {
    let found = rows.filter((r) => matches(r, where))
    if (orderBy?.due_date === 'desc') {
      found = found.sort((a, b) => b.due_date.getTime() - a.due_date.getTime())
    }
    return found[0] ?? null
  },
  findMany: async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter((r) => matches(r, where)),
  createMany: async ({ data }: { data: Omit<Row, 'id'>[] }) => {
    let count = 0
    for (const d of data) {
      // Unique (recurrence_id, due_date)
      const dup =
        d.recurrence_id !== null &&
        rows.some(
          (r) => r.recurrence_id === d.recurrence_id && r.due_date.getTime() === d.due_date.getTime()
        )
      if (dup) continue
      rows.push({ ...d, id: `c${nextId++}` })
      count++
    }
    return { count }
  },
}

const txClient = { chore }

jest.mock('@/lib/prisma', () => ({
  prisma: {
    chore: {
      get findUnique() {
        return chore.findUnique
      },
      get findMany() {
        return chore.findMany
      },
      get update() {
        return async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          const r = rows.find((x) => x.id === where.id)
          if (r) Object.assign(r, data)
          return r
        }
      },
    },
    $transaction: async (fn: (tx: typeof txClient) => Promise<number>) => fn(txClient),
  },
}))

import { expandRecurringChores, expandAllRecurringChores } from '@/lib/recurringChores'

const FAM = 'fam-A'

// Local-time dates, because the expander normalises to local midnight (the
// same rule nextDueDate uses), so the tests hold in any TZ.
const day = (d: number) => new Date(2026, 8, d) // 2026-09-<d>, local midnight
const NOW = new Date(2026, 8, 1, 12) // midday on the template's first due date
const DAY_MS = 24 * 60 * 60 * 1000

function seriesRows(id: string) {
  return rows.filter((r) => r.recurrence_id === id)
}

function addRow(over: Partial<Row>): Row {
  const row: Row = {
    id: `c${nextId++}`,
    family_id: FAM,
    title: 'Clean room',
    description: null,
    points: 10,
    difficulty: 'medium',
    frequency: 'once',
    assigned_to: 'kid',
    created_by: 'parent',
    due_date: new Date('2026-09-01T00:00:00Z'),
    status: 'pending',
    recurrence_id: null,
    is_template: false,
    ...over,
  }
  rows.push(row)
  return row
}

beforeEach(() => {
  rows = []
  nextId = 1
})

describe('#184 recurring chores', () => {
  it('does not re-expand a legacy row that was never marked as a template', async () => {
    // A row left over from the old expander: non-'once' frequency, no series
    // linkage. Selecting on `is_template` keeps it inert.
    addRow({ frequency: 'daily', is_template: false, recurrence_id: null })

    const inserted = await expandAllRecurringChores(FAM)

    expect(inserted).toBe(0)
    expect(rows).toHaveLength(1)
  })

  it('expands a template into a window and advances as time passes', async () => {
    const t = addRow({ frequency: 'daily', is_template: true, due_date: day(1) })
    t.recurrence_id = t.id

    // Window of 7 upcoming occurrences; the template itself is the first.
    const first = await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM, NOW)
    expect(first).toBe(6)
    expect(seriesRows(t.id)).toHaveLength(7)

    // Three days later three occurrences have passed, so the window is topped
    // back up by exactly three — and the series moves forward.
    const maxBefore = Math.max(...rows.map((r) => r.due_date.getTime()))
    const later = new Date(NOW.getTime() + 3 * DAY_MS)
    const second = await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM, later)
    expect(second).toBe(3)
    expect(Math.max(...rows.map((r) => r.due_date.getTime()))).toBe(maxBefore + 3 * DAY_MS)
  })

  it('is idempotent: a repeated run at the same point creates nothing', async () => {
    const t = addRow({ frequency: 'weekly', is_template: true, due_date: day(1) })
    t.recurrence_id = t.id

    const first = await expandRecurringChores({ id: t.id, frequency: 'weekly' }, FAM, NOW)
    expect(first).toBe(3)
    const snapshot = rows.length

    const again = await expandRecurringChores({ id: t.id, frequency: 'weekly' }, FAM, NOW)
    expect(again).toBe(0)
    expect(rows.length).toBe(snapshot)

    // No (recurrence_id, due_date) pair appears twice.
    const keys = rows.map((r) => `${r.recurrence_id}|${r.due_date.getTime()}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not grow the series without bound when the cron runs repeatedly', async () => {
    const t = addRow({ frequency: 'daily', is_template: true, due_date: day(1) })
    t.recurrence_id = t.id

    for (let i = 0; i < 30; i++) {
      await expandAllRecurringChores(FAM, NOW)
    }

    // Previously each run appended another 7 rows after the latest one.
    expect(seriesRows(t.id)).toHaveLength(7)
    const horizon = day(8).getTime()
    for (const r of seriesRows(t.id)) expect(r.due_date.getTime()).toBeLessThan(horizon)
  })

  it('never creates dates beyond the horizon, even if the count is short', async () => {
    const t = addRow({ frequency: 'daily', is_template: true, due_date: day(1) })
    t.recurrence_id = t.id
    // A legacy row far in the future (e.g. from the old unbounded expander)
    // is the latest in the series; nothing may be appended after it.
    addRow({ recurrence_id: t.id, due_date: day(28) })

    const inserted = await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM, NOW)
    expect(inserted).toBe(0)
  })

  it('resumes a stale series from today instead of back-filling past dates', async () => {
    const t = addRow({ frequency: 'daily', is_template: true, due_date: day(1) })
    t.recurrence_id = t.id
    await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM, NOW)

    // The cron has not run for weeks.
    const muchLater = new Date(2026, 9, 1, 9) // 2026-10-01 09:00 local
    const today = new Date(2026, 9, 1).getTime()
    const before = rows.length
    const inserted = await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM, muchLater)

    expect(inserted).toBe(7)
    const created = rows.slice(before)
    for (const r of created) expect(r.due_date.getTime()).toBeGreaterThanOrEqual(today)
    expect(Math.min(...created.map((r) => r.due_date.getTime()))).toBe(today)
  })

  it('gives a series that starts in the future its full first window', async () => {
    const t = addRow({ frequency: 'weekly', is_template: true, due_date: day(20) })
    t.recurrence_id = t.id

    const inserted = await expandRecurringChores({ id: t.id, frequency: 'weekly' }, FAM, NOW)
    expect(inserted).toBe(3)
    expect(seriesRows(t.id).map((r) => r.due_date.getTime()).sort()).toEqual(
      [day(20), day(27), new Date(2026, 9, 4), new Date(2026, 9, 11)].map((d) => d.getTime())
    )
  })

  it('keeps two independent series with the same title and date separate', async () => {
    // Same title, same assignee, same starting date — but two distinct series.
    // The old (title, assigned_to, due_date) key conflated these.
    const a = addRow({ frequency: 'daily', is_template: true, description: 'series A', due_date: day(1) })
    a.recurrence_id = a.id
    const b = addRow({ frequency: 'daily', is_template: true, description: 'series B', due_date: day(1) })
    b.recurrence_id = b.id

    const nA = await expandRecurringChores({ id: a.id, frequency: 'daily' }, FAM, NOW)
    const nB = await expandRecurringChores({ id: b.id, frequency: 'daily' }, FAM, NOW)

    expect(nA).toBeGreaterThan(0)
    expect(nB).toBeGreaterThan(0) // was 0 under the old key

    const forA = rows.filter((r) => r.recurrence_id === a.id)
    const forB = rows.filter((r) => r.recurrence_id === b.id)
    expect(forA.length).toBeGreaterThan(1)
    expect(forB.length).toBeGreaterThan(1)
  })

  it('generates one-off occurrences, never new templates', async () => {
    const t = addRow({ frequency: 'daily', is_template: true, due_date: day(1) })
    t.recurrence_id = t.id

    await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM, NOW)

    const generated = rows.filter((r) => r.recurrence_id === t.id && r.id !== t.id)
    expect(generated.length).toBeGreaterThan(0)
    for (const g of generated) {
      expect(g.frequency).toBe('once')
      expect(g.is_template).toBe(false)
    }
  })
})
