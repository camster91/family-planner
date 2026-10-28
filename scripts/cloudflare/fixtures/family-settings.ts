import { decodeAuditCursor, AUDIT_RETENTION_MS } from '../../../src/lib/household-audit'
import { renameD1Family, readD1FamilyFeatures, updateD1FamilyFeatures, updateD1BetaMetrics, readD1AuditPage } from '../../../src/lib/cloudflare/family-settings'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import type { FeatureKey } from '../../../src/lib/feature-flags'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refuses(operation: () => unknown, status?: number) {
  try { await operation() } catch (error) {
    check(error instanceof Error && (status === undefined || ('status' in error && error.status === status)), `expected refusal ${status}`)
    return
  }
  throw new Error(`did not refuse ${status}`)
}
export async function testFamilySettings(db: D1Store) {
  const parent = { userId: 'read-a', familyId: 'read-family-a', generation: 0 }
  const child = { ...parent, userId: 'read-b' }
  const foreign = { userId: 'read-c', familyId: 'read-family-b', generation: 0 }
  const count = async (action: string, familyId = parent.familyId) => (await db.prepare('SELECT count(*) AS n FROM "AuditLog" WHERE family_id=?1 AND action LIKE ?2').bind(familyId, action).first<{ n: number }>())!.n
  const rename = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => renameD1Family({ familyId: parent.familyId, baseName: 'Fabricated A', name: `Fabricated renamed ${i}` }, parent, db)))
  check(rename.filter(r => r.status === 'fulfilled').length === 1, 'one strict rename winner')
  check(rename.filter(r => r.status === 'rejected' && r.reason.status === 409).length === 7, 'strict rename conflicts')
  const winner = rename.find(r => r.status === 'fulfilled')!
  check(winner.status === 'fulfilled', 'rename result')
  check(!('invite_code' in winner.value.family) && !('capture_ai_key_enc' in winner.value.family), 'rename safe projection')
  await db.prepare(`CREATE TRIGGER fixture_name_noop BEFORE UPDATE OF name ON "Family" WHEN OLD.name=NEW.name BEGIN SELECT RAISE(ABORT,'fixture noop write'); END`).run()
  try {
    const retry = await renameD1Family({ familyId: parent.familyId, baseName: 'Fabricated A', name: winner.value.family.name }, parent, db)
    check(retry.family.name === winner.value.family.name, 'uncertain rename converges without a write')
    await renameD1Family({ familyId: parent.familyId }, parent, db)
  } finally { await db.prepare('DROP TRIGGER fixture_name_noop').run() }
  await refuses(() => renameD1Family({ familyId: foreign.familyId, name: 'Must not save' }, parent, db), 403)
  await refuses(() => renameD1Family({ familyId: parent.familyId, name: 'Must not save' }, child, db), 403)
  const keys: FeatureKey[] = ['inventory', 'notes', 'budget', 'projects', 'messages', 'wishlist', 'travel', 'allowance']
  await Promise.all(keys.map(key => updateD1FamilyFeatures(parent, { [key]: true }, db)))
  const flags = await readD1FamilyFeatures(parent, db)
  check(keys.every(key => flags[key] === true), 'concurrent feature merges survive')
  check(await count('feature.%') === keys.length, 'one audit per actual feature change')
  await updateD1FamilyFeatures(parent, { inventory: true, notes: true }, db)
  check(await count('feature.%') === keys.length, 'no duplicate audit for feature retries')
  check(!(await readD1FamilyFeatures(foreign, db)).inventory, 'second household unaffected')
  check((await readD1FamilyFeatures(child, db)).inventory, 'child feature read')
  await refuses(() => updateD1FamilyFeatures(child, { inventory: false }, db), 403)
  await refuses(() => updateD1FamilyFeatures({ ...parent, generation: 1 }, { inventory: false }, db), 401)
  await db.prepare(`CREATE TRIGGER fixture_settings_audit BEFORE INSERT ON "AuditLog" WHEN NEW.family_id='read-family-a' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END`).run()
  try { await refuses(() => updateD1FamilyFeatures(parent, { inventory: false }, db)) }
  finally { await db.prepare('DROP TRIGGER fixture_settings_audit').run() }
  check((await readD1FamilyFeatures(parent, db)).inventory, 'failed audit rolls back feature change')
  await updateD1BetaMetrics(parent, true, db)
  await db.prepare(`INSERT INTO "BetaMetricDaily" (family_id,day,metric,count) VALUES ('read-family-a','2026-10-28','fixture',2),('read-family-b','2026-10-28','fixture',3)`).run()
  await db.prepare(`CREATE TRIGGER fixture_settings_audit BEFORE INSERT ON "AuditLog" WHEN NEW.family_id='read-family-a' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END`).run()
  try { await refuses(() => updateD1BetaMetrics(parent, false, db)) }
  finally { await db.prepare('DROP TRIGGER fixture_settings_audit').run() }
  check((await db.prepare('SELECT count FROM "BetaMetricDaily" WHERE family_id=?1').bind(parent.familyId).first<{ count: number }>())?.count === 2, 'failed audit preserves metrics')
  check((await db.prepare('SELECT beta_metrics_enabled AS n FROM "Family" WHERE id=?1').bind(parent.familyId).first<{ n: number }>())?.n === 1, 'failed audit preserves opt in')
  await updateD1BetaMetrics(parent, false, db)
  check(await count('beta_metrics.%') === 2, 'metrics switch change history')
  check((await db.prepare('SELECT count(*) AS n FROM "BetaMetricDaily" WHERE family_id=?1').bind(parent.familyId).first<{ n: number }>())?.n === 0, 'metrics off erases own counts')
  check((await db.prepare('SELECT count FROM "BetaMetricDaily" WHERE family_id=?1').bind(foreign.familyId).first<{ count: number }>())?.count === 3, 'metrics off preserves foreign counts')
  await db.prepare(`INSERT INTO "BetaMetricDaily" (family_id,day,metric,count) VALUES ('read-family-a','2026-10-28','fixture',1)`).run()
  await updateD1BetaMetrics(parent, false, db)
  check(await count('beta_metrics.%') === 2, 'off retry creates no extra history')
  check((await db.prepare('SELECT count(*) AS n FROM "BetaMetricDaily" WHERE family_id=?1').bind(parent.familyId).first<{ n: number }>())?.n === 0, 'off retry still erases residual counts')
  await refuses(() => updateD1BetaMetrics(child, true, db), 403)
  // Stale preflight authority cannot admit a write after demotion or revocation.
  function racingStore(sql: string): D1Store {
    return { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
      const primary = db.withSession('first-primary')
      return { prepare: primary.prepare.bind(primary), async batch(statements) { await db.prepare(sql).run(); return primary.batch(statements) } }
    } }
  }
  try {
    await refuses(() => updateD1FamilyFeatures(parent, { inventory: false }, racingStore(`UPDATE "User" SET role='child' WHERE id='read-a'`)), 403)
    check((await db.prepare('SELECT features FROM "Family" WHERE id=?1').bind(parent.familyId).first<{ features: string }>())?.features.includes('"inventory":true'), 'demoted actor cannot write features')
  } finally { await db.prepare(`UPDATE "User" SET role='parent' WHERE id='read-a'`).run() }
  try {
    await refuses(() => updateD1BetaMetrics(parent, true, racingStore(`UPDATE "User" SET token_version=1 WHERE id='read-a'`)), 401)
    check(await count('beta_metrics.%') === 2, 'revoked actor creates no audit')
  } finally { await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='read-a'`).run() }
  const now = new Date()
  for (const [id, familyId, actorId, created] of [
    ['fixture-old-own', parent.familyId, parent.userId, now.getTime() - AUDIT_RETENTION_MS - 1],
    ['fixture-old-foreign', foreign.familyId, foreign.userId, now.getTime() - AUDIT_RETENTION_MS - 1],
    ['fixture-moved-actor', parent.familyId, foreign.userId, now.getTime()],
  ] as const) await db.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,summary,created_at) VALUES (?1,?2,?3,'person','feature.turned_on','feature','Fixture summary',?4)`).bind(id, familyId, actorId, created).run()
  await refuses(() => readD1AuditPage(child, { limit: 2, cursor: null, now }, db), 403)
  check((await db.prepare(`SELECT id FROM "AuditLog" WHERE id='fixture-old-own'`).first()) !== null, 'child refusal did not prune')
  const ids = new Set<string>()
  let cursor = null as ReturnType<typeof decodeAuditCursor>
  let sawMoved = false
  do {
    const page = await readD1AuditPage(parent, { limit: 2, cursor, now }, db)
    for (const entry of page.entries) {
      check(!ids.has(entry.id), 'audit cursor repeats a row')
      check(entry.id !== 'fixture-old-foreign', 'foreign history excluded')
      if (entry.id === 'fixture-moved-actor') { check(entry.actor === null, 'foreign actor name hidden'); sawMoved = true }
      ids.add(entry.id)
    }
    cursor = page.nextCursor ? decodeAuditCursor(page.nextCursor) : null
  } while (cursor)
  check(sawMoved && ids.size >= keys.length + 3, 'all retained history paginated')
  check((await db.prepare(`SELECT id FROM "AuditLog" WHERE id='fixture-old-own'`).first()) === null, 'own expired history pruned')
  check((await db.prepare(`SELECT id FROM "AuditLog" WHERE id='fixture-old-foreign'`).first()) !== null, 'foreign retention unaffected')
  return { renameRace: 8, convergentRename: true, featureMergeRace: 8, atomicAudit: true, metricsErasure: true, childAuthority: true, sessionRace: true, householdIsolation: true, auditPagination: true, auditRetention: true, actorPrivacy: true }
}
