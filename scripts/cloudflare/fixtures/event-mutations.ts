import { mutateD1Event, D1EventReceiptError } from '../../../src/lib/cloudflare/event-mutations'
import { hashIdempotentRequest } from '../../../src/lib/idempotency-hash'
import { IDEMPOTENCY_TTL_MS } from '../../../src/lib/idempotency-key'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refuses(operation: () => unknown, code: string) {
  try { await operation() } catch (cause) { check(cause instanceof D1EventReceiptError && cause.code === code, code); return }
  throw new Error('Receipt was not refused')
}
export async function testEventMutations(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('mutation-a','Fixture','mutation-a'),('mutation-b','Other','mutation-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('mutation-parent','mutation-parent@example.test','Parent','mutation-a','parent'),
    ('mutation-teen','mutation-teen@example.test','Teen','mutation-a','teen'),
    ('mutation-child','mutation-child@example.test','Child','mutation-a','child'),
    ('mutation-other','mutation-other@example.test','Other','mutation-b','parent')`).run()
  const actor = { userId: 'mutation-parent', familyId: 'mutation-a', role: 'parent', generation: 0, name: 'Parent' }
  const now = new Date('2026-10-28T12:00:00Z'), options = { now, database: db }
  const input = { title: 'Family outing', start_time: '2026-10-29T12:00:00Z', end_time: '2026-10-29T13:00:00Z', event_type: 'family' as const }
  const create = { kind: 'create' as const, input }
  const key = 'event-create-race-fixture'
  const created = await Promise.all(Array.from({ length: 8 }, () => mutateD1Event(actor, create, key, options)))
  const body = created[0].body as { event: { id: string; title: string; schedule_generation: string; start_time: string } }
  const id = body.event.id
  check(created.every(r => r.status === 200 && JSON.stringify(r.body) === JSON.stringify(body)) && created.filter(r => r.replayed).length === 7 && created.filter(r => r.created).length === 1, 'eight create retries share one exact committed response')
  check((await db.prepare(`SELECT count(*) AS n FROM "Event" WHERE family_id='mutation-a'`).first<{ n: number }>())!.n === 1, 'one event')
  check((await db.prepare(`SELECT count(*) AS n FROM "Activity" WHERE family_id='mutation-a'`).first<{ n: number }>())!.n === 1, 'one activity')
  const stored = await db.prepare(`SELECT * FROM "Event" WHERE id=?1`).bind(id).first<{ schedule_generation: string; start_time: number }>()
  check(stored?.schedule_generation === body.event.schedule_generation && stored.start_time === Date.parse(body.event.start_time), 'receipt matches stored identity and instant')
  await refuses(() => mutateD1Event(actor, { ...create, input: { ...input, title: 'Changed input' } }, key, options), 'IDEMPOTENCY_KEY_REUSED')
  await refuses(() => mutateD1Event(actor, { kind: 'delete', eventId: id }, key, options), 'IDEMPOTENCY_KEY_REUSED')
  await db.prepare(`UPDATE "Event" SET title='Later edit' WHERE id=?1`).bind(id).run()
  check(JSON.stringify((await mutateD1Event(actor, create, key, options)).body) === JSON.stringify(body), 'replay does not reapply old event fields')
  const deletion = { kind: 'delete' as const, eventId: id }
  const removed = await Promise.all(Array.from({ length: 8 }, () => mutateD1Event(actor, deletion, 'event-delete-race-fixture', options)))
  check(removed.every(r => r.status === 200) && removed.filter(r => r.replayed).length === 7 && !await db.prepare('SELECT id FROM "Event" WHERE id=?1').bind(id).first(), 'delete retries complete once and replay missing target')
  check((await mutateD1Event(actor, create, key, options)).replayed && !await db.prepare('SELECT id FROM "Event" WHERE id=?1').bind(id).first(), 'create replay cannot resurrect a later deleted event')
  const teen = { ...actor, userId: 'mutation-teen', role: 'teen', name: 'Teen' }
  const child = { ...actor, userId: 'mutation-child', role: 'child', name: 'Child' }
  const teenCreated = await mutateD1Event(teen, create, null, options)
  check(teenCreated.status === 200 && (await mutateD1Event(child, create, null, options)).status === 200, 'existing teen and child create rights')
  const teenId = (teenCreated.body as typeof body).event.id
  check((await mutateD1Event(teen, { kind: 'delete', eventId: teenId }, null, options)).status === 403, 'teen deletion refused')
  const foreign = await mutateD1Event({ ...actor, userId: 'mutation-other', familyId: 'mutation-b' }, create, null, options)
  check((await mutateD1Event(actor, { kind: 'delete', eventId: (foreign.body as typeof body).event.id }, null, options)).status === 403, 'foreign deletion refused')
  await db.prepare(`INSERT INTO "CalendarSubscription" (id,family_id,created_by,name,url_enc) VALUES ('mutation-source','mutation-a','mutation-parent','Fixture','opaque-fixture')`).run()
  await db.prepare(`UPDATE "Event" SET source_subscription_id='mutation-source' WHERE id=?1`).bind(teenId).run()
  check((await mutateD1Event(actor, { kind: 'delete', eventId: teenId }, 'event-delete-imported-fixture', options)).status === 409, 'imported deletion refused')
  await db.prepare(`UPDATE "Event" SET source_subscription_id=NULL WHERE id=?1`).bind(teenId).run()
  await db.prepare(`INSERT INTO "EventPreparation" (id,family_id,event_id,reviewed_event_source) VALUES ('mutation-prep','mutation-a',?1,?2)`).bind(teenId, 'a'.repeat(64)).run()
  check((await mutateD1Event(actor, { kind: 'delete', eventId: teenId }, null, options)).status === 200 && !await db.prepare(`SELECT id FROM "EventPreparation" WHERE id='mutation-prep'`).first(), 'canonical preparation cascade')
  const hash = hashIdempotentRequest('event.create', input), scope = 'user:mutation-parent'
  await db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at) VALUES
    ('mutation-pending',?1,'event-pending-fixture','mutation-a','mutation-parent','event.create',?2,?3,?4),
    ('mutation-abandoned',?1,'event-abandoned-fixture','mutation-a','mutation-parent','event.create',?2,?5,?4)`).bind(scope, hash, now.getTime(), now.getTime() + IDEMPOTENCY_TTL_MS, now.getTime() - 31000).run()
  await refuses(() => mutateD1Event(actor, create, 'event-pending-fixture', options), 'IDEMPOTENCY_IN_PROGRESS')
  check((await mutateD1Event(actor, create, 'event-abandoned-fixture', options)).status === 200, 'abandoned claim recovers')
  const recovered = await db.prepare(`SELECT id,expires_at FROM "IdempotencyRecord" WHERE key='event-abandoned-fixture'`).first<{ id: string; expires_at: number }>()
  check(recovered?.id === 'mutation-abandoned' && recovered.expires_at === now.getTime() + IDEMPOTENCY_TTL_MS, 'reclaimed identity and retention preserved')
  const later = { now: new Date(now.getTime() + IDEMPOTENCY_TTL_MS + 1), database: db }
  check(!(await mutateD1Event(actor, { ...create, input: { ...input, title: 'Expired replacement' } }, key, later)).replayed, 'expired key accepts a new action body')
  await db.prepare(`CREATE TRIGGER fixture_mutation_receipt_abort BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='event-rollback-fixture' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
  const count = async () => (await db.prepare(`SELECT (SELECT count(*) FROM "Event") AS events,(SELECT count(*) FROM "Activity") AS activity`).first<{ events: number; activity: number }>())!
  const before = await count()
  let aborted = false
  try { await mutateD1Event(actor, create, 'event-rollback-fixture', options) } catch { aborted = true }
  check(aborted && JSON.stringify(await count()) === JSON.stringify(before), 'receipt failure rolls back event and activity')
  await db.prepare('DROP TRIGGER fixture_mutation_receipt_abort').run()
  const deleteCandidate = await mutateD1Event(actor, create, null, options)
  const deleteId = (deleteCandidate.body as typeof body).event.id
  await db.prepare(`INSERT INTO "EventPreparation" (id,family_id,event_id,reviewed_event_source) VALUES ('mutation-rollback-prep','mutation-a',?1,?2)`).bind(deleteId, 'b'.repeat(64)).run()
  await db.prepare(`CREATE TRIGGER fixture_delete_receipt_abort BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='event-delete-rollback-fixture' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
  let deleteAborted = false
  try { await mutateD1Event(actor, { kind: 'delete', eventId: deleteId }, 'event-delete-rollback-fixture', options) } catch { deleteAborted = true }
  check(deleteAborted && await db.prepare('SELECT id FROM "Event" WHERE id=?1').bind(deleteId).first() && await db.prepare(`SELECT id FROM "EventPreparation" WHERE id='mutation-rollback-prep'`).first(), 'delete receipt failure restores event and cascade')
  await db.prepare('DROP TRIGGER fixture_delete_receipt_abort').run()
  await db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,created_at,expires_at)
    VALUES ('mutation-release',?1,'event-delete-release-fixture','mutation-a','mutation-parent','event.delete',?2,?3,?4)`)
    .bind(scope, hashIdempotentRequest('event.delete', { eventId: 'missing-target' }), now.getTime() - 31000, now.getTime() + IDEMPOTENCY_TTL_MS).run()
  check((await mutateD1Event(actor, { kind: 'delete', eventId: 'missing-target' }, 'event-delete-release-fixture', options)).status === 404 && !await db.prepare(`SELECT id FROM "IdempotencyRecord" WHERE id='mutation-release'`).first(), 'abandoned failed effect releases its key')
  check((await mutateD1Event(actor, create, 'event-delete-release-fixture', options)).status === 200, 'released error key can serve a corrected action')
  function racing(sql: string): D1Store { return { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const primary = db.withSession('first-primary')
    return { prepare: primary.prepare.bind(primary), async batch(statements) { await db.prepare(sql).run(); return primary.batch(statements) } }
  } } }
  const raceBefore = await count()
  check((await mutateD1Event(actor, create, 'event-revocation-race-fixture', { now, database: racing(`UPDATE "User" SET token_version=1 WHERE id='mutation-parent'`) })).status === 401 && JSON.stringify(await count()) === JSON.stringify(raceBefore), 'revocation before commit cannot create event activity or receipt')
  check(!await db.prepare(`SELECT id FROM "IdempotencyRecord" WHERE key='event-revocation-race-fixture'`).first(), 'revoked action has no receipt')
  await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='mutation-parent'`).run()
  check((await mutateD1Event(actor, { kind: 'delete', eventId: deleteId }, 'event-import-race-fixture', { now, database: racing(`UPDATE "Event" SET source_subscription_id='mutation-source' WHERE id='${deleteId}'`) })).status === 409 && await db.prepare('SELECT id FROM "Event" WHERE id=?1').bind(deleteId).first(), 'new imported source blocks in-flight deletion')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.calendar',json('false')) WHERE id='mutation-a'`).run()
  check((await mutateD1Event(actor, deletion, 'event-delete-race-fixture', options)).status === 403, 'disabled calendar blocks completed delete replay')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.calendar',json('true')) WHERE id='mutation-a'`).run()
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='mutation-parent'`).run()
  check((await mutateD1Event(actor, create, key, later)).status === 401, 'revoked completed receipt cannot disclose cached data')
  await db.prepare(`UPDATE "User" SET token_version=0,family_id='mutation-b' WHERE id='mutation-parent'`).run()
  await refuses(() => mutateD1Event({ ...actor, familyId: 'mutation-b' }, create, key, later), 'IDEMPOTENCY_KEY_REUSED')
  return { createRace: 8, deleteRace: 8, exactReplay: true, noResurrection: true, roleAndHouseholdIsolation: true, importedReadOnly: true, preparationCascade: true, pendingAndAbandoned: true, expiredReuse: true, receiptRollback: true, deleteCascadeRollback: true, errorKeyRelease: true, authorityAndSourceRaces: true, replayAuthority: true }
}
