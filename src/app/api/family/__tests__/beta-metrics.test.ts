// PATCH /api/family/beta-metrics (#287, PR101 D-6): two households. Parents
// only, own household only, strict body, the shared-device refusal, off
// deletes only that household's counts, the audit line, and no-store caching.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { PATCH } from '../beta-metrics/route'
import { FAMILY_A, FAMILY_B, db, req, writesTo, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'

const PATH = '/api/family/beta-metrics'

function patch(as: UserKey | null, body: unknown) {
  return PATCH(req({ as, path: PATH, method: 'PATCH', body }))
}

function enabled(familyId: string) {
  return db.rows('family').find((f) => f.id === familyId)!.beta_metrics_enabled
}

function seedCounts() {
  const day = new Date('2026-09-28T00:00:00Z')
  db.rows('betaMetricDaily').push(
    { family_id: FAMILY_A, day, metric: 'chore_completed', count: 4 },
    { family_id: FAMILY_A, day, metric: 'event_created', count: 1 },
    { family_id: FAMILY_B, day, metric: 'chore_completed', count: 7 }
  )
}

function counts(familyId: string) {
  return db.rows('betaMetricDaily').filter((r) => r.family_id === familyId).length
}

describe('PATCH /api/family/beta-metrics', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    seedCounts()
  })

  it('is off by default for every household', () => {
    expect(enabled(FAMILY_A)).toBe(false)
    expect(enabled(FAMILY_B)).toBe(false)
  })

  it('401 without a session; 400 for a member without a household; nothing written', async () => {
    expect((await patch(null, { enabled: true })).status).toBe(401)
    expect((await patch('loner', { enabled: true })).status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })

  it.each(['teenA', 'childA', 'childB'] as UserKey[])('%s gets 403 and changes nothing', async (who) => {
    const res = await patch(who, { enabled: false })
    expect(res.status).toBe(403)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(db.writes).toHaveLength(0)
    expect(counts(FAMILY_A)).toBe(2)
    expect(counts(FAMILY_B)).toBe(1)
  })

  it('a parent turns it on for their own household only, with a history line', async () => {
    const res = await patch('parentA', { enabled: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ betaMetrics: { enabled: true } })
    expect(enabled(FAMILY_A)).toBe(true)
    expect(enabled(FAMILY_B)).toBe(false)
    const updates = writesTo('family')
    expect(updates).toHaveLength(1)
    expect(updates[0].args.where).toEqual({ id: FAMILY_A })
    // On deletes nothing.
    expect(writesTo('betaMetricDaily')).toHaveLength(0)
    const audit = db.rows('auditLog')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      family_id: FAMILY_A,
      actor_user_id: 'parent-a',
      action: 'beta_metrics.turned_on',
      target_type: 'family',
      summary: 'Turned on beta usage counts',
    })
  })

  it("off deletes that household's counts and never the other household's", async () => {
    db.rows('family').find((f) => f.id === FAMILY_A)!.beta_metrics_enabled = true
    db.rows('family').find((f) => f.id === FAMILY_B)!.beta_metrics_enabled = true
    const res = await patch('parentA', { enabled: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ betaMetrics: { enabled: false } })
    expect(enabled(FAMILY_A)).toBe(false)
    expect(enabled(FAMILY_B)).toBe(true)
    expect(counts(FAMILY_A)).toBe(0)
    expect(counts(FAMILY_B)).toBe(1)
    const deletes = writesTo('betaMetricDaily')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].args.where).toEqual({ family_id: FAMILY_A })
    expect(db.rows('auditLog')).toEqual([
      expect.objectContaining({ family_id: FAMILY_A, action: 'beta_metrics.turned_off' }),
    ])
  })

  it('parent B controls household B only', async () => {
    const res = await patch('parentB', { enabled: false })
    expect(res.status).toBe(200)
    expect(counts(FAMILY_A)).toBe(2)
    expect(counts(FAMILY_B)).toBe(0)
    expect(enabled(FAMILY_A)).toBe(false)
  })

  it('a repeat adds no history line; a repeated off still leaves no counts', async () => {
    expect((await patch('parentA', { enabled: false })).status).toBe(200)
    expect(writesTo('family')).toHaveLength(0)
    expect(db.rows('auditLog')).toHaveLength(0)
    expect(counts(FAMILY_A)).toBe(0)
  })

  it.each([
    ['no body', undefined],
    ['a string', 'true'],
    ['a missing enabled', {}],
    ['a non-boolean', { enabled: 'yes' }],
    ['another household', { enabled: false, familyId: FAMILY_B }],
    ['a metric name', { enabled: true, metric: 'chore_completed' }],
  ])('400 for %s, writing nothing', async (_label, body) => {
    const res = await patch('parentA', body)
    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(db.writes).toHaveLength(0)
    expect(counts(FAMILY_A)).toBe(2)
    expect(counts(FAMILY_B)).toBe(1)
  })

  it('refuses a paired shared device with 403 before person auth, even with a parent session beside it', async () => {
    enableSharedDevice()
    try {
      const fx = seedDevices()
      for (const as of [null, 'parentA'] as const) {
        const res = await PATCH(
          deviceReq({ as, path: PATH, method: 'PATCH', body: { enabled: false }, cookies: fx.d1.cookies })
        )
        expect(res.status).toBe(403)
        expect((await res.json()).error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
        expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      }
      expect(writesTo('family')).toHaveLength(0)
      expect(writesTo('betaMetricDaily')).toHaveLength(0)
    } finally {
      disableSharedDevice()
    }
  })
})
