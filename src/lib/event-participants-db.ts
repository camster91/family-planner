/**
 * People on an event: PostgreSQL/Prisma side of src/lib/event-participants.ts.
 * The D1 side is src/lib/cloudflare/event-participants.ts; both resolve the
 * same household order, colours and "current members only" rule.
 */
import type { Prisma } from '@prisma/client'
import {
  eventPeopleReady, orderEventPeople, resolveHouseholdPeople,
  type EventPerson, type EventPersonRef, type HouseholdPersonRow,
} from './event-participants'

type Db = Pick<Prisma.TransactionClient, 'user' | 'householdMember' | 'eventParticipant'>

/** Current household people in household order, with resolved colours. */
export async function readHouseholdPeople(db: Pick<Db, 'user' | 'householdMember'>, familyId: string): Promise<Map<string, EventPerson>> {
  const [accounts, profiles] = await Promise.all([
    db.user.findMany({
      where: { family_id: familyId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, board_color: true },
    }),
    // Standalone email-free profiles only: a profile mapped or linked to an
    // account is represented by that account, as on the Today board.
    db.householdMember.findMany({
      where: { family_id: familyId, archived_at: null, erasure_user_id: null, legacy_mapping: null, account_link: null },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, board_color: true },
    }),
  ])
  const rows: HouseholdPersonRow[] = [
    ...accounts.map((row) => ({ kind: 'account' as const, ...row })),
    ...profiles.map((row) => ({ kind: 'profile' as const, ...row })),
  ]
  return resolveHouseholdPeople(rows)
}

/** Attach current same-household people. Off, or nothing stored: an empty list. */
export async function projectEventParticipants<T extends { id: string }>(
  db: Db, familyId: string, events: T[],
): Promise<Array<T & { participants: EventPerson[] }>> {
  if (!eventPeopleReady() || events.length === 0) return events.map((event) => ({ ...event, participants: [] }))
  const rows = await db.eventParticipant.findMany({
    where: { family_id: familyId, event_id: { in: events.map((event) => event.id) } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { event_id: true, user_id: true, member_id: true },
  })
  const byEvent = new Map<string, EventPersonRef[]>()
  for (const row of rows) {
    const ref: EventPersonRef = row.user_id !== null ? { kind: 'account', id: row.user_id } : { kind: 'profile', id: row.member_id! }
    byEvent.set(row.event_id, [...(byEvent.get(row.event_id) ?? []), ref])
  }
  const people = rows.length ? await readHouseholdPeople(db, familyId) : new Map<string, EventPerson>()
  return events.map((event) => ({
    ...event,
    // A stored person who left the household or was archived is not shown.
    participants: orderEventPeople(byEvent.get(event.id) ?? [], people),
  }))
}

/** Replace an event's people inside the caller's transaction. Callers have
 * already proved every ref against readHouseholdPeople in that transaction. */
export async function replaceEventParticipantsInTx(
  tx: Pick<Db, 'eventParticipant'>, eventId: string, familyId: string, refs: ReadonlyArray<EventPersonRef>,
) {
  await tx.eventParticipant.deleteMany({ where: { event_id: eventId, family_id: familyId } })
  if (refs.length)
    await tx.eventParticipant.createMany({
      data: refs.map((ref) => ({
        event_id: eventId, family_id: familyId,
        user_id: ref.kind === 'account' ? ref.id : null, member_id: ref.kind === 'profile' ? ref.id : null,
      })),
    })
}
