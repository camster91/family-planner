// Morning summary sender (O-40). Called only by POST /api/cron/morning-summary,
// which runs only when an operator schedules it (AGENTS.md: no scheduler is
// added by the app). Off by default three ways: the endpoint is closed until
// CRON_SECRET is set, nothing calls it until the operator adds a schedule, and
// every member's switch defaults to off.
//
// Per run:
//   * Reads opted-in members only, in pages (by id), up to MAX_SCANNED_PER_RUN.
//   * Loads each household's rows ONCE per page (the Today board's fields:
//     chore title/due day/status/assignee, event title/start/end, dinner name)
//     and builds each member's summary with the pure builder.
//   * Each household is tried on its own: a failure is logged (content-free)
//     and the next household carries on, like the recurring-chores cron.
//   * Once a day per person: the person's local `YYYY-MM-DD` is claimed in
//     `User.morning_summary_sent_on` with a conditional update BEFORE anything
//     is sent. A retried, overlapping or double-called run finds the claim and
//     sends nothing. A send that fails after the claim is not retried that day
//     (never twice beats always once).
//   * Quiet hours (O-32): a person inside their quiet hours at run time gets
//     nothing and the day is NOT claimed, so a later run the same local day
//     (if the operator schedules one) sends it; otherwise that day is skipped.
//   * Email only to a verified address, and only when mail is configured;
//     otherwise in-app only. Both go through src/lib/notification-delivery.ts.
//   * At most MAX_SENDS_PER_RUN people get a summary per run; a run that stops
//     early says `truncated: true`, and the next run continues (people already
//     sent today are skipped cheaply).
//
// Logs carry no names, titles, addresses or ids beyond the route label.

import type { PrismaClient } from '@prisma/client'
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from '@/lib/dates'
import { normalizeFeatures } from '@/lib/features'
import { dayKeyFor } from '@/lib/local-day-key'
import { morningSummaryEmail } from '@/lib/mail'
import { deliverNotification, sendOptInMail } from '@/lib/notification-delivery'
import { QUIET_HOURS_SELECT, isInQuietHours, isValidTimeZone, quietHoursFromRow } from '@/lib/quiet-hours'
import { buildMorningSummary, type SummaryChore, type SummaryDinner, type SummaryEvent } from '@/lib/morning-summary'
import { logRouteError } from '@/lib/api-error'

/** Opted-in members read per page. */
export const PAGE_SIZE = 200
/** Most opted-in members looked at in one run. */
export const MAX_SCANNED_PER_RUN = 5000
/** Most people sent a summary in one run (bounds email volume per call). */
export const MAX_SENDS_PER_RUN = 1000
/** Upper bounds on rows read per household (the summary names far fewer). */
const MAX_EVENTS = 100
const MAX_CHORES = 300
const MAX_DINNERS = 20

const ROUTE = 'POST /api/cron/morning-summary'

type Db = Pick<PrismaClient, 'user' | 'family' | 'chore' | 'event' | 'familyMeal'>

export interface MorningSummaryRunOptions {
  now?: Date
  /** IANA zone for members who have none saved (the operator's `tz`); else UTC. */
  fallbackTimeZone?: string | null
  requestId?: string
  /** Public origin for links. Defaults to NEXT_PUBLIC_APP_URL. */
  appUrl?: string
}

export interface MorningSummaryRunResult {
  success: boolean
  households: { processed: number; failed: number }
  sent: { inApp: number; email: number }
  skipped: {
    alreadySent: number
    quietHours: number
    nothingToday: number
    noEmail: number
  }
  failedRecipients: number
  truncated: boolean
}

interface Recipient {
  id: string
  name: string
  role: string
  family_id: string | null
  morning_summary_time_zone: string | null
  morning_summary_sent_on: string | null
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  quiet_hours_time_zone: string | null
}

interface Household {
  features: { chores: boolean; calendar: boolean; meals: boolean }
  chores: SummaryChore[]
  events: SummaryEvent[]
  dinners: SummaryDinner[]
  toCheckCount: number
}

/** The household's rows around today, in a UTC window wide enough for every zone (UTC-12..UTC+14). */
async function loadHousehold(db: Db, familyId: string, now: Date): Promise<Household> {
  const family = await db.family.findUnique({
    where: { id: familyId },
    select: { features: true },
  })
  const f = normalizeFeatures(family?.features)
  const features = { chores: f.chores, calendar: f.calendar, meals: f.meals }
  const today = startOfTodayUTC(now)
  const from = addUTCDays(today, -2)
  const to = addUTCDays(today, 3)

  const [chores, events, dinners, toCheckCount] = await Promise.all([
    features.chores
      ? db.chore.findMany({
          where: { family_id: familyId, due_date: { gte: from, lt: to } },
          select: {
            title: true,
            due_date: true,
            status: true,
            assigned_to: true,
          },
          orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
          take: MAX_CHORES,
        })
      : Promise.resolve([]),
    features.calendar
      ? db.event.findMany({
          // Title and times only: never location or description.
          where: {
            family_id: familyId,
            end_time: { gte: from },
            start_time: { lt: to },
          },
          select: { title: true, start_time: true, end_time: true },
          orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
          take: MAX_EVENTS,
        })
      : Promise.resolve([]),
    features.meals
      ? db.familyMeal.findMany({
          // Name only: never the meal's notes or the recipe's instructions.
          where: {
            family_id: familyId,
            meal_type: 'dinner',
            date: { gte: from, lt: to },
          },
          select: {
            date: true,
            recipe_name: true,
            recipe: { select: { title: true } },
          },
          orderBy: [{ date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
          take: MAX_DINNERS,
        })
      : Promise.resolve([]),
    // Same count as the parent's home summary: chores waiting for a check.
    features.chores ? db.chore.count({ where: { family_id: familyId, status: 'completed' } }) : Promise.resolve(0),
  ])

  return {
    features,
    chores: chores.map((c) => ({
      title: c.title,
      dueDay: toDateOnlyUTC(c.due_date),
      status: c.status,
      assigneeId: c.assigned_to,
    })),
    events: events.map((e) => ({
      title: e.title,
      start: e.start_time,
      end: e.end_time,
    })),
    dinners: dinners.map((d) => ({
      day: toDateOnlyUTC(d.date),
      name: d.recipe_name?.trim() || d.recipe?.title?.trim() || null,
    })),
    toCheckCount,
  }
}

/** Where a member turns the summary off: children have no Settings page (kid-access). */
function settingsFor(role: string, appUrl: string) {
  return role === 'parent' || role === 'teen'
    ? {
        settingsUrl: `${appUrl}/dashboard/settings`,
        settingsLabel: 'Settings → Notifications',
      }
    : {
        settingsUrl: `${appUrl}/dashboard`,
        settingsLabel: 'the menu under your name → Notifications',
      }
}

export async function runMorningSummary(
  db: Db,
  options: MorningSummaryRunOptions = {}
): Promise<MorningSummaryRunResult> {
  const now = options.now ?? new Date()
  const fallbackZone = isValidTimeZone(options.fallbackTimeZone) ? options.fallbackTimeZone : 'UTC'
  const appUrl = (options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://family.ashbi.ca').replace(/\/+$/, '')

  const result: MorningSummaryRunResult = {
    success: true,
    households: { processed: 0, failed: 0 },
    sent: { inApp: 0, email: 0 },
    skipped: { alreadySent: 0, quietHours: 0, nothingToday: 0, noEmail: 0 },
    failedRecipients: 0,
    truncated: false,
  }
  let sends = 0
  let scanned = 0
  let cursor: string | null = null

  pages: while (scanned < MAX_SCANNED_PER_RUN) {
    const page: Recipient[] = await db.user.findMany({
      where: {
        morning_summary_enabled: true,
        family_id: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        name: true,
        role: true,
        family_id: true,
        morning_summary_time_zone: true,
        morning_summary_sent_on: true,
        ...QUIET_HOURS_SELECT,
      },
      orderBy: { id: 'asc' },
      take: Math.min(PAGE_SIZE, MAX_SCANNED_PER_RUN - scanned),
    })
    if (page.length === 0) break
    scanned += page.length
    cursor = page[page.length - 1].id

    // Who is due now, before loading any household data.
    const due = new Map<string, Array<{ user: Recipient; dayKey: string; timeZone: string }>>()
    for (const user of page) {
      const timeZone = isValidTimeZone(user.morning_summary_time_zone) ? user.morning_summary_time_zone : fallbackZone
      const dayKey = dayKeyFor({ kind: 'tz', timeZone })(now)
      if (user.morning_summary_sent_on === dayKey) {
        result.skipped.alreadySent++
        continue
      }
      if (isInQuietHours(now, quietHoursFromRow(user))) {
        result.skipped.quietHours++
        continue
      }
      const list = due.get(user.family_id!) ?? []
      list.push({ user, dayKey, timeZone })
      due.set(user.family_id!, list)
    }

    for (const [familyId, members] of due) {
      if (sends >= MAX_SENDS_PER_RUN) {
        result.truncated = true
        break pages
      }
      let household: Household
      try {
        household = await loadHousehold(db, familyId, now)
        result.households.processed++
      } catch (error) {
        result.households.failed++
        logRouteError(`${ROUTE} (household)`, error, options.requestId)
        continue
      }

      for (const { user, dayKey, timeZone } of members) {
        if (sends >= MAX_SENDS_PER_RUN) {
          result.truncated = true
          break pages
        }
        const summary = buildMorningSummary({
          person: { id: user.id, role: user.role },
          dayKey,
          timeZone,
          ...household,
        })
        if (!summary) {
          // Nothing today: send nothing. Not claimed, so a later run the same
          // day can still send if something was added meanwhile.
          result.skipped.nothingToday++
          continue
        }
        try {
          // Claim the day first. Conditional on the switch still being on and
          // the day not yet claimed: only one caller can win.
          const claim = await db.user.updateMany({
            where: {
              id: user.id,
              morning_summary_enabled: true,
              OR: [{ morning_summary_sent_on: null }, { morning_summary_sent_on: { not: dayKey } }],
            },
            data: { morning_summary_sent_on: dayKey },
          })
          if (claim.count !== 1) {
            result.skipped.alreadySent++
            continue
          }
          sends++
          const inApp = await deliverNotification(
            {
              userId: user.id,
              type: 'summary',
              title: 'Your morning summary',
              message: summary.text,
              actionUrl: '/dashboard/today',
            },
            now
          )
          if (inApp.delivered) result.sent.inApp++
          const mail = await sendOptInMail(
            'morning_summary',
            {
              userId: user.id,
              ...morningSummaryEmail({
                name: user.name,
                dayLabel: summary.dayLabel,
                lines: summary.lines,
                todayUrl: `${appUrl}/dashboard/today`,
                ...settingsFor(user.role, appUrl),
              }),
            },
            now
          )
          if (mail.sent) result.sent.email++
          else result.skipped.noEmail++
        } catch (error) {
          result.failedRecipients++
          logRouteError(`${ROUTE} (recipient)`, error, options.requestId)
        }
      }
    }

    if (page.length < PAGE_SIZE) break
  }

  if (scanned >= MAX_SCANNED_PER_RUN) result.truncated = true
  result.success = result.households.failed === 0 && result.failedRecipients === 0
  return result
}
