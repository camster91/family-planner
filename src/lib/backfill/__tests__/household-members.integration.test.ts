/** Dormant #480 foundation, real PG, fixture-only; no production activation. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { memberIdForLegacyUser, rehearseHouseholdMembers } from '../household-members'

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
const ROOT = path.resolve(__dirname, '../../../..')
const A = 'fx_member_rehearsal_a'
const B = 'fx_member_rehearsal_b'
const P = 'fx_member_rehearsal_parent'
const T = 'fx_member_rehearsal_teen'
const C = 'fx_member_rehearsal_child'
const BP = 'fx_member_rehearsal_b_parent'
const U = 'fx_member_rehearsal_unassigned'
const OTHER = 'test_member_rehearsal_nonfixture'
const sql = fs.readFileSync(path.join(ROOT, 'database/migration-household-members.sql'), 'utf8')

dbDescribe('household member foundation rehearsal', () => {
  let db: pg.Client
  async function cleanup() {
    await db.query('DELETE FROM "Chore" WHERE id = $1', ['fx_member_rehearsal_chore'])
    await db.query('DELETE FROM "HouseholdMember" WHERE family_id IN ($1, $2)', [A, B])
    await db.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [[P, T, C, BP, U, OTHER]])
    await db.query('DELETE FROM "Family" WHERE id IN ($1, $2)', [A, B])
  }
  async function counts() {
    return (await db.query(`SELECT
      (SELECT count(*)::int FROM "HouseholdMember" WHERE family_id IN ($1, $2)) AS members,
      (SELECT count(*)::int FROM "HouseholdMemberLegacyMapping" WHERE family_id IN ($1, $2)) AS mappings,
      (SELECT count(*)::int FROM "HouseholdMemberAccountLink" WHERE family_id IN ($1, $2)) AS links`, [A, B])).rows[0]
  }
  async function legacyHashes() {
    const results: string[] = []
    for (const table of ['User', 'Chore']) {
      results.push((await db.query(`SELECT md5(coalesce(string_agg(row_to_json(x)::text, '' ORDER BY id), '')) AS hash FROM "${table}" x`)).rows[0].hash)
    }
    return results
  }
  function cli(...args: string[]) {
    return spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/rehearse-household-members.mjs', ...args], { cwd: ROOT, env: process.env, encoding: 'utf8' })
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    db = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    await db.query(sql)
  })
  beforeEach(async () => {
    await cleanup()
    await db.query('INSERT INTO "Family" (id, name, invite_code) VALUES ($1, $1, $1), ($2, $2, $2)', [A, B])
    for (const [id, familyId, role, age] of [[P, A, 'parent', null], [T, A, 'teen', 14], [C, A, 'child', 3], [BP, B, 'parent', null], [U, null, 'parent', null]]) {
      await db.query('INSERT INTO "User" (id, email, name, family_id, role, age, xp) VALUES ($1, $2, $1, $3, $4, $5, 30)', [id, `${id}@example.test`, familyId, role, age])
    }
    await db.query('INSERT INTO "Chore" (id, family_id, title, assigned_to, created_by, due_date) VALUES ($1, $2, $3, $4, $5, $6)', ['fx_member_rehearsal_chore', A, 'Fixture-only chore', C, P, '2026-01-05T00:00:00Z'])
  })
  afterAll(async () => { await cleanup(); await db.end() })

  it('runs the additive migration twice without changing legacy rows', async () => {
    const before = await legacyHashes()
    await db.query(sql)
    await db.query(sql)
    expect(await legacyHashes()).toEqual(before)
    expect(await counts()).toEqual({ members: 0, mappings: 0, links: 0 })
  })

  it('defaults CLI to a dry run with counts only and no committed writes', async () => {
    const before = await legacyHashes()
    const result = cli('--family', A)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ usersScanned: 3, existingMappings: 0, membersPlanned: 3, membersCreated: 0, mappingsCreated: 0, accountLinksCreated: 0 })
    expect(result.stdout).not.toContain(P)
    expect(await counts()).toEqual({ members: 0, mappings: 0, links: 0 })
    expect(await legacyHashes()).toEqual(before)
  })

  it('applies only explicit household users without links/login/points/assignment changes', async () => {
    const before = await legacyHashes()
    const result = cli('--family', A, '--apply')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).membersCreated).toBe(3)
    expect(await counts()).toEqual({ members: 3, mappings: 3, links: 0 })
    expect(await legacyHashes()).toEqual(before)
    expect((await db.query('SELECT role, age FROM "HouseholdMember" WHERE id = $1', [memberIdForLegacyUser(A, C)])).rows).toEqual([{ role: 'child', age: 3 }])
    expect((await db.query('SELECT count(*)::int AS n FROM "User" WHERE id LIKE $1', ['hm_%'])).rows[0].n).toBe(0)
  })

  it('re-applies without replacing edited/archived profiles or recreating active links', async () => {
    await rehearseHouseholdMembers(db, A, true)
    const id = memberIdForLegacyUser(A, C)
    await db.query('UPDATE "HouseholdMember" SET name = $1, archived_at = CURRENT_TIMESTAMP, revision = 2 WHERE id = $2', ['Edited fixture', id])
    const second = await rehearseHouseholdMembers(db, A, true)
    expect(second.membersCreated).toBe(0)
    expect(second.existingMappings).toBe(3)
    expect((await db.query('SELECT name, revision, archived_at IS NOT NULL AS archived FROM "HouseholdMember" WHERE id = $1', [id])).rows[0]).toEqual({ name: 'Edited fixture', revision: 2, archived: true })
    expect((await counts()).links).toBe(0)
  })

  it('scopes mappings/links by both member and account household and rejects duplicate account links', async () => {
    await rehearseHouseholdMembers(db, A, true)
    await rehearseHouseholdMembers(db, B, true)
    const member = memberIdForLegacyUser(A, C)
    await expect(db.query('INSERT INTO "HouseholdMemberAccountLink" (member_id,user_id,family_id,verified_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)', [member, BP, A])).rejects.toMatchObject({ code: '23503' })
    await db.query('INSERT INTO "HouseholdMember" (id,family_id,name) VALUES ($1,$2,$3)', ['fx_member_rehearsal_unlinked', A, 'Unlinked fixture'])
    await expect(db.query('INSERT INTO "HouseholdMemberLegacyMapping" (user_id,member_id,family_id) VALUES ($1,$2,$3)', [U, 'fx_member_rehearsal_unlinked', A])).rejects.toMatchObject({ code: '23503' })
    await db.query('INSERT INTO "HouseholdMemberAccountLink" (member_id,user_id,family_id,verified_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)', [member, C, A])
    await expect(db.query('INSERT INTO "HouseholdMemberAccountLink" (member_id,user_id,family_id,verified_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)', [memberIdForLegacyUser(A, T), C, A])).rejects.toMatchObject({ code: '23505' })
  })

  it('stores a name-only preschool profile without creating an account or grant', async () => {
    await db.query('INSERT INTO "HouseholdMember" (id,family_id,name,role,age) VALUES ($1,$2,$3,$4,3)', ['fx_member_rehearsal_name_only', A, 'Fixture preschooler', 'child'])
    expect(await counts()).toEqual({ members: 1, mappings: 0, links: 0 })
    expect((await db.query('SELECT count(*)::int AS n FROM "User" WHERE id = $1', ['fx_member_rehearsal_name_only'])).rows[0].n).toBe(0)
    await expect(db.query('UPDATE "HouseholdMember" SET family_id = $1 WHERE id = $2', [B, 'fx_member_rehearsal_name_only'])).rejects.toMatchObject({ code: '23514' })
  })

  it('blocks an unmanaged account household move while scoped mapping exists', async () => {
    await rehearseHouseholdMembers(db, A, true)
    await expect(db.query('UPDATE "User" SET family_id = $1 WHERE id = $2', [B, C])).rejects.toMatchObject({ code: '23503' })
  })

  it('rolls back a failure between profile and mapping insertion', async () => {
    const before = await legacyHashes()
    const failing = { query: (text: string, values?: unknown[]) => text.startsWith('INSERT INTO "HouseholdMemberLegacyMapping"') ? Promise.reject(new Error('Injected mapping failure')) : db.query(text, values) }
    await expect(rehearseHouseholdMembers(failing as unknown as pg.Client, A, true)).rejects.toThrow('Injected mapping failure')
    expect(await counts()).toEqual({ members: 0, mappings: 0, links: 0 })
    expect(await legacyHashes()).toEqual(before)
  })

  it('serializes simultaneous rehearsals without duplicate profiles', async () => {
    const second = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await second.connect()
    try {
      const results = await Promise.all([rehearseHouseholdMembers(db, A, true), rehearseHouseholdMembers(second, A, true)])
      expect(results.reduce((n, r) => n + r.membersCreated, 0)).toBe(3)
      expect(await counts()).toEqual({ members: 3, mappings: 3, links: 0 })
    } finally { await second.end() }
  })

  it('rejects a conflicting existing compatibility mapping rather than transferring identity', async () => {
    await db.query('INSERT INTO "HouseholdMember" (id,family_id,name) VALUES ($1,$2,$3)', ['fx_member_rehearsal_wrong', A, 'Other fixture person'])
    await db.query('INSERT INTO "HouseholdMemberLegacyMapping" (user_id,member_id,family_id) VALUES ($1,$2,$3)', [C, 'fx_member_rehearsal_wrong', A])
    await expect(rehearseHouseholdMembers(db, A, true)).rejects.toMatchObject({ code: 'MAPPING_CONFLICT' })
    expect(await counts()).toEqual({ members: 1, mappings: 1, links: 0 })
  })

  it('rejects invalid legacy role data before writing any profiles', async () => {
    await db.query('UPDATE "User" SET role = $1 WHERE id = $2', ['unknown', T])
    await expect(rehearseHouseholdMembers(db, A, true)).rejects.toMatchObject({ code: 'INVALID_LEGACY_PROFILE' })
    expect(await counts()).toEqual({ members: 0, mappings: 0, links: 0 })
  })

  it('refuses a mixed fixture/real account family before writing any profiles', async () => {
    await db.query('INSERT INTO "User" (id,email,name,family_id) VALUES ($1,$2,$1,$3)', [OTHER, 'mixed-fixture@example.test', A])
    await expect(rehearseHouseholdMembers(db, A, true)).rejects.toMatchObject({ code: 'NON_FIXTURE_ACCOUNT' })
    expect(await counts()).toEqual({ members: 0, mappings: 0, links: 0 })
  })
})
