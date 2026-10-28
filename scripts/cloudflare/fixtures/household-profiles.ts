import { manageD1HouseholdProfile, listD1HouseholdProfiles } from '../../../src/lib/cloudflare/household-profiles'
import { d1WriteCheck, isD1WriteConflict } from '../../../src/lib/cloudflare/write-check'
import { routineStepSeriesConfig } from '../../../src/lib/routine-schedule'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refuses(operation: () => unknown, code?: string) {
  try { await operation() } catch (error) {
    check(error instanceof Error && (code === undefined || ('code' in error && error.code === code)), `expected ${code}: ${String(error)}`)
    return
  }
  throw new Error(`did not refuse ${code}`)
}
export async function testHouseholdProfiles(db: D1Store) {
  const actor = { userId: 'read-a', familyId: 'read-family-a', tokenVersion: 0 }
  const now = new Date(), key = 'fixture_profile_create_once'
  const create = { action: 'create', name: 'Fabricated small child', role: 'child', age: 3 }
  const userCount = () => db.prepare('SELECT count(*) AS n FROM "User"').first<{ n: number }>()
  const beforeUsers = (await userCount())!.n
  const creations = await Promise.all(Array.from({ length: 8 }, () => manageD1HouseholdProfile(actor, key, create, now, db)))
  check(creations.filter(c => !c.replayed).length === 1 && new Set(creations.map(c => c.profile.id)).size === 1, 'one profile effect, seven receipt replays')
  const id = creations[0].profile.id
  check((await userCount())!.n === beforeUsers, 'no account/mailbox created')
  check(creations[0].profile.role === 'child' && creations[0].profile.age === 3 && !('email' in creations[0].profile), 'email-free profile projection')
  await refuses(() => manageD1HouseholdProfile(actor, key, { ...create, name: 'Different request' }, now, db), 'KEY_REUSED')
  await refuses(() => manageD1HouseholdProfile(actor, key, create, new Date(now.getTime() + 8 * 86400000), db), 'CONFLICT')
  await refuses(() => manageD1HouseholdProfile({ ...actor, userId: 'read-b' }, 'fixture_child_create_no', create, now, db), 'FORBIDDEN')
  await refuses(() => manageD1HouseholdProfile({ ...actor, tokenVersion: 1 }, 'fixture_revoked_create', create, now, db), 'UNAUTHORIZED')
  await refuses(() => manageD1HouseholdProfile(actor, 'fixture_invalid_age', { ...create, role: 'teen', age: 3 }, now, db), 'INVALID')
  check((await listD1HouseholdProfiles(actor, db)).some(p => p.id === id), 'own profile listing')
  check(!(await listD1HouseholdProfiles({ userId: 'read-c', familyId: 'read-family-b', tokenVersion: 0 }, db)).some(p => p.id === id), 'foreign profile excluded')
  const schedule = { frequency: 'daily', starts_on: '2026-10-28', weekly_days: [], monthly_day: null }
  const config = routineStepSeriesConfig.parse({ protocol: 'herewoven.routine-step-series.v1', revision: 1, stack_id: 'fixture-profile-stack', state: 'active', effective_on: '2026-10-28', anchor: 'After breakfast', schedule,
    content: { title: 'Fabricated routine step', description: null, subject: { kind: 'profile', member_id: id }, points: 0, difficulty: 'easy', icon: null, duration_minutes: 2 } })
  await db.prepare(`INSERT INTO "RoutineStack" (id,family_id,label,fingerprint) VALUES ('fixture-profile-stack','read-family-a','Fabricated routine','initial')`).run()
  await db.prepare(`INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_member_id,recurrence_id,routine_stack_id,routine_series_config) VALUES ('fixture-profile-root','read-family-a','Preserved occurrence',1,'read-a',?1,'fixture-profile-root','fixture-profile-stack',?2)`).bind(id, JSON.stringify(config)).run()
  const root = () => db.prepare(`SELECT title,due_date,assigned_to,assigned_member_id,routine_series_config FROM "Chore" WHERE id='fixture-profile-root'`).first<{ title: string; due_date: number; assigned_to: string | null; assigned_member_id: string; routine_series_config: string }>()
  const edit = { action: 'edit', id, revision: 0, name: 'Fabricated renamed child' }
  await db.prepare(`CREATE TRIGGER fixture_profile_receipt BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='fixture_profile_receipt_fail' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`).run()
  try { await refuses(() => manageD1HouseholdProfile(actor, 'fixture_profile_receipt_fail', edit, now, db)) }
  finally { await db.prepare('DROP TRIGGER fixture_profile_receipt').run() }
  check((await listD1HouseholdProfiles(actor, db)).find(p => p.id === id)?.revision === 0, 'receipt failure rolls back profile')
  check(JSON.parse((await root())!.routine_series_config).revision === 1, 'receipt failure rolls back routine')
  check((await db.prepare(`SELECT version FROM "RoutineStack" WHERE id='fixture-profile-stack'`).first<{ version: number }>())?.version === 1, 'receipt failure rolls back stack')
  const changed = await manageD1HouseholdProfile(actor, 'fixture_profile_edit_once', edit, now, db)
  check(changed.profile.revision === 1 && changed.profile.name === edit.name, 'profile edit')
  const changedRoot = (await root())!
  check(changedRoot.title === 'Preserved occurrence' && changedRoot.due_date === 1 && changedRoot.assigned_to === null && changedRoot.assigned_member_id === id, 'occurrence identity/history unchanged')
  check(JSON.parse(changedRoot.routine_series_config).revision === 2, 'future subject revision invalidated')
  check((await db.prepare(`SELECT version FROM "RoutineStack" WHERE id='fixture-profile-stack'`).first<{ version: number }>())?.version === 2, 'routine stack invalidated')
  await manageD1HouseholdProfile(actor, 'fixture_profile_edit_once', edit, now, db)
  check(JSON.parse((await root())!.routine_series_config).revision === 2, 'replayed edit does not invalidate twice')
  await refuses(() => manageD1HouseholdProfile(actor, 'fixture_profile_stale_edit', { ...edit, name: 'Stale edit' }, now, db), 'CONFLICT')
  // An intervening routine edit invalidates the batch precondition and is
  // retained when the profile command rebuilds its atomic plan.
  let raced = false
  const racing: D1Store = { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const primary = db.withSession('first-primary')
    return { prepare: primary.prepare.bind(primary), async batch(statements) {
      if (!raced) { raced = true; await db.prepare(`UPDATE "Chore" SET routine_series_config=json_set(routine_series_config,'$.revision',3) WHERE id='fixture-profile-root'`).run() }
      return primary.batch(statements)
    } }
  } }
  await manageD1HouseholdProfile(actor, 'fixture_profile_edit_race', { ...edit, revision: 1, name: 'Fabricated raced edit' }, now, racing)
  check(JSON.parse((await root())!.routine_series_config).revision === 4, 'concurrent future edit survives retry')
  const epochBeforeArchive = (await db.prepare(`SELECT responsibility_epoch AS n FROM "Chore" WHERE id='fixture-profile-root'`).first<{ n: number }>())!.n
  await db.prepare(`INSERT INTO "ResponsibilityState" (id,family_id,chore_id,backup_member_id,source_token) VALUES ('fixture-profile-responsibility','read-family-a','fixture-profile-root',?1,?2)`).bind(id, 'a'.repeat(64)).run()
  const archived = await manageD1HouseholdProfile(actor, 'fixture_profile_archive', { action: 'archive', id, revision: 2 }, now, db)
  check(archived.profile.archived_at === now.toISOString() && archived.profile.revision === 3, 'archive with receipt')
  check((await db.prepare(`SELECT count(*) AS n FROM "ResponsibilityState" WHERE id='fixture-profile-responsibility'`).first<{ n: number }>())!.n === 0, 'archive retires responsibility participation')
  check((await db.prepare(`SELECT responsibility_epoch AS n FROM "Chore" WHERE id='fixture-profile-root'`).first<{ n: number }>())!.n === epochBeforeArchive + 3, 'archive invalidates primary, metadata and future routine epochs')
  await db.prepare(`UPDATE "Chore" SET status='completed' WHERE id='fixture-profile-root'`).run()
  await refuses(() => db.prepare(`INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_member_id) VALUES ('fixture-archived-reassign','read-family-a','Must refuse',1,'read-a',?1)`).bind(id).run())
  await db.prepare(`UPDATE "Chore" SET assigned_member_id=NULL,member_subject_erased=1 WHERE id='fixture-profile-root'`).run()
  await refuses(() => db.prepare(`UPDATE "Chore" SET member_subject_erased=0,assigned_to='read-a' WHERE id='fixture-profile-root'`).run())
  // Explicit precondition failure must undo statements already executed.
  let assertionFailed = false
  try { await db.batch([db.prepare(`UPDATE "User" SET name='MUST ROLL BACK' WHERE id='read-a'`), d1WriteCheck(db, '0')]) }
  catch (error) { assertionFailed = isD1WriteConflict(error) }
  check(assertionFailed, 'named assertion failure classified')
  check((await db.prepare(`SELECT name FROM "User" WHERE id='read-a'`).first<{ name: string }>())?.name === 'Fabricated A', 'native batch assertion rolls back prior write')
  check((await db.prepare('SELECT count(*) AS n FROM "_D1WriteCheck"').first<{ n: number }>())?.n === 0, 'checks persist no state')
  await refuses(() => db.prepare(`UPDATE "RoutineStack" SET schedule_config='{"protocol":"future-unsupported"}' WHERE id='fixture-profile-stack'`).run())
  await refuses(() => db.prepare(`UPDATE "Chore" SET routine_duration_minutes=0 WHERE id='fixture-profile-root'`).run())
  await db.prepare(`INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_to) VALUES ('fixture-account-responsibility','read-family-a','Fabricated account work',1,'read-a','read-b')`).run()
  await db.prepare(`INSERT INTO "ResponsibilityState" (id,family_id,chore_id,backup_account_id,source_token) VALUES ('fixture-account-responsibility','read-family-a','fixture-account-responsibility','read-b',?1)`).bind('b'.repeat(64)).run()
  await db.prepare(`UPDATE "User" SET role='teen' WHERE id='read-b'`).run()
  check((await db.prepare(`SELECT count(*) AS n FROM "ResponsibilityState" WHERE id='fixture-account-responsibility'`).first<{ n: number }>())!.n === 0, 'role change retires responsibility metadata')
  check((await db.prepare(`SELECT responsibility_epoch AS n FROM "Chore" WHERE id='fixture-account-responsibility'`).first<{ n: number }>())!.n === 2, 'role change closes primary and metadata ABA')
  await refuses(() => db.prepare(`UPDATE "Chore" SET responsibility_generation='must-not-change' WHERE id='fixture-account-responsibility'`).run())
  await db.prepare(`UPDATE "User" SET role='child' WHERE id='read-b'`).run()
  return { concurrentCreate: 8, emailFree: true, scopedList: true, replay: true, keyReuse: true, expiry: true, atomicRoutineAndReceipt: true, futureEditRace: true, archive: true, stickyErasure: true, batchAssertionRollback: true, responsibilityRetirement: true }
}
