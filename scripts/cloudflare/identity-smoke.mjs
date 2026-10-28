#!/usr/bin/env node
/** Local workerd/D1 only. No network provider, production credentials or persisted household data. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// These repositories have only erased type imports and node:crypto at runtime.
// Execute their actual source rather than maintaining SQL copies in a fixture.
async function loadRepository(name) {
  const source = await fs.readFile(path.join(root, 'src/lib/cloudflare', name), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { createD1Family } = await loadRepository('family-create.ts')
const { checkD1RateLimit, isD1RateLimited } = await loadRepository('rate-limit.ts')
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'identity-fixture', modules: true, compatibilityDate: '2026-10-13',
  script: 'export default { fetch() { return new Response("local identity fixture") } }',
  d1Databases: { DB: 'herewoven-identity-smoke' }, d1Persist: false,
}))
try {
  const db = await mf.getD1Database('DB')
  const schema = await fs.readFile(path.join(root, 'database/cloudflare/0001_identity.sql'), 'utf8')
  // This initial migration contains table/index statements only (no triggers).
  for (const statement of schema.replace(/^--.*$/gm, '').split(';').filter(sql => sql.trim())) {
    await db.prepare(statement).run()
  }
  const prisma = await fs.readFile(path.join(root, 'prisma/schema.prisma'), 'utf8')
  for (const name of ['Family', 'User', 'FamilyInvite', 'RateLimitEntry', 'AuditLog']) {
    const body = prisma.match(new RegExp(`model ${name} \\{\\n([\\s\\S]*?)\\n\\}`))[1]
    const columns = (await db.prepare(`PRAGMA table_info("${name}")`).all()).results.map(row => row.name)
    const expected = body.split('\n').filter(line => !line.includes('@ignore'))
      .map(line => line.match(/^\s*(\w+)\s+(?:String|Int|Boolean|DateTime|Float|Json)(?:\?|\[\])?(?:\s|$)/))
      .filter(Boolean).map(match => match[1])
    assert.deepEqual(columns.sort(), expected.sort(), `${name} scalar column parity`)
  }
  const addUser = (id, version = 0) => db.prepare('INSERT INTO "User" (id,email,name,token_version) VALUES (?1,?2,?1,?3)')
    .bind(id, `${id}@example.test`, version).run()
  const input = (userId, familyId, tokenVersion = 0) => ({
    userId, familyId, tokenVersion, name: 'Fabricated household',
    inviteCode: `code-${familyId}`, features: JSON.stringify({ chores: true, gamification: false }), now: 1000,
  })
  const familyCount = async () => (await db.prepare('SELECT count(*) AS n FROM "Family"').first()).n
  await addUser('owner-a')
  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, i) => createD1Family(db, input('owner-a', `family-${i}`))))
  assert.equal(concurrent.filter(result => typeof result === 'object').length, 1, 'only one create wins')
  assert.equal(concurrent.filter(result => result === 'already').length, 11)
  assert.equal(await familyCount(), 1)
  const owner = await db.prepare('SELECT family_id,role FROM "User" WHERE id=?1').bind('owner-a').first()
  assert.equal(owner.role, 'parent')
  assert.ok(concurrent.some(result => typeof result === 'object' && result.id === owner.family_id))
  assert.equal(await createD1Family(db, input('missing-account', 'no-owner')), 'gone')
  await addUser('revoked-account', 3)
  assert.equal(await createD1Family(db, input('revoked-account', 'revoked-family', 2)), 'gone')
  assert.equal(await familyCount(), 1)

  // Prove a failure after the insert rolls back the entire batch.
  await addUser('rollback-account')
  await db.exec(`CREATE TRIGGER fail_membership BEFORE UPDATE ON "User" WHEN OLD.id = 'rollback-account' BEGIN SELECT RAISE(ABORT, 'fixture membership failure'); END;`)
  await assert.rejects(createD1Family(db, input('rollback-account', 'rolled-back-family')))
  assert.equal(await familyCount(), 1)
  await db.exec('DROP TRIGGER fail_membership;')

  // An invite-code collision must leave the second account unattached.
  await addUser('owner-b')
  const collision = { ...input('owner-b', 'other-family'), inviteCode: concurrent.find(result => typeof result === 'object').invite_code }
  await assert.rejects(createD1Family(db, collision))
  assert.equal((await db.prepare('SELECT family_id FROM "User" WHERE id=?1').bind('owner-b').first()).family_id, null)
  assert.equal(await familyCount(), 1)
  await createD1Family(db, input('owner-b', 'other-family'))
  assert.equal(await familyCount(), 2)
  assert.notEqual((await db.prepare('SELECT family_id FROM "User" WHERE id=?1').bind('owner-b').first()).family_id, owner.family_id)

  for (const now of [1000, 2000]) {
    const limits = await Promise.all(Array.from({ length: 24 }, () => checkD1RateLimit(db, 'fixture-login', 5, 1000, now)))
    assert.equal(limits.filter(result => result.allowed).length, 5, 'concurrent limit and expired-window reset')
    assert.ok(limits.filter(result => !result.allowed).every(result => result.remaining === 0 && result.retryAfterMs === 1000))
  }
  assert.equal((await checkD1RateLimit(db, 'different-key', 5, 1000, 2000)).allowed, true)
  assert.equal((await isD1RateLimited(db, 'fixture-login', 5, 2000)).allowed, false)
  assert.equal((await isD1RateLimited(db, 'fixture-login', 5, 3000)).allowed, true)
  assert.equal((await isD1RateLimited(db, 'missing-key', 5, 2000)).remaining, 5)
  await db.prepare('DELETE FROM "RateLimitEntry" WHERE key = ?1').bind('fixture-login').run()
  assert.equal((await isD1RateLimited(db, 'fixture-login', 5, 2000)).allowed, true)
  console.log('PASS local D1 identity: schema parity, concurrent household creation, revocation/deletion rejection, batch rollback, code collision, household separation, atomic rate limits/reset.')
} finally {
  await mf.dispose()
}
