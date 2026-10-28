#!/usr/bin/env node
/** Local workerd/D1 only. No network provider, production credentials or persisted household data. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler'
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
const { createD1Registration, findD1Account, findD1LoginUser, findD1RegistrationInvite, storeD1VerificationToken, consumeD1VerificationToken, isD1VerificationTokenUsed, findD1PublicUser, findD1AuthUser, updateD1Profile } = await loadRepository('accounts.ts')
const { storeD1ResetToken, d1ResetTokenExists, consumeD1ResetToken, restoreD1VerificationToken, changeD1Password } = await loadRepository('account-recovery.ts')
const { hasD1DeviceCredential } = await loadRepository('device-credentials.ts')
const { createD1Family } = await loadRepository('family-create.ts')
const { checkD1RateLimit, isD1RateLimited } = await loadRepository('rate-limit.ts')
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'identity-fixture', modules: true, compatibilityDate: '2026-10-13',
  script: 'export default { fetch() { return new Response("local identity fixture") } }',
  d1Databases: { DB: 'herewoven-identity-smoke' }, d1Persist: false,
}))
try {
  const db = await mf.getD1Database('DB')
  for (const file of (await fs.readdir(path.join(root, 'database/cloudflare'))).filter(file => file.endsWith('.sql')).sort()) {
    const schema = await fs.readFile(path.join(root, 'database/cloudflare', file), 'utf8')
    // Use the same SQL splitter as Wrangler, including trigger bodies.
    for (const statement of splitSqlQuery(schema)) {
      await db.prepare(statement).run()
    }
  }
  const prisma = await fs.readFile(path.join(root, 'prisma/schema.prisma'), 'utf8')
  for (const name of ['Family', 'User', 'FamilyInvite', 'RateLimitEntry', 'AuditLog', 'BetaMetricDaily', 'HouseholdMember', 'HouseholdDevice', 'DeviceSession', 'ParentElevationPin', 'DeviceAuditEvent']) {
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

  const registration = (userId, email, inviteTokenHash) => ({
    userId, email, inviteTokenHash, passwordHash: 'fabricated-password-hash',
    name: 'Fabricated member', now: 1000, auditId: `audit-${userId}`,
    auditSummaries: { parent: 'Member joined as parent', teen: 'Member joined as teen', child: 'Member joined as child' },
  })
  const registered = await createD1Registration(db, registration('new-account', 'new@example.test'))
  assert.equal(registered.email_verified, false)
  assert.ok(registered.created_at instanceof Date)
  assert.equal(registered.family_id, null)
  await assert.rejects(createD1Registration(db, registration('duplicate-account', 'new@example.test')))
  assert.equal((await findD1Account(db, 'new@example.test')).id, 'new-account')
  const login = await findD1LoginUser(db, 'new@example.test')
  assert.equal(login.email_verified, false)
  assert.equal('verify_token' in login, false)
  assert.equal('reset_token' in login, false)
  const hash = createHash('sha256').update('fabricated-verify-token').digest('hex')
  await storeD1VerificationToken(db, 'new-account', hash, 5000)
  assert.equal(await consumeD1VerificationToken(db, 'fabricated-verify-token', 1000), false)
  const claims = await Promise.all(Array.from({ length: 8 }, () => consumeD1VerificationToken(db, hash, 1000)))
  assert.equal(claims.filter(Boolean).length, 1)
  assert.equal(await isD1VerificationTokenUsed(db, hash), true)
  assert.equal((await findD1LoginUser(db, 'new@example.test')).email_verified, true)
  await storeD1VerificationToken(db, 'new-account', hash, 999)
  assert.equal(await consumeD1VerificationToken(db, hash, 1000), false)

  const addInvite = (id, email, token, expires = 5000) => db.prepare(`INSERT INTO "FamilyInvite"
    (id,family_id,email,role,token_hash,expires_at,created_by) VALUES (?1,?2,?3,'child',?4,?5,'owner-a')`)
    .bind(id, owner.family_id, email, token, expires).run()
  await addInvite('invite-a', 'invited@example.test', 'invite-hash')
  assert.equal((await findD1RegistrationInvite(db, 'invite-hash')).family_id, owner.family_id)
  assert.equal(await createD1Registration(db, registration('wrong-email', 'wrong@example.test', 'invite-hash')), null)
  const invited = await Promise.all(Array.from({ length: 8 }, (_, i) => createD1Registration(db, registration(`invited-${i}`, 'invited@example.test', 'invite-hash'))))
  assert.equal(invited.filter(Boolean).length, 1)
  assert.equal(invited.find(Boolean).role, 'child')
  assert.equal(invited.find(Boolean).family_id, owner.family_id)
  assert.equal(invited.find(Boolean).email_verified, true)
  assert.equal((await db.prepare(`SELECT count(*) AS n FROM "AuditLog" WHERE action='member.joined'`).first()).n, 1)
  await addInvite('invite-expired', 'expired@example.test', 'expired-hash', 999)
  assert.equal(await createD1Registration(db, registration('expired-account', 'expired@example.test', 'expired-hash')), null)

  await addInvite('invite-rollback', 'rollback@example.test', 'rollback-hash')
  await db.exec(`CREATE TRIGGER fail_join_audit BEFORE INSERT ON "AuditLog" WHEN NEW.target_id='rollback-invite-user' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END;`)
  await assert.rejects(createD1Registration(db, registration('rollback-invite-user', 'rollback@example.test', 'rollback-hash')))
  assert.equal(await findD1Account(db, 'rollback@example.test'), null)
  assert.equal((await findD1RegistrationInvite(db, 'rollback-hash')).accepted_at, null)
  await db.exec('DROP TRIGGER fail_join_audit;')
  await db.prepare(`UPDATE "FamilyInvite" SET role='teen' WHERE id='invite-rollback'`).run()
  assert.equal((await createD1Registration(db, registration('rollback-invite-user', 'rollback@example.test', 'rollback-hash'))).role, 'teen')

  await db.prepare('UPDATE "User" SET family_id=?1 WHERE id=?2').bind(owner.family_id, 'new-account').run()
  await db.prepare('INSERT INTO "ParentElevationPin" (user_id,family_id,pin_hash) VALUES (?1,?2,?3)').bind('new-account', owner.family_id, 'fabricated-pin-hash').run()
  const resetHash = createHash('sha256').update('fabricated-reset-token').digest('hex')
  await storeD1ResetToken(db, 'new-account', resetHash, 5000)
  assert.equal(await d1ResetTokenExists(db, resetHash, 1000), true)
  assert.equal(await d1ResetTokenExists(db, 'fabricated-reset-token', 1000), false)
  assert.equal(await d1ResetTokenExists(db, resetHash, 5000), false)
  const resetClaims = await Promise.all(Array.from({ length: 8 }, () => consumeD1ResetToken(db, resetHash, 'replacement-password-hash', 1000)))
  assert.equal(resetClaims.filter(result => result.consumed).length, 1)
  assert.equal(resetClaims.find(result => result.consumed).clearedPin.userId, 'new-account')
  assert.equal((await db.prepare('SELECT count(*) AS n FROM "ParentElevationPin" WHERE user_id=?1').bind('new-account').first()).n, 0)
  assert.equal((await findD1Account(db, 'new@example.test')).token_version, 1)
  assert.equal((await findD1Account(db, 'new@example.test')).reset_token, null)
  assert.equal(await findD1AuthUser(db, 'new-account', 0), null)

  // Failure after deleting the PIN must restore the PIN and reset token too.
  await db.prepare('INSERT INTO "ParentElevationPin" (user_id,family_id,pin_hash) VALUES (?1,?2,?3)').bind('new-account', owner.family_id, 'fabricated-pin-hash').run()
  await storeD1ResetToken(db, 'new-account', resetHash, 5000)
  await db.exec(`CREATE TRIGGER fail_reset BEFORE UPDATE ON "User" WHEN OLD.id='new-account' BEGIN SELECT RAISE(ABORT, 'fixture reset failure'); END;`)
  await assert.rejects(consumeD1ResetToken(db, resetHash, 'must-not-commit', 1000))
  assert.equal(await d1ResetTokenExists(db, resetHash, 1000), true)
  assert.equal((await db.prepare('SELECT count(*) AS n FROM "ParentElevationPin" WHERE user_id=?1').bind('new-account').first()).n, 1)
  await db.exec('DROP TRIGGER fail_reset;')

  assert.equal(await changeD1Password(db, 'new-account', 0, 'replacement-password-hash', 'bad-change'), false)
  assert.equal(await changeD1Password(db, 'new-account', 1, 'wrong-hash', 'bad-change'), false)
  assert.equal(await changeD1Password(db, 'new-account', 1, 'replacement-password-hash', 'changed-password-hash'), true)
  assert.equal(await d1ResetTokenExists(db, resetHash, 1000), false)
  assert.equal(await changeD1Password(db, 'new-account', 1, 'replacement-password-hash', 'raced-change'), false)
  const publicUser = await findD1PublicUser(db, 'new-account')
  assert.equal('password' in publicUser, false)
  assert.equal('token_version' in publicUser, false)
  assert.equal(await updateD1Profile(db, 'new-account', 1, { name: 'stale edit' }), null)
  assert.equal((await updateD1Profile(db, 'new-account', 2, { name: 'Current name', age: 3 })).age, 3)
  assert.equal((await findD1PublicUser(db, 'owner-a')).name, 'owner-a')

  await db.prepare('UPDATE "User" SET email_verified=0 WHERE id=?1').bind('new-account').run()
  await storeD1VerificationToken(db, 'new-account', 'issued-hash', 5000)
  await restoreD1VerificationToken(db, 'new-account', 'issued-hash', 'prior-hash', 4000)
  assert.equal((await findD1Account(db, 'new@example.test')).verify_token, 'prior-hash')
  await storeD1VerificationToken(db, 'new-account', 'newer-hash', 6000)
  await restoreD1VerificationToken(db, 'new-account', 'issued-hash', 'prior-hash', 4000)
  assert.equal((await findD1Account(db, 'new@example.test')).verify_token, 'newer-hash')
  assert.equal(await consumeD1VerificationToken(db, 'newer-hash', 1000), true)
  await restoreD1VerificationToken(db, 'new-account', 'newer-hash', 'prior-hash', 4000)
  assert.equal(await isD1VerificationTokenUsed(db, 'newer-hash'), true)

  await db.prepare('INSERT INTO "HouseholdDevice" (id,family_id,label,platform) VALUES (?1,?2,?3,?4)')
    .bind('device-a', owner.family_id, 'Fabricated tablet', 'web').run()
  await db.prepare(`INSERT INTO "DeviceSession" (id,device_id,family_id,access_token_hash,access_expires_at,refresh_token_hash,refresh_expires_at)
    VALUES ('session-a','device-a',?1,'access-hash',2000,'refresh-hash',200000)`)
    .bind(owner.family_id).run()
  assert.equal(await hasD1DeviceCredential(db, { access: 'access-hash' }, 1000, 60000), true)
  assert.equal(await hasD1DeviceCredential(db, { access: 'access-hash' }, 2000, 60000), false)
  await db.prepare(`UPDATE "DeviceSession" SET rotated_at=900 WHERE id='session-a'`).run()
  assert.equal(await hasD1DeviceCredential(db, { access: 'access-hash' }, 1000, 60000), false)
  assert.equal(await hasD1DeviceCredential(db, { refresh: 'refresh-hash' }, 1000, 60000), true)
  assert.equal(await hasD1DeviceCredential(db, { refresh: 'refresh-hash' }, 100000, 60000), false)
  await db.prepare(`UPDATE "DeviceSession" SET family_id='other-family',rotated_at=NULL WHERE id='session-a'`).run()
  assert.equal(await hasD1DeviceCredential(db, { access: 'access-hash', refresh: 'refresh-hash' }, 1000, 60000), false)
  await db.prepare(`UPDATE "DeviceSession" SET family_id=?1 WHERE id='session-a'`).bind(owner.family_id).run()
  await db.prepare(`UPDATE "HouseholdDevice" SET revoked_at=1000 WHERE id='device-a'`).run()
  assert.equal(await hasD1DeviceCredential(db, { refresh: 'refresh-hash' }, 1000, 60000), false)

  await db.prepare('INSERT INTO "HouseholdMember" (id,family_id,name) VALUES (?1,?2,?3)').bind('profile-a', owner.family_id, 'Fabricated profile').run()
  await assert.rejects(db.prepare(`INSERT INTO "DeviceAuditEvent" (id,family_id,subject_member_id,type) VALUES ('foreign-audit','other-family','profile-a','fixture')`).run())
  await db.prepare(`INSERT INTO "DeviceAuditEvent" (id,family_id,subject_member_id,type) VALUES ('audit-subject',?1,'profile-a','fixture')`).bind(owner.family_id).run()
  await assert.rejects(db.prepare(`UPDATE "DeviceAuditEvent" SET subject_member_id=NULL WHERE id='audit-subject'`).run())
  await db.prepare(`UPDATE "DeviceAuditEvent" SET subject_member_id=NULL,subject_member_erased=1 WHERE id='audit-subject'`).run()
  await assert.rejects(db.prepare(`UPDATE "DeviceAuditEvent" SET subject_member_erased=0 WHERE id='audit-subject'`).run())

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
  console.log('PASS local D1 identity: recovery/PIN rollback, revoked-session profile/CAS, challenge restore, device guards, scoped audit erasure, registration, invite races/audit rollback, verification claims/expiry, private projections, schema parity, concurrent household creation, revocation/deletion rejection, batch rollback, code collision, household separation, atomic rate limits/reset.')
} finally {
  await mf.dispose()
}
