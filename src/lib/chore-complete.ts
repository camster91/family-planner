/**
 * Completing a chore: the one write behind POST /api/chores/complete (person
 * session) and POST /api/device/chores/:id/complete (paired tablet, #274).
 * Route handlers stay thin so the business rules are not forked (ADR-0006,
 * SHARED_DEVICE.md §12).
 *
 * Rules (unchanged from the person route):
 * - Complete only from `pending`, `in_progress` or `overdue` (#185). A chore
 *   that is already `completed` or `verified` is a no-op, so a repeated tap is
 *   idempotent and a verified chore can never be reset to `completed` (which
 *   would let the next verify award XP again). No XP is awarded here: a
 *   parent's verify is the only path that awards XP, so a child's tick waits
 *   for a parent's check.
 * - The status change, the activity row and the recurring successor commit in
 *   one transaction. After it commits, the household's beta usage count
 *   `chore_completed` goes up (#287; a no-op unless the household opted in).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { expandSeriesInTx, nextDueDate as nextDueDateForCompletion } from '@/lib/recurringChores'
import { toDateOnlyUTC } from '@/lib/dates'
import { recordBetaMetric } from '@/lib/beta-metrics'

type Db = Pick<PrismaClient, 'chore' | '$transaction' | '$executeRaw'>

/** The chore fields the completion reads. */
export const COMPLETABLE_CHORE_SELECT = {
  id: true,
  family_id: true,
  title: true,
  description: true,
  points: true,
  assigned_to: true,
  due_date: true,
  status: true,
  frequency: true,
  weekly_days: true,
  difficulty: true,
  created_by: true,
  photo_url: true,
  recurrence_id: true,
  icon: true,
  routine: true,
  routine_order: true,
} as const

export type CompletableChore = Prisma.ChoreGetPayload<{ select: typeof COMPLETABLE_CHORE_SELECT }>

/** Load a chore of `familyId` for completion; a foreign and a missing id are both null. */
export async function findHouseholdChore(
  db: Pick<PrismaClient, 'chore'>,
  choreId: string,
  familyId: string
): Promise<CompletableChore | null> {
  return db.chore.findFirst({ where: { id: choreId, family_id: familyId }, select: COMPLETABLE_CHORE_SELECT })
}

/**
 * Mark `chore` completed and top up its recurring series. `actor` is the
 * household member the activity row is attributed to (the signed-in person,
 * or the member a shared tablet picked with "Who's this?", SHARED_DEVICE.md
 * O-5). Returns false when the chore was not in a completable state.
 */
export async function completeChore(
  db: Db,
  chore: CompletableChore,
  actor: { id: string; name: string },
  options: { photoValue?: string | null; now?: Date } = {}
): Promise<boolean> {
  const now = options.now ?? new Date()
  const photoValue = options.photoValue ?? null
  const completed = await db.$transaction(async (tx) => {
    const updateResult = await tx.chore.updateMany({
      where: { id: chore.id, status: { in: ['pending', 'in_progress', 'overdue'] } },
      data: {
        status: 'completed',
        completed_at: now,
        ...(photoValue ? { photo_url: photoValue, photo_verified: false } : {}),
      },
    })
    if (updateResult.count === 0) return false

    await tx.activity.create({
      data: {
        family_id: chore.family_id,
        user_id: actor.id,
        type: 'chore_completed',
        title: `${actor.name} completed "${chore.title}"`,
      },
    })

    // Recurring chores: make sure the next occurrences exist. Any chore in a
    // series (the template or one of its generated copies, which are stored
    // as 'once') tops the series up with the same logic as the create route
    // and the cron; the template's own frequency decides whether the series
    // still repeats. Idempotent: the window/horizon rules and the
    // (recurrence_id, due_date) unique key mean a repeat call adds nothing.
    // A legacy recurring row (no series) keeps its single successor.
    if (chore.recurrence_id) {
      await expandSeriesInTx(tx, chore.recurrence_id, chore.family_id, now)
    } else if (chore.frequency && chore.frequency !== 'once') {
      const nextDueDate = nextDueDateForCompletion(new Date(chore.due_date), chore.frequency, chore.weekly_days)
      if (nextDueDate) {
        const successor = await tx.chore.create({
          data: {
            family_id: chore.family_id,
            title: chore.title,
            description: chore.description,
            points: chore.points,
            assigned_to: chore.assigned_to,
            due_date: nextDueDate,
            status: 'pending',
            frequency: 'once',
            difficulty: chore.difficulty,
            created_by: chore.created_by,
            icon: chore.icon,
            routine: chore.routine,
            routine_order: chore.routine_order,
          },
        })
        // Remember exactly which row this completion created, so Undo
        // removes that row and nothing else (#268).
        await tx.chore.update({ where: { id: chore.id }, data: { successor_id: successor.id } })
      }
    }
    return true
  })
  // Beta usage counts (#287): after the commit, person and tablet alike; never throws.
  if (completed) await recordBetaMetric(db, chore.family_id, 'chore_completed', { now })
  return completed
}

/**
 * The calendar days that are "today" somewhere right now: from UTC−12 to
 * UTC+14, as `YYYY-MM-DD`. A shared tablet's zone is not known to the server,
 * so a chore counts as due today when its date-only due day is one of these
 * (at most three days, usually two). Anything older or later is refused.
 */
export function daysThatAreTodaySomewhere(now: Date): Set<string> {
  const days = new Set<string>()
  for (const offsetHours of [-12, 0, 14]) {
    days.add(toDateOnlyUTC(new Date(now.getTime() + offsetHours * 60 * 60 * 1000)))
  }
  return days
}

export function isDueTodaySomewhere(dueDate: Date, now: Date): boolean {
  return daysThatAreTodaySomewhere(now).has(toDateOnlyUTC(dueDate))
}
