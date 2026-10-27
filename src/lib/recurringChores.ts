import { isFairChoreTopUpEnabled } from "@/lib/chore-top-up-gates"
import { topUpFairHouseholdSeries } from "@/lib/chore-top-up-cursor"
import { isProfileChoreRecurrenceSupported } from '@/lib/profile-chore-gates'
import { topUpScheduledOnceSteps } from '@/lib/routine-once-top-up'
import { nextDueDate, startOfDay } from '@/lib/chore-recurrence-dates'
export { nextDueDate, startOfDay } from '@/lib/chore-recurrence-dates'
import { normalizedWeekdays, nextSelectedWeekday } from '@/lib/chore-weekdays'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { describeError, log } from '@/lib/logger'
import type { ChoreFrequency } from '@/types'
import { planRotationTurns } from '@/lib/chore-rotation'
import { eligibleChoreAssigneeInTx } from '@/lib/chore-member-subject'
import { lockHousehold } from '@/lib/household-lock'
import { eligibleProfileChoreAssigneeInTx } from '@/lib/chore-profile-assignee'
import { expandRoutineScheduleInTx } from '@/lib/routine-schedule-expansion'

const FREQUENCY_CONFIG: Record<Exclude<ChoreFrequency, 'once'>, { occurrences: number; unit: 'day' | 'week' | 'month'; amount: number }> = {
  daily: { occurrences: 7, unit: 'day', amount: 1 },
  weekly: { occurrences: 4, unit: 'day', amount: 7 },
  monthly: { occurrences: 3, unit: 'day', amount: 30 },
}

const WINDOW_SIZE: Record<Exclude<ChoreFrequency, 'once'>, number> = {
  daily: 7,
  weekly: 4,
  monthly: 3,
}

/**
 * Keep a recurring series topped up to `windowSize` upcoming occurrences,
 * inside the caller's transaction.
 *
 * The series is identified by `recurrence_id` (the template's own id on the
 * template and on every occurrence it generates), NOT by matching
 * (title, assigned_to, due_date) — that key conflated two unrelated chores that
 * happened to share a title and date, silently swallowing one series' rows.
 *
 * `windowSize` means "how many upcoming occurrences to keep", where upcoming is
 * `due_date >= start of today` (the template counts, like any other row in the
 * series). Each run only creates enough rows to reach that count, and never a
 * date beyond the horizon: `windowSize` intervals after the later of today and
 * the template's first due date. Previously every run appended another
 * `windowSize` rows after the latest one, so a daily cron grew each series
 * without bound into the future.
 *
 * New dates continue from the LATEST occurrence already in the series (so the
 * series keeps advancing rather than re-deriving the first window forever),
 * skipping any date that has already passed — a series the cron has not
 * touched for a while resumes from today instead of back-filling overdue rows.
 *
 * The unique constraint on (recurrence_id, due_date) is the final guard, so two
 * concurrent runs cannot double-insert even if they race past the count.
 */
export async function expandSeriesInTx(
  tx: Prisma.TransactionClient,
  templateId: string,
  familyId: string,
  now: Date = new Date()
): Promise<number> {
  await lockHousehold(tx, familyId)
  const original = await tx.chore.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      title: true,
      description: true,
      points: true,
      difficulty: true,
      frequency: true,
      weekly_days: true,
      family_id: true,
      assigned_to: true,
      assigned_member_id: true,
      member_subject_erased: true,
      created_by: true,
      due_date: true,
      icon: true,
      routine: true,
      routine_order: true,
      rotation_member_ids: true,
      recurrence_id: true,
      is_template: true,
    },
  })

  // Household-scoped: a template of another household is never expanded.
  if (!original || original.family_id !== familyId) return 0
  // Definitions are authoritative even when the historical root is a one-off.
  // Unsupported metadata never falls back to legacy snapshot fields.
  const definition = await tx.$queryRaw<{ routine_series_config: unknown }[]>`
    SELECT "routine_series_config" FROM "Chore" WHERE "id" = ${templateId} AND "family_id" = ${familyId}`
  if (definition.some(row => row.routine_series_config != null)) {
    return expandRoutineScheduleInTx(tx, original, definition[0].routine_series_config, startOfDay(now).toISOString().slice(0, 10))
  }
  if (original.frequency === 'once') return 0
  const assignedTo = original.assigned_to

  // A profile series is a gated, canonical member-owned template. Never pass
  // it through the account resolver: an unavailable profile stops future
  // expansion rather than inventing a User or account assignment.
  const profileMemberId = original.assigned_member_id
  if (assignedTo === null) {
    if (!profileMemberId || original.member_subject_erased || original.recurrence_id !== original.id || !original.is_template || original.rotation_member_ids.length > 0) return 0
    if (!await eligibleProfileChoreAssigneeInTx(tx, familyId, profileMemberId)) return 0
  }

  const windowSize = WINDOW_SIZE[original.frequency as Exclude<ChoreFrequency, 'once'>] * (original.frequency === 'weekly' ? Math.max(1, normalizedWeekdays(original.weekly_days).length) : 1)
  if (!windowSize) return 0

  // The series anchor is the template id. An occurrence is any row whose
  // recurrence_id is the template id; the anchor itself counts as the first.
  const seriesId = original.id
  const today = startOfDay(now)

  // Horizon: `windowSize` intervals after the later of today and the series'
  // first date (a series created to start next month still gets its window).
  const firstDay = startOfDay(original.due_date)
  const monthlyAnchorDay = firstDay.getUTCDate()
  let horizon: Date = firstDay > today ? firstDay : today
  for (let i = 0; i < windowSize; i++) {
    const next = nextDueDate(horizon, original.frequency, original.weekly_days, monthlyAnchorDay)
    if (!next) return 0
    horizon = next
  }

  // Once the window is full, more future rows cannot change the decision.
  // If fewer exist, this reads all of them, retaining the exact collision set.
  const upcoming = await tx.chore.findMany({
    where: { family_id: familyId, recurrence_id: seriesId, due_date: { gte: today } },
    select: { due_date: true },
    orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
    take: windowSize,
  })
  const needed = windowSize - upcoming.length
  if (needed <= 0) return 0

  // Latest date already in the series. Falling back to the template's own due
  // date means a brand-new series starts one interval after its first row.
  const latest = await tx.chore.findFirst({
    where: { family_id: familyId, recurrence_id: seriesId },
    orderBy: [{ due_date: 'desc' }, { id: 'desc' }],
    select: { due_date: true, rotation_index: true },
  })
  const anchorDate = latest?.due_date ?? original.due_date

  const existingKeys = new Set(upcoming.map((c) => c.due_date.getTime()))
  const candidates: Date[] = []
  let cursor = nextDueDate(anchorDate, original.frequency, original.weekly_days, monthlyAnchorDay)
  while (cursor && cursor < horizon && candidates.length < needed) {
    if (cursor >= today && !existingKeys.has(cursor.getTime())) {
      candidates.push(cursor)
    }
    cursor = nextDueDate(cursor, original.frequency, original.weekly_days, monthlyAnchorDay)
  }

  if (candidates.length === 0) return 0

  if (assignedTo === null) {
    const occurrences = candidates.map((due_date) => ({
      family_id: familyId,
      title: original.title,
      description: original.description,
      points: original.points,
      difficulty: original.difficulty,
      frequency: 'once',
      assigned_to: null,
      assigned_member_id: profileMemberId,
      member_subject_erased: false,
      rotation_index: null,
      created_by: original.created_by,
      icon: original.icon,
      routine: original.routine,
      routine_order: original.routine_order,
      due_date,
      status: 'pending',
      recurrence_id: seriesId,
      is_template: false,
      routine_stack_id: null,
    }))
    const { count } = await tx.chore.createMany({
      data: occurrences,
      skipDuplicates: true,
    })
    return count
  }

  // Take turns (O-39, src/lib/chore-rotation.ts): each new copy takes the
  // place after the latest occurrence, in due-date order. Members no longer
  // eligible in the household are skipped. If nobody is eligible, retain the
  // history and create no new work; never fall back to a removed owner.
  const rotation = original.rotation_member_ids ?? []
  const assignees = new Map<string, { assigned_to: string; assigned_member_id?: string }>()
  for (const id of new Set(rotation.length ? rotation : [assignedTo])) {
    const subject = await eligibleChoreAssigneeInTx(tx, familyId, id, { requireCanonical: !!original.assigned_member_id })
    if (subject) assignees.set(id, subject)
  }
  if (assignees.size === 0) return 0
  let turns: Array<{ index: number; assignee: string | null }> = []
  if (rotation.length > 0) {
    const members = await tx.user.findMany({
      where: { id: { in: rotation }, family_id: familyId },
      select: { id: true },
    })
    const active = new Set(members.map((m) => m.id).filter(id => assignees.has(id)))
    turns = planRotationTurns(rotation, latest?.rotation_index ?? null, candidates.length, (id) => active.has(id))
  }

  const occurrences = candidates.map((due_date, i) => ({
    family_id: familyId,
    title: original.title,
    description: original.description,
    points: original.points,
    difficulty: original.difficulty,
    // Instances are one-offs: only the template recurs, so the cron can
    // never mistake a generated row for a template.
    frequency: 'once',
    ...assignees.get(turns[i]?.assignee ?? assignedTo)!,
    rotation_index: turns[i]?.index ?? null,
    created_by: original.created_by,
    // Picture routines (#272): every occurrence keeps the template's picture and step.
    icon: original.icon,
    routine: original.routine,
    routine_order: original.routine_order,
    due_date,
    status: 'pending',
    recurrence_id: seriesId,
    is_template: false,
  }))

  const { count } = await tx.chore.createMany({
    data: occurrences,
    skipDuplicates: true,
  })
  return count
}

/**
 * Generate occurrences for one recurring template, idempotently, in its own
 * transaction. See `expandSeriesInTx` for the window rules.
 */
export async function expandRecurringChores(
  template: { id: string; frequency: string },
  familyId: string,
  now: Date = new Date()
): Promise<number> {
  if (template.frequency === 'once') return 0
  if (!WINDOW_SIZE[template.frequency as Exclude<ChoreFrequency, 'once'>]) return 0

  return prisma!.$transaction((tx) => expandSeriesInTx(tx, template.id, familyId, now))
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
export async function expandAllRecurringChores(familyId: string, now: Date = new Date()): Promise<number> {
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
    inserted += await expandRecurringChores(template, familyId, now)
  }
  return inserted
}

/**
 * Most series one lazy top-up looks at. A household has a handful of
 * recurring chores; the cap only bounds a page load if something goes wrong.
 */
export const MAX_SERIES_PER_TOP_UP = 100

/**
 * Attempt a bounded foreground top-up for a household, on read.
 * The default legacy path starts at the first100 IDs. The separately gated
 * fair path resumes a household-owned attempted position across visits.
 * Neither a bounded visit nor an inserted count proves every series is full.
 *
 * There is no scheduler (AGENTS.md: no cron without approval), so a series is
 * otherwise only extended when it is created, when one of its chores is
 * completed (`completeChore`) or when someone calls the unscheduled cron
 * route. A series nobody ticks for a few weeks would run out. The chores page
 * and the Today board call this before they read, so the window is refilled
 * whenever someone looks.
 *
 * Idempotent and bounded like `expandSeriesInTx` (at most the window per
 * series, never past the horizon; the (recurrence_id, due_date) unique key
 * guards concurrent loads). Never throws: a failure is logged and the page
 * renders what is already there.
 */
export async function topUpHouseholdSeries(familyId: string, now: Date = new Date()): Promise<number> {
  // Explicit once-only routine recovery has its own bounded pass. It neither
  // changes legacy once semantics nor consumes the repeating-template budget.
  const onceInserted = await topUpScheduledOnceSteps(prisma!, familyId, now, expandSeriesInTx)
  if (isFairChoreTopUpEnabled()) {
    return onceInserted + await topUpFairHouseholdSeries(prisma!, familyId, now, expandSeriesInTx)
  }
  try {
    const templates = await prisma!.chore.findMany({
      where: { family_id: familyId, is_template: true, frequency: { not: 'once' } },
      select: { id: true, frequency: true },
      orderBy: { id: 'asc' },
      take: MAX_SERIES_PER_TOP_UP,
    })
    let inserted = 0
    for (const template of templates) {
      inserted += await expandRecurringChores(template, familyId, now)
    }
    return onceInserted + inserted
  } catch (error) {
    log.warn('chores.series_top_up_failed', describeError(error))
    return onceInserted
  }
}

/** The chore fields a frequency edit reads. */
export type FrequencyEditChore = {
  id: string
  family_id: string
  frequency: string
  recurrence_id: string | null
  assigned_to?: string | null
  assigned_member_id?: string | null
  weekly_days?: number[]
}

/**
 * Apply a frequency edit (PATCH /api/chores) inside the caller's transaction,
 * after the other fields of the edit are written.
 *
 * - A chore with no series that becomes daily/weekly/monthly becomes the
 *   template of its own series and is expanded, exactly like a recurring
 *   chore created that way (POST /api/chores/create: mark as template +
 *   expansion, in one transaction).
 * - A template set to `once` stops its series (O-33): the template keeps its
 *   `recurrence_id` but is no longer `is_template`, so nothing extends it
 *   again, and the series' copies that are still `pending` and due after
 *   today are removed. Copies due today or earlier, and any copy someone has
 *   started, completed or had verified, are kept. Leaving the future copies
 *   would show three or four more "weekly" chores after the parent said it no
 *   longer repeats, which is the more surprising outcome.
 * - A template moved to another repeating frequency removes the same pending
 *   future copies and re-expands at the new interval.
 * - A generated copy is always a one-off (`frequency` 'once'). Its frequency is
 *   changed only with `applyToSeries`, and then the change is made to its
 *   series' template as above (the edited copy itself is never removed).
 *   Without the flag the value is ignored: older edit forms post the copy's own
 *   'once' back with every save, and that must not stop the series.
 */
export async function applyFrequencyEditInTx(
  tx: Prisma.TransactionClient,
  chore: FrequencyEditChore,
  newFrequency: string,
  options: { applyToSeries?: boolean; now?: Date; weeklyDays?: number[] } = {}
): Promise<void> {
  const now = options.now ?? new Date()
  let assignedTo = chore.assigned_to
  let assignedMemberId = chore.assigned_member_id
  if (
    newFrequency !== 'once' &&
    assignedTo === undefined &&
    assignedMemberId === undefined
  ) {
    const current = await tx.chore.findUnique({
      where: { id: chore.id },
      select: { assigned_to: true, assigned_member_id: true },
    })
    assignedTo = current?.assigned_to
    assignedMemberId = current?.assigned_member_id
  }
  if (
    newFrequency !== 'once' &&
    assignedTo === null &&
    assignedMemberId != null &&
    !isProfileChoreRecurrenceSupported()
  ) {
    throw new Error('MEMBER_PROTOCOL_UNAVAILABLE')
  }
  const template = chore.recurrence_id
    ? await tx.chore.findFirst({
        where: { id: chore.recurrence_id, family_id: chore.family_id },
        select: {
          id: true,
          frequency: true,
          weekly_days: true,
          assigned_to: true,
          assigned_member_id: true,
        },
      })
    : null

  if (
    newFrequency !== 'once' &&
    template?.assigned_to === null &&
    template.assigned_member_id != null &&
    !isProfileChoreRecurrenceSupported()
  ) {
    throw new Error('MEMBER_PROTOCOL_UNAVAILABLE')
  }

  const priorDays = normalizedWeekdays(template?.weekly_days ?? chore.weekly_days)
  const nextDays = newFrequency === 'weekly' ? normalizedWeekdays(options.weeklyDays ?? priorDays) : []
  const scheduleChanged = JSON.stringify(priorDays) !== JSON.stringify(nextDays)

  if (template && template.id !== chore.id) {
    // A generated copy.
    if (!options.applyToSeries || (newFrequency === template.frequency && !scheduleChanged)) return
    await changeSeriesFrequencyInTx(tx, template.id, chore.family_id, newFrequency, chore.id, now, nextDays)
    return
  }

  if (template) {
    // The series template itself.
    if ((newFrequency === template.frequency && !scheduleChanged)) return
    await changeSeriesFrequencyInTx(tx, template.id, chore.family_id, newFrequency, chore.id, now, nextDays)
    return
  }

  // No series (a plain chore, a legacy recurring row, or a copy whose template
  // was deleted).
  if (newFrequency === chore.frequency && !scheduleChanged) return
  if (newFrequency === 'once' || !isRepeating(newFrequency)) {
    await tx.chore.update({ where: { id: chore.id }, data: { frequency: newFrequency, weekly_days: nextDays } })
    return
  }
  await tx.chore.update({
    where: { id: chore.id },
    data: { frequency: newFrequency, weekly_days: nextDays, recurrence_id: chore.id, is_template: true },
  })
  await expandSeriesInTx(tx, chore.id, chore.family_id, now)
}

function isRepeating(frequency: string): frequency is Exclude<ChoreFrequency, 'once'> {
  return Object.prototype.hasOwnProperty.call(WINDOW_SIZE, frequency)
}

async function changeSeriesFrequencyInTx(
  tx: Prisma.TransactionClient,
  templateId: string,
  familyId: string,
  newFrequency: string,
  keepId: string,
  now: Date,
  weeklyDays: number[] = []
): Promise<void> {
  const repeating = isRepeating(newFrequency)
  await tx.chore.update({
    where: { id: templateId },
    data: { frequency: repeating ? newFrequency : 'once', weekly_days: weeklyDays, is_template: repeating },
  })
  const tomorrow = startOfDay(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  await tx.chore.deleteMany({
    where: {
      family_id: familyId,
      recurrence_id: templateId,
      id: { notIn: [templateId, keepId] },
      status: 'pending',
      due_date: { gte: tomorrow },
    },
  })
  // The template and the edited copy retain their identities. A future,
  // pending row must still follow the new selected weekdays; keeping its id
  // must not leave a Monday occurrence in a Wednesday-only schedule. Today,
  // past and completed rows remain unchanged, including their recorded dates.
  if (newFrequency === 'weekly' && weeklyDays.length) {
    const future = await tx.chore.findMany({
      where: { family_id: familyId, recurrence_id: templateId, due_date: { gte: tomorrow } },
      select: { id: true, due_date: true, status: true },
      orderBy: { due_date: 'asc' },
    })
    const occupied = new Set(future.map(row => row.due_date.getTime()))
    for (const row of future) {
      if (row.status !== 'pending' || ![templateId, keepId].includes(row.id) || weeklyDays.includes(row.due_date.getUTCDay())) continue
      occupied.delete(row.due_date.getTime())
      let next = nextSelectedWeekday(row.due_date, weeklyDays, true)!
      // Preserve completed rows and any retained occurrence on that day.
      // The series' unique date constraint remains the final guard.
      while (occupied.has(next.getTime())) next = nextSelectedWeekday(next, weeklyDays)!
      await tx.chore.update({ where: { id: row.id }, data: { due_date: next } })
      occupied.add(next.getTime())
    }
  }
  if (repeating) await expandSeriesInTx(tx, templateId, familyId, now)
}
