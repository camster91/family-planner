import { readSharedPreparationContext, type SharedPreparationContext } from '@/lib/event-preparation/shared-discovery' 
import { hiddenRoutineOccurrenceIds, scheduledOnceRoutineOccurrenceIds } from "@/lib/routine-occurrence-policy";
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
import { addUTCDays, parseDateOnly, startOfTodayUTC, toDateOnlyUTC } from '@/lib/dates'
import { canRoleAccessPath } from '@/lib/kid-access'
import { getOpenShoppingItems, type ShoppingSnapshot } from '@/lib/shopping-snapshot'
import type { FamilyFeatures } from '@/lib/features'
import { resolveMemberColors, type MemberColorKey } from '@/lib/member-colors'
import {
  DEFAULT_USE_SOON_DAYS,
  countMissingIngredients,
  getUseSoonItems,
  loadCookInventory,
  type DateKind,
  type InventoryLocation,
} from '@/lib/inventory'
import type { BoardWeather } from '@/lib/weather/board-weather'
import { isRoutineIconKey } from '@/lib/routine-icons'
import type { BoardDisplay } from '@/lib/ambient'
import { COMING_UP_DAYS } from '@/lib/board-constants'
import { loadBoardDinners, BOARD_DINNER_INGREDIENT_MAX, type DinnerRow } from './today-dinners'
import { isProfileAgeAllowed, profileRoleSchema, type MemberProtocol } from '@/lib/member-subject-contract'
import { isProfileChoreEnabled, profileChoreActionAvailability, profileChoreProtocolRefusal, readChoreSubject, type ProfileChoreActionAvailability } from '@/lib/chore-profile'

export { COMING_UP_DAYS } from '@/lib/board-constants'

/** Upper bound on rows per domain; the board shows far fewer. */
const MAX_EVENTS = 60
const MAX_CHORES = 80
/** "Use soon" rows read for the board (it shows at most 5, then "N more"). */
export const MAX_USE_SOON = 50

export interface BoardMember {
  id: string
  /** Display name only. No email, age, avatar, role or points. */
  name: string
  /**
   * Board colour (#262): a palette key from src/lib/member-colors.ts, the
   * parent's choice or the deterministic fallback. Always shown next to the
   * name, never alone. Optional for clients built before #262.
   */
  color?: MemberColorKey
  /** Explicit subject identity for protocol 2 readers. */
  subject?: BoardSubject
}

/** The only subject identity that may cross the shared Today boundary. */
export type BoardSubject =
  { kind: 'account'; accountId: string; name: string } | { kind: 'profile'; memberId: string; name: string; color: MemberColorKey }

export interface BoardEvent {
  id: string
  title: string
  start: string
  end: string
  isTask: boolean
  /** Subscribed calendar the event was imported from (#232), for the "From …" label. */
  source: { name: string; color: string | null } | null
  /**
   * Household member who added the event (#262), for the member colour and
   * name on the board. Null for imported events (subscribed calendars and
   * provider-synced calendars) and for a creator who is no
   * longer in the household. Events have no attendee field, so this is who
   * added it, not who attends. Optional for clients built before #262.
   */
  addedById?: string | null
}

export interface BoardChore {
  id: string
  title: string
  /** `YYYY-MM-DD` (UTC calendar day of the stored date-only value). */
  dueDay: string
  status: string
  /** Legacy account id. Never contains a HouseholdMember id. */
  assigneeId?: string
  /** Protocol 2's explicit account/profile subject. */
  subject?: BoardSubject
  /** Per-row profile capability; paused recurring work stays readable but not actionable. */
  actionAvailability?: ProfileChoreActionAvailability
  /**
   * Picture key from the built-in chore icon set (#272), or null. A fixed
   * catalogue key, never user text, so it is safe for every audience including
   * the shared device (SHARED_DEVICE.md §9.1). Always sent by
   * `buildTodayBoard`; optional in the type for older callers and fixtures.
   */
  icon?: string | null
}

export interface BoardDinner {
  /** Another dinner exists for this day; this preview is not the full collection. */
  hasMoreDinners?: boolean
  id: string
  /** `YYYY-MM-DD` (UTC calendar day of the stored date-only value). */
  day: string
  recipeName: string | null
  cookName: string | null
  /**
   * Linked recipe (ADR-0007): title and prep time only, never the recipe's
   * description, instructions or the meal's `notes`. Null when unlinked.
   */
  recipeTitle?: string | null
  /** Recipe prep time in minutes, when linked and known. */
  prepMinutes?: number | null
  /**
   * How many of the linked recipe's ingredients are not in the household's
   * inventory on the dinner's day (#122), matched exactly like "What can I
   * cook" (`countMissingIngredients`). A count only, never the names.
   * Present only for a signed-in member when the `inventory` feature is on
   * and the recipe lists ingredients; never sent to a shared device
   * (SHARED_DEVICE.md §9.1 does not allow it). Omitted, not 0, when unknown.
   */
  missingIngredients?: number
}

/**
 * Inventory item to use soon (#263 data, #262 tile). Board-safe fields only
 * (`getUseSoonItems`): no amount, author, ingredient link or notes. The
 * client works out "expired / use today / use in N days" against the
 * viewer's local day, as it does for chores and dinners.
 */
export interface BoardUseSoonItem {
  id: string
  /** Household food name, like a grocery item already on the board. */
  name: string
  location: InventoryLocation
  /** `YYYY-MM-DD` expiry day. */
  expiresOn: string
  /**
   * What the day means (#158): `best_before` or `use_by`. Optional so an
   * older cached DTO still renders (read as best before).
   */
  dateKind?: DateKind
}

/** A household photo chosen by a parent for the calm display (#271). */
export interface BoardPhoto {
  /** `Upload.id` of the household's own upload. */
  id: string
  /** Same-origin, household-scoped file URL (`/api/files/chores/<filename>`). */
  url: string
}

/**
 * Fridge calm display settings (#271). `photos` is present only for a
 * signed-in member; the shared-device audience never gets it
 * (SHARED_DEVICE.md §9.1 and its open question).
 */
export interface BoardDisplayData extends BoardDisplay {
  photos?: BoardPhoto[]
}

/** Where the board may link, already filtered by role and feature flags. */
export interface BoardLinks {
  calendar: string | null
  chores: string | null
  meals: string | null
  lists: string | null
  features: string | null
  /** Food inventory page (#263); optional for boards built before it. */
  inventory?: string | null
}

export interface TodayBoardData {
  /** Server time the snapshot was built (ISO). */
  generatedAt: string
  /** Subject protocol used to build this snapshot; routes must echo this to clients. */
  memberProtocol?: MemberProtocol
  members: BoardMember[]
  events: BoardEvent[]
  chores: BoardChore[]
  /** Online shared-schedule title context only; deliberately omitted by cache schema. */
  sharedPreparationContext?: SharedPreparationContext
  /** null when meal planning is turned off for the household. */
  dinners: BoardDinner[] | null
  /** null when the role may not open lists (never for the current roles), or for a device when lists are off. */
  shopping: ShoppingSnapshot | null
  /** Device-only, bounded list choices; absent on older servers and person boards. */
  groceryLists?: Array<{ id: string; name: string }>
  /**
   * Items to use soon (#263), expired or expiring within a few days, soonest
   * first. null when the household's `inventory` feature is off. Optional for
   * clients built before the tile.
   */
  useSoon?: BoardUseSoonItem[] | null
  links: BoardLinks
  /**
   * Weather tile (#262): null when the household has not opted in, the server
   * kill switch is off, or the forecast is unavailable (the tile is hidden).
   * Filled by the caller from src/lib/weather/board-weather.ts, not by
   * buildTodayBoard. Optional for clients built before #262.
   */
  weather?: BoardWeather | null
  /**
   * Calm display and night hours (#271), filled by loadTodayBoard
   * (./board-snapshot.ts). Optional for clients built before #271.
   */
  display?: BoardDisplayData
  /**
   * Opaque change version (#271). The board polls the version route and
   * re-fetches only when the answer differs. Optional for older servers.
   */
  version?: string
  /** A protocol-1 reader must not render a profile-only row. */
  protocolError?: ReturnType<typeof profileChoreProtocolRefusal>
}

type Db = Pick<
  PrismaClient,
  '$queryRaw' | 'user' | 'event' | 'chore' | 'familyMeal' | 'calendarSubscription' | 'listItem' | 'list' | 'inventoryItem' | 'householdMember'
>

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
  ({ audience?: 'person'; role: string | null | undefined } | { audience: 'device'; role?: never }) & {
    /** Server-selected member subject protocol. Defaults to legacy account protocol 1. */
    memberProtocol?: MemberProtocol
  }

type ProfileBoardRow = {
  id: string
  family_id: string
  name: string
  role: string
  age: number | null
  board_color: string | null
  archived_at: Date | null
  erasure_user_id: string | null
  legacy_mapping: { user_id: string } | null
  account_link: { user_id: string } | null
}

const profileBoardSelect = {
  id: true,
  family_id: true,
  name: true,
  role: true,
  age: true,
  board_color: true,
  archived_at: true,
  erasure_user_id: true,
  legacy_mapping: { select: { user_id: true } },
  account_link: { select: { user_id: true } },
} as const

const profileChoreSubjectSelect = {
  id: true,
  family_id: true,
  name: true,
  role: true,
  age: true,
  archived_at: true,
  erasure_user_id: true,
  legacy_mapping: { select: { user_id: true } },
  account_link: { select: { user_id: true } },
} as const

/**
 * A capped board read cannot use the returned rows as an existence check for
 * the legacy protocol. Keep this probe deliberately narrow: it only looks for
 * a live, non-erased canonical member subject in this household and date
 * window, and returns no subject data. The regular capped query still owns the
 * payload shown on the board.
 */
function profileCompatibilityProbeWhere(familyId: string, from: Date, to: Date) {
  return {
    family_id: familyId,
    due_date: { gte: from, lt: to },
    assigned_to: null,
    assigned_member_id: { not: null },
    member_subject_erased: false,
    assigneeMember: {
      is: {
        family_id: familyId,
        archived_at: null,
        erasure_user_id: null,
        legacy_mapping: { is: null },
        account_link: { is: null },
        role: { in: ['child', 'teen', 'parent'] },
        OR: [
          { age: null },
          { role: 'child', age: { gte: 0, lte: 17 } },
          { role: 'teen', age: { gte: 13, lte: 17 } },
          { role: 'parent', age: { gte: 18, lte: 120 } },
        ],
      },
    },
  }
}

function activeUnlinkedProfile(row: ProfileBoardRow, familyId: string): boolean {
  const role = profileRoleSchema.safeParse(row.role)
  return (
    row.family_id === familyId &&
    row.archived_at === null &&
    row.erasure_user_id === null &&
    row.legacy_mapping === null &&
    row.account_link === null &&
    role.success &&
    isProfileAgeAllowed(role.data, row.age)
  )
}

/**
 * Missing-ingredient counts per dinner id (#122), each against the
 * inventory on the dinner's own day, with the "What can I cook" rules
 * (`countMissingIngredients`). Dinners without a recipe or without
 * ingredients get no count. When the household has more items than the scan
 * cap, nothing is counted: an uncertain number is not shown.
 */
async function missingIngredientCounts(
  db: Pick<PrismaClient, 'inventoryItem'>,
  familyId: string,
  dinners: readonly DinnerRow[],
  from: Date,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const withIngredients = dinners.filter((d) => (d.recipe?.ingredients?.length ?? 0) > 0 && d.recipe!.ingredients!.length <= BOARD_DINNER_INGREDIENT_MAX)
  if (withIngredients.length === 0) return counts
  const { items, truncated } = await loadCookInventory(db, familyId, { from })
  if (truncated) return counts
  for (const d of withIngredients) {
    if (d.recipe!.ingredients!.some(line => line.ingredient.family_id !== familyId)) continue
    const day = parseDateOnly(toDateOnlyUTC(d.date))
    if (!day) continue
    const missing = countMissingIngredients(d.recipe!.ingredients!, items, day)
    if (missing !== null) counts.set(d.id, missing)
  }
  return counts
}

const NO_LINKS: BoardLinks = {
  calendar: null,
  chores: null,
  meals: null,
  lists: null,
  features: null,
  inventory: null,
}

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
  const memberProtocol = options.memberProtocol ?? 1
  const profileGate = isProfileChoreEnabled()
  const profileReaderEnabled = profileGate && memberProtocol === 2
  // A gated profile row must never disappear silently for an account-only
  // reader. The route layer turns this marker into the stable 409 refusal;
  // keeping it on the server DTO also protects direct board/version callers.
  const protocolError = memberProtocol === 2 && !profileGate ? profileChoreProtocolRefusal() : undefined
  // Always inspect the canonical profile column. A profile row can survive a
  // feature rollback, and an account-only client must receive a recoverable
  // refusal rather than silently losing that work.
  const inspectProfileRows = true
  const now = options.now ?? new Date()
  const includeShopping = isDevice ? features.lists : canRoleAccessPath(role, '/dashboard/lists')
  // #122: "N ingredients missing" on the dinner card, for signed-in members
  // only. SHARED_DEVICE.md §9.1 does not allow it on a paired tablet.
  const withMissing = !isDevice && features.meals && features.inventory

  // A UTC-day window that contains "today" through "today + COMING_UP_DAYS"
  // for every zone from UTC-12 to UTC+14.
  const windowStart = addUTCDays(startOfTodayUTC(now), -1)
  const windowEnd = addUTCDays(startOfTodayUTC(now), COMING_UP_DAYS + 2)

  const groceryLists =
    isDevice && includeShopping
      ? await db.list.findMany({
          where: { family_id: familyId, type: { in: ['grocery'] } },
          select: { id: true, name: true },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          take: 50,
        })
      : undefined

  const hiddenRoutineIds = await hiddenRoutineOccurrenceIds(db, familyId)
  const choreWhere = {
    family_id: familyId,
    id: { notIn: hiddenRoutineIds },
    due_date: { gte: windowStart, lt: windowEnd },
    ...(inspectProfileRows
      ? {
          OR: [{ assigned_to: { not: null } }, { assigned_member_id: { not: null } }],
        }
      : { assigned_to: { not: null } }),
  }
  const choreSelect = inspectProfileRows
    ? {
        id: true,
        title: true,
        due_date: true,
        status: true,
        assigned_to: true,
        assigned_member_id: true,
        member_subject_erased: true,
        frequency: true,
        recurrence_id: true,
        icon: true,
        assignee: { select: { id: true, name: true, family_id: true } },
        assigneeMember: { select: profileChoreSubjectSelect },
      }
    : {
        id: true,
        title: true,
        due_date: true,
        status: true,
        assigned_to: true,
        icon: true,
      }

  const needsProfileCompatibilityProbe = memberProtocol === 1 || !profileGate
  const [members, profileMembers, events, chores, profileCompatibilityProbe, dinners, shopping, useSoon] = await Promise.all([
    db.user.findMany({
      where: { family_id: familyId },
      select: { id: true, name: true, board_color: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
    profileReaderEnabled
      ? db.householdMember.findMany({
          where: {
            family_id: familyId,
            archived_at: null,
            erasure_user_id: null,
            legacy_mapping: { is: null },
            account_link: { is: null },
          },
          select: profileBoardSelect,
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([] as ProfileBoardRow[]),
    db.event.findMany({
      // Not yet finished, and starting before the end of the window.
      where: {
        family_id: familyId,
        end_time: { gt: now },
        start_time: { lt: windowEnd },
      },
      select: {
        id: true,
        title: true,
        start_time: true,
        end_time: true,
        is_task: true,
        source_subscription_id: true,
        source_connection_id: true,
        created_by: true,
      },
      orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
      take: MAX_EVENTS,
    }),
    db.chore.findMany({
      // Protocol 1 remains account-only unless a stored profile row needs to
      // produce MEMBER_PROTOCOL_UNAVAILABLE instead of being hidden.
      where: choreWhere,
      select: choreSelect,
      orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: MAX_CHORES,
    }),
    needsProfileCompatibilityProbe
      ? db.chore.findFirst({
          where: { ...profileCompatibilityProbeWhere(familyId, windowStart, windowEnd), id: { notIn: hiddenRoutineIds } },
          select: { id: true },
          orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve(null),
    features.meals
      ? loadBoardDinners(db, familyId, windowStart, windowEnd, withMissing)
      : Promise.resolve(null),
    includeShopping ? getOpenShoppingItems(db, familyId, 5, ['grocery']) : Promise.resolve(null),
    // "Use soon" (#263): only with the inventory feature on. Anchored one UTC
    // day ahead so the window covers the viewer's local today in every zone
    // (UTC-12..UTC+14); anything already expired is always included. The
    // client drops rows that are not yet due for its own day.
    features.inventory
      ? getUseSoonItems(db, familyId, {
          today: addUTCDays(startOfTodayUTC(now), 1),
          days: DEFAULT_USE_SOON_DAYS,
          limit: MAX_USE_SOON,
          // A use-by day stays in until it has passed in every zone, read as
          // its own capped set so stale use-by rows never crowd out rows
          // that are valid for every viewer; the client drops the ones that
          // are past for its own day (#158).
          useBySkewFrom: addUTCDays(startOfTodayUTC(now), -1),
        })
      : Promise.resolve(null),
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
  const missingByDinner =
    withMissing && dinners ? await missingIngredientCounts(db, familyId, dinners, windowStart) : new Map<string, number>()

  const accountById = new Map(members.map((m) => [m.id, m]))
  const memberIds = new Set(accountById.keys())
  const eligibleProfiles = profileMembers.filter((member) => activeUnlinkedProfile(member, familyId))
  const profileBoardId = (memberId: string) => `profile:${memberId}`
  const colorRows = [
    ...members,
    ...eligibleProfiles.map((member) => ({
      ...member,
      id: profileBoardId(member.id),
    })),
  ]
  const colors = resolveMemberColors(colorRows)
  const profileById = new Map(eligibleProfiles.map((member) => [member.id, member]))
  const boardMembers = [
    ...members.map((member) => ({
      id: member.id,
      name: member.name,
      color: colors.get(member.id),
      ...(memberProtocol === 2 && profileGate
        ? {
            subject: {
              kind: 'account' as const,
              accountId: member.id,
              name: member.name,
            },
          }
        : {}),
    })),
    ...eligibleProfiles.map((member) => ({
      id: profileBoardId(member.id),
      name: member.name,
      color: colors.get(profileBoardId(member.id)),
      subject: {
        kind: 'profile' as const,
        memberId: member.id,
        name: member.name,
        color: colors.get(profileBoardId(member.id))!,
      },
    })),
  ]

  type BoardChoreRow = {
    id: string
    title: string
    due_date: Date
    status: string
    assigned_to: string | null
    assigned_member_id: string | null
    member_subject_erased: boolean
    frequency?: string | null
    recurrence_id?: string | null
    icon: string | null
    assignee?: { id: string; name: string; family_id: string | null } | null
    assigneeMember?: {
      id: string
      family_id: string
      name: string
      role: string
      age: number | null
      archived_at: Date | null
      erasure_user_id: string | null
      legacy_mapping: { user_id: string } | null
      account_link: { user_id: string } | null
    } | null
  }
  const choreRows = chores as BoardChoreRow[]
  const scheduledOnceIds = await scheduledOnceRoutineOccurrenceIds(
    db, familyId,
    choreRows.filter((row) => row.assigned_to === null && row.assigned_member_id != null).map((row) => row.id),
  )
  const hasProfileRows =
    Boolean(profileCompatibilityProbe) || choreRows.some((chore) => chore.assigneeMember?.archived_at === null && readChoreSubject(chore, familyId)?.kind === 'profile')
  const boardChores: BoardChore[] = choreRows.flatMap((chore): BoardChore[] => {
    const base = {
      id: chore.id,
      title: chore.title,
      dueDay: toDateOnlyUTC(chore.due_date),
      status: chore.status,
      icon: isRoutineIconKey(chore.icon) ? chore.icon : null,
    }
    if (chore.assigned_to !== null) {
      const account = accountById.get(chore.assigned_to)
      if (!account) return []
      return [
        {
          ...base,
          assigneeId: chore.assigned_to,
          ...(memberProtocol === 2 && profileGate
            ? {
                subject: {
                  kind: 'account' as const,
                  accountId: account.id,
                  name: account.name,
                },
              }
            : {}),
        },
      ]
    }
    if (!profileReaderEnabled || !chore.assigned_member_id) return []
    const subject = readChoreSubject(chore, familyId)
    const profile = subject?.kind === 'profile' ? profileById.get(subject.memberId) : undefined
    if (!profile) return []
    const actionAvailability = profileChoreActionAvailability(chore, scheduledOnceIds.has(chore.id) ? "scheduled-once" : "legacy")
    return [
      {
        ...base,
        subject: {
          kind: 'profile' as const,
          memberId: profile.id,
          name: profile.name,
          color: colors.get(profileBoardId(profile.id))!,
        },
        ...(actionAvailability ? { actionAvailability } : {}),
      },
    ]
  })

  // Use only the exact already-resolved account/profile tasks. No parent map,
  // plan IDs/tokens, private details or profile-as-actor inference crosses here.
  const sharedPreparationContext = protocolError || (hasProfileRows && memberProtocol === 1)
    ? {}
    : await readSharedPreparationContext(db, {
        familyId,
        memberProtocol,
        visibleChoreIds: boardChores.map((chore) => chore.id),
      })

  return {
    generatedAt: now.toISOString(),
    memberProtocol,
    members: boardMembers,
    events: events.map((e) => {
      const sub = e.source_subscription_id ? subById.get(e.source_subscription_id) : undefined
      return {
        id: e.id,
        title: e.title,
        start: e.start_time.toISOString(),
        end: e.end_time.toISOString(),
        isTask: e.is_task,
        source: e.source_subscription_id
          ? {
              name: sub?.name ?? 'Subscribed calendar',
              color: sub?.color ?? null,
            }
          : null,
        // Imported events (subscribed feeds #232, provider sync #264) belong to
        // the feed or account, not to whoever connected it.
        addedById: !e.source_subscription_id && !e.source_connection_id && memberIds.has(e.created_by) ? e.created_by : null,
      }
    }),
    chores: boardChores,
    ...(Object.keys(sharedPreparationContext).length ? { sharedPreparationContext } : {}),
    dinners: dinners
      ? dinners.map((d) => ({
          id: d.id,
          day: toDateOnlyUTC(d.date),
          hasMoreDinners: d.hasMoreDinners,
          recipeName: d.recipe_name?.trim() || null,
          cookName: d.cook?.name ?? null,
          recipeTitle: d.recipe?.title?.trim() || null,
          prepMinutes: d.recipe?.prep_time ?? null,
          ...(missingByDinner.has(d.id) ? { missingIngredients: missingByDinner.get(d.id) } : {}),
        }))
      : null,
    shopping,
    ...(groceryLists ? { groceryLists } : {}),
    useSoon: useSoon
      ? useSoon.map((i) => ({
          id: i.id,
          name: i.name,
          location: i.location,
          expiresOn: i.expiresOn,
          dateKind: i.dateKind,
        }))
      : null,
    links: isDevice
      ? { ...NO_LINKS }
      : {
          calendar: allowedLink(role, '/dashboard/calendar', features.calendar),
          chores: allowedLink(role, '/dashboard/chores', features.chores),
          meals: allowedLink(role, '/dashboard/meals', features.meals),
          lists: allowedLink(role, '/dashboard/lists/groceries', features.lists),
          features: allowedLink(role, '/dashboard/features'),
          inventory: allowedLink(role, '/dashboard/inventory', features.inventory),
        },
    ...(hasProfileRows && memberProtocol === 1 ? { protocolError: profileChoreProtocolRefusal() } : {}),
    ...(protocolError ? { protocolError } : {}),
  }
}
