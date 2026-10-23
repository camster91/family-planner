// GET /api/chores stays bounded: `?id=` reads one household chore (the edit
// page no longer downloads the list to find one), `from`/`to` filter on the
// due date (the travel page), and the unpaged default is capped at the latest
// CHORE_UNPAGED_MAX by due date. The web chores page's "current" read
// (`currentChoreQueries`) is pinned here too.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)

import { GET } from '../route'
import { CHORE_CURRENT_MAX, CHORE_UNPAGED_MAX, currentChoreQueries, parseChoreDateRange } from '@/lib/chore-paging'
import { FAMILY_A, bodyOf, db, req } from '@/__tests__/helpers/two-household'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function addChore(id: string, due: string, over: Record<string, unknown> = {}) {
  db.rows('chore').push({ ...db.find('chore', 'chore-a')!, id, due_date: day(due), status: 'pending', ...over })
}

beforeEach(() => db.reset())

describe('GET /api/chores?id=', () => {
  it('returns one chore of the household, with its series template for a copy', async () => {
    addChore('tmpl-a', '2026-10-01', { frequency: 'weekly', recurrence_id: 'tmpl-a', is_template: true })
    addChore('copy-a', '2026-10-08', { frequency: 'once', recurrence_id: 'tmpl-a' })
    const res = await GET(req({ as: 'parentA', query: { id: 'copy-a' } }))
    expect(res.status).toBe(200)
    const body = await bodyOf(res)
    expect(body.chore).toMatchObject({ id: 'copy-a', frequency: 'once' })
    expect(body.template).toEqual({ id: 'tmpl-a', frequency: 'weekly' })
    expect(body.chores).toBeUndefined()

    const plain = await bodyOf(await GET(req({ as: 'childA', query: { id: 'chore-a' } })))
    expect(plain.chore.id).toBe('chore-a')
    expect(plain.template).toBeNull()
  })

  it("another household's chore and a missing id read the same: 404", async () => {
    expect((await GET(req({ as: 'parentA', query: { id: 'chore-b' } }))).status).toBe(404)
    expect((await GET(req({ as: 'parentA', query: { id: 'no-such-chore' } }))).status).toBe(404)
  })

  it('keeps recurring profile rows readable with paused action availability after rollback', async () => {
    const previous = {
      enabled: process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED,
      rollback: process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY,
      recurrence: process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED,
    }
    process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = '1'
    process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = '1'
    delete process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED
    db.rows('householdMember').push({
      id: 'member-profile-a', family_id: FAMILY_A, name: 'Little One', role: 'child', age: 3,
      archived_at: null, erasure_user_id: null, legacy_mapping: null, account_link: null,
    })
    addChore('profile-recurring', '2026-10-01', {
      assigned_to: null, assigned_member_id: 'member-profile-a', member_subject_erased: false,
      frequency: 'once', recurrence_id: 'profile-series-a',
    })
    addChore('profile-once', '2026-10-02', {
      assigned_to: null, assigned_member_id: 'member-profile-a', member_subject_erased: false,
      frequency: 'once', recurrence_id: null,
    })
    try {
      const body = await bodyOf(await GET(req({
        as: 'parentA', headers: { 'X-Member-Protocol': '2' },
        query: { from: '2026-10-01', to: '2026-10-03' },
      })))
      const recurring = body.chores.find((chore: { id: string }) => chore.id === 'profile-recurring')
      const oneOff = body.chores.find((chore: { id: string }) => chore.id === 'profile-once')
      expect(recurring).toEqual(expect.objectContaining({
        subject: { kind: 'profile', memberId: 'member-profile-a', name: 'Little One', role: 'child' },
        actionAvailability: {
          state: 'paused', reason: 'RECURRENCE_CAPABILITY_UNAVAILABLE', recovery: 'refresh-and-retain-pending',
          requiresCompatibleClient: true, actions: { complete: false, undo: false, verify: false, reject: false },
        },
      }))
      expect(oneOff).toEqual(expect.objectContaining({
        subject: { kind: 'profile', memberId: 'member-profile-a', name: 'Little One', role: 'child' },
        actionAvailability: {
          state: 'active', requiresCompatibleClient: false,
          actions: { complete: true, undo: true, verify: true, reject: true },
        },
      }))
      expect(body.chores.filter((chore: { subject?: unknown }) => !chore.subject).every((chore: { actionAvailability?: unknown }) => chore.actionAvailability === undefined)).toBe(true)
    } finally {
      if (previous.enabled === undefined) delete process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED
      else process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED = previous.enabled
      if (previous.rollback === undefined) delete process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY
      else process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY = previous.rollback
      if (previous.recurrence === undefined) delete process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED
      else process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED = previous.recurrence
    }
  })
})

it('keeps an archived profile row readable and paused in list/detail without blocking active household chores', async () => {
  const keys = ['HOUSEHOLD_PROFILE_CHORE_ENABLED', 'HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY', 'HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED']
  const previous = keys.map(key => [key, process.env[key]] as const)
  for (const key of keys) process.env[key] = '1'
  db.rows('householdMember').push({ id: 'archived-profile-a', family_id: FAMILY_A, name: 'Archived fixture', role: 'child', age: 3, archived_at: day('2026-10-01'), erasure_user_id: null, legacy_mapping: null, account_link: null })
  addChore('archived-profile-chore', '2026-10-02', { assigned_to: null, assigned_member_id: 'archived-profile-a', member_subject_erased: false, frequency: 'once', recurrence_id: null })
  addChore('active-account-chore', '2026-10-02')
  try {
    const response = await GET(req({ as: 'parentA', headers: { 'X-Member-Protocol': '2' }, query: { from: '2026-10-01', to: '2026-10-03' } }))
    expect(response.status).toBe(200)
    const list = await bodyOf(response)
    expect(list.chores).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'active-account-chore' }), expect.objectContaining({ id: 'archived-profile-chore', subject: { kind: 'profile', memberId: 'archived-profile-a', name: 'Archived fixture', role: 'child' }, actionAvailability: expect.objectContaining({ state: 'paused', reason: 'PROFILE_ARCHIVED' }) })]))
    const detail = await GET(req({ as: 'parentA', headers: { 'X-Member-Protocol': '2' }, query: { id: 'archived-profile-chore' } }))
    expect(detail.status).toBe(200)
    expect((await bodyOf(detail)).chore.actionAvailability).toMatchObject({ state: 'paused', reason: 'PROFILE_ARCHIVED', actions: { complete: false, undo: false, verify: false, reject: false } })
    expect((await GET(req({ as: 'parentB', headers: { 'X-Member-Protocol': '2' }, query: { id: 'archived-profile-chore' } }))).status).toBe(404)
  } finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
})

describe('GET /api/chores from/to', () => {
  it('returns only chores due in the inclusive window', async () => {
    addChore('w-before', '2026-09-30')
    addChore('w-start', '2026-10-01')
    addChore('w-end', '2026-10-05')
    addChore('w-after', '2026-10-06')
    const body = await bodyOf(await GET(req({ as: 'parentA', query: { from: '2026-10-01', to: '2026-10-05' } })))
    const ids = body.chores.map((c: { id: string }) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['w-start', 'w-end']))
    expect(ids).not.toContain('w-before')
    expect(ids).not.toContain('w-after')
    expect(body.chores.every((c: { family_id: string }) => c.family_id === FAMILY_A)).toBe(true)
  })

  it('rejects a bad date or an inverted window with 400 INVALID_QUERY', async () => {
    const queries: Record<string, string>[] = [
      { from: '2026-13-01' },
      { to: 'tomorrow' },
      { from: '2026-10-05', to: '2026-10-01' },
    ]
    for (const query of queries) {
      const res = await GET(req({ as: 'parentA', query }))
      expect(res.status).toBe(400)
      expect((await bodyOf(res)).code).toBe('INVALID_QUERY')
    }
  })

  it('parseChoreDateRange makes `to` inclusive', () => {
    const range = parseChoreDateRange(new URLSearchParams('from=2026-10-01&to=2026-10-05'))
    expect(range).toEqual({ ok: true, from: day('2026-10-01'), toExclusive: day('2026-10-06') })
  })
})

describe('GET /api/chores without limit', () => {
  it('returns at most the latest CHORE_UNPAGED_MAX chores, oldest first', async () => {
    const start = Date.UTC(2020, 0, 1)
    for (let i = 0; i < CHORE_UNPAGED_MAX + 5; i++) {
      addChore(`bulk-${String(i).padStart(4, '0')}`, new Date(start + i * 86_400_000).toISOString().slice(0, 10))
    }
    const body = await bodyOf(await GET(req({ as: 'parentA' })))
    expect(body.chores).toHaveLength(CHORE_UNPAGED_MAX)
    expect(body.nextCursor).toBeUndefined()
    const times = body.chores.map((c: { due_date: string }) => new Date(c.due_date).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    // The oldest rows are the ones left out.
    const ids = body.chores.map((c: { id: string }) => c.id)
    expect(ids).not.toContain('bulk-0000')
    expect(ids).toContain(`bulk-${String(CHORE_UNPAGED_MAX + 4).padStart(4, '0')}`)
  })
})

describe('GET /api/chores?order=desc (chores page history)', () => {
  it('walks pages newest first, each chore once, ties broken by id', async () => {
    // Dates far from the fixture's chores; from/to keeps only these.
    for (const [id, due] of [
      ['h-1', '2001-01-01'],
      ['h-2', '2001-01-02'],
      ['h-3a', '2001-01-03'],
      ['h-3b', '2001-01-03'],
      ['h-4', '2001-01-04'],
    ]) {
      addChore(id, due, { status: 'verified' })
    }
    const seen: string[] = []
    let cursor: string | null = null
    for (let pages = 0; pages < 5; pages++) {
      const query: Record<string, string> = {
        status: 'verified',
        limit: '2',
        order: 'desc',
        from: '2001-01-01',
        to: '2001-01-31',
      }
      if (cursor) query.cursor = cursor
      const body = await bodyOf(await GET(req({ as: 'parentA', query })))
      seen.push(...body.chores.map((c: { id: string }) => c.id))
      cursor = body.nextCursor
      if (!cursor) break
    }
    expect(seen).toEqual(['h-4', 'h-3b', 'h-3a', 'h-2', 'h-1'])
  })

  it('keeps the oldest-first default without order', async () => {
    addChore('o-2', '2001-01-02')
    addChore('o-1', '2001-01-01')
    const body = await bodyOf(
      await GET(req({ as: 'parentA', query: { limit: '5', from: '2001-01-01', to: '2001-01-31' } }))
    )
    expect(body.chores.map((c: { id: string }) => c.id)).toEqual(['o-1', 'o-2'])
  })

  it('rejects a bad order with 400 INVALID_QUERY', async () => {
    const res = await GET(req({ as: 'parentA', query: { limit: '5', order: 'sideways' } }))
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).code).toBe('INVALID_QUERY')
  })
})

describe('currentChoreQueries (web chores page)', () => {
  it('bounds open chores to 60 days back, keeps every chore awaiting a check, caps both', () => {
    const q = currentChoreQueries(FAMILY_A, new Date('2026-10-01T15:00:00Z'))
    expect(q.historyBefore.toISOString()).toBe('2026-09-30T00:00:00.000Z')
    expect(q.open.where).toEqual({
      family_id: FAMILY_A,
      OR: [
        { status: { notIn: ['verified', 'completed'] }, due_date: { gte: day('2026-08-02') } },
        { status: 'verified', due_date: { gte: day('2026-09-30') } },
      ],
    })
    expect(q.awaitingCheck.where).toEqual({ family_id: FAMILY_A, status: 'completed' })
    for (const part of [q.open, q.awaitingCheck]) {
      expect(part.take).toBe(CHORE_CURRENT_MAX)
      expect(part.orderBy).toEqual([{ due_date: 'desc' }, { id: 'desc' }])
    }
  })
})
