// Commit and undo of a review-first import (#270): events are created in one
// transaction under a required Idempotency-Key (a retry replays the original
// result), the undo token is an HMAC bound to the caller, household, ids and
// time (forged, another person's or expired tokens are refused), and undo can
// never reach an event made by hand through POST /api/events. Roles: parent
// and teen; child and paired device 403; two households kept apart.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
const mockGate = jest.fn(async (_familyId: string, _key: string): Promise<unknown> => null)
jest.mock('@/lib/feature-gate-server', () => ({
  featureGate: (familyId: string, key: string) => mockGate(familyId, key),
}))

import { POST as COMMIT } from '../commit/route'
import { POST as UNDO } from '../undo/route'
import { POST as CREATE_EVENT } from '@/app/api/events/route'
import { db, req, FOREIGN, USER_IDS, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'
import { idempotencyRuntime } from '@/lib/idempotency'
import { EVENT_IMPORT_UNDO_WINDOW_MS } from '@/lib/event-import'
import {
  EVENT_IMPORT_ACTIVITY_TYPE,
  commitImportedEvents,
  signUndoToken,
  verifyUndoToken,
} from '@/lib/event-import-commit'

const KEY_1 = 'batch-key-0000000000000001'
const KEY_2 = 'batch-key-0000000000000002'

const EVENTS = [
  { title: 'Picture day', description: null, start_time: '2026-10-02T04:00:00.000Z', end_time: '2026-10-03T03:59:00.000Z', location: null },
  {
    title: 'Bake sale', description: 'Bring $2', start_time: '2026-10-09T19:30:00.000Z',
    end_time: '2026-10-09T21:00:00.000Z', location: 'Gym',
  },
]

function commitReq(as: UserKey | null, body: unknown = { events: EVENTS }, key: string | null = KEY_1) {
  return req({
    as,
    method: 'POST',
    path: '/api/calendar/import-suggestions/commit',
    body,
    headers: key ? { 'Idempotency-Key': key } : {},
  })
}
const undoReq = (as: UserKey | null, body: unknown) =>
  req({ as, method: 'POST', path: '/api/calendar/import-suggestions/undo', body })

const eventIds = () => db.rows('event').map((r) => r.id as string)
const importedFor = (family: string) =>
  db.rows('event').filter((r) => r.family_id === family && ['Picture day', 'Bake sale'].includes(r.title as string))

async function errorCode(res: any): Promise<string | undefined> {
  return (await res.json())?.error?.code
}

beforeAll(() => {
  for (const level of ['log', 'warn', 'error', 'info'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
})
beforeEach(() => {
  db.reset()
  mockGate.mockReset()
  mockGate.mockImplementation(async () => null)
  idempotencyRuntime.random = () => 0.99
})

describe('POST /api/calendar/import-suggestions/commit', () => {
  it('creates the reviewed events in the caller household with one activity row and an undo token', async () => {
    const res = await COMMIT(commitReq('teenA'))
    expect(res.status).toBe(201)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.eventIds).toHaveLength(2)
    expect(typeof body.undoToken).toBe('string')
    expect(Date.parse(body.undoExpiresAt) - Date.now()).toBeLessThanOrEqual(EVENT_IMPORT_UNDO_WINDOW_MS)
    const rows = db.rows('event').filter((r) => body.eventIds.includes(r.id))
    expect(rows.map((r) => [r.title, r.family_id, r.created_by, r.location, r.description])).toEqual([
      ['Picture day', 'family-A', USER_IDS.teenA, null, null],
      ['Bake sale', 'family-A', USER_IDS.teenA, 'Gym', 'Bring $2'],
    ])
    expect(rows[1].start_time).toEqual(new Date(EVENTS[1].start_time))
    const acts = db.rows('activity').filter((a) => a.type === EVENT_IMPORT_ACTIVITY_TYPE)
    expect(acts).toHaveLength(1)
    expect(acts[0].title).toBe('Teen A imported 2 events to the calendar')
    expect(mockGate).toHaveBeenCalledWith('family-A', 'calendar')
  })

  it('a retry with the same key replays the original result and creates nothing more', async () => {
    const first = await COMMIT(commitReq('parentA'))
    const firstBody = await first.json()
    const before = db.rows('event').length
    const again = await COMMIT(commitReq('parentA'))
    expect(again.status).toBe(201)
    expect(again.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await again.json()).toEqual(firstBody)
    expect(db.rows('event').length).toBe(before)
    // A different batch under the same key is refused, not merged.
    const reused = await COMMIT(commitReq('parentA', { events: [EVENTS[0]] }))
    expect(reused.status).toBe(422)
    // A new key is a new import.
    expect((await COMMIT(commitReq('parentA', { events: EVENTS }, KEY_2))).status).toBe(201)
    expect(db.rows('event').length).toBe(before + 2)
  })

  it('converges when an earlier run committed but its response was never stored', async () => {
    const actor = { id: USER_IDS.parentA, family_id: 'family-A', name: 'Parent A' }
    const { prisma } = require('@/lib/prisma')
    const now = new Date()
    const first = await commitImportedEvents(prisma, { events: EVENTS }, actor, 'rec-1', now)
    // Same record (a takeover after a crash): no second set of events, same token.
    const again = await commitImportedEvents(prisma, { events: EVENTS }, actor, 'rec-1', new Date(now.getTime() + 40_000))
    expect(again).toEqual(first)
    expect(db.rows('event').filter((r) => r.created_by === USER_IDS.parentA && r.title === 'Bake sale')).toHaveLength(1)
  })

  it('requires an Idempotency-Key', async () => {
    const res = await COMMIT(commitReq('parentA', { events: EVENTS }, null))
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(eventIds()).toEqual(['event-a', 'event-b'])
  })

  it('validates with the POST /api/events rules and writes nothing on a bad batch', async () => {
    const bad = [
      { events: [] },
      { events: [{ ...EVENTS[0], title: '' }] },
      { events: [{ ...EVENTS[0], title: 'x'.repeat(201) }] },
      { events: [{ ...EVENTS[0], start_time: 'soon' }] },
      { events: [{ ...EVENTS[0], end_time: '2026-10-01T00:00:00.000Z' }] },
      { events: [{ ...EVENTS[0], family_id: 'family-B' }] },
      { events: [EVENTS[0]], family_id: 'family-B' },
      { events: Array.from({ length: 31 }, () => EVENTS[0]) },
    ]
    for (const [i, body] of bad.entries()) {
      const res = await COMMIT(commitReq('parentA', body, `bad-key-00000000000000${String(i).padStart(2, '0')}`))
      expect(res.status).toBe(400)
    }
    expect(eventIds()).toEqual(['event-a', 'event-b'])
    expect(db.rows('activity').filter((a) => a.type === EVENT_IMPORT_ACTIVITY_TYPE)).toHaveLength(0)
  })

  it('refuses a child, a signed-out caller, the calendar feature off and a paired device', async () => {
    const child = await COMMIT(commitReq('childA'))
    expect(child.status).toBe(403)
    expect(await errorCode(child)).toBe('EVENT_IMPORT_FORBIDDEN')
    expect((await COMMIT(commitReq(null))).status).toBe(401)
    mockGate.mockImplementationOnce(async () => ({ status: 403, json: async () => ({ error: 'off' }), headers: new Headers() }))
    expect((await COMMIT(commitReq('parentA'))).status).toBe(403)
    enableSharedDevice()
    try {
      const fx = seedDevices()
      const csrf = 'c'.repeat(64)
      const res = await COMMIT(
        deviceReq({
          method: 'POST',
          path: '/api/calendar/import-suggestions/commit',
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { 'x-csrf-token': csrf, 'Idempotency-Key': KEY_1 },
          body: { events: EVENTS },
        })
      )
      expect(res.status).toBe(403)
    } finally {
      disableSharedDevice()
    }
    expect(eventIds()).toEqual(expect.arrayContaining(['event-a', 'event-b']))
    expect(db.rows('event').filter((r) => r.title === 'Bake sale')).toHaveLength(0)
  })

  it('two households: B commits into B only, and the same key in A and B are separate imports', async () => {
    const a = await (await COMMIT(commitReq('parentA'))).json()
    const b = await COMMIT(commitReq('parentB'))
    expect(b.status).toBe(201)
    const bBody = await b.json()
    expect(bBody.eventIds).not.toEqual(a.eventIds)
    expect(JSON.stringify(bBody)).not.toContain(FOREIGN)
    expect(importedFor('family-B').map((r) => r.created_by)).toEqual([USER_IDS.parentB, USER_IDS.parentB])
    expect(importedFor('family-A').map((r) => r.created_by)).toEqual([USER_IDS.parentA, USER_IDS.parentA])
  })
})

describe('POST /api/calendar/import-suggestions/undo', () => {
  async function commitAs(as: UserKey, key = KEY_1) {
    const res = await COMMIT(commitReq(as, { events: EVENTS }, key))
    expect(res.status).toBe(201)
    return res.json() as Promise<{ eventIds: string[]; undoToken: string }>
  }

  it('removes exactly the events of that import and is safe to repeat', async () => {
    const other = await commitAs('parentA', KEY_2)
    const mine = await commitAs('parentA')
    const res = await UNDO(undoReq('parentA', { token: mine.undoToken }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ removedCount: 2 })
    expect(eventIds()).not.toEqual(expect.arrayContaining(mine.eventIds))
    expect(eventIds()).toEqual(expect.arrayContaining([...other.eventIds, 'event-a', 'event-b']))
    const again = await UNDO(undoReq('parentA', { token: mine.undoToken }))
    expect(await again.json()).toEqual({ removedCount: 0 })
  })

  it('lets a teen undo their own import', async () => {
    const mine = await commitAs('teenA')
    const res = await UNDO(undoReq('teenA', { token: mine.undoToken }))
    expect(await res.json()).toEqual({ removedCount: 2 })
  })

  it('can never delete an event made by hand with POST /api/events (the teen delete bypass)', async () => {
    const created = await CREATE_EVENT(
      req({ as: 'teenA', method: 'POST', path: '/api/events', body: { title: 'By hand', start_time: '2026-10-05T12:00:00.000Z' } })
    )
    const handId = (await created.json()).event.id as string
    // No ids are accepted any more; a forged token naming the id fails the MAC.
    expect((await UNDO(undoReq('teenA', { eventIds: [handId] }))).status).toBe(400)
    const forged = signUndoToken({ userId: USER_IDS.teenA, familyId: 'family-A', eventIds: [handId], createdAt: Date.now() })
      .replace(/\.[^.]+$/, '.' + Buffer.alloc(32, 7).toString('base64url'))
    const res = await UNDO(undoReq('teenA', { token: forged }))
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('UNDO_TOKEN_INVALID')
    // Editing the ids of a real token breaks it too.
    const mine = await commitAs('teenA')
    const [v, payload, mac] = mine.undoToken.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
    claims.e = [handId]
    const edited = `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`
    expect((await UNDO(undoReq('teenA', { token: edited }))).status).toBe(403)
    expect(eventIds()).toContain(handId)
  })

  it("refuses another member's token and a token from another household", async () => {
    const parents = await commitAs('parentA')
    const res = await UNDO(undoReq('teenA', { token: parents.undoToken }))
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('UNDO_TOKEN_INVALID')
    const foreign = await commitAs('parentB', KEY_2)
    const cross = await UNDO(undoReq('parentA', { token: foreign.undoToken }))
    expect(cross.status).toBe(403)
    expect(JSON.stringify(await cross.json())).not.toContain(FOREIGN)
    expect(eventIds()).toEqual(expect.arrayContaining([...parents.eventIds, ...foreign.eventIds]))
  })

  it('refuses an expired token (409) and a malformed one (403 or 400)', async () => {
    const mine = await commitAs('parentA')
    const old = signUndoToken({
      userId: USER_IDS.parentA,
      familyId: 'family-A',
      eventIds: mine.eventIds,
      createdAt: Date.now() - EVENT_IMPORT_UNDO_WINDOW_MS - 1000,
    })
    const res = await UNDO(undoReq('parentA', { token: old }))
    expect(res.status).toBe(409)
    expect(await errorCode(res)).toBe('UNDO_WINDOW_EXPIRED')
    for (const token of ['nope', 'v1.x.y', 'v2.a.b', `${mine.undoToken}x`]) {
      expect((await UNDO(undoReq('parentA', { token }))).status).toBe(403)
    }
    expect((await UNDO(undoReq('parentA', { token: '' }))).status).toBe(400)
    expect((await UNDO(undoReq('parentA', { token: mine.undoToken, extra: 1 }))).status).toBe(400)
    expect(eventIds()).toEqual(expect.arrayContaining(mine.eventIds))
  })

  it('refuses a child and a paired device', async () => {
    const mine = await commitAs('parentA')
    expect((await UNDO(undoReq('childA', { token: mine.undoToken }))).status).toBe(403)
    expect((await UNDO(undoReq(null, { token: mine.undoToken }))).status).toBe(401)
    enableSharedDevice()
    try {
      const fx = seedDevices()
      const csrf = 'c'.repeat(64)
      const res = await UNDO(
        deviceReq({
          method: 'POST',
          path: '/api/calendar/import-suggestions/undo',
          cookies: { ...fx.d1.cookies, csrf_token: csrf },
          headers: { 'x-csrf-token': csrf },
          body: { token: mine.undoToken },
        })
      )
      expect(res.status).toBe(403)
    } finally {
      disableSharedDevice()
    }
    expect(eventIds()).toEqual(expect.arrayContaining(mine.eventIds))
  })
})

describe('undo token', () => {
  const actor = { userId: 'u1', familyId: 'f1' }
  it('round-trips and binds user, household and time', () => {
    const now = Date.now()
    const t = signUndoToken({ ...actor, eventIds: ['b', 'a'], createdAt: now })
    expect(verifyUndoToken(t, actor, now)).toEqual({ ok: true, eventIds: ['a', 'b'], createdAt: now })
    expect(verifyUndoToken(t, { ...actor, userId: 'u2' }, now)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyUndoToken(t, { ...actor, familyId: 'f2' }, now)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifyUndoToken(t, actor, now + EVENT_IMPORT_UNDO_WINDOW_MS + 1)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyUndoToken(t, actor, now - 5 * 60 * 1000)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('depends on the server secret', () => {
    const now = Date.now()
    const t = signUndoToken({ ...actor, eventIds: ['a'], createdAt: now })
    const auth = require('@/lib/auth')
    const spy = jest.spyOn(auth, 'getJwtSecret').mockReturnValue('another-secret-another-secret-xx')
    try {
      expect(verifyUndoToken(t, actor, now)).toEqual({ ok: false, reason: 'invalid' })
    } finally {
      spy.mockRestore()
    }
  })
})
