/**
 * Household people for the person chips and the "Everyone · Mia" filter on
 * server-rendered screens (calendar, chores). The same reader on both
 * backends as `GET /api/events/people`: accounts and standalone email-free
 * profiles of ONE household, in household order, with the colour each has
 * everywhere else. Identity key, name and colour only; never an email, role,
 * age or avatar. A failed read is an empty list (no filter), never an error
 * page: who an item is for is helpful context, not the screen itself.
 */
import { prisma } from './prisma'
import { storageBackend } from './storage-backend'
import { eventPersonKey } from './event-participants'
import type { PersonOption } from './person-display'
import { logRouteWarning } from './api-error'

export async function readHouseholdPeopleOptions(familyId: string, screen: string): Promise<PersonOption[]> {
  try {
    const people =
      storageBackend() === 'd1'
        ? await (async () => {
            const [{ getD1Database }, { readD1HouseholdPeople }] = await Promise.all([
              import('./cloudflare/database'),
              import('./cloudflare/event-participants'),
            ])
            return readD1HouseholdPeople((await getD1Database()).withSession('first-primary'), familyId)
          })()
        : await (await import('./event-participants-db')).readHouseholdPeople(prisma!, familyId)
    return [...people.values()].map((person) => ({
      key: eventPersonKey(person),
      name: person.name,
      color: person.color,
    }))
  } catch (error) {
    logRouteWarning(`${screen} household people`, error, undefined)
    return []
  }
}
