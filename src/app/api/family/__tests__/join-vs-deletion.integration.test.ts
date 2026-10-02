// Joins cannot orphan an account into a household being deleted (D-3 review;
// src/lib/household-lock.ts, docs/product/ACCOUNT_DELETION.md "Concurrency").
//
// Against real Postgres with two connections: while a second connection holds
// the household membership lock (as a running deletion does), a join by
// invite code, a join by email invite, and registration with an invite all
// wait; when that connection deletes the household and commits, each fails
// cleanly (404 / 400) and no account is left behind with family_id NULL. The
// deletion functions take the same lock (a held lock makes deleteHousehold
// wait), and a real deleteHousehold racing a join always ends in one of the
// two consistent outcomes.
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

import crypto from 'crypto'
import pg from 'pg'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(60_000)

describeWithDatabase('joins vs household deletion (Postgres)', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let join: typeof import('../join/route')
  let register: typeof import('@/app/api/auth/register/route')
  let lib: typeof import('@/lib/account-deletion')
  let lockKey: (familyId: string) => string

  const P = 'jvdint'
  const FAM = `${P}-family`
  const PARENT = `${P}-parent`
  const JOINER = `${P}-joiner`
  const CODE = `${P}invitecode0001` // canonical form: lowercase, no dashes
  const NEW_EMAIL = `${P}-newcomer@example.test`

  function request(body: unknown, as?: string): any {
    const url = new URL('http://localhost/api/test')
    return {
      method: 'POST',
      url: url.toString(),
      nextUrl: url,
      headers: new Headers({ 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}` }),
      cookies: { get: (n: string) => (n === 'session_token' && as ? { value: `session:${as}` } : undefined) },
      json: async () => body,
    }
  }

  async function cleanup() {
    await prisma.user.deleteMany({ where: { OR: [{ id: { startsWith: `${P}-` } }, { email: { startsWith: `${P}-` } }] } })
    await prisma.family.deleteMany({ where: { id: FAM } })
    await prisma.rateLimitEntry.deleteMany({
      where: { OR: [{ key: { contains: P } }, { key: { startsWith: 'join-ip:198.51.100.' } }] },
    })
  }

  async function seed() {
    await cleanup()
    await prisma.family.create({ data: { id: FAM, name: 'Join Race', invite_code: CODE } })
    await prisma.user.createMany({
      data: [
        { id: PARENT, email: `${PARENT}@example.test`, name: 'P', role: 'parent', family_id: FAM },
        { id: JOINER, email: `${JOINER}@example.test`, name: 'J', role: 'teen', family_id: null },
      ],
    })
  }

  async function invite(email: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex')
    await prisma.familyInvite.create({
      data: {
        family_id: FAM,
        email,
        role: 'child',
        token_hash: crypto.createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
        created_by: PARENT,
      },
    })
    return token
  }

  /** A second connection that holds the membership lock, then deletes the household and commits. */
  async function holdLockThenDelete<T>(during: () => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(FAM)])
      const pending = during()
      let settled = false
      pending.then(
        () => (settled = true),
        () => (settled = true)
      )
      await new Promise((r) => setTimeout(r, 500))
      // Still waiting on the lock.
      expect(settled).toBe(false)
      await client.query(`DELETE FROM "FamilyInvite" WHERE family_id = $1`, [FAM])
      await client.query(`DELETE FROM "User" WHERE family_id = $1`, [FAM])
      await client.query(`DELETE FROM "Family" WHERE id = $1`, [FAM])
      await client.query('COMMIT')
      return await pending
    } finally {
      await client.end()
    }
  }

  beforeAll(async () => {
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    join = await import('../join/route')
    register = await import('@/app/api/auth/register/route')
    lib = await import('@/lib/account-deletion')
    lockKey = (await import('@/lib/household-lock')).householdLockKey
    for (const level of ['log', 'info', 'warn'] as const) jest.spyOn(console, level).mockImplementation(() => undefined)
  })

  beforeEach(seed)

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('a join by invite code waits for the deletion, then gets 404; the joiner is not orphaned', async () => {
    const res: any = await holdLockThenDelete(() => join.POST(request({ inviteCode: CODE }, JOINER)))
    expect(res.status).toBe(404)
    const joiner = await prisma.user.findUnique({ where: { id: JOINER } })
    expect(joiner).toMatchObject({ family_id: null, role: 'teen' })
  })

  it('a join by email invite waits, then gets 404', async () => {
    const token = await invite(`${JOINER}@example.test`)
    const res: any = await holdLockThenDelete(() => join.POST(request({ token }, JOINER)))
    expect(res.status).toBe(404)
    expect(await prisma.user.findUnique({ where: { id: JOINER } })).toMatchObject({ family_id: null })
  })

  it('registration with an invite waits, then gets 400 and creates no account', async () => {
    const token = await invite(NEW_EMAIL)
    const res: any = await holdLockThenDelete(() =>
      register.POST(request({ email: NEW_EMAIL, password: 'Correct-Horse-42!', name: 'Newcomer', inviteToken: token }))
    )
    expect(res.status).toBe(400)
    expect(await prisma.user.count({ where: { email: NEW_EMAIL } })).toBe(0)
  })

  it('deleteHousehold takes the same lock', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(FAM)])
      let settled = false
      const deletion = lib.deleteHousehold(FAM, PARENT, { revokeCalendarGrant: async () => undefined })
      deletion.then(
        () => (settled = true),
        () => (settled = true)
      )
      await new Promise((r) => setTimeout(r, 500))
      expect(settled).toBe(false)
      await client.query('ROLLBACK')
      expect(await deletion).toMatchObject({ deleted: true })
    } finally {
      await client.end()
    }
  })

  it('a real deletion racing a join never leaves an orphaned account', async () => {
    for (let round = 0; round < 5; round++) {
      await seed()
      const [joined, deleted] = await Promise.all([
        join.POST(request({ inviteCode: CODE }, JOINER)) as Promise<any>,
        lib.deleteHousehold(FAM, PARENT, { revokeCalendarGrant: async () => undefined }),
      ])
      expect(deleted).toMatchObject({ deleted: true })
      expect(await prisma.family.count({ where: { id: FAM } })).toBe(0)
      const joiner = await prisma.user.findUnique({ where: { id: JOINER } })
      if (joined.status === 200) {
        // Joined first: deleted with the household.
        expect(joiner).toBeNull()
      } else {
        // Waited: refused, and still an account of its own.
        expect(joined.status).toBe(404)
        expect(joiner).toMatchObject({ family_id: null })
      }
    }
  })
})
