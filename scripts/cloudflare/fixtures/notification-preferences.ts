import { readD1NotificationPreferences, updateD1NotificationPreferences, pruneD1ExpiredReceipts } from '../../../src/lib/cloudflare/notification-preferences'
import { hashIdempotentRequest } from '../../../src/lib/idempotency-hash'
import { NOTIFICATION_PREFERENCES_ACTION } from '../../../src/lib/notification-policy'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refuses(operation: () => unknown, code?: string) {
  try { await operation() } catch (error) { check(error instanceof Error && (code === undefined || ('code' in error && error.code === code)), `expected ${code}`); return }
  throw new Error(`did not refuse ${code}`)
}
export async function testNotificationPreferences(db: D1Store) {
  const actor = { userId: 'read-a', familyId: 'read-family-a', generation: 0 }, now = new Date()
  const initial = await readD1NotificationPreferences(actor, db)
  check(initial.preferences.chores && !initial.morningSummary.enabled, 'canonical boolean defaults')
  await Promise.all([
    updateD1NotificationPreferences(actor, { chores: false }, null, now, db),
    updateD1NotificationPreferences(actor, { events: false }, null, now, db),
  ])
  const concurrent = await readD1NotificationPreferences(actor, db)
  check(!concurrent.preferences.chores && !concurrent.preferences.events && concurrent.preferences.messages, 'independent concurrent toggles survive')
  await db.prepare(`UPDATE "User" SET morning_summary_sent_on='2026-10-28' WHERE id='read-a'`).run()
  await updateD1NotificationPreferences(actor, { morningSummary: { enabled: true, timeZone: 'America/Toronto' } }, null, now, db)
  await updateD1NotificationPreferences(actor, { morningSummary: { enabled: false } }, null, now, db)
  check((await readD1NotificationPreferences(actor, db)).morningSummary.timeZone === 'America/Toronto', 'omitted morning zone preserved')
  check((await db.prepare(`SELECT morning_summary_sent_on FROM "User" WHERE id='read-a'`).first<{ morning_summary_sent_on: string }>())!.morning_summary_sent_on === '2026-10-28', 'summary last-sent day preserved')
  await updateD1NotificationPreferences(actor, { quietHours: { enabled: true, start: '21:00', end: '06:00', timeZone: 'America/Toronto' } }, null, now, db)
  const quiet = await updateD1NotificationPreferences(actor, { quietHours: { enabled: false, start: '22:00', end: '07:00' } }, null, now, db)
  check(quiet.body.quietHours.timeZone === null, 'omitted quiet zone explicitly UTC')
  const key = 'fixture_notification_once'
  const saves = await Promise.all(Array.from({ length: 8 }, () => updateD1NotificationPreferences(actor, { chores: true }, key, now, db)))
  check(saves.filter(s => !s.replayed).length === 1 && saves.filter(s => s.replayed).length === 7, 'one keyed effect with seven replays')
  await updateD1NotificationPreferences(actor, { chores: false }, null, now, db)
  check((await updateD1NotificationPreferences(actor, { chores: true }, key, now, db)).body.preferences.chores, 'exact historical receipt replayed')
  check(!(await readD1NotificationPreferences(actor, db)).preferences.chores, 'replay does not reapply an old toggle')
  await refuses(() => updateD1NotificationPreferences(actor, { chores: false }, key, now, db), 'IDEMPOTENCY_KEY_REUSED')
  await db.prepare(`CREATE TRIGGER fixture_notify_receipt BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='fixture_notification_fail' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`).run()
  try { await refuses(() => updateD1NotificationPreferences(actor, { chores: true }, 'fixture_notification_fail', now, db)) }
  finally { await db.prepare('DROP TRIGGER fixture_notify_receipt').run() }
  check(!(await readD1NotificationPreferences(actor, db)).preferences.chores, 'receipt failure rolls back preferences')
  const patch = { messages: false }, reclaimKey = 'fixture_notify_reclaim'
  await db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at) VALUES ('fixture-notify-reclaim','user:read-a',?1,'read-family-a','read-a',?2,?3,?4,?5)`)
    .bind(reclaimKey, NOTIFICATION_PREFERENCES_ACTION, hashIdempotentRequest(NOTIFICATION_PREFERENCES_ACTION, patch), now.getTime(), now.getTime() + 60000).run()
  await refuses(() => updateD1NotificationPreferences(actor, patch, reclaimKey, now, db), 'IDEMPOTENCY_IN_PROGRESS')
  await db.prepare(`UPDATE "IdempotencyRecord" SET created_at=?1 WHERE id='fixture-notify-reclaim'`).bind(now.getTime() - 31000).run()
  check(!(await updateD1NotificationPreferences(actor, patch, reclaimKey, now, db)).body.preferences.messages, 'abandoned legacy receipt reclaimed')
  await db.prepare(`UPDATE "IdempotencyRecord" SET expires_at=?1,action='different-expired-action' WHERE scope='user:read-a' AND key=?2`).bind(now.getTime(), reclaimKey).run()
  check((await updateD1NotificationPreferences(actor, { messages: true }, reclaimKey, now, db)).body.preferences.messages, 'expired key reusable after action changes')
  const child = { userId: 'read-b', familyId: 'read-family-a', generation: 0 }
  await updateD1NotificationPreferences(child, { messages: false }, key, now, db)
  check((await readD1NotificationPreferences(actor, db)).preferences.messages && !(await readD1NotificationPreferences(child, db)).preferences.messages, 'child changes only own preferences and receipt scope')
  await refuses(() => readD1NotificationPreferences({ ...actor, familyId: 'read-family-b' }, db), 'FORBIDDEN')
  await refuses(() => readD1NotificationPreferences({ ...actor, generation: 1 }, db), 'UNAUTHORIZED')
  await db.prepare(`INSERT INTO "User" (id,email,name) VALUES ('notify-unattached','notify-unattached@example.test','Fabricated unattached')`).run()
  try {
    const unattached = { userId: 'notify-unattached', familyId: null, generation: 0 }
    check(!(await updateD1NotificationPreferences(unattached, { chores: false }, key, now, db)).body.preferences.chores, 'unattached account update')
    check((await db.prepare(`SELECT count(*) AS n FROM "IdempotencyRecord" WHERE scope='user:notify-unattached'`).first<{ n: number }>())!.n === 0, 'unattached key ignored without receipt')
  } finally { await db.prepare(`DELETE FROM "User" WHERE id='notify-unattached'`).run() }
  let raced = false
  const racing: D1Store = { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const primary = db.withSession('first-primary')
    return { prepare: primary.prepare.bind(primary), async batch(statements) {
      if (!raced) { raced = true; await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='read-a'`).run() }
      return primary.batch(statements)
    } }
  } }
  try { await refuses(() => updateD1NotificationPreferences(actor, { chores: true }, null, now, racing), 'UNAUTHORIZED') }
  finally { await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='read-a'`).run() }
  check(!(await readD1NotificationPreferences(actor, db)).preferences.chores, 'revoked writer leaves preferences unchanged')
  const expired = Array.from({ length: 502 }, (_, i) => `fixture-prune-${i}`)
  await db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at)
    SELECT value,'user:read-c',value,'read-family-b','read-c','fixture','fixture',?2,?3 FROM json_each(?1)`)
    .bind(JSON.stringify(expired), now.getTime() - 100, now.getTime() - 1).run()
  await pruneD1ExpiredReceipts(db, now.getTime())
  check((await db.prepare(`SELECT count(*) AS n FROM "IdempotencyRecord" WHERE id LIKE 'fixture-prune-%'`).first<{ n: number }>())!.n === 2, 'receipt housekeeping bounded to 500')
  check((await db.prepare(`SELECT count(*) AS n FROM "IdempotencyRecord" WHERE scope='user:read-a' AND key='fixture_notification_once'`).first<{ n: number }>())!.n === 1, 'unexpired receipt survives housekeeping')
  return { concurrentPartialUpdates: true, keyedRace: 8, exactReplayWithoutReapply: true, receiptRollback: true, quietHours: true, morningZoneAndSentDay: true, legacyReclaim: true, expiredKeyReuse: true, ownChildScope: true, unattachedAccount: true, revokedWriter: true, boundedRetention: true }
}
