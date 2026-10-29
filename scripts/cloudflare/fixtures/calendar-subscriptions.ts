import { createD1CalendarSubscription, deleteD1CalendarSubscription, listD1CalendarSubscriptions, renewD1CalendarSubscriptionActor, updateD1CalendarSubscription } from '../../../src/lib/cloudflare/calendar-subscriptions'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import { encryptSecret } from '../../../src/lib/secret-box'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
export async function testCalendarSubscriptions(db: D1Store) {
  process.env.JWT_SECRET = 'fabricated-calendar-smoke-key-not-a-real-secret'
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('calendar-a','Fixture','calendar-a'),('calendar-b','Other','calendar-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('calendar-parent','calendar-parent@example.test','Parent','calendar-a','parent'),
    ('calendar-teen','calendar-teen@example.test','Teen','calendar-a','teen'),
    ('calendar-child','calendar-child@example.test','Child','calendar-a','child'),
    ('calendar-other','calendar-other@example.test','Other','calendar-b','parent')`).run()
  const actor = { userId: 'calendar-parent', familyId: 'calendar-a', generation: 0, role: 'parent' }
  const teen = { ...actor, userId: 'calendar-teen', role: 'teen' }
  const child = { ...actor, userId: 'calendar-child', role: 'child' }
  const other = { ...actor, userId: 'calendar-other', familyId: 'calendar-b' }
  const input = { name: 'Fixture feed', color: '#12ABcd', url_enc: encryptSecret('https://calendar.example.test/private-token?secret=fixture') }
  const concurrent = await Promise.all(Array.from({ length: 14 }, () => createD1CalendarSubscription(actor, input, db)))
  check(concurrent.filter(r => r.kind === 'data' && r.value.kind === 'created').length === 10, 'concurrent cap admits exactly ten')
  check(concurrent.filter(r => r.kind === 'data' && r.value.kind === 'full').length === 4, 'cap reports full')
  const listed = await listD1CalendarSubscriptions(actor, db)
  check(listed.kind === 'data' && listed.value.length === 10, 'parent list')
  const id = listed.value[0].id
  check(listed.value.every(s => s.url_hint === 'calendar.example.test/…' && s.last_status === 'pending'), 'encrypted host-only hint')
  check(!JSON.stringify(listed).includes('private-token') && !JSON.stringify(listed).includes('url_enc'), 'no URL or ciphertext disclosure')
  const teenList = await listD1CalendarSubscriptions(teen, db)
  check(teenList.kind === 'data' && teenList.value.every(s => !('url_hint' in s)), 'teens receive no URL hint')
  check((await listD1CalendarSubscriptions(child, db)).kind === 'held', 'child list refused')
  check((await createD1CalendarSubscription(teen, input, db)).kind === 'held', 'teen create refused')
  check(await renewD1CalendarSubscriptionActor(teen, 'refresh', db), 'teen refresh authority')
  check(!await renewD1CalendarSubscriptionActor(child, 'refresh', db), 'child refresh refused')
  const foreign = await createD1CalendarSubscription(other, input, db)
  check(foreign.kind === 'data' && foreign.value.kind === 'created', 'independent family capacity')
  const foreignId = foreign.value.subscription.id
  const missing = await updateD1CalendarSubscription(actor, foreignId, { name: 'Must not save' }, db)
  check(missing.kind === 'data' && missing.value === null, 'foreign update concealed')
  const removedForeign = await deleteD1CalendarSubscription(actor, foreignId, db)
  check(removedForeign.kind === 'data' && removedForeign.value === null, 'foreign delete concealed')
  await Promise.all([updateD1CalendarSubscription(actor, id, { name: 'Renamed' }, db), updateD1CalendarSubscription(actor, id, { color: null }, db)])
  const updated = await updateD1CalendarSubscription(actor, id, {}, db)
  check(updated.kind === 'data' && updated.value?.name === 'Renamed' && updated.value.color === null, 'independent patches and explicit clear')
  check((await updateD1CalendarSubscription(teen, id, { name: 'Must not save' }, db)).kind === 'held', 'teen manage refused')
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by,source_subscription_id) VALUES
    ('calendar-imported','calendar-a','Imported',1,2,'calendar-parent',?1),
    ('calendar-local','calendar-a','Local',1,2,'calendar-parent',NULL),
    ('calendar-foreign','calendar-b','Foreign',1,2,'calendar-other',?2)`).bind(id, foreignId).run()
  // A write failure after event deletion must roll back the entire native batch.
  await db.prepare(`CREATE TRIGGER fixture_calendar_abort BEFORE DELETE ON "CalendarSubscription" WHEN OLD.id='${id}' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
  let failed = false
  try { await deleteD1CalendarSubscription(actor, id, db) } catch { failed = true }
  check(failed && await db.prepare(`SELECT id FROM "Event" WHERE id='calendar-imported'`).first(), 'delete failure restores imported event')
  await db.prepare('DROP TRIGGER fixture_calendar_abort').run()
  const removed = await deleteD1CalendarSubscription(actor, id, db)
  check(removed.kind === 'data' && removed.value?.removedEvents === 1, 'scoped imported removal count')
  check((await db.prepare(`SELECT id FROM "Event" WHERE id IN ('calendar-imported','calendar-local','calendar-foreign')`).all()).results.length === 2, 'local and other household events survive')
  function racing(sql: string): D1Store { return { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const primary = db.withSession('first-primary')
    return { prepare: primary.prepare.bind(primary), async batch(statements) { await db.prepare(sql).run(); return primary.batch(statements) } }
  } } }
  const target = listed.value[1].id
  check((await updateD1CalendarSubscription(actor, target, { name: 'Must not save' }, racing(`UPDATE "User" SET token_version=1 WHERE id='calendar-parent'`))).kind === 'held', 'revoked in-flight writer refused')
  check(!await renewD1CalendarSubscriptionActor(actor, 'read', db), 'post-response authority renewal')
  await db.prepare(`UPDATE "User" SET token_version=0,role='teen' WHERE id='calendar-parent'`).run()
  check((await createD1CalendarSubscription(actor, input, db)).kind === 'held', 'stale original parent role refused')
  await db.prepare(`UPDATE "User" SET role='parent',family_id='calendar-b' WHERE id='calendar-parent'`).run()
  check((await deleteD1CalendarSubscription(actor, target, db)).kind === 'held', 'moved original household refused')
  check((await db.prepare(`SELECT name FROM "CalendarSubscription" WHERE id=?1`).bind(target).first<{ name: string }>())?.name === 'Fixture feed', 'held writes leave rows unchanged')
  return { concurrentCap: 14, encryptedUrlProjection: true, teenPrivacy: true, householdIsolation: true, partialPatches: true, atomicDeletionRollback: true, importedOnlyDeletion: true, actorRenewal: true }
}
