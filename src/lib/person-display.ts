/**
 * Who an item is for, as the screens show it: a first name next to the
 * person's colour and initial. Pure helpers shared by the person chip, the
 * person filter and the screens that use them. Presentation only: no ids are
 * invented here and nothing is read from storage.
 */
import { isMemberColorKey, type MemberColorKey } from './member-colors'

/** A household person as a screen shows them. `key` is `account:<id>` or `profile:<id>`. */
export interface PersonOption {
  key: string
  name: string
  /** A palette key from src/lib/member-colors.ts; anything else draws a neutral chip. */
  color?: string | null
}

/** First word of a display name ("Avery Fixture-A" -> "Avery"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/** The first letter of a name for the chip's circle ("?" when there is none). */
export function personInitial(name: string): string {
  const first = Array.from(firstName(name))[0]
  return first ? first.toLocaleUpperCase() : '?'
}

/** The palette key when it is one this build knows; otherwise null (neutral chip). */
export function personColor(color: string | null | undefined): MemberColorKey | null {
  return isMemberColorKey(color) ? color : null
}

/**
 * Short names for a set of people: first names, unless two people share one
 * (then their full names), so "Alex" never stands for two people at once.
 */
export function shortNames(people: ReadonlyArray<Pick<PersonOption, 'key' | 'name'>>): Map<string, string> {
  const counts = new Map<string, number>()
  for (const person of people) {
    const short = firstName(person.name).toLocaleLowerCase()
    counts.set(short, (counts.get(short) ?? 0) + 1)
  }
  return new Map(
    people.map((person) => {
      const short = firstName(person.name)
      return [person.key, (counts.get(short.toLocaleLowerCase()) ?? 0) > 1 ? person.name.trim() : short]
    }),
  )
}

/** The key a chore is for: its account assignee or its email-free profile. */
export function choreSubjectKey(chore: {
  assigned_to?: string | null
  subject?: { kind: string; memberId?: string; accountId?: string } | null
}): string | null {
  if (chore.subject?.kind === 'profile' && chore.subject.memberId) return `profile:${chore.subject.memberId}`
  if (chore.subject?.kind === 'account' && chore.subject.accountId) return `account:${chore.subject.accountId}`
  return chore.assigned_to ? `account:${chore.assigned_to}` : null
}

/** "all", or one person's key. */
export type PersonFilterValue = 'all' | string

/**
 * Whether an item for `keys` shows under the chosen filter. "Everyone" shows
 * all items. One person shows only the items that are for them, so an item
 * for nobody in particular is hidden while a person is chosen.
 */
export function matchesPerson(keys: ReadonlyArray<string>, value: PersonFilterValue): boolean {
  return value === 'all' || keys.includes(value)
}
