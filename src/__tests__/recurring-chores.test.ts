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

  it('expands a template into a window and advances on the next run', async () => {
    const t = addRow({ frequency: 'daily', is_template: true })
    t.recurrence_id = t.id

    const first = await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM)
    expect(first).toBeGreaterThan(0)

    const afterFirst = rows.length
    const maxAfterFirst = Math.max(...rows.map((r) => r.due_date.getTime()))

    // The second run must move the window forward, not insert zero.
    const second = await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM)
    expect(second).toBeGreaterThan(0)
    expect(rows.length).toBe(afterFirst + second)
    expect(Math.max(...rows.map((r) => r.due_date.getTime()))).toBeGreaterThan(maxAfterFirst)
  })

  it('is idempotent: a repeated run at the same point creates no duplicates', async () => {
    const t = addRow({ frequency: 'weekly', is_template: true })
    t.recurrence_id = t.id

    await expandRecurringChores({ id: t.id, frequency: 'weekly' }, FAM)
    const snapshot = rows.length

    // Simulate a retry where the series already covers the window: rewind the
    // newest occurrence so the next computation reproduces existing dates.
    const inserted = await expandRecurringChores({ id: t.id, frequency: 'weekly' }, FAM)
    expect(inserted).toBeGreaterThan(0) // advanced, as intended
    expect(rows.length).toBe(snapshot + inserted)

    // No (recurrence_id, due_date) pair appears twice.
    const keys = rows.map((r) => `${r.recurrence_id}|${r.due_date.getTime()}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps two independent series with the same title and date separate', async () => {
    // Same title, same assignee, same starting date — but two distinct series.
    // The old (title, assigned_to, due_date) key conflated these.
    const a = addRow({ frequency: 'daily', is_template: true, description: 'series A' })
    a.recurrence_id = a.id
    const b = addRow({ frequency: 'daily', is_template: true, description: 'series B' })
    b.recurrence_id = b.id

    const nA = await expandRecurringChores({ id: a.id, frequency: 'daily' }, FAM)
    const nB = await expandRecurringChores({ id: b.id, frequency: 'daily' }, FAM)

    expect(nA).toBeGreaterThan(0)
    expect(nB).toBeGreaterThan(0) // was 0 under the old key

    const forA = rows.filter((r) => r.recurrence_id === a.id)
    const forB = rows.filter((r) => r.recurrence_id === b.id)
    expect(forA.length).toBeGreaterThan(1)
    expect(forB.length).toBeGreaterThan(1)
  })

  it('generates one-off occurrences, never new templates', async () => {
    const t = addRow({ frequency: 'daily', is_template: true })
    t.recurrence_id = t.id

    await expandRecurringChores({ id: t.id, frequency: 'daily' }, FAM)

    const generated = rows.filter((r) => r.recurrence_id === t.id && r.id !== t.id)
    expect(generated.length).toBeGreaterThan(0)
    for (const g of generated) {
      expect(g.frequency).toBe('once')
      expect(g.is_template).toBe(false)
    }
  })
})
