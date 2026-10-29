import { safeFetch, isUnsafeAddressError } from '../../../src/lib/safe-fetch'
import { syncD1CalendarSubscription, persistD1CalendarSync } from '../../../src/lib/cloudflare/calendar-sync'
import { readD1StaleCalendarSubscriptions } from '../../../src/lib/cloudflare/calendar-stale'
import { CalendarSubscriptionSyncHeld, importWindow } from '../../../src/lib/calendar-import/sync-values'
import { encryptSecret } from '../../../src/lib/secret-box'
import { checkProviderUrlShape } from '../../../src/lib/outbound-url'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testCalendarSync(db: D1Store) {
  process.env.JWT_SECRET = 'fabricated-calendar-sync-key-not-a-real-secret'
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('sync-family','Fixture','sync-family'),('sync-other','Other','sync-other')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('sync-parent','sync-parent@example.test','Parent','sync-family','parent'),
    ('sync-teen','sync-teen@example.test','Teen','sync-family','teen'),
    ('sync-foreign','sync-foreign@example.test','Other','sync-other','parent')`).run()
  const actor = { userId: 'sync-parent', familyId: 'sync-family', role: 'parent', generation: 0 }
  const teen = { ...actor, userId: 'sync-teen', role: 'teen' }
  process.env.HEREWOVEN_STORAGE = 'd1'
  let unsafeRefused = false
  try { await safeFetch('https://127.0.0.1/private', { redirect: 'manual' }) } catch (cause) { unsafeRefused = isUnsafeAddressError(cause) }
  check(unsafeRefused, 'Workers provider boundary refuses private addresses')
  const now = new Date('2026-10-28T12:00:00Z')
  await db.prepare(`INSERT INTO "CalendarSubscription" (id,family_id,created_by,name,url_enc) VALUES ('sync-sub','sync-family','sync-parent','Fixture',?1),('sync-foreign-sub','sync-other','sync-foreign','Foreign',?1)`)
    .bind(encryptSecret('https://calendar.example.test/secret-fixture')).run()
  const assertUrl = async (url: string) => { if (checkProviderUrlShape(url)) throw new Error('Refused fixture address') }
  const feed = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture-uid\r\nDTSTART:20261029T120000Z\r\nDTEND:20261029T130000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
  const options = (body: string, extra = {}) => ({ actor, now, assertUrl, fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/calendar', etag: 'fixture-etag' } }), ...extra })
  const first = await syncD1CalendarSubscription('sync-sub', actor.familyId, options(feed('Original')), db)
  check(first?.created === 1 && first.updated === 0, 'initial imported occurrence')
  type EventRow = { id: string; title: string; schedule_epoch: number; schedule_generation: string; created_by: string }
  const event = () => db.prepare(`SELECT id,title,schedule_epoch,schedule_generation,created_by FROM "Event" WHERE source_subscription_id='sync-sub' AND source_uid='fixture-uid'`).first<EventRow>()
  const original = (await event())!
  check((await syncD1CalendarSubscription('sync-sub', actor.familyId, options(feed('Original')), db))?.created === 0, 'repeat identity stable')
  const changed = await syncD1CalendarSubscription('sync-sub', actor.familyId, options(feed('Changed'), { actor: teen }), db)
  const edited = (await event())!
  check(changed?.updated === 1 && edited.id === original.id && edited.created_by === original.created_by && edited.schedule_generation === original.schedule_generation && edited.schedule_epoch === original.schedule_epoch + 1, 'changed fields retain identity and advance schedule snapshot')
  const unchanged = await syncD1CalendarSubscription('sync-sub', actor.familyId, options(feed('Changed')), db)
  check(unchanged?.updated === 0 && (await event())!.schedule_epoch === edited.schedule_epoch, 'unchanged feed does not advance epoch')
  let validators = false
  const notModified = await syncD1CalendarSubscription('sync-sub', actor.familyId, options('', { fetchImpl: async (_url: string, init?: RequestInit) => {
    validators = new Headers(init?.headers).get('if-none-match') === 'fixture-etag'; return new Response(null, { status: 304 })
  } }), db)
  check(validators && notModified?.status === 'not_modified' && (await event())!.title === 'Changed', '304 conditional fetch preserves events')
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by,source_subscription_id,source_uid,source_occurrence_start) VALUES
    ('sync-local','sync-family','Local',1,2,'sync-parent',NULL,NULL,NULL),
    ('sync-history','sync-family','History',1,2,'sync-parent','sync-sub','history',1),
    ('sync-invalid','sync-family','Invalid',1,2,'sync-parent','sync-sub',NULL,NULL),
    ('sync-foreign-event','sync-other','Foreign',1,2,'sync-foreign','sync-foreign-sub','foreign',1)`).run()
  const invalid = await syncD1CalendarSubscription('sync-sub', actor.familyId, options('not a calendar'), db)
  check(invalid?.status === 'error' && await event(), 'invalid feed never deletes events')
  const huge = feed('Huge').replace('END:VEVENT', 'RRULE:FREQ=MINUTELY;COUNT=3100\r\nEND:VEVENT')
  const truncated = await syncD1CalendarSubscription('sync-sub', actor.familyId, options(huge), db)
  check(truncated?.status === 'error' && truncated.error?.includes('too large') && await event(), 'truncated expansion never reconciles a prefix')
  await db.prepare(`CREATE TRIGGER fixture_sync_abort BEFORE UPDATE ON "CalendarSubscription" WHEN NEW.id='sync-sub' AND NEW.last_status='ok' BEGIN SELECT RAISE(ABORT,'fixture sync refusal'); END`).run()
  const failed = await syncD1CalendarSubscription('sync-sub', actor.familyId, options(feed('Must roll back')), db)
  check(failed?.status === 'error' && (await event())!.title === 'Changed' && (await event())!.schedule_epoch === edited.schedule_epoch, 'event and epoch roll back when status write fails')
  await db.prepare('DROP TRIGGER fixture_sync_abort').run()
  let revoked = false
  try { await syncD1CalendarSubscription('sync-sub', actor.familyId, options('', { fetchImpl: async () => {
    await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='sync-parent'`).run()
    return new Response(feed('Must not save'), { headers: { 'content-type': 'text/calendar' } })
  } }), db) } catch (cause) { revoked = cause instanceof CalendarSubscriptionSyncHeld && cause.reason === 'access' }
  check(revoked && (await event())!.title === 'Changed', 'actor revoked while fetching cannot write')
  await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='sync-parent'`).run()
  let sourceChanged = false
  try { await syncD1CalendarSubscription('sync-sub', actor.familyId, options('', { fetchImpl: async () => {
    await db.prepare(`UPDATE "CalendarSubscription" SET url_enc=?1 WHERE id='sync-sub'`).bind(encryptSecret('https://calendar.example.test/replaced')).run()
    return new Response(feed('Must not save'), { headers: { 'content-type': 'text/calendar' } })
  } }), db) } catch (cause) { sourceChanged = cause instanceof CalendarSubscriptionSyncHeld && cause.reason === 'source' }
  check(sourceChanged && (await event())!.title === 'Changed', 'replaced source held after fetch')
  check(await syncD1CalendarSubscription('sync-foreign-sub', actor.familyId, options(feed('Must not save')), db) === null, 'foreign refresh concealed')
  const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
  const removed = await syncD1CalendarSubscription('sync-sub', actor.familyId, options(empty), db)
  check(removed?.deleted === 2 && !await event(), 'empty complete feed removes in-window and invalid identities')
  check((await db.prepare(`SELECT id FROM "Event" WHERE id IN ('sync-history','sync-local','sync-foreign-event')`).all()).results.length === 3, 'valid history local and foreign rows preserved')
  const source = (await db.prepare(`SELECT id,family_id,created_by,created_at,url_enc,etag,last_modified FROM "CalendarSubscription" WHERE id='sync-sub'`).first<Parameters<typeof persistD1CalendarSync>[1]>())!
  const occurrences = Array.from({ length: 600 }, (_, i) => ({ uid: '界'.repeat(450) + i, occurrenceStart: new Date(now.getTime() + i * 1000), start: now, end: new Date(now.getTime() + 60000), title: 'Large fixture', description: '界'.repeat(1000), location: null, allDay: false }))
  const large = await persistD1CalendarSync(db, source, actor, { now: now.getTime(), status: 'ok', error: null }, { occurrences, window: importWindow(now) })
  check(large.created === 600 && large.updated === 0, 'multi-megabyte expanded content uses bounded D1 values in one batch')
  const stale = await readD1StaleCalendarSubscriptions(actor.familyId, new Date(now.getTime() + 16 * 60000), actor, db)
  check(stale.length === 1 && stale[0].id === 'sync-sub', 'stale selection scoped and bounded')
  check((await readD1StaleCalendarSubscriptions('sync-other', now, actor, db)).length === 0, 'stale actor household mismatch refused')
  let generationGuard = false
  try { await db.prepare(`UPDATE "Event" SET schedule_generation='replacement' WHERE id='sync-history'`).run() } catch { generationGuard = true }
  check(generationGuard, 'immutable event insertion generation')
  for (const assignment of ['schedule_epoch=-1', 'schedule_epoch=0.5', 'preparation_epoch=2147483648']) {
    let refused = false
    try { await db.prepare(`UPDATE "Event" SET ${assignment} WHERE id='sync-history'`).run() } catch { refused = true }
    check(refused, 'integer bounded event epoch')
  }
  return { workerPrivateAddressRefused: true, initialImport: true, identityAndEpoch: true, unchanged: true, conditional304: true, invalidFeedPreserved: true, truncatedPreserved: true, atomicStatusRollback: true, revokedDuringFetch: true, changedSource: true, historyAndHouseholdIsolation: true, boundedLargeImport: 600, staleSelection: true }
}
