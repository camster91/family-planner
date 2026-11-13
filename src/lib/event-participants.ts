/**
 * People an event is for (#124 follow-up). Shared, storage-neutral contract.
 *
 * A participant is a household account or an email-free profile of the same
 * household as the event. The whole capability is default-off: writers refuse
 * a participant list and readers return none unless FAMILY_EVENT_PEOPLE_READY
 * is "1", so an older client or a rolled-back deployment sees the event shape
 * it always saw plus an empty, additive `participants` array.
 */
import { MEMBER_COLOR_KEYS, resolveMemberColors, type MemberColorKey } from './member-colors'

export const EVENT_PEOPLE_READY_ENV = 'FAMILY_EVENT_PEOPLE_READY'
export const eventPeopleReady = () => process.env[EVENT_PEOPLE_READY_ENV] === '1'

export const EVENT_PEOPLE_MAX = 12
export const EVENT_PEOPLE_UNSUPPORTED_CODE = 'EVENT_PEOPLE_UNSUPPORTED'
export const EVENT_PEOPLE_INVALID_CODE = 'EVENT_PEOPLE_INVALID'
export const EVENT_PEOPLE_UNSUPPORTED = {
  status: 409,
  body: { error: 'Choosing people for an event is not available on this server.', code: EVENT_PEOPLE_UNSUPPORTED_CODE },
} as const
export const EVENT_PEOPLE_INVALID = {
  status: 400,
  body: { error: 'Choose people from this household.', code: EVENT_PEOPLE_INVALID_CODE },
} as const

export type EventPersonKind = 'account' | 'profile'
export type EventPersonRef = { kind: EventPersonKind; id: string }
export type EventPerson = EventPersonRef & { name: string; color: MemberColorKey }
/** A household person in household order, before colours are resolved. */
export type HouseholdPersonRow = EventPersonRef & { name: string; board_color: string | null }

export const eventPersonKey = (ref: EventPersonRef) => `${ref.kind}:${ref.id}`

/**
 * Household order is accounts, then standalone profiles, each by created_at
 * then id: the order the Today board lists people in. Colours follow the same
 * rule as the board (src/lib/member-colors.ts), so a person keeps one colour
 * everywhere.
 */
export function resolveHouseholdPeople(rows: ReadonlyArray<HouseholdPersonRow>): Map<string, EventPerson> {
  const colors = resolveMemberColors(rows.map((row) => ({ id: eventPersonKey(row), board_color: row.board_color })))
  const out = new Map<string, EventPerson>()
  for (const row of rows) {
    const key = eventPersonKey(row)
    out.set(key, { kind: row.kind, id: row.id, name: row.name, color: colors.get(key) ?? MEMBER_COLOR_KEYS[0] })
  }
  return out
}

/** Requested people that are not current members of the household. */
export function unknownEventPeople(refs: ReadonlyArray<EventPersonRef>, people: ReadonlyMap<string, unknown>) {
  return refs.filter((ref) => !people.has(eventPersonKey(ref)))
}

/**
 * The people to show for stored refs: current household members only, in
 * household order (not the order they were chosen), so an event lists its
 * people the same way on every surface and after every edit.
 */
export function orderEventPeople(refs: ReadonlyArray<EventPersonRef>, people: ReadonlyMap<string, EventPerson>): EventPerson[] {
  const wanted = new Set(refs.map(eventPersonKey))
  return [...people.entries()].filter(([key]) => wanted.has(key)).map(([, person]) => person)
}
