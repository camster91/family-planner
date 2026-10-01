// Opt-in paging for GET /api/chores (O-19): query parsing and the opaque cursor.
import {
  CHORE_PAGE_MAX,
  afterChoreCursor,
  choreOrderBy,
  compareChoreOrder,
  decodeChoreCursor,
  encodeChoreCursor,
  parseChorePaging,
} from '../chore-paging'

const q = (s: string) => new URLSearchParams(s)

describe('parseChorePaging', () => {
  it('leaves the request unpaged without limit', () => {
    expect(parseChorePaging(q(''))).toEqual({ ok: true, paged: false })
    expect(parseChorePaging(q('status=pending'))).toEqual({ ok: true, paged: false })
  })

  it('accepts 1..200 and rejects anything else', () => {
    expect(parseChorePaging(q('limit=1'))).toEqual({ ok: true, paged: true, limit: 1, cursor: null, order: 'asc' })
    expect(parseChorePaging(q(`limit=${CHORE_PAGE_MAX}`))).toMatchObject({ ok: true, limit: CHORE_PAGE_MAX })
    for (const bad of ['0', '201', '-1', '1.5', 'abc', '', '1000']) {
      expect(parseChorePaging(q(`limit=${bad}`))).toMatchObject({ ok: false })
    }
  })

  it('needs limit for a cursor and rejects malformed cursors', () => {
    const cursor = encodeChoreCursor({ due_date: new Date('2026-10-01T00:00:00Z'), id: 'chore-a' })
    expect(parseChorePaging(q(`cursor=${cursor}`))).toEqual({ ok: false, error: 'cursor requires limit' })
    expect(parseChorePaging(q('limit=5&cursor=%%%'))).toEqual({ ok: false, error: 'Invalid cursor' })
    expect(parseChorePaging(q(`limit=5&cursor=${Buffer.from('not-a-date|x').toString('base64url')}`))).toMatchObject({
      ok: false,
    })
    expect(parseChorePaging(q(`limit=5&cursor=${Buffer.from('2026-10-01T00:00:00Z|bad id!').toString('base64url')}`))).toMatchObject({
      ok: false,
    })
  })
})

describe('paging order', () => {
  it('defaults to asc (existing callers) and accepts desc', () => {
    expect(parseChorePaging(q('limit=5'))).toMatchObject({ ok: true, order: 'asc' })
    expect(parseChorePaging(q('limit=5&order=asc'))).toMatchObject({ ok: true, order: 'asc' })
    expect(parseChorePaging(q('limit=5&order=desc'))).toMatchObject({ ok: true, order: 'desc' })
  })

  it('rejects an unknown order, and order without limit', () => {
    for (const bad of ['', 'DESC', 'newest', 'up']) {
      expect(parseChorePaging(q(`limit=5&order=${bad}`))).toEqual({ ok: false, error: 'order must be asc or desc' })
    }
    expect(parseChorePaging(q('order=desc'))).toEqual({ ok: false, error: 'order requires limit' })
  })

  it('orders and filters newest first for desc', () => {
    const cursor = { dueDate: new Date('2026-10-01T00:00:00Z'), id: 'b' }
    expect(choreOrderBy()).toEqual([{ due_date: 'asc' }, { id: 'asc' }])
    expect(choreOrderBy('desc')).toEqual([{ due_date: 'desc' }, { id: 'desc' }])
    expect(afterChoreCursor(cursor, 'desc')).toEqual({
      OR: [{ due_date: { lt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { lt: 'b' } }],
    })
    expect(afterChoreCursor(cursor, 'asc')).toEqual(afterChoreCursor(cursor))
  })
})

describe('chore cursor', () => {
  it('round-trips the due date and id', () => {
    const row = { due_date: new Date('2026-10-01T12:34:56.000Z'), id: 'cm123_abc-XYZ' }
    const decoded = decodeChoreCursor(encodeChoreCursor(row))
    expect(decoded).toEqual({ dueDate: row.due_date, id: row.id })
  })

  it('builds an after-cursor filter on (due_date, id)', () => {
    const cursor = { dueDate: new Date('2026-10-01T00:00:00Z'), id: 'b' }
    expect(afterChoreCursor(cursor)).toEqual({
      OR: [{ due_date: { gt: cursor.dueDate } }, { due_date: cursor.dueDate, id: { gt: 'b' } }],
    })
  })

  it('sorts by due date then id, for Date or ISO string due dates', () => {
    const rows = [
      { due_date: '2026-10-02T00:00:00.000Z', id: 'a' },
      { due_date: new Date('2026-10-01T00:00:00Z'), id: 'c' },
      { due_date: '2026-10-01T00:00:00.000Z', id: 'b' },
    ]
    expect([...rows].sort(compareChoreOrder).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
})
