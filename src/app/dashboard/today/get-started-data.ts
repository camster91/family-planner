/**
 * Data for the parent's "Get started" card on /dashboard/today.
 *
 * A brand-new household lands on a Today board where every region is empty.
 * The card offers three first steps and ticks each one off from real
 * household data: someone invited, a chore, an event. Only yes/no flags leave
 * the server (no names, emails or titles). Scoped by the caller's
 * `family_id`; parents only, never in fridge mode (the page decides that).
 *
 * Cheap on purpose: one count and three `findFirst` id lookups, all in
 * parallel. There is no stored "dismissed" flag on the server (no suitable
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
}

export function allStepsDone(steps: GetStartedSteps): boolean {
  return steps.invited && steps.hasChore && steps.hasEvent
}

export async function loadGetStarted(
  db: PrismaClient,
  opts: { familyId: string; role: string; now?: Date }
): Promise<GetStartedSteps | null> {
  if (opts.role !== 'parent') return null
  const now = opts.now ?? new Date()
  const familyId = opts.familyId

  const [memberCount, invite, chore, event] = await Promise.all([
    db.user.count({ where: { family_id: familyId } }),
    db.familyInvite.findFirst({
      where: { family_id: familyId, accepted_at: null, expires_at: { gt: now } },
      select: { id: true },
    }),
    db.chore.findFirst({ where: { family_id: familyId }, select: { id: true } }),
    db.event.findFirst({ where: { family_id: familyId }, select: { id: true } }),
  ])

  return {
    invited: memberCount > 1 || invite !== null,
    hasChore: chore !== null,
    hasEvent: event !== null,
  }
}
