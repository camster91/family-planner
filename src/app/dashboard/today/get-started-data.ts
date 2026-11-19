/**
 * Data for the parent's "Get started" card on /dashboard/today.
 *
 * A brand-new household lands on a Today board where every region is empty.
 * The card offers four first steps and ticks each one off from real
 * household data: someone invited, a chore, an event, a connected or
 * subscribed calendar. Only yes/no flags leave the server (no names, emails,
 * titles or calendar URLs). Scoped by the caller's `family_id`; parents only,
 * never in fridge mode (the page decides that).
 *
 * Cheap on purpose: one count and four `findFirst` id lookups (plus one for
 * the second calendar kind), all in parallel. There is no stored "dismissed" flag on the server (no suitable
 * column; no migration for this): Hide is remembered in the browser, per
 * household, by the card itself.
 */
import type { PrismaClient } from '@prisma/client'

export interface GetStartedSteps {
  /** More than one member, or an invite still waiting to be accepted. */
  invited: boolean
  /** Any chore exists for the household. */
  hasChore: boolean
  /** Any calendar event exists for the household. */
  hasEvent: boolean
  /** A two-way calendar connection or a subscribed (ICS) calendar exists. */
  hasCalendar: boolean
}

export function allStepsDone(steps: GetStartedSteps): boolean {
  return steps.invited && steps.hasChore && steps.hasEvent && steps.hasCalendar
}

/**
 * Facts behind the honest empty states on the personal Today page (any
 * role, never fridge mode): has this household ever added a chore, and does
 * it have a grocery list at all. Only two yes/no flags leave the server.
 */
export interface TodayStarts {
  /** Any chore exists for the household (done, open or old). */
  hasChore: boolean
  /** A `grocery` or `shopping` list exists (both are grocery lists, ADR-0007). */
  hasGroceryList: boolean
}

export const GROCERY_LIST_TYPES = ['grocery', 'shopping'] as const

export async function loadTodayStarts(
  db: Pick<PrismaClient, 'chore' | 'list'>,
  opts: { familyId: string }
): Promise<TodayStarts> {
  const [chore, list] = await Promise.all([
    db.chore.findFirst({ where: { family_id: opts.familyId }, select: { id: true } }),
    db.list.findFirst({
      where: { family_id: opts.familyId, type: { in: [...GROCERY_LIST_TYPES] } },
      select: { id: true },
    }),
  ])
  return { hasChore: chore !== null, hasGroceryList: list !== null }
}

export async function loadGetStarted(
  db: PrismaClient,
  opts: { familyId: string; role: string; now?: Date }
): Promise<GetStartedSteps | null> {
  if (opts.role !== 'parent') return null
  const now = opts.now ?? new Date()
  const familyId = opts.familyId

  const [memberCount, invite, chore, event, connection, subscription] = await Promise.all([
    db.user.count({ where: { family_id: familyId } }),
    db.familyInvite.findFirst({
      where: { family_id: familyId, accepted_at: null, expires_at: { gt: now } },
      select: { id: true },
    }),
    db.chore.findFirst({ where: { family_id: familyId }, select: { id: true } }),
    db.event.findFirst({ where: { family_id: familyId }, select: { id: true } }),
    db.calendarConnection.findFirst({ where: { family_id: familyId }, select: { id: true } }),
    db.calendarSubscription.findFirst({ where: { family_id: familyId }, select: { id: true } }),
  ])

  return {
    invited: memberCount > 1 || invite !== null,
    hasChore: chore !== null,
    hasEvent: event !== null,
    hasCalendar: connection !== null || subscription !== null,
  }
}
