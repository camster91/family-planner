// GET /api/audit (#285, PR101 D-4): household audit history. Two households,
// roles, the shared-device refusal, cross-household isolation, cursor paging
// and 12-month retention. The fake Prisma evaluates every `where`, so a query
// that forgot the household would return family B's FOREIGN rows here.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))

import { GET } from '../route'
import { AUDIT_PAGE_MAX, AUDIT_RETENTION_MS, encodeAuditCursor } from '@/lib/household-audit'
import { db, req, expectNoForeignData, FAMILY_A, FAMILY_B, FOREIGN, type UserKey } from '@/__tests__/helpers/two-household'
import { deviceReq, enableSharedDevice, disableSharedDevice, seedDevices } from '@/__tests__/helpers/device'

const DAY = 24 * 60 * 60 * 1000

function row(id: string, familyId: string, at: Date, extra: Record<string, unknown> = {}) {
  const foreign = familyId === FAMILY_B
  return {
    id,
    family_id: familyId,
    actor_user_id: foreign ? 'parent-b' : 'parent-a',
    actor_kind: 'person',
    action: 'feature.turned_on',
    target_type: 'feature',
    target_id: 'meals',
    summary: foreign ? `Turned on ${FOREIGN} meals` : 'Turned on Meal planning',
    created_at: at,
    ...extra,
  }
}

function audit(as: UserKey | null, query: Record<string, string> = {}) {
  return GET(req({ as, path: '/api/audit', query }))
}

type Entry = { id: string; action: string; actorKind: string; actor: { id: string; name: string } | null; summary: string; createdAt: string }

async function page(as: UserKey, query: Record<string, string> = {}) {
  const res = await audit(as, query)
  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  const body = await expectNoForeignData(res)
  return body as { entries: Entry[]; nextCursor: string | null }
}

describe('GET /api/audit', () => {
  const now = Date.now()

  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    db.rows('auditLog').push(
      row('a-1', FAMILY_A, new Date(now - 3 * DAY)),
      row('a-2', FAMILY_A, new Date(now - 2 * DAY), {
        actor_kind: 'device',
        action: 'board_settings.changed',
        target_type: 'family',
        target_id: FAMILY_A,
        summary: 'Changed the Today board settings: weather',
      }),
      row('a-3', FAMILY_A, new Date(now - 1 * DAY), { actor_user_id: null, summary: 'Paired the tablet “Kitchen”', action: 'device.paired' }),
      row('b-1', FAMILY_B, new Date(now - 1 * DAY)),
      row('b-2', FAMILY_B, new Date(now - 400 * DAY))
    )
  })

  it('401 without a session and 400 without a household, reading nothing', async () => {
    expect((await audit(null)).status).toBe(401)
    expect((await audit('loner')).status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })

  it.each(['teenA', 'childA', 'childB'] as UserKey[])('%s gets 403 and no rows', async (who) => {
    const res = await audit(who)
    expect(res.status).toBe(403)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('Turned on')
    expect(db.writes).toHaveLength(0)
  })

  it("a parent reads only their own household's history, newest first, with plain fields", async () => {
    const { entries, nextCursor } = await page('parentA')
    expect(entries.map((e) => e.id)).toEqual(['a-3', 'a-2', 'a-1'])
    expect(nextCursor).toBeNull()
    expect(entries[1]).toEqual({
      id: 'a-2',
      action: 'board_settings.changed',
      actorKind: 'device',
      actor: { id: 'parent-a', name: 'Parent A' },
      targetType: 'family',
      targetId: FAMILY_A,
      summary: 'Changed the Today board settings: weather',
      createdAt: new Date(now - 2 * DAY).toISOString(),
    })
    // No household id, email or other internal columns leave the server.
    const text = JSON.stringify(entries)
    expect(text).not.toContain('family_id')
    expect(text).not.toContain('@example.test')
    expect(entries[0].actor).toBeNull()
  })

  it('never names an actor who has since left for another household', async () => {
    db.find('user', 'parent-a')!.family_id = FAMILY_B
    db.find('user', 'teen-a')!.role = 'parent'
    const res = await GET(req({ as: 'teenA', path: '/api/audit' }))
    const { entries } = await res.json()
    expect(entries.map((e: Entry) => e.actor)).toEqual([null, null, null])
  })

  it('isolates households both ways, including with a cursor taken from the other household', async () => {
    const b = await GET(req({ as: 'parentB', path: '/api/audit' }))
    const body = await b.json()
    expect(body.entries.map((e: Entry) => e.id)).toEqual(['b-1'])
    const aCursor = encodeAuditCursor({ id: 'a-3', created_at: new Date(now - 1 * DAY) })
    const bWithA = await GET(req({ as: 'parentB', path: '/api/audit', query: { cursor: aCursor } }))
    expect((await bWithA.json()).entries.every((e: Entry) => e.id.startsWith('b-'))).toBe(true)
    const aWithB = await page('parentA', { cursor: encodeAuditCursor({ id: 'b-1', created_at: new Date(now) }) })
    expect(aWithB.entries.map((e) => e.id)).toEqual(['a-3', 'a-2', 'a-1'])
  })

  it('pages with an opaque cursor: no duplicates, no gaps, stable order for equal times', async () => {
    const same = new Date(now - 10 * DAY)
    for (let i = 0; i < 57; i++) {
      // Three rows share every timestamp, so the id tie-breaker matters.
      db.rows('auditLog').push(row(`p-${String(i).padStart(2, '0')}`, FAMILY_A, new Date(same.getTime() - Math.floor(i / 3) * 1000)))
    }
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const result: { entries: Entry[]; nextCursor: string | null } = await page('parentA', cursor ? { limit: '20', cursor } : { limit: '20' })
      expect(result.entries.length).toBeLessThanOrEqual(20)
      seen.push(...result.entries.map((e) => e.id))
      cursor = result.nextCursor
      pages += 1
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(seen).toHaveLength(60)
    expect(new Set(seen).size).toBe(60)
    const times = seen.map((id) => db.find('auditLog', id)!.created_at.getTime())
    expect([...times].sort((x, y) => y - x)).toEqual(times)
  })

  it(`validates limit (1–${AUDIT_PAGE_MAX}, default 20) and cursor`, async () => {
    for (let i = 0; i < 60; i++) db.rows('auditLog').push(row(`m-${i}`, FAMILY_A, new Date(now - (20 + i) * DAY)))
    expect((await page('parentA')).entries).toHaveLength(20)
    expect((await page('parentA', { limit: String(AUDIT_PAGE_MAX) })).entries).toHaveLength(AUDIT_PAGE_MAX)
    for (const limit of ['0', '51', '-1', '1.5', 'ten', '']) {
      expect((await audit('parentA', { limit })).status).toBe(400)
    }
    for (const cursor of ['', 'not-a-cursor', Buffer.from('x|y').toString('base64url'), Buffer.from(`${new Date().toISOString()}|bad id!`).toString('base64url')]) {
      expect((await audit('parentA', { cursor })).status).toBe(400)
    }
  })

  it("prunes the reader's household rows older than 12 months, and only theirs", async () => {
    db.rows('auditLog').push(
      row('a-old', FAMILY_A, new Date(now - AUDIT_RETENTION_MS - DAY)),
      row('a-edge', FAMILY_A, new Date(now - AUDIT_RETENTION_MS + DAY))
    )
    const { entries } = await page('parentA', { limit: '50' })
    expect(entries.map((e) => e.id)).toEqual(['a-3', 'a-2', 'a-1', 'a-edge'])
    expect(db.find('auditLog', 'a-old')).toBeUndefined()
    // Family B's old row is untouched until a B parent reads.
    expect(db.find('auditLog', 'b-2')).toBeDefined()
    const deletes = db.writes.filter((w) => w.model === 'auditLog')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].args.where.family_id).toBe(FAMILY_A)
  })

  it('refuses a paired shared device with 403 before person auth, even with a parent session beside it', async () => {
    enableSharedDevice()
    try {
      const fx = seedDevices()
      for (const as of [null, 'parentA'] as const) {
        const res = await GET(deviceReq({ as, path: '/api/audit', cookies: fx.d1.cookies }))
        expect(res.status).toBe(403)
        const body = await res.json()
        expect(body.error.code).toBe('DEVICE_WRITE_NOT_ALLOWED')
        expect(JSON.stringify(body)).not.toContain('Turned on')
      }
      expect(db.writes.filter((w) => w.model === 'auditLog')).toHaveLength(0)
    } finally {
      disableSharedDevice()
    }
  })
})
