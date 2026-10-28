import { updateD1PersonEvent } from '../../../src/lib/cloudflare/event-update'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
export async function testEventUpdate(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('edit-family','Fixture','edit-family'),('edit-other','Other','edit-other')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('edit-parent','edit-parent@example.test','Parent','edit-family','parent'),
    ('edit-teen','edit-teen@example.test','Teen','edit-family','teen'),
    ('edit-foreign','edit-foreign@example.test','PRIVATE FOREIGN NAME','edit-other','parent')`).run()
  await db.prepare(`INSERT INTO "CalendarSubscription" (id,family_id,created_by,name,url_enc) VALUES ('edit-source','edit-family','edit-parent','Fixture','opaque-fixture')`).run()
  const start = Date.parse('2026-10-29T12:00:00Z'), end = start + 3600000
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by,recurrence,source_subscription_id) VALUES
    ('edit-local','edit-family','Original',?1,?2,'edit-parent','FREQ=BAD',NULL),
    ('edit-imported','edit-family','Imported',?1,?2,'edit-parent',NULL,'edit-source'),
    ('edit-foreign-event','edit-other','Foreign',?1,?2,'edit-foreign',NULL,NULL)`).bind(start, end).run()
  const actor = { userId: 'edit-parent', familyId: 'edit-family', tokenVersion: 0 }
  const run = (input: Parameters<typeof updateD1PersonEvent>[1], database = db) => updateD1PersonEvent(actor, input, database)
  type Row = { title: string; location: string | null; description: string | null; recurrence: string | null; start_time: number; end_time: number; schedule_epoch: number; schedule_generation: string }
  const row = () => db.prepare(`SELECT * FROM "Event" WHERE id='edit-local'`).first<Row>()
  const before = (await row())!
  await Promise.all([
    run({ eventId: 'edit-local', title: 'Changed' }),
    run({ eventId: 'edit-local', location: 'Home' }),
    run({ eventId: 'edit-local', description: 'Details' }),
  ])
  const changed = (await row())!
  check(changed.title === 'Changed' && changed.location === 'Home' && changed.description === 'Details' && changed.recurrence === 'FREQ=BAD', 'concurrent partial updates merge without rewriting unsupported repeat')
  check(changed.schedule_generation === before.schedule_generation && changed.schedule_epoch === before.schedule_epoch + 3, 'canonical schedule material epoch')
  check((await run({ eventId: 'edit-local', title: 'Changed' })).status === 200 && (await row())!.schedule_epoch === changed.schedule_epoch, 'absolute retry does not duplicate material change')
  check((await run({ eventId: 'edit-local', start_time: '2026-10-29T14:00:00Z' })).status === 400 && (await row())!.start_time === start, 'one changed bound validates against current other bound')
  check((await run({ eventId: 'edit-local', start_time: 'not-a-date' })).status === 400, 'invalid date rejected')
  check((await run({ eventId: 'edit-local', recurrence: null, expected_recurrence: 'FREQ=WEEKLY', title: 'Must not save' })).status === 409 && (await row())!.title === 'Changed', 'repeat review holds whole patch')
  check((await run({ eventId: 'edit-local', recurrence: null, expected_recurrence: 'FREQ=BAD' })).status === 200 && (await row())!.recurrence === null, 'exact reviewed repeat removal')
  check((await run({ eventId: 'edit-local', location: null, description: null })).status === 200 && (await row())!.location === null && (await row())!.description === null, 'explicit metadata clears')
  check((await run({ eventId: 'edit-local', start_time: '2026-10-29T14:00:00Z', end_time: '2026-10-29T14:00:00Z' })).status === 200, 'existing zero-duration contract')
  check((await run({ eventId: 'edit-imported', title: 'Must not save' })).status === 409, 'imported read-only')
  check((await run({ eventId: 'edit-foreign-event', title: 'Must not save' })).status === 404, 'foreign target concealed')
  check((await updateD1PersonEvent({ ...actor, userId: 'edit-teen' }, { eventId: 'edit-local', title: 'Must not save' }, db)).status === 403, 'teen refused')
  const stable = (await row())!
  await db.prepare(`CREATE TRIGGER fixture_edit_rollback AFTER UPDATE ON "Event" WHEN NEW.id='edit-local' AND NEW.title='Must roll back' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
  let aborted = false
  try { await run({ eventId: 'edit-local', title: 'Must roll back' }) } catch { aborted = true }
  check(aborted && (await row())!.title === stable.title && (await row())!.schedule_epoch === stable.schedule_epoch, 'failed event trigger rolls back fields and epoch')
  await db.prepare('DROP TRIGGER fixture_edit_rollback').run()
  await db.prepare(`UPDATE "Event" SET created_by='edit-foreign' WHERE id='edit-local'`).run()
  const reply = await run({ eventId: 'edit-local', title: 'Current title' })
  const body = reply.body as { event: { creator: unknown; title: string; start_time: Date } }
  check(reply.status === 200 && body.event.creator === null && !JSON.stringify(reply).includes('PRIVATE FOREIGN') && !('source' in body.event), 'PATCH creator privacy and canonical response shape')
  check(body.event.start_time.toISOString() === '2026-10-29T14:00:00.000Z', 'response date projection')
  function racing(sql: string): D1Store { return { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const primary = db.withSession('first-primary')
    return { prepare: primary.prepare.bind(primary), async batch(statements) { await db.prepare(sql).run(); return primary.batch(statements) } }
  } } }
  check((await run({ eventId: 'edit-local', title: 'Must not save' }, racing(`UPDATE "User" SET token_version=1 WHERE id='edit-parent'`))).status === 401 && (await row())!.title === 'Current title', 'revocation immediately before atomic batch')
  await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='edit-parent'`).run()
  check((await run({ eventId: 'edit-local', title: 'Must not save' }, racing(`UPDATE "Event" SET source_subscription_id='edit-source' WHERE id='edit-local'`))).status === 409 && (await row())!.title === 'Current title', 'import source change immediately before atomic batch')
  await db.prepare(`UPDATE "Event" SET source_subscription_id=NULL,recurrence='FREQ=DAILY' WHERE id='edit-local'`).run()
  check((await run({ eventId: 'edit-local', title: 'Must not save', recurrence: null, expected_recurrence: 'FREQ=DAILY' }, racing(`UPDATE "Event" SET recurrence='FREQ=WEEKLY' WHERE id='edit-local'`))).status === 409 && (await row())!.recurrence === 'FREQ=WEEKLY', 'concurrent rule is retained before reviewed removal')
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='edit-parent'`).run()
  check((await run({ eventId: 'edit-local', title: 'Must not save' })).status === 401, 'revoked writer')
  await db.prepare(`UPDATE "User" SET token_version=0,role='teen' WHERE id='edit-parent'`).run()
  check((await run({ eventId: 'edit-local', title: 'Must not save' })).status === 403, 'demoted writer')
  await db.prepare(`UPDATE "User" SET role='parent',family_id='edit-other' WHERE id='edit-parent'`).run()
  check((await run({ eventId: 'edit-local', title: 'Must not save' })).status === 403 && (await row())!.title === 'Current title', 'moved writer leaves original event unchanged')
  return { concurrentPartialMerge: 3, currentBoundValidation: true, exactRepeatReview: true, nullClears: true, importedReadOnly: true, householdIsolation: true, parentAuthority: true, epochAndRollback: true, responseProjection: true, batchAdmissionRaces: true }
}
