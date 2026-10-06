jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: async () => null }))

import { GET } from '../route'
import { db, req, FAMILY_A, FAMILY_B, fakePrisma } from '@/__tests__/helpers/two-household'

const range = { start: '2026-12-31T00:00:00Z', end: '2027-01-02T00:00:00Z' }
function add(id: string, start: string, end = start, family = FAMILY_A) {
  db.rows('event').push({ id, title: id, family_id: family, start_time: new Date(start),
    end_time: new Date(end), recurrence: null, created_by: 'parent-a', source_subscription_id: null,
    source_connection_id: null })
}
async function get(query: Record<string, string> = range, as: 'parentA' | 'parentB' | 'teenA' | 'childA' = 'parentA') {
  return GET(req({ as, path: '/api/events', query }))
}
beforeEach(() => { db.reset(); db.rows('event').length = 0 })

test.each<Record<string, string>>([
  { start: range.start }, { end: range.end }, { ...range, start: '' },
  { ...range, start: '2026-12-31' }, { ...range, start: '2026-12-31T00:00:00' },
  { ...range, start: '2026-02-30T00:00:00Z' },
  { ...range, start: '2026-12-31T24:00:00Z' },
  { ...range, start: '2026-12-31T00:00:00+24:00' },
  { ...range, start: range.end }, { ...range, end: range.start },
  { ...range, end: '2027-02-15T00:00:00Z' },
  { ...range, limit: '0' }, { ...range, limit: '201' }, { ...range, limit: '1.5' },
  { ...range, limit: '' }, { ...range, limit: '1e2' },
  { ...range, upcoming: 'true' }, { cursor: 'bad' }, { limit: '2' },
])('rejects invalid or ambiguous range parameters: %j', async query => {
  const res = await get(query)
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: expect.any(String) })
})

test.each([
  { start: '0000-01-01T00:00:00Z', end: '0000-01-01T01:00:00Z' },
  { start: '0001-01-01T00:00:00+23:59', end: '0001-01-01T01:00:00+23:59' },
  { start: '9999-12-31T22:00:00-23:59', end: '9999-12-31T23:00:00-23:59' },
  { start: '9999-12-31T23:00:00Z', end: '9999-12-31T23:59:00-00:01' },
])('rejects unsupported normalized UTC bounds before any event query: %j', async bounds => {
  const list = jest.spyOn(fakePrisma.event, 'findMany')
  try {
    const res = await get(bounds)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid calendar instant' })
    expect(list).not.toHaveBeenCalled()
  } finally { list.mockRestore() }
})

test('rejects duplicate bounds instead of silently selecting the first', async () => {
  const res = await GET(req({ as: 'parentA', path: '/api/events?start=2026-12-31T00:00:00Z&start=2027-01-01T00:00:00Z&end=2027-01-02T00:00:00Z' }))
  expect(res.status).toBe(400)
})

test('pages ties by start then id with explicit continuation, even after boundary row deletion', async () => {
  for (const id of ['c', 'b', 'a']) add(id, range.start)
  add('later', '2027-01-01T00:00:00Z')
  add('foreign', range.start, range.end, FAMILY_B)
  const first = await (await get({ ...range, limit: '2' })).json()
  expect(first.events.map((e: any) => e.id)).toEqual(['a', 'b'])
  expect(first.hasMore).toBe(true)
  expect(first.nextCursor).toEqual(expect.any(String))
  db.rows('event').splice(db.rows('event').findIndex(e => e.id === 'b'), 1)
  const second = await (await get({ ...range, limit: '2', cursor: first.nextCursor })).json()
  expect(second.events.map((e: any) => e.id)).toEqual(['c', 'later'])
  expect(second).toMatchObject({ hasMore: false, nextCursor: null })
})

test('pages continuing-event ties before the visible start without skipping or repeating them', async () => {
  const early = '2026-12-01T00:00:00Z'
  for (const id of ['c', 'b', 'a']) add(id, early, '2027-01-01T00:00:00Z')
  add('visible', range.start)
  add('foreign-continuing', early, range.end, FAMILY_B)
  db.find('event', 'foreign-continuing')!.title = 'FOREIGN continuing event'
  const firstRes = await get({ ...range, limit: '1' })
  expect(firstRes.status).toBe(200)
  const first = await firstRes.json()
  expect(first.events.map((e: any) => e.id)).toEqual(['a'])
  expect(first.hasMore).toBe(true)
  const payload = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString())
  expect(payload).toMatchObject({ time: new Date(early).toISOString(), id: 'a' })
  const secondRes = await get({ ...range, limit: '1', cursor: first.nextCursor })
  expect(secondRes.status).toBe(200)
  const second = await secondRes.json()
  expect(second.events.map((e: any) => e.id)).toEqual(['b'])
  expect(second.hasMore).toBe(true)
  const thirdRes = await get({ ...range, limit: '2', cursor: second.nextCursor })
  expect(thirdRes.status).toBe(200)
  const third = await thirdRes.json()
  expect(third.events.map((e: any) => e.id)).toEqual(['c', 'visible'])
  expect(third).toMatchObject({ hasMore: false, nextCursor: null })
  expect(JSON.stringify([first, second, third])).not.toContain('FOREIGN')
})

test('rejects cursor replay into another household or interval without any event lookup', async () => {
  add('a', range.start); add('b', range.start)
  const first = await (await get({ ...range, limit: '1' })).json()
  expect(first.nextCursor).toEqual(expect.any(String))
  const list = jest.spyOn(fakePrisma.event, 'findMany')
  const lookup = jest.spyOn(fakePrisma.event, 'findUnique')
  try {
    expect((await get({ ...range, limit: '1', cursor: first.nextCursor }, 'parentB')).status).toBe(400)
    expect((await get({ ...range, end: '2027-01-03T00:00:00Z', cursor: first.nextCursor })).status).toBe(400)
    expect(list).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
  } finally { list.mockRestore(); lookup.mockRestore() }
})

test.each(['', 'bad', '!!!!', 'e30', 'a'.repeat(2049)])('rejects malformed range cursor %s', async cursor => {
  const res = await get({ ...range, cursor })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: expect.any(String) })
})

test.each(['parentA', 'teenA', 'childA'] as const)('preserves member GET access, creator and household-scoped source attachment for %s', async as => {
  add('ics', range.start)
  add('provider', range.start)
  add('broken-source', range.start)
  db.find('event', 'ics')!.source_subscription_id = 'sub-a'
  db.find('event', 'provider')!.source_connection_id = 'connection-a'
  db.find('event', 'broken-source')!.source_subscription_id = 'sub-b'
  db.rows('calendarSubscription').push(
    { id: 'sub-a', family_id: FAMILY_A, name: 'School', color: 'blue', url: 'private-feed' },
    { id: 'sub-b', family_id: FAMILY_B, name: 'FOREIGN secret', color: 'red' },
  )
  const body = await (await get(range, as)).json()
  expect(body.events.find((e: any) => e.id === 'ics')).toMatchObject({
    creator: { id: 'parent-a', name: 'Parent A' }, source: { subscription_id: 'sub-a', name: 'School', color: 'blue' },
  })
  expect(body.events.find((e: any) => e.id === 'provider')).toMatchObject({ source_connection_id: 'connection-a', source: null })
  expect(JSON.stringify(body)).not.toMatch(/FOREIGN|private-feed/)
})

test('authentication precedes range validation; absent household is still rejected', async () => {
  expect((await GET(req({ as: null, path: '/api/events', query: { start: 'bad' } }))).status).toBe(401)
  expect((await GET(req({ as: 'loner', path: '/api/events', query: range }))).status).toBe(400)
})

test('nonempty id takes precedence over malformed range/paging and keeps foreign id denial', async () => {
  add('a', range.start)
  add('foreign', range.start, range.end, FAMILY_B)
  const query = { start: 'bad', end: 'bad', limit: '0', cursor: 'bad', upcoming: 'true' }
  const body = await (await get({ ...query, id: 'a' })).json()
  expect(Object.keys(body)).toEqual(['event'])
  expect(body.event.id).toBe('a')
  expect([403, 404]).toContain((await get({ ...query, id: 'foreign' })).status)
  expect((await get({ ...query, id: 'missing' })).status).toBe(404)
})

test('default range cap is explicit and bounded at 200 plus one probe row', async () => {
  for (let i = 0; i < 201; i++) add(`row-${String(i).padStart(3, '0')}`, range.start)
  const spy = jest.spyOn(fakePrisma.event, 'findMany')
  try {
    const body = await (await get()).json()
    expect(body.events).toHaveLength(200)
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toEqual(expect.any(String))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ take: 201, where: expect.objectContaining({ family_id: FAMILY_A }) }))
    const last = await (await get({ ...range, cursor: body.nextCursor })).json()
    expect(last.events.map((e: any) => e.id)).toEqual(['row-200'])
    expect(last).toMatchObject({ hasMore: false, nextCursor: null })
  } finally { spy.mockRestore() }
})

test('legacy and upcoming lists retain only the events envelope and 100-row cap', async () => {
  for (let i = 0; i < 101; i++) add(`row-${i}`, '2099-01-01T00:00:00Z')
  const queries: Record<string, string>[] = [{}, { upcoming: 'true' }]
  for (const query of queries) {
    const body = await (await get(query)).json()
    expect(Object.keys(body)).toEqual(['events'])
    expect(body.events).toHaveLength(100)
  }
})

test('accepts offset-defined DST day boundaries without imposing a 24-hour day', async () => {
  add('last-hour', '2026-03-09T03:30:00Z')
  add('outside', '2026-03-09T04:00:00Z')
  const body = await (await get({ start: '2026-03-08T00:00:00-05:00', end: '2026-03-09T00:00:00-04:00' })).json()
  expect(body.events.map((e: any) => e.id)).toEqual(['last-hour'])
})

test('cursor validation and paging never use a row lookup, even for a forged foreign-row bookmark', async () => {
  add('a', range.start); add('z', range.start)
  add('foreign-row', '2027-01-01T00:00:00Z', range.end, FAMILY_B)
  db.find('event', 'foreign-row')!.title = 'FOREIGN private appointment'
  const body = await (await get({ ...range, limit: '1' })).json()
  const payload = JSON.parse(Buffer.from(body.nextCursor, 'base64url').toString())
  payload.id = 'foreign-row'
  const forged = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const lookup = jest.spyOn(fakePrisma.event, 'findUnique')
  try {
    const res = await get({ ...range, cursor: forged })
    expect(res.status).toBe(200)
    expect(lookup).not.toHaveBeenCalled()
    const next = await res.json()
    expect(next.events.map((e: any) => e.id)).toEqual(['z'])
    expect(next).toMatchObject({ hasMore: false, nextCursor: null })
    expect(JSON.stringify(next)).not.toContain('FOREIGN')
  } finally { lookup.mockRestore() }
})

test('range includes continuing events and zero-duration starts across year boundaries, not foreign or touching ends', async () => {
  add('continuing', '2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z')
  add('ends-at-start', '2026-12-30T00:00:00Z', range.start)
  add('zero-at-start', range.start)
  add('inside', '2027-01-01T00:00:00Z')
  add('at-end', range.end)
  add('foreign', range.start, range.end, FAMILY_B)
  add('old-recurring', '2026-01-01T00:00:00Z')
  db.find('event', 'old-recurring')!.recurrence = 'FREQ=DAILY'
  const res = await get()
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.events.map((e: any) => e.id)).toEqual(['continuing', 'zero-at-start', 'inside'])
  expect(body).toMatchObject({ nextCursor: null, hasMore: false })
})
