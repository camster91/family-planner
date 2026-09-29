// Membership locks against real Postgres (D-3 review, third round;
// src/lib/household-lock.ts, docs/product/ACCOUNT_DELETION.md "Concurrency").
// A second connection holds a lock the way a running deletion does, deletes,
// and commits; the write under test must have waited and then refuse cleanly
// with nothing left behind:
//
// * calendar OAuth commit (`commitConnection`) vs household deletion: "gone",
//   no connection row; and a deletion waits on a commit holding the lock;
// * POST /api/family (create) vs account deletion (user lock): refused, no
//   Family without members;
// * account deletion waits on the user lock;
// * POST /api/upload vs household deletion: 404, no Upload row, no file.
//
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...
// against a disposable database that `node scripts/migrate.js` has prepared.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/session', () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith('session:')) return null
    const { prisma } = require('@/lib/prisma')
    const u = await prisma.user.findUnique({ where: { id: token.slice(8) } })
    return u ? { userId: u.id, email: u.email, role: u.role, family_id: u.family_id, tv: u.token_version } : null
  },
  getTokenVersion: async () => 0,
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import pg from 'pg'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('membership locks (Postgres)', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let locks: typeof import('@/lib/household-lock')
  let lib: typeof import('@/lib/account-deletion')
  let connections: typeof import('@/lib/calendar-sync/connections')
  let family: typeof import('@/app/api/family/route')
  let upload: typeof import('@/app/api/upload/route')
  let uploadDir: string

  const P = 'mlockint'
  const FAM = `${P}-family`
  const PARENT = `${P}-parent`
  const LONER = `${P}-loner`
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

  function request(as: string, extra: Record<string, unknown> = {}): any {
    const url = new URL('http://localhost/api/test')
    return {
      method: 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (n: string) => (n === 'session_token' ? { value: `session:${as}` } : undefined) },
      ...extra,
    }
  }

  async function cleanup() {
    await prisma.upload.deleteMany({ where: { family_id: FAM } })
    await prisma.user.deleteMany({ where: { id: { startsWith: `${P}-` } } })
    await prisma.family.deleteMany({ where: { OR: [{ id: FAM }, { name: { startsWith: `${P} ` } }] } })
  }

  beforeAll(async () => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-mlock-'))
    process.env.UPLOAD_DIR = uploadDir
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    locks = await import('@/lib/household-lock')
    lib = await import('@/lib/account-deletion')
    connections = await import('@/lib/calendar-sync/connections')
    family = await import('@/app/api/family/route')
    upload = await import('@/app/api/upload/route')
    for (const level of ['log', 'info', 'warn'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })

  beforeEach(async () => {
    await cleanup()
    await prisma.family.create({ data: { id: FAM, name: `${P} household`, invite_code: `${P}-code-000001` } })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: `${PARENT}@example.test`, name: 'P', role: 'parent', family_id: FAM },
        { id: LONER, email: `${LONER}@example.test`, name: 'L', role: 'parent', family_id: null },
      ],
    })
  })

  afterAll(async () => {
    await cleanup()
    fs.rmSync(uploadDir, { recursive: true, force: true })
    await prisma.$disconnect()
  })

  /**
   * A second connection takes `lockKey`, lets `during` start, checks it is
   * still waiting after 500 ms, runs `sql` (the deletion) and commits.
   */
  async function holdThen<T>(lockKey: string, during: () => Promise<T>, sql: Array<[string, unknown[]]>): Promise<T> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey])
      const pending = during()
      let settled = false
      pending.then(
        () => (settled = true),
        () => (settled = true)
      )
      await new Promise((r) => setTimeout(r, 500))
      expect(settled).toBe(false)
      for (const [q, params] of sql) await client.query(q, params)
      await client.query('COMMIT')
      return await pending
    } finally {
      await client.end()
    }
  }

  const deleteHouseholdSql: Array<[string, unknown[]]> = [
    [`DELETE FROM "User" WHERE family_id = $1`, [FAM]],
    [`DELETE FROM "Family" WHERE id = $1`, [FAM]],
  ]

  it('a calendar commit waits for a household deletion, then refuses ("gone") and stores nothing', async () => {
    const outcome = await holdThen(
      locks.householdLockKey(FAM),
      () =>
        connections.commitConnection(prisma, {
          familyId: FAM,
          userId: PARENT,
          provider: 'google',
          data: { access_token_enc: 'x', refresh_token_enc: 'y', status: 'pending' },
          hasRefreshToken: true,
        }),
      deleteHouseholdSql
    )
    expect(outcome).toBe('gone')
    expect(await prisma.calendarConnection.count({ where: { user_id: PARENT } })).toBe(0)
  })

  it('a household deletion waits for a calendar commit holding the lock, then deletes that connection too', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [locks.householdLockKey(FAM)])
      await client.query(
        `INSERT INTO "CalendarConnection" (id, family_id, user_id, provider, updated_at) VALUES ($1, $2, $3, 'google', now())`,
        [`${P}-conn`, FAM, PARENT]
      )
      const revoked: string[] = []
      let settled = false
      const deletion = lib.deleteHousehold(FAM, PARENT, {
        uploadDir,
        revokeCalendarGrant: async (g) => {
          revoked.push(g.id)
        },
      })
      deletion.then(
        () => (settled = true),
        () => (settled = true)
      )
      await new Promise((r) => setTimeout(r, 500))
      expect(settled).toBe(false)
      await client.query('COMMIT')
      expect(await deletion).toMatchObject({ deleted: true })
      expect(revoked).toEqual([`${P}-conn`])
      expect(await prisma.calendarConnection.count({ where: { id: `${P}-conn` } })).toBe(0)
    } finally {
      await client.end()
    }
  })

  it('POST /api/family waits for an account deletion (user lock), then refuses; no member-less Family', async () => {
    const res: any = await holdThen(
      locks.userLockKey(LONER),
      () => family.POST(request(LONER, { json: async () => ({ name: `${P} new home` }) })),
      [[`DELETE FROM "User" WHERE id = $1`, [LONER]]]
    )
    expect(res.status).toBe(401)
    expect(await prisma.family.count({ where: { name: `${P} new home` } })).toBe(0)
  })

  it('account deletion takes the user lock before reading the household', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [locks.userLockKey(LONER)])
      // While the lock is held, the account gets a household (as a create would).
      await client.query(`UPDATE "User" SET family_id = $1, role = 'teen' WHERE id = $2`, [FAM, LONER])
      let settled = false
      const deletion = lib.deleteMemberAccount(LONER, { uploadDir, revokeCalendarGrant: async () => undefined })
      deletion.then(
        () => (settled = true),
        () => (settled = true)
      )
      await new Promise((r) => setTimeout(r, 500))
      expect(settled).toBe(false)
      await client.query('COMMIT')
      // It then sees the household it now belongs to and leaves it properly.
      expect(await deletion).toMatchObject({ deleted: true, successorId: PARENT })
      expect(await prisma.user.count({ where: { id: LONER } })).toBe(0)
      expect(await prisma.family.count({ where: { id: FAM } })).toBe(1)
    } finally {
      await client.end()
    }
  })

  it('an upload waits for a household deletion, then gets 404 with no row and no file', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(JPEG)], 'photo.jpg', { type: 'image/jpeg' }))
    const res: any = await holdThen(
      locks.householdLockKey(FAM),
      () => upload.POST(request(PARENT, { formData: async () => fd })),
      deleteHouseholdSql
    )
    expect(res.status).toBe(404)
    expect(await prisma.upload.count({ where: { family_id: FAM } })).toBe(0)
    expect(fs.readdirSync(path.join(uploadDir, 'chores'))).toEqual([])
  })

  it('an upload that commits first is removed, row and file, by the household deletion', async () => {
    const fd = new FormData()
    fd.append('file', new File([new Uint8Array(JPEG)], 'photo.jpg', { type: 'image/jpeg' }))
    const res: any = await upload.POST(request(PARENT, { formData: async () => fd }))
    expect(res.status).toBe(200)
    expect(fs.readdirSync(path.join(uploadDir, 'chores'))).toHaveLength(1)
    await lib.deleteHousehold(FAM, PARENT, { uploadDir, revokeCalendarGrant: async () => undefined })
    expect(fs.readdirSync(path.join(uploadDir, 'chores'))).toEqual([])
  })
})
