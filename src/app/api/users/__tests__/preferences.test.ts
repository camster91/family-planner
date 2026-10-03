// GET / PATCH /api/users/preferences (#286, PR101 D-5): two households, every
// role reads and changes only their OWN switches, strict validation, the
// shared-device refusal, Idempotency-Key replay and no-store caching.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { GET, PATCH } from '../preferences/route'
import { db, req, writesTo, USER_IDS, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'

const PATH = '/api/users/preferences'
const ALL_ON = { chores: true, events: true, messages: true }
const QUIET_OFF = { enabled: false, start: '22:00', end: '07:00', timeZone: null }
const SUMMARY_OFF = { enabled: false, timeZone: null }

function get(as: UserKey | null) {
  return GET(req({ as, path: PATH }))
}

function patch(as: UserKey | null, body: unknown, headers: Record<string, string> = {}) {
  return PATCH(req({ as, path: PATH, method: 'PATCH', body, headers }))
}

function columns(who: UserKey) {
  const u = db.find('user', USER_IDS[who])!
  return { chores: u.notify_chores, events: u.notify_events, messages: u.notify_messages }
}

describe('/api/users/preferences', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
  })

  it('401 without a session, reading and writing nothing', async () => {
    expect((await get(null)).status).toBe(401)
    expect((await patch(null, { chores: false })).status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })

  it.each(['parentA', 'teenA', 'childA', 'parentB', 'loner'] as UserKey[])(
    '%s reads their own preferences (all on by default), privately and uncached',
    async (who) => {
      const res = await get(who)
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      // Only the three booleans: no id, name, email or household.
      expect(await res.json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: ALL_ON })
      expect(db.writes).toHaveLength(0)
    }
  )

  it("reads the caller's own row, never another member's", async () => {
    db.find('user', USER_IDS.childA)!.notify_chores = false
    db.find('user', USER_IDS.parentB)!.notify_events = false
    expect(await (await get('parentA')).json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: ALL_ON })
    expect(await (await get('childA')).json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: { ...ALL_ON, chores: false } })
    expect(await (await get('parentB')).json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: { ...ALL_ON, events: false } })
  })

  it.each(['parentA', 'teenA', 'childA'] as UserKey[])('%s changes only their own switches', async (who) => {
    const res = await patch(who, { chores: false, messages: false })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: { chores: false, events: true, messages: false } })
    expect(columns(who)).toEqual({ chores: false, events: true, messages: false })

    // Everyone else, in both households, is untouched.
    for (const other of ['parentA', 'teenA', 'childA', 'parentB', 'childB', 'loner'] as UserKey[]) {
      if (other !== who) expect(columns(other)).toEqual(ALL_ON)
    }
    const updates = writesTo('user')
    expect(updates).toHaveLength(1)
    expect(updates[0].args.where).toEqual({ id: USER_IDS[who] })

    // Turning one back on leaves the others as they were.
    const again = await patch(who, { chores: true })
    expect(await again.json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: { chores: true, events: true, messages: false } })
  })

  it('cannot name another member, in this household or another (strict body)', async () => {
    for (const body of [
      { userId: USER_IDS.childA, chores: false },
      { user_id: USER_IDS.parentB, chores: false },
      { id: USER_IDS.childB, events: false },
    ]) {
      const res = await patch('parentA', body)
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    }
    expect(columns('childA')).toEqual(ALL_ON)
    expect(columns('parentB')).toEqual(ALL_ON)
    expect(columns('childB')).toEqual(ALL_ON)
    expect(columns('parentA')).toEqual(ALL_ON)
    expect(writesTo('user')).toHaveLength(0)
  })

  it.each([
    ['an unknown key', { chores: false, weeklyReports: true }],
    ['a snake_case column name', { notify_chores: false }],
    ['a non-boolean value', { chores: 'off' }],
    ['null', { events: null }],
    ['an empty body', {}],
    ['an array', [false]],
    ['a bare boolean', false],
  ])('400 VALIDATION_ERROR for %s, writing nothing', async (_label, body) => {
    const res = await patch('teenA', body)
    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
    expect(db.writes).toHaveLength(0)
  })

  it('400 INVALID_JSON for a body that is not JSON', async () => {
    const res = await PATCH(req({ as: 'childA', path: PATH, method: 'PATCH' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_JSON')
    expect(db.writes).toHaveLength(0)
  })

  it('a member without a household can still change their own switches', async () => {
    const res = await patch('loner', { events: false }, { 'Idempotency-Key': 'loner-key-00000001' })
    expect(res.status).toBe(200)
    expect(columns('loner')).toEqual({ chores: true, events: false, messages: true })
    // No household, so no idempotency record (records belong to a household).
    expect(writesTo('idempotencyRecord')).toHaveLength(0)
  })

  it('Idempotency-Key: the same key and body replays; the same key with another body is 422', async () => {
    const key = { 'Idempotency-Key': 'prefs-key-0000001' }
    const first = await patch('childA', { messages: false }, key)
    expect(first.status).toBe(200)
    const userWrites = writesTo('user').length

    const replay = await patch('childA', { messages: false }, key)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
    expect(await replay.json()).toEqual({ quietHours: QUIET_OFF, morningSummary: SUMMARY_OFF, preferences: { chores: true, events: true, messages: false } })
    expect(writesTo('user')).toHaveLength(userWrites)

    const reused = await patch('childA', { messages: true }, key)
    expect(reused.status).toBe(422)
    expect(columns('childA').messages).toBe(false)

    // Keys are per person: the same key from another member is a new request.
    const other = await patch('teenA', { messages: false }, key)
    expect(other.status).toBe(200)
    expect(other.headers.get('Idempotency-Replayed')).toBeNull()
    expect(columns('teenA').messages).toBe(false)
  })

  it('400 for an invalid Idempotency-Key, writing nothing', async () => {
    const res = await patch('parentA', { chores: false }, { 'Idempotency-Key': 'x' })
    expect(res.status).toBe(400)
    expect(columns('parentA')).toEqual(ALL_ON)
  })

  it('refuses a paired shared device with 403 before person auth, even with a session beside it', async () => {
    enableSharedDevice()
    try {
      const fx = seedDevices()
      for (const as of [null, 'parentA', 'childA'] as const) {
        const read = await GET(deviceReq({ as, path: PATH, cookies: fx.d1.cookies }))
        expect(read.status).toBe(403)
        expect((await read.json()).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')

        const write = await PATCH(
          deviceReq({ as, path: PATH, method: 'PATCH', body: { chores: false }, cookies: fx.d1.cookies })
        )
        expect(write.status).toBe(403)
        expect((await write.json()).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
      }
      expect(columns('parentA')).toEqual(ALL_ON)
      expect(columns('childA')).toEqual(ALL_ON)
      expect(writesTo('user')).toHaveLength(0)
    } finally {
      disableSharedDevice()
    }
  })

  describe('quiet hours (#141, O-32)', () => {
    const NIGHT = { enabled: true, start: '22:00', end: '07:00', timeZone: 'America/Toronto' }

    function quietColumns(who: UserKey) {
      const u = db.find('user', USER_IDS[who])!
      return {
        enabled: u.quiet_hours_enabled,
        start: u.quiet_hours_start,
        end: u.quiet_hours_end,
        timeZone: u.quiet_hours_time_zone,
      }
    }

    it.each(['parentA', 'teenA', 'childA', 'loner'] as UserKey[])(
      '%s saves their own quiet hours; nobody else changes',
      async (who) => {
        const res = await patch(who, { quietHours: NIGHT })
        expect(res.status).toBe(200)
        expect(res.headers.get('Cache-Control')).toBe('private, no-store')
        expect(await res.json()).toEqual({ preferences: ALL_ON, quietHours: NIGHT, morningSummary: SUMMARY_OFF })
        expect(quietColumns(who)).toEqual(NIGHT)
        for (const other of ['parentA', 'teenA', 'childA', 'parentB', 'childB', 'loner'] as UserKey[]) {
          if (other !== who) expect(quietColumns(other)).toEqual(QUIET_OFF)
        }
        const updates = writesTo('user')
        expect(updates).toHaveLength(1)
        expect(updates[0].args.where).toEqual({ id: USER_IDS[who] })
        // A fresh read sees it.
        expect(await (await get(who)).json()).toEqual({ preferences: ALL_ON, quietHours: NIGHT, morningSummary: SUMMARY_OFF })
      }
    )

    it('a window may wrap past midnight or sit inside one day; a missing zone is stored as null (UTC)', async () => {
      const day = { enabled: true, start: '13:00', end: '15:30' }
      const res = await patch('teenA', { quietHours: day })
      expect(res.status).toBe(200)
      expect((await res.json()).quietHours).toEqual({ ...day, timeZone: null })
    })

    it('switches and quiet hours can change together; turning quiet hours off keeps the times', async () => {
      await patch('childA', { quietHours: NIGHT })
      const res = await patch('childA', { events: false, quietHours: { ...NIGHT, enabled: false } })
      expect(await res.json()).toEqual({
        preferences: { ...ALL_ON, events: false },
        quietHours: { ...NIGHT, enabled: false },
        morningSummary: SUMMARY_OFF,
      })
    })

    it('changing only a switch leaves quiet hours as they were', async () => {
      await patch('parentA', { quietHours: NIGHT })
      const res = await patch('parentA', { chores: false })
      expect((await res.json()).quietHours).toEqual(NIGHT)
    })

    it.each([
      ['equal start and end', { ...NIGHT, start: '22:00', end: '22:00' }],
      ['a 12-hour time', { ...NIGHT, start: '10:00 PM' }],
      ['a single-digit hour', { ...NIGHT, start: '9:00' }],
      ['an hour past 23', { ...NIGHT, end: '24:00' }],
      ['seconds', { ...NIGHT, end: '07:00:00' }],
      ['an unknown time zone', { ...NIGHT, timeZone: 'Mars/Olympus' }],
      ['an over-long time zone', { ...NIGHT, timeZone: 'A'.repeat(65) }],
      ['a missing enabled flag', { start: '22:00', end: '07:00' }],
      ['a missing end', { enabled: true, start: '22:00' }],
      ['a non-boolean enabled', { ...NIGHT, enabled: 'yes' }],
      ['an unknown key inside', { ...NIGHT, userId: USER_IDS.childA }],
      ['null', null],
    ])('400 VALIDATION_ERROR for quiet hours with %s, writing nothing', async (_label, quietHours) => {
      const res = await patch('teenA', { quietHours })
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
      expect(db.writes).toHaveLength(0)
      expect(quietColumns('teenA')).toEqual(QUIET_OFF)
    })

    it('a paired shared device cannot change quiet hours', async () => {
      enableSharedDevice()
      try {
        const fx = seedDevices()
        const res = await PATCH(
          deviceReq({ as: 'parentA', path: PATH, method: 'PATCH', body: { quietHours: NIGHT }, cookies: fx.d1.cookies })
        )
        expect(res.status).toBe(403)
        expect(quietColumns('parentA')).toEqual(QUIET_OFF)
      } finally {
        disableSharedDevice()
      }
    })
  })

  describe('morning summary (O-40)', () => {
    const ON = { enabled: true, timeZone: 'America/Vancouver' }

    function summaryColumns(who: UserKey) {
      const u = db.find('user', USER_IDS[who])!
      return {
        enabled: u.morning_summary_enabled,
        timeZone: u.morning_summary_time_zone,
        sentOn: u.morning_summary_sent_on,
      }
    }

    it('is off for everyone by default (opt-in)', async () => {
      for (const who of ['parentA', 'teenA', 'childA', 'parentB', 'loner'] as UserKey[]) {
        expect((await (await get(who)).json()).morningSummary).toEqual(SUMMARY_OFF)
      }
    })

    it.each(['parentA', 'teenA', 'childA'] as UserKey[])(
      '%s turns their own summary on with their zone; nobody else changes',
      async (who) => {
        const res = await patch(who, { morningSummary: ON })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ preferences: ALL_ON, quietHours: QUIET_OFF, morningSummary: ON })
        expect(summaryColumns(who)).toEqual({ enabled: true, timeZone: 'America/Vancouver', sentOn: null })
        for (const other of ['parentA', 'teenA', 'childA', 'parentB', 'childB', 'loner'] as UserKey[]) {
          if (other !== who) expect(summaryColumns(other)).toEqual({ enabled: false, timeZone: null, sentOn: null })
        }
        expect(writesTo('user')).toHaveLength(1)
        expect(writesTo('user')[0].args.where).toEqual({ id: USER_IDS[who] })
      }
    )

    it('turning it off keeps the saved zone and never resets the last-sent day', async () => {
      await patch('teenA', { morningSummary: ON })
      db.find('user', USER_IDS.teenA)!.morning_summary_sent_on = '2026-10-03'
      const res = await patch('teenA', { morningSummary: { enabled: false } })
      expect((await res.json()).morningSummary).toEqual({ enabled: false, timeZone: 'America/Vancouver' })
      expect(summaryColumns('teenA')).toEqual({ enabled: false, timeZone: 'America/Vancouver', sentOn: '2026-10-03' })
      // On again the same day: the sent day is still there, so no second summary.
      await patch('teenA', { morningSummary: ON })
      expect(summaryColumns('teenA').sentOn).toBe('2026-10-03')
    })

    it.each([
      ['an unknown time zone', { enabled: true, timeZone: 'Mars/Olympus' }],
      ['a non-boolean enabled', { enabled: 'yes' }],
      ['a missing enabled flag', { timeZone: 'America/Toronto' }],
      ['an unknown key inside', { enabled: true, userId: USER_IDS.childA }],
      ['a sent-day write attempt', { enabled: true, sentOn: '2026-10-03' }],
      ['a bare boolean', true],
    ])('400 VALIDATION_ERROR for %s, writing nothing', async (_label, morningSummary) => {
      const res = await patch('childA', { morningSummary })
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR')
      expect(db.writes).toHaveLength(0)
      expect(summaryColumns('childA')).toEqual({ enabled: false, timeZone: null, sentOn: null })
    })

    it('a paired shared device cannot turn it on', async () => {
      enableSharedDevice()
      try {
        const fx = seedDevices()
        const res = await PATCH(
          deviceReq({ as: 'parentA', path: PATH, method: 'PATCH', body: { morningSummary: ON }, cookies: fx.d1.cookies })
        )
        expect(res.status).toBe(403)
        expect(summaryColumns('parentA').enabled).toBe(false)
      } finally {
        disableSharedDevice()
      }
    })
  })
})
