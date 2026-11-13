import { mutateD1Event } from '../../../src/lib/cloudflare/event-mutations'
import { updateD1PersonEvent } from '../../../src/lib/cloudflare/event-update'
import { readD1CalendarEvents } from '../../../src/lib/cloudflare/calendar-events'
import { readD1HouseholdPeople } from '../../../src/lib/cloudflare/event-participants'
import { CALENDAR_OWNER_PROTOCOL } from '../../../src/lib/calendar-read-owner'
import { EVENT_PEOPLE_READY_ENV } from '../../../src/lib/event-participants'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
type People = Array<{ kind: string; id: string; name: string; color: string }>
/** People on an event: real workerd/D1, two households, capability on and off. */
export async function testEventParticipants(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('people-a','Fixture','people-a'),('people-b','Other','people-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role,board_color,created_at) VALUES
    ('people-parent','people-parent@example.test','Parent','people-a','parent','green',1),
    ('people-teen','people-teen@example.test','Teen','people-a','teen',NULL,2),
    ('people-foreign','people-foreign@example.test','PRIVATE FOREIGN NAME','people-b','parent',NULL,3)`).run()
  await db.prepare(`INSERT INTO "HouseholdMember" (id,family_id,name,role,created_at) VALUES
    ('people-kid','people-a','Kid','child',4),
    ('people-archived','people-a','Archived','child',5),
    ('people-foreign-kid','people-b','PRIVATE FOREIGN KID','child',6)`).run()
  await db.prepare(`UPDATE "HouseholdMember" SET archived_at=10 WHERE id='people-archived'`).run()
  const actor = { userId: 'people-parent', familyId: 'people-a', role: 'parent', generation: 0, name: 'Parent' }
  const editor = { userId: 'people-parent', familyId: 'people-a', tokenVersion: 0 }
  const owner = { protocol: CALENDAR_OWNER_PROTOCOL, actorId: 'people-parent', familyId: 'people-a', role: 'parent', generation: 0 } as Parameters<typeof readD1CalendarEvents>[0]
  const base = { title: 'Dentist', start_time: '2026-11-20T14:00:00Z', end_time: '2026-11-20T15:00:00Z', event_type: 'appointment' as const }
  const create = (participants: Array<{ kind: 'account' | 'profile'; id: string }> | undefined, key: string | null = null) =>
    mutateD1Event(actor, { kind: 'create', input: { ...base, participants } }, key, { database: db })
  const stored = async (eventId: string) => (await db.prepare(`SELECT user_id,member_id FROM "EventParticipant" WHERE event_id=?1 ORDER BY created_at,id`).bind(eventId).all<{ user_id: string | null; member_id: string | null }>()).results
  const count = async (table: string) => (await db.prepare(`SELECT count(*) AS n FROM "${table}" WHERE family_id='people-a'`).first<{ n: number }>())!.n

  // Capability off: a people list is refused and nothing is written; an
  // ordinary create still works and reads return an empty additive list.
  process.env[EVENT_PEOPLE_READY_ENV] = '0'
  const off = await create([{ kind: 'account', id: 'people-teen' }])
  check(off.status === 409 && (off.body as { code: string }).code === 'EVENT_PEOPLE_UNSUPPORTED' && await count('Event') === 0, 'off: people list refused before any write')
  const plain = await create(undefined)
  const plainId = (plain.body as { event: { id: string; participants: People } }).event.id
  check(plain.status === 200 && (plain.body as { event: { participants: People } }).event.participants.length === 0, 'off: ordinary create unchanged')
  check((await updateD1PersonEvent(editor, { eventId: plainId, participants: [] }, db)).status === 409, 'off: people PATCH refused')
  check((await readD1CalendarEvents(owner, { id: plainId }, db))[0].participants.length === 0, 'off: read returns no people')

  process.env[EVENT_PEOPLE_READY_ENV] = '1'
  const people = await readD1HouseholdPeople(db.withSession('first-primary'), 'people-a')
  check([...people.keys()].join() === 'account:people-parent,account:people-teen,profile:people-kid', 'household people: accounts then standalone profiles, no archived or foreign')
  check(people.get('account:people-parent')!.color === 'green' && new Set([...people.values()].map(p => p.color)).size === 3, 'chosen colour kept; fallbacks distinct')

  // Create with an account and a profile; exact retry shares one receipt.
  const refs = [{ kind: 'profile' as const, id: 'people-kid' }, { kind: 'account' as const, id: 'people-teen' }]
  const made = await Promise.all(Array.from({ length: 4 }, () => create(refs, 'people-create-key')))
  const event = (made[0].body as { event: { id: string; participants: People } }).event
  check(made.every(r => r.status === 200 && JSON.stringify(r.body) === JSON.stringify(made[0].body)) && made.filter(r => r.created).length === 1, 'create retries share one result')
  check(event.participants.map(p => `${p.kind}:${p.id}:${p.name}`).join() === 'account:people-teen:Teen,profile:people-kid:Kid', 'create response lists chosen people in household order')
  check((await stored(event.id)).length === 2, 'two participant rows, once')

  // Foreign-household, archived and unknown people are refused whole.
  const before = await count('Event')
  for (const bad of [{ kind: 'account' as const, id: 'people-foreign' }, { kind: 'profile' as const, id: 'people-foreign-kid' },
    { kind: 'profile' as const, id: 'people-archived' }, { kind: 'account' as const, id: 'people-missing' }]) {
    const refused = await create([{ kind: 'account', id: 'people-teen' }, bad])
    check(refused.status === 400 && (refused.body as { code: string }).code === 'EVENT_PEOPLE_INVALID' && !JSON.stringify(refused).includes('PRIVATE'), `create refuses ${bad.id}`)
  }
  check(await count('Event') === before && await count('EventParticipant') === 2, 'refused creates write nothing')

  // The database itself refuses a foreign account or profile and an edit of identity.
  for (const sql of [
    `INSERT INTO "EventParticipant" (id,event_id,family_id,user_id) VALUES ('x1','${event.id}','people-a','people-foreign')`,
    `INSERT INTO "EventParticipant" (id,event_id,family_id,member_id) VALUES ('x2','${event.id}','people-a','people-foreign-kid')`,
    `INSERT INTO "EventParticipant" (id,event_id,family_id) VALUES ('x3','${event.id}','people-a')`,
    `INSERT INTO "EventParticipant" (id,event_id,family_id,user_id,member_id) VALUES ('x4','${event.id}','people-a','people-parent','people-kid')`,
    `UPDATE "EventParticipant" SET user_id='people-parent',member_id=NULL WHERE event_id='${event.id}' AND member_id='people-kid'`,
  ]) {
    let refused = false
    try { await db.prepare(sql).run() } catch { refused = true }
    check(refused, `database guard: ${sql.slice(0, 60)}`)
  }

  // PATCH replaces the list absolutely; omitted leaves it; [] clears it.
  const patch = (input: Omit<Parameters<typeof updateD1PersonEvent>[1], 'eventId'>) => updateD1PersonEvent(editor, { eventId: event.id, ...input }, db)
  const kept = await patch({ title: 'Dentist (moved)' })
  check(kept.status === 200 && (kept.body as { event: { participants: People } }).event.participants.length === 2, 'PATCH without people leaves them')
  const replaced = await patch({ participants: [{ kind: 'account', id: 'people-parent' }] })
  check(replaced.status === 200 && (replaced.body as { event: { participants: People } }).event.participants.map(p => p.id).join() === 'people-parent'
    && (await stored(event.id)).map(r => r.user_id).join() === 'people-parent', 'PATCH replaces the list')
  const invalid = await patch({ title: 'Must not save', participants: [{ kind: 'account', id: 'people-teen' }, { kind: 'account', id: 'people-foreign' }] })
  const row = await db.prepare(`SELECT title FROM "Event" WHERE id=?1`).bind(event.id).first<{ title: string }>()
  check(invalid.status === 400 && (invalid.body as { code: string }).code === 'EVENT_PEOPLE_INVALID' && row!.title === 'Dentist (moved)'
    && (await stored(event.id)).map(r => r.user_id).join() === 'people-parent', 'invalid people hold the whole PATCH')
  check((await updateD1PersonEvent({ ...editor, userId: 'people-teen' }, { eventId: event.id, participants: [] }, db)).status === 403
    && (await stored(event.id)).length === 1, 'teen cannot change people')
  check((await updateD1PersonEvent({ userId: 'people-foreign', familyId: 'people-b', tokenVersion: 0 }, { eventId: event.id, participants: [] }, db)).status === 404
    && (await stored(event.id)).length === 1, 'other household cannot reach the event')
  const both = await patch({ participants: [{ kind: 'account', id: 'people-teen' }, { kind: 'profile', id: 'people-kid' }] })
  check(both.status === 200 && (await stored(event.id)).length === 2, 'PATCH sets several people')

  // Reads show current members only: a person who leaves or is archived drops out.
  const read = async () => (await readD1CalendarEvents(owner, { id: event.id }, db))[0].participants as People
  check((await read()).map(p => p.id).join() === 'people-teen,people-kid', 'read lists people')
  await db.prepare(`UPDATE "User" SET family_id=NULL WHERE id='people-teen'`).run()
  await db.prepare(`UPDATE "HouseholdMember" SET archived_at=20 WHERE id='people-kid'`).run()
  check((await read()).length === 0, 'departed account and archived profile are not shown')
  await db.prepare(`UPDATE "User" SET family_id='people-a' WHERE id='people-teen'`).run()
  check((await patch({ participants: [] })).status === 200 && (await stored(event.id)).length === 0, 'empty list clears people')

  // Deleting the account or the event removes its participant rows.
  await patch({ participants: [{ kind: 'account', id: 'people-teen' }] })
  await db.prepare(`DELETE FROM "User" WHERE id='people-teen'`).run()
  check((await stored(event.id)).length === 0, 'account deletion cascades')
  await patch({ participants: [{ kind: 'account', id: 'people-parent' }] })
  check((await mutateD1Event(actor, { kind: 'delete', eventId: event.id }, null, { database: db })).status === 200 && await count('EventParticipant') === 0, 'event deletion cascades')
  delete process.env[EVENT_PEOPLE_READY_ENV]
  return { offRefused: true, householdOrder: true, createAtomic: true, foreignRefused: true, databaseGuards: true, patchAbsolute: true, invalidHoldsPatch: true, roleScoped: true, currentMembersOnly: true, cascades: true }
}
