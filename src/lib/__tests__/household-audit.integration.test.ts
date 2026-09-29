// Household audit history (#285, PR101 D-4) against real Postgres: the audit
// row commits atomically with the change it records (a failure after both
// writes rolls back both), the read route pages the real index newest first,
// a deleted member's rows keep their summary with no actor, and deleting the
// household deletes its history. Only the session token check and
// next/server are replaced. Opt-in like the other integration suites:
// RUN_DB_INTEGRATION=1 DATABASE_URL=... against a disposable database that
// `node scripts/migrate.js` has prepared.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
// getServerUser (features route) reads the session cookie through next/headers;
// each concurrent request runs in its own async context with its own token.
jest.mock('next/headers', () => {
  const { AsyncLocalStorage } = require('async_hooks')
  const als = new AsyncLocalStorage()
  return {
    __als: als,
    cookies: async () => ({
      get: (name: string) => (name === 'session_token' && als.getStore() ? { value: als.getStore() } : undefined),
    }),
    headers: async () => new Headers(),
  }
})
jest.mock('@/lib/session', () => ({
  // `session:<userId>` tokens; role and family always come from the real user row.
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith('session:')) return null
    const { prisma } = require('@/lib/prisma')
    const u = await prisma.user.findUnique({ where: { id: token.slice(8) } })
    return u ? { userId: u.id, email: u.email, role: u.role, family_id: u.family_id, tv: u.token_version } : null
  },
  getTokenVersion: async () => 0,
}))

import * as householdAudit from '@/lib/household-audit'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('household audit history against Postgres', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let settingsRoute: typeof import('@/app/api/family/board-settings/route')
  let inviteRoute: typeof import('@/app/api/family/invites/[id]/route')
  let auditRoute: typeof import('@/app/api/audit/route')
  let featuresRoute: typeof import('@/app/api/family/features/route')
  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    (require('next/headers').__als as import('async_hooks').AsyncLocalStorage<string>).run(`session:${userId}`, fn)

  const FAM = 'auditint-family'
  const FAM2 = 'auditint-family-2'
  const PARENT = 'auditint-parent'
  const PARENT2 = 'auditint-parent-2'
  const TEEN = 'auditint-teen'
  const OTHER = 'auditint-other'

  function request(as: string, opts: { method?: string; path?: string; body?: unknown; query?: Record<string, string> } = {}): any {
    const url = new URL(`http://localhost${opts.path ?? '/api/test'}`)
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
    return {
      method: opts.method ?? 'GET',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      json: async () => opts.body,
    }
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: { in: [FAM, FAM2] } } })
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, PARENT2, TEEN, OTHER] } } })
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    settingsRoute = await import('@/app/api/family/board-settings/route')
    inviteRoute = await import('@/app/api/family/invites/[id]/route')
    auditRoute = await import('@/app/api/audit/route')
    featuresRoute = await import('@/app/api/family/features/route')
    await cleanup()
    await prisma.family.createMany({
      data: [
        { id: FAM, name: 'Audit home', invite_code: 'auditint-invite' },
        { id: FAM2, name: 'Audit other', invite_code: 'auditint-invite-2' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: 'p@auditint.test', name: 'Robin', role: 'parent', family_id: FAM },
        { id: PARENT2, email: 'p2@auditint.test', name: 'Sam', role: 'parent', family_id: FAM },
        { id: TEEN, email: 't@auditint.test', name: 'Kit', role: 'teen', family_id: FAM },
        { id: OTHER, email: 'o@auditint.test', name: 'Other', role: 'parent', family_id: FAM2 },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    jest.restoreAllMocks()
  })

  it('commits the change and its audit row together', async () => {
    const res = await settingsRoute.PATCH(
      request(PARENT, { method: 'PATCH', body: { display: { idleMinutes: 0 } } })
    )
    expect(res.status).toBe(200)
    const family = await prisma.family.findUnique({ where: { id: FAM }, select: { ambient_idle_minutes: true } })
    expect(family?.ambient_idle_minutes).toBe(0)
    const rows = await prisma.auditLog.findMany({ where: { family_id: FAM } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actor_user_id: PARENT,
      actor_kind: 'person',
      action: 'board_settings.changed',
      target_type: 'family',
      target_id: FAM,
      summary: 'Changed the Today board settings: calm display',
    })
  })

  it('rolls back the change when the transaction fails after the audit write', async () => {
    const before = await prisma.family.findUnique({ where: { id: FAM }, select: { ambient_idle_minutes: true } })
    const auditBefore = await prisma.auditLog.count({ where: { family_id: FAM } })
    const original = householdAudit.writeAuditLog
    const spy = jest.spyOn(householdAudit, 'writeAuditLog').mockImplementationOnce(async (db, entries) => {
      await original(db, entries)
      // The audit row is written; now fail the rest of the transaction.
      throw new Error('simulated failure after the audit write')
    })
    const res = await settingsRoute.PATCH(request(PARENT, { method: 'PATCH', body: { display: { idleMinutes: 30 } } }))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    const after = await prisma.family.findUnique({ where: { id: FAM }, select: { ambient_idle_minutes: true } })
    expect(after).toEqual(before)
    expect(await prisma.auditLog.count({ where: { family_id: FAM } })).toBe(auditBefore)
  })

  it('rolls back the audit row when the change itself fails', async () => {
    const auditBefore = await prisma.auditLog.count({ where: { family_id: FAM } })
    await expect(
      prisma.$transaction(async (tx) => {
        await householdAudit.writeAuditLog(tx, {
          familyId: FAM,
          actorUserId: PARENT,
          actorKind: 'person',
          action: 'invite.revoked',
          targetType: 'invite',
          targetId: 'missing',
          summary: householdAudit.auditSummary.inviteRevoked('child'),
        })
        // The change fails (no such invite): the audit row must not survive.
        await tx.familyInvite.delete({ where: { id: 'auditint-missing-invite' } })
      })
    ).rejects.toBeTruthy()
    expect(await prisma.auditLog.count({ where: { family_id: FAM } })).toBe(auditBefore)
  })

  it('revoking an invite writes its row; the read route pages the real index, parents only', async () => {
    const invite = await prisma.familyInvite.create({
      data: {
        family_id: FAM,
        email: 'kid@auditint.test',
        role: 'child',
        token_hash: 'auditint-hash',
        expires_at: new Date(Date.now() + 86_400_000),
        created_by: PARENT,
      },
    })
    const del = await inviteRoute.DELETE(request(PARENT, { method: 'DELETE' }), { params: Promise.resolve({ id: invite.id }) })
    expect(del.status).toBe(200)
    expect(await prisma.familyInvite.findUnique({ where: { id: invite.id } })).toBeNull()

    // 25 more rows sharing a few timestamps, plus one in the other household.
    const base = Date.now() - 60_000
    await prisma.auditLog.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        family_id: FAM,
        actor_user_id: PARENT2,
        actor_kind: 'person',
        action: 'feature.turned_on',
        target_type: 'feature',
        target_id: 'wishlist',
        summary: 'Turned on Wishlist',
        created_at: new Date(base - Math.floor(i / 5) * 1000),
      })),
    })
    await prisma.auditLog.create({
      data: { family_id: FAM2, actor_user_id: OTHER, actor_kind: 'person', action: 'feature.turned_on', target_type: 'feature', target_id: 'wishlist', summary: 'Other household row' },
    })

    const teen = await auditRoute.GET(request(TEEN, { path: '/api/audit' }))
    expect(teen.status).toBe(403)

    const seen: string[] = []
    let cursor: string | null = null
    let first: any = null
    do {
      const res: any = await auditRoute.GET(request(PARENT, { path: '/api/audit', query: cursor ? { limit: '10', cursor } : { limit: '10' } }))
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      first = first ?? body
      seen.push(...body.entries.map((e: { id: string }) => e.id))
      cursor = body.nextCursor
    } while (cursor)
    expect(seen).toHaveLength(27)
    expect(new Set(seen).size).toBe(27)
    expect(first.entries[0]).toMatchObject({ action: 'invite.revoked', summary: 'Cancelled an invite to join as a child', actor: { id: PARENT, name: 'Robin' } })
    expect(JSON.stringify(first)).not.toContain('Other household row')
    expect(JSON.stringify(first)).not.toContain('kid@auditint.test')
  })

  it('prunes rows past 12 months when a parent reads', async () => {
    await prisma.auditLog.create({
      data: {
        id: 'auditint-old',
        family_id: FAM,
        actor_kind: 'person',
        action: 'feature.turned_off',
        target_type: 'feature',
        target_id: 'wishlist',
        summary: 'Turned off Wishlist',
        created_at: new Date(Date.now() - householdAudit.AUDIT_RETENTION_MS - 86_400_000),
      },
    })
    const res = await auditRoute.GET(request(PARENT, { path: '/api/audit' }))
    expect(res.status).toBe(200)
    expect(await prisma.auditLog.findUnique({ where: { id: 'auditint-old' } })).toBeNull()
  })

  it('two parents toggling different features at once: both changes persist, one audit row each (#285 review)', async () => {
    await prisma.family.update({ where: { id: FAM }, data: { features: { travel: false, pickups: false } } })
    const auditBefore = await prisma.auditLog.count({ where: { family_id: FAM, target_type: 'feature' } })
    // Hold the household row so both requests are in flight before either can
    // write: a read outside the lock would now see the same stale flags.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const isLocked = new Promise<void>((r) => (locked = r))
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${FAM} FOR UPDATE`
        locked()
        await gate
      },
      { timeout: 20_000 }
    )
    await isLocked
    const patch = (userId: string, key: string) =>
      asUser(userId, () =>
        featuresRoute.PATCH({ json: async () => ({ key, enabled: true }) } as unknown as Request)
      )
    const both = Promise.all([patch(PARENT, 'travel'), patch(PARENT2, 'pickups')])
    await new Promise((r) => setTimeout(r, 500))
    release()
    await holder
    const [a, b] = await both
    expect([a.status, b.status]).toEqual([200, 200])

    const family = await prisma.family.findUnique({ where: { id: FAM }, select: { features: true } })
    expect(family?.features).toMatchObject({ travel: true, pickups: true })
    const rows = await prisma.auditLog.findMany({
      where: { family_id: FAM, target_type: 'feature' },
      orderBy: { created_at: 'asc' },
    })
    const added = rows.slice(auditBefore)
    expect(added.map((r) => [r.action, r.target_id, r.actor_user_id]).sort()).toEqual([
      ['feature.turned_on', 'pickups', PARENT2],
      ['feature.turned_on', 'travel', PARENT],
    ])
  })

  it('board settings: a no-op or resubmitted value writes no audit row; a real change writes one (#285 review)', async () => {
    const count = () => prisma.auditLog.count({ where: { family_id: FAM, action: 'board_settings.changed' } })
    const before = await count()
    const current = await prisma.family.findUnique({ where: { id: FAM }, select: { ambient_idle_minutes: true } })
    for (const body of [{ weather: {} }, { display: { idleMinutes: current!.ambient_idle_minutes } }, { memberColors: {} }]) {
      const res = await settingsRoute.PATCH(request(PARENT, { method: 'PATCH', body }))
      expect(res.status).toBe(200)
    }
    expect(await count()).toBe(before)
    const next = current!.ambient_idle_minutes === 15 ? 10 : 15
    const changed = await settingsRoute.PATCH(request(PARENT, { method: 'PATCH', body: { display: { idleMinutes: next } } }))
    expect(changed.status).toBe(200)
    expect(await count()).toBe(before + 1)
    // The same value again (a retry) records nothing more.
    await settingsRoute.PATCH(request(PARENT, { method: 'PATCH', body: { display: { idleMinutes: next } } }))
    expect(await count()).toBe(before + 1)
  })

  // Hold a row lock in another transaction until `release()`, so requests
  // started meanwhile are all in flight before either can write.
  async function holdRow(lock: (tx: any) => Promise<unknown>) {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const isLocked = new Promise<void>((r) => (locked = r))
    const holder = prisma.$transaction(
      async (tx) => {
        await lock(tx)
        locked()
        await gate
      },
      { timeout: 20_000 }
    )
    await isLocked
    return async () => {
      await new Promise((r) => setTimeout(r, 500))
      release()
      await holder
    }
  }

  it("board settings: a no-op overlapping another parent's change never records that change as its own (#285 review)", async () => {
    const rows = () =>
      prisma.auditLog.findMany({
        where: { family_id: FAM, action: 'board_settings.changed' },
        orderBy: { created_at: 'asc' },
      })
    // Both patches queue behind a held household lock and then serialise on
    // it (lockBoardSettings), so the no-op's before/after snapshots can never
    // straddle the other parent's commit.
    const before = (await rows()).length
    const current = await prisma.family.findUnique({ where: { id: FAM }, select: { ambient_idle_minutes: true } })
    const next = current!.ambient_idle_minutes === 30 ? 5 : 30
    const release = await holdRow((tx) => tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${FAM} FOR UPDATE`)
    const both = Promise.all([
      settingsRoute.PATCH(request(PARENT, { method: 'PATCH', body: { weather: {} } })),
      settingsRoute.PATCH(request(PARENT2, { method: 'PATCH', body: { display: { idleMinutes: next } } })),
    ])
    await release()
    const [a, b] = await both
    expect([a.status, b.status]).toEqual([200, 200])
    const added = (await rows()).slice(before)
    expect(added.map((r) => r.actor_user_id)).toEqual([PARENT2])
  })

  it('two parents renaming the same tablet at once: each row names the label it replaced (#285 review)', async () => {
    const prev = process.env.SHARED_DEVICE_ENABLED
    process.env.SHARED_DEVICE_ENABLED = 'true'
    try {
      const deviceRoute = await import('@/app/api/family/devices/[id]/route')
      const DEVICE = 'auditint-device'
      await prisma.householdDevice.create({
        data: { id: DEVICE, family_id: FAM, label: 'Kitchen', platform: 'web', created_by: PARENT },
      })
      const release = await holdRow(
        (tx) => tx.$queryRaw`SELECT "id" FROM "HouseholdDevice" WHERE "id" = ${DEVICE} FOR UPDATE`
      )
      const rename = (as: string, label: string) =>
        deviceRoute.PATCH(request(as, { method: 'PATCH', body: { label } }), {
          params: Promise.resolve({ id: DEVICE }),
        })
      const both = Promise.all([rename(PARENT, 'Hall'), rename(PARENT2, 'Fridge'), rename(PARENT, 'Fridge')])
      await release()
      const results = await both
      expect(results.map((r) => r.status)).toEqual([200, 200, 200])

      const rows = await prisma.auditLog.findMany({
        where: { family_id: FAM, action: 'device.renamed', target_id: DEVICE },
        orderBy: { created_at: 'asc' },
      })
      const final = await prisma.householdDevice.findUnique({ where: { id: DEVICE }, select: { label: true } })
      // The renames form one chain from "Kitchen" to the final label: every row
      // starts where the previous one ended, and a rename to the label the
      // tablet already has (the repeated "Fridge") writes no row.
      let label = 'Kitchen'
      for (const row of rows) {
        const m = /^Renamed the tablet “(.+)” to “(.+)”$/.exec(row.summary)
        expect(m?.[1]).toBe(label)
        expect(m?.[2]).not.toBe(label)
        label = m![2]
      }
      expect(label).toBe(final!.label)
    } finally {
      if (prev === undefined) delete process.env.SHARED_DEVICE_ENABLED
      else process.env.SHARED_DEVICE_ENABLED = prev
    }
  })

  it('a rename overlapping a removal: the removal row names the label the tablet ended with (#285 review)', async () => {
    const prev = process.env.SHARED_DEVICE_ENABLED
    process.env.SHARED_DEVICE_ENABLED = 'true'
    try {
      const deviceRoute = await import('@/app/api/family/devices/[id]/route')
      const revokeRoute = await import('@/app/api/family/devices/[id]/revoke/route')
      const DEVICE = 'auditint-device-revoke'
      await prisma.householdDevice.create({
        data: { id: DEVICE, family_id: FAM, label: 'Kitchen', platform: 'web', created_by: PARENT },
      })
      const release = await holdRow(
        (tx) => tx.$queryRaw`SELECT "id" FROM "HouseholdDevice" WHERE "id" = ${DEVICE} FOR UPDATE`
      )
      const ctx = { params: Promise.resolve({ id: DEVICE }) }
      const both = Promise.all([
        deviceRoute.PATCH(request(PARENT, { method: 'PATCH', body: { label: 'Hall' } }), ctx),
        revokeRoute.POST(request(PARENT2, { method: 'POST', body: {} }), { params: Promise.resolve({ id: DEVICE }) }),
      ])
      await release()
      await both
      const final = await prisma.householdDevice.findUnique({
        where: { id: DEVICE },
        select: { label: true, revoked_at: true },
      })
      expect(final?.revoked_at).not.toBeNull()
      const removed = await prisma.auditLog.findMany({
        where: { family_id: FAM, action: 'device.removed', target_id: DEVICE },
      })
      expect(removed).toHaveLength(1)
      expect(removed[0].summary).toContain(`“${final!.label}”`)
    } finally {
      if (prev === undefined) delete process.env.SHARED_DEVICE_ENABLED
      else process.env.SHARED_DEVICE_ENABLED = prev
    }
  })

  it("deleting a member keeps the household's rows without an actor", async () => {
    await prisma.user.delete({ where: { id: PARENT2 } })
    const rows = await prisma.auditLog.findMany({ where: { family_id: FAM, summary: 'Turned on Wishlist' } })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.actor_user_id === null)).toBe(true)
  })

  it("deleting the household deletes its history and leaves the other household's", async () => {
    expect(await prisma.auditLog.count({ where: { family_id: FAM } })).toBeGreaterThan(0)
    await prisma.family.delete({ where: { id: FAM } })
    expect(await prisma.auditLog.count({ where: { family_id: FAM } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { family_id: FAM2 } })).toBe(1)
  })
})
