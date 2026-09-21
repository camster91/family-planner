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
 * advanced by `setMonth(+1)`; across a month boundary those disagree (#184).
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
      // Calendar month, not a fixed 30 days. `setMonth` handles short-month
      // rollover (Jan 31 -> Feb 28/29) consistently everywhere.
      d.setMonth(d.getMonth() + 1)
      return d
    default:
      return null
  }
}

const WINDOW_SIZE: Record<Exclude<ChoreFrequency, 'once'>, number> = {
  daily: 7,
  weekly: 4,
  monthly: 3,
}

/**
 * Generate occurrences for one recurring template, idempotently.
 *
 * The series is identified by `recurrence_id` (the template's own id on the
 * template and on every occurrence it generates), NOT by matching
 * (title, assigned_to, due_date) — that key conflated two unrelated chores that
 * happened to share a title and date, silently swallowing one series' rows.
 *
 * The window advances from the LATEST occurrence already in the series, not
 * from the template's original due date. Generating from a fixed origin meant
 * that once the first window was written, every later run derived the same
 * dates, found them all present, and inserted nothing — the series stopped
 * after one window instead of continuing.
 *
 * All of this runs inside a transaction with a unique constraint on
 * (recurrence_id, due_date) as the final guard, so two concurrent runs cannot
 * double-insert even if they race past the existence check.
 */
export async function expandRecurringChores(
  template: { id: string; frequency: string },
  familyId: string
): Promise<number> {
  if (template.frequency === 'once') return 0

  const windowSize = WINDOW_SIZE[template.frequency as Exclude<ChoreFrequency, 'once'>]
  if (!windowSize) return 0

  return prisma!.$transaction(async (tx) => {
    const original = await tx.chore.findUnique({
      where: { id: template.id },
      select: {
        id: true,
        title: true,
        description: true,
        points: true,
        difficulty: true,
        frequency: true,
        family_id: true,
        assigned_to: true,
        created_by: true,
        due_date: true,
      },
    })

    if (!original) return 0

    // The series anchor is the template id. An occurrence is any row whose
    // recurrence_id is the template id; the anchor itself counts as the first.
    const seriesId = original.id

    // Latest date already in the series. Falling back to the template's own due
    // date means a brand-new series starts one interval after its first row.
    const latest = await tx.chore.findFirst({
      where: { recurrence_id: seriesId },
      orderBy: { due_date: 'desc' },
      select: { due_date: true },
    })

    const anchorDate = latest?.due_date ?? original.due_date

    // Build the next `windowSize` dates strictly after the anchor.
    const candidates: Date[] = []
    let cursor = new Date(anchorDate)
    for (let i = 0; i < windowSize; i++) {
      const next = nextDueDate(cursor, original.frequency)
      if (!next) break
      candidates.push(next)
      cursor = next
    }
    if (candidates.length === 0) return 0

    // Skip any that already exist for THIS series (the unique constraint would
    // reject them anyway; this keeps the count honest and the insert quiet).
    const existing = await tx.chore.findMany({
      where: { recurrence_id: seriesId, due_date: { in: candidates } },
      select: { due_date: true },
    })
    const existingKeys = new Set(existing.map((c) => c.due_date.getTime()))

    const occurrences = candidates
      .filter((d) => !existingKeys.has(d.getTime()))
      .map((due_date) => ({
        family_id: familyId,
        title: original.title,
        description: original.description,
        points: original.points,
        difficulty: original.difficulty,
        // Instances are one-offs: only the template recurs, so the cron can
        // never mistake a generated row for a template.
        frequency: 'once',
        assigned_to: original.assigned_to,
        created_by: original.created_by,
        due_date,
        status: 'pending',
        recurrence_id: seriesId,
        is_template: false,
      }))

    if (occurrences.length === 0) return 0

    const { count } = await tx.chore.createMany({
      data: occurrences,
      skipDuplicates: true,
    })
    return count
  })
}

/**
 * Mark a newly created chore as the template of its own series.
 *
 * Called once, when a user creates a recurring chore. Until this runs the row
 * has no `recurrence_id`, so no series exists yet and the cron cannot expand it.
 */
export async function markAsTemplate(choreId: string): Promise<void> {
  await prisma!.chore.update({
    where: { id: choreId },
    data: { recurrence_id: choreId, is_template: true },
  })
}

/**
 * Expand recurring TEMPLATES for a family. Used by the daily cron.
 *
 * Only rows flagged `is_template` are expanded — not "any row whose frequency
 * is not once". That distinction matters: before this change, legacy rows
 * generated by the old expander still carried a non-`once` frequency, so a
 * deploy that made the cron reachable would have re-expanded every one of them
 * and multiplied the whole table. Selecting on the explicit flag means a
 * legacy row is inert until it is deliberately adopted as a template.
 */
export async function expandAllRecurringChores(familyId: string): Promise<number> {
  const templates = await prisma!.chore.findMany({
    where: {
      family_id: familyId,
      is_template: true,
      frequency: { not: 'once' },
    },
    select: { id: true, frequency: true },
  })

  let inserted = 0
  for (const template of templates) {
    // Sequential rather than Promise.all: each expansion reads the series'
    // latest date, so concurrent expansion of the same series would race.
    inserted += await expandRecurringChores(template, familyId)
  }
  return inserted
}
