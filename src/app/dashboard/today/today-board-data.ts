/**
 * Shared-surface DTO for the Today board (/dashboard/today, #119 / #159).
 *
 * This view is designed for the always-on fridge/wall tablet, so it follows
 * the shared-device defaults in docs/architecture/AUTHORIZATION.md even while
 * the tablet is signed in as a person (device sessions are #157):
 *
 * - Every query uses an explicit `select` of approved, glanceable fields. Broad
 *   parent objects are never loaded and then hidden client-side, so nothing
 *   private reaches the page props or the RSC payload.
 * - Never read here: budget/transactions, allowance, messages, medications,
 *   sick days, locations/addresses, handoff details, account settings, tokens,
 *   XP/streaks/leaderboards. Event `location`/`description` and meal `notes`
 *   are free text that often carries addresses or private notes, so they are
 *   left out too.
 * - Every read is scoped by the caller's `family_id`.
 *
 * Dates: events are instants; chores and meals are date-only values stored as
 * UTC midnight (src/lib/dates.ts). The server cannot know the viewer's zone, so
 * it returns a window wide enough for any zone and the client picks "today"
 * and the next days against the viewer's local calendar.
 */
import type { PrismaClient } from '@prisma/client'
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from '@/lib/dates'
import { canRoleAccessPath } from '@/lib/kid-access'
import { getOpenShoppingItems, type ShoppingSnapshot } from '@/lib/shopping-snapshot'
import type { FamilyFeatures } from '@/lib/features'

/** Days after today covered by "Coming up". */
export const COMING_UP_DAYS = 3

/** Upper bound on rows per domain; the board shows far fewer. */
const MAX_EVENTS = 60
const MAX_CHORES = 80

export interface BoardMember {
  id: string
  /** Display name only. No email, age, avatar, role or points. */
  name: string
}

export interface BoardEvent {
  id: string
  title: string
  start: string
  end: string
  isTask: boolean
  /** Subscribed calendar the event was imported from (#232), for the "From …" label. */
  source: { name: string; color: string | null } | null
}

export interface BoardChore {
  id: string
  title: string
  /** `YYYY-MM-DD` (UTC calendar day of the stored date-only value). */
  dueDay: string
  status: string
  assigneeId: string
}

export interface BoardDinner {
  id: string
  /** `YYYY-MM-DD` (UTC calendar day of the stored date-only value). */
  day: string
  recipeName: string | null
  cookName: string | null
}

/** Where the board may link, already filtered by role and feature flags. */
export interface BoardLinks {
  calendar: string | null
  chores: string | null
  meals: string | null
  lists: string | null
  features: string | null
}

export interface TodayBoardData {
  /** Server time the snapshot was built (ISO). */
  generatedAt: string
  members: BoardMember[]
  events: BoardEvent[]
  chores: BoardChore[]
  /** null when meal planning is turned off for the household. */
  dinners: BoardDinner[] | null
  /** null when the role may not open lists (never for the current roles), or for a device when lists are off. */
  shopping: ShoppingSnapshot | null
  links: BoardLinks
}

type Db = Pick<PrismaClient, 'user' | 'event' | 'chore' | 'familyMeal' | 'calendarSubscription' | 'listItem'>

interface BuildTodayBoardBase {
  familyId: string
  features: FamilyFeatures
  now?: Date
}

/**
 * `audience: 'person'` (default): links follow the member's role.
 * `audience: 'device'` (shared tablet, #157/#240): no role exists, so every
 * link is null and shopping follows only the `lists` feature. A device must
 * never be passed as `role: null`, which `allowedLink` treats as non-kid.
 */
export type BuildTodayBoardOptions = BuildTodayBoardBase &
  ({ audience?: 'person'; role: string | null | undefined } | { audience: 'device'; role?: never })

const NO_LINKS: BoardLinks = { calendar: null, chores: null, meals: null, lists: null, features: null }

/**
 * Link target if the role may open it and its feature is on, else null. The
 * middleware would bounce a kid from calendar/chores/meals, so those links
 * are simply not offered.
 */
function allowedLink(role: string | null | undefined, href: string, enabled = true): string | null {
  return enabled && canRoleAccessPath(role, href) ? href : null
}

export async function buildTodayBoard(db: Db, options: BuildTodayBoardOptions): Promise<TodayBoardData> {
  const { familyId, features } = options
  const isDevice = options.audience === 'device'
  const role = isDevice ? undefined : options.role
  const now = options.now ?? new Date()
  const includeShopping = isDevice ? features.lists : canRoleAccessPath(role, '/dashboard/lists')

  // A UTC-day window that contains "today" through "today + COMING_UP_DAYS"
  // for every zone from UTC-12 to UTC+14.
  const windowStart = addUTCDays(startOfTodayUTC(now), -1)
  const windowEnd = addUTCDays(startOfTodayUTC(now), COMING_UP_DAYS + 2)

  const [members, events, chores, dinners, shopping] = await Promise.all([
    db.user.findMany({
      where: { family_id: familyId },
      select: { id: true, name: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
    db.event.findMany({
      // Not yet finished, and starting before the end of the window.
      where: { family_id: familyId, end_time: { gt: now }, start_time: { lt: windowEnd } },
      select: {
        id: true,
        title: true,
        start_time: true,
        end_time: true,
        is_task: true,
        source_subscription_id: true,
      },
      orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
      take: MAX_EVENTS,
    }),
    db.chore.findMany({
      where: { family_id: familyId, due_date: { gte: windowStart, lt: windowEnd } },
      select: { id: true, title: true, due_date: true, status: true, assigned_to: true },
      orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: MAX_CHORES,
    }),
    features.meals
      ? db.familyMeal.findMany({
          where: { family_id: familyId, meal_type: 'dinner', date: { gte: windowStart, lt: windowEnd } },
          select: { id: true, date: true, recipe_name: true, cook: { select: { name: true } } },
          orderBy: [{ date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve(null),
    includeShopping ? getOpenShoppingItems(db, familyId) : Promise.resolve(null),
  ])

  // Subscription names for imported events, looked up in this family only so a
  // foreign subscription id can never resolve to another household's name.
  const subIds = [...new Set(events.map((e) => e.source_subscription_id).filter((id): id is string => Boolean(id)))]
  const subs =
    subIds.length > 0
      ? await db.calendarSubscription.findMany({
          where: { id: { in: subIds }, family_id: familyId },
          select: { id: true, name: true, color: true },
        })
      : []
  const subById = new Map(subs.map((s) => [s.id, s]))

  const memberIds = new Set(members.map((m) => m.id))

  return {
    generatedAt: now.toISOString(),
    members: members.map((m) => ({ id: m.id, name: m.name })),
    events: events.map((e) => {
      const sub = e.source_subscription_id ? subById.get(e.source_subscription_id) : undefined
      return {
        id: e.id,
        title: e.title,
        start: e.start_time.toISOString(),
        end: e.end_time.toISOString(),
        isTask: e.is_task,
        source: e.source_subscription_id
          ? { name: sub?.name ?? 'Subscribed calendar', color: sub?.color ?? null }
          : null,
      }
    }),
    chores: chores
      // An assignee outside the household cannot be shown by name; skip it.
      .filter((c) => memberIds.has(c.assigned_to))
      .map((c) => ({
        id: c.id,
        title: c.title,
        dueDay: toDateOnlyUTC(c.due_date),
        status: c.status,
        assigneeId: c.assigned_to,
      })),
    dinners: dinners
      ? dinners.map((d) => ({
          id: d.id,
          day: toDateOnlyUTC(d.date),
          recipeName: d.recipe_name?.trim() || null,
          cookName: d.cook?.name ?? null,
        }))
      : null,
    shopping,
    links: isDevice
      ? { ...NO_LINKS }
      : {
          calendar: allowedLink(role, '/dashboard/calendar', features.calendar),
          chores: allowedLink(role, '/dashboard/chores', features.chores),
          meals: allowedLink(role, '/dashboard/meals', features.meals),
          lists: allowedLink(role, '/dashboard/lists', features.lists),
          features: allowedLink(role, '/dashboard/features'),
        },
  }
}
