import { prisma } from '@/lib/prisma'
import type { ChoreFrequency } from '@/types'

const FREQUENCY_CONFIG: Record<Exclude<ChoreFrequency, 'once'>, { occurrences: number; unit: 'day' | 'week' | 'month'; amount: number }> = {
  daily: { occurrences: 7, unit: 'day', amount: 1 },
  weekly: { occurrences: 4, unit: 'day', amount: 7 },
  monthly: { occurrences: 3, unit: 'day', amount: 30 },
}

/**
 * Next due date for one interval after `from`.
 *
 * Exported so the completion path in `/api/chores/complete` uses the SAME rule.
 * Previously the expander advanced monthly by `setDate(+30)` while completion
 * advanced by `setMonth(+1)`; across a month boundary those disagree, so the
 * two paths produced different dates for the same chore (#184).
 */
export function nextDueDate(from: Date, frequency: string): Date | null {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)

  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1)
      return d
    case 'weekly':
      d.setDate(d.getDate() + 7)
      return d
    case 'monthly':
      // Calendar month, not a fixed 30 days. `setMonth` also handles the
      // short-month rollover (Jan 31 -> Feb 28/29) the same way everywhere.
      d.setMonth(d.getMonth() + 1)
      return d
    default:
      return null
  }
}

/**
 * Given a recurring chore, generate and insert future occurrences with
 * status='pending'.
 *
 * Idempotency (#184): the previous version `createMany`'d N rows unconditionally
 * and gave every generated row the template's `frequency`. Because the cron then
 * re-selected every non-`once` chore — including the rows that expansion had
 * just created — each run multiplied the set again.
 *
 * Two changes close that:
 *
 *   1. Generated rows are inserted with `frequency: 'once'`. Only the template
 *      the user created carries a recurrence, so the cron can never expand a
 *      generated row.
 *   2. A due date is skipped when a chore with the same
 *      (family_id, title, assigned_to, due_date) already exists. Running the
 *      expander twice produces the same set, not a doubled one.
 *
 * Deletion of a template does not remove its generated occurrences, so a
 * user-deleted series is not silently resurrected by excluding existing dates
 * from re-insertion.
 */
export async function expandRecurringChores(
  chore: { id: string; frequency: string; assigned_to: string; created_by: string },
  familyId: string
): Promise<number> {
  if (chore.frequency === 'once') return 0

  const config = FREQUENCY_CONFIG[chore.frequency as Exclude<ChoreFrequency, 'once'>]
  if (!config) return 0

  const originalChore = await prisma!.chore.findUnique({
    where: { id: chore.id },
    select: {
      title: true,
      description: true,
      points: true,
      difficulty: true,
      family_id: true,
      assigned_to: true,
      created_by: true,
      due_date: true,
    },
  })

  if (!originalChore) return 0

  const baseDueDate = new Date(originalChore.due_date)

  // Build the candidate dates this template implies.
  const candidates: Date[] = []
  for (let i = 1; i <= config.occurrences; i++) {
    const dueDate = new Date(baseDueDate)
    dueDate.setDate(dueDate.getDate() + config.amount * i)
    dueDate.setHours(0, 0, 0, 0)
    candidates.push(dueDate)
  }

  if (candidates.length === 0) return 0

  // Ask which of those dates already exist for this (family, title, assignee).
  // One query, then filter — cheaper and simpler than a per-date lookup.
  const existing = await prisma!.chore.findMany({
    where: {
      family_id: familyId,
      title: originalChore.title,
      assigned_to: originalChore.assigned_to,
      due_date: { in: candidates },
    },
    select: { due_date: true },
  })
  const existingKeys = new Set(existing.map((c) => c.due_date.getTime()))

  const occurrences = candidates
    .filter((d) => !existingKeys.has(d.getTime()))
    .map((due_date) => ({
      family_id: familyId,
      title: originalChore.title,
      description: originalChore.description,
      points: originalChore.points,
      difficulty: originalChore.difficulty,
      // Deliberately NOT the template's frequency. A generated occurrence is a
      // one-off; only the template recurs. This is what stops the cron from
      // expanding the output of a previous expansion.
      frequency: 'once',
      assigned_to: originalChore.assigned_to,
      created_by: originalChore.created_by,
      due_date,
      status: 'pending',
    }))

  if (occurrences.length === 0) return 0

  await prisma!.chore.createMany({ data: occurrences })
  return occurrences.length
}

/**
 * Expand recurring TEMPLATES for a family. Used by the daily cron.
 *
 * Only expands rows whose frequency is not `once` — which, after the change
 * above, means only user-created templates. Generated occurrences are `once`
 * and are therefore never re-expanded, so repeated cron runs converge instead
 * of multiplying (#184).
 */
export async function expandAllRecurringChores(familyId: string): Promise<number> {
  const recurringChores = await prisma!.chore.findMany({
    where: {
      family_id: familyId,
      frequency: { not: 'once' },
      status: { in: ['pending', 'completed', 'verified'] },
    },
    select: { id: true, frequency: true, assigned_to: true, created_by: true },
  })

  const insertedCounts = await Promise.all(
    recurringChores.map((chore) => expandRecurringChores(chore, familyId))
  )

  return insertedCounts.reduce((total, inserted) => total + inserted, 0)
}
