import { randomUUID } from 'node:crypto'
import {
  eventPeopleReady, orderEventPeople, resolveHouseholdPeople,
  type EventPerson, type EventPersonRef, type HouseholdPersonRow,
} from '@/lib/event-participants'
import type { D1Statement, D1Store, SqlValue } from './database'
import { d1WriteCheck } from './write-check'

type Session = Pick<D1Store, 'prepare' | 'batch'>
/** Standalone email-free profiles only: a profile mapped or linked to an
 * account is represented by that account, as on the Today board. */
const PROFILE_FILTER = `m.archived_at IS NULL AND m.erasure_user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" lm WHERE lm.member_id=m.id AND lm.family_id=m.family_id)
  AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" al WHERE al.member_id=m.id AND al.family_id=m.family_id)`
const ACCOUNT_VALID = `EXISTS (SELECT 1 FROM "User" u WHERE u.id=?4 AND u.family_id=?3)`
const PROFILE_VALID = `EXISTS (SELECT 1 FROM "HouseholdMember" m WHERE m.id=?5 AND m.family_id=?3 AND ${PROFILE_FILTER})`

/** Current household people in household order, with resolved colours. */
export async function readD1HouseholdPeople(db: Session, familyId: string): Promise<Map<string, EventPerson>> {
  const [accounts, profiles] = await db.batch<{ id: string; name: string; board_color: string | null }>([
    db.prepare(`SELECT id,name,board_color FROM "User" WHERE family_id=?1 ORDER BY created_at ASC,id ASC`).bind(familyId),
    db.prepare(`SELECT m.id,m.name,m.board_color FROM "HouseholdMember" m WHERE m.family_id=?1 AND ${PROFILE_FILTER}
      ORDER BY m.created_at ASC,m.id ASC`).bind(familyId),
  ])
  const rows: HouseholdPersonRow[] = [
    ...accounts.results.map((row) => ({ kind: 'account' as const, ...row })),
    ...profiles.results.map((row) => ({ kind: 'profile' as const, ...row })),
  ]
  return resolveHouseholdPeople(rows)
}

/** Attach current same-household people. Off, or nothing stored: an empty list. */
export async function attachD1EventParticipants<T extends { id: string }>(
  db: Session, familyId: string, events: T[],
): Promise<Array<T & { participants: EventPerson[] }>> {
  if (!eventPeopleReady() || events.length === 0) return events.map((event) => ({ ...event, participants: [] }))
  const byEvent = new Map<string, EventPersonRef[]>()
  for (let offset = 0; offset < events.length; offset += 80) {
    const ids = events.slice(offset, offset + 80).map((event) => event.id)
    const rows = await db.prepare(`SELECT event_id,user_id,member_id FROM "EventParticipant"
      WHERE family_id=?1 AND event_id IN (${ids.map((_, index) => `?${index + 2}`).join(',')}) ORDER BY created_at ASC,id ASC`)
      .bind(familyId, ...ids).all<{ event_id: string; user_id: string | null; member_id: string | null }>()
    for (const row of rows.results) {
      const ref: EventPersonRef = row.user_id !== null ? { kind: 'account', id: row.user_id } : { kind: 'profile', id: row.member_id! }
      byEvent.set(row.event_id, [...(byEvent.get(row.event_id) ?? []), ref])
    }
  }
  const people = byEvent.size ? await readD1HouseholdPeople(db, familyId) : new Map<string, EventPerson>()
  return events.map((event) => ({
    ...event,
    // A stored person who left the household or was archived is not shown.
    participants: orderEventPeople(byEvent.get(event.id) ?? [], people),
  }))
}

/**
 * Insert statements for a new event, for one atomic batch. Each insert
 * re-proves household membership in SQL and is followed by a write check, so
 * a person removed between the caller's read and this batch aborts the whole
 * batch (a retryable write conflict) instead of being stored or dropped.
 */
export function d1EventParticipantInserts(
  db: Session, eventId: string, familyId: string, refs: ReadonlyArray<EventPersonRef>, now: number,
): D1Statement[] {
  const statements: D1Statement[] = []
  for (const ref of refs) {
    const account = ref.kind === 'account'
    statements.push(db.prepare(`INSERT INTO "EventParticipant" (id,event_id,family_id,user_id,member_id,created_at)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE ${account ? ACCOUNT_VALID : PROFILE_VALID}`)
      .bind(randomUUID(), eventId, familyId, account ? ref.id : null, account ? null : ref.id, now))
    statements.push(d1WriteCheck(db, `(SELECT count(*) FROM "EventParticipant" WHERE event_id=?1 AND family_id=?2
      AND ${account ? 'user_id' : 'member_id'}=?3)=1`, [eventId, familyId, ref.id]))
  }
  return statements
}

/**
 * SQL for an absolute replacement inside the event PATCH batch. `bind` appends
 * to the batch's shared value list; `family` and `event` are the placeholders
 * already bound to the household and event ids. `valid` is true only when
 * every requested person is a current member, and is part of the PATCH guard,
 * so an invalid list changes nothing at all.
 */
export function d1EventParticipantReplacement(refs: ReadonlyArray<EventPersonRef>, bind: (value: SqlValue) => string, family: string, event: string) {
  const accounts = refs.filter((ref) => ref.kind === 'account').map((ref) => bind(ref.id))
  const profiles = refs.filter((ref) => ref.kind === 'profile').map((ref) => bind(ref.id))
  const accountCount = accounts.length
    ? `(SELECT count(*) FROM "User" u WHERE u.family_id=${family} AND u.id IN (${accounts.join(',')}))` : '0'
  const profileCount = profiles.length
    ? `(SELECT count(*) FROM "HouseholdMember" m WHERE m.family_id=${family} AND m.id IN (${profiles.join(',')}) AND ${PROFILE_FILTER})` : '0'
  const valid = `(${accountCount}=${accounts.length} AND ${profileCount}=${profiles.length})`
  const now = bind(Date.now())
  return {
    valid,
    remove: (guard: string) => `DELETE FROM "EventParticipant" WHERE event_id=${event} AND family_id=${family} AND ${guard}`,
    inserts: (guard: string) => [
      ...accounts.map((id) => `INSERT INTO "EventParticipant" (id,event_id,family_id,user_id,member_id,created_at)
        SELECT lower(hex(randomblob(16))),${event},${family},${id},NULL,${now} WHERE ${guard}`),
      ...profiles.map((id) => `INSERT INTO "EventParticipant" (id,event_id,family_id,user_id,member_id,created_at)
        SELECT lower(hex(randomblob(16))),${event},${family},NULL,${id},${now} WHERE ${guard}`),
    ],
  }
}
