import { readVisibleChoreRows, afterCreatedChoreCursor } from "@/lib/chore-visible-read";
import { hiddenRoutineOccurrenceIds } from "@/lib/routine-occurrence-policy";
/**
 * Data for the personal home summary on /dashboard/today (#268, #269).
 *
 * Only shared-surface chore fields every member may already read (title, due
 * day, status, assignee) and member display names, the same fields the Today
 * board shows (ROLE_AND_ISOLATION_MATRIX.md). No points, XP, photos or notes.
 * Scoped by the caller's `family_id`. Not loaded in fridge mode.
 *
 * Kept next to the page, apart from today-board-data.ts (the board's DTO).
 */
import type { PrismaClient } from '@prisma/client'
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from '@/lib/dates'
import { canRoleAccessPath } from '@/lib/kid-access'
import type { HomeChore, HomeMember } from '@/lib/home-summary'
import type { MemberProtocol } from '@/lib/member-subject-contract'
import { isProfileAgeAllowed, profileRoleSchema } from '@/lib/member-subject-contract'
import { profileChoreProtocolRefusal } from '@/lib/chore-profile'

const MAX_CHORES = 120

/**
 * The home summary is intentionally capped. This bounded existence check keeps
 * protocol 1 honest when a profile-only chore sorts after those rows, including
 * during a feature rollback. It returns only an id and stays inside the
 * caller's household/date window; it never widens the summary payload.
 */
function profileCompatibilityProbeWhere(familyId: string, from: Date, to: Date) {
  return {
    family_id: familyId,
    due_date: { gte: from, lte: to },
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

const profileCompatibilitySubjectSelect = {
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

function isActiveProfileChore(
  chore: {
    assigned_to: string | null
    assigned_member_id: string | null
    member_subject_erased?: boolean
    assigneeMember?: {
      id: string
      family_id: string
      role: string
      age: number | null
      archived_at: Date | null
      erasure_user_id: string | null
      legacy_mapping: { user_id: string } | null
      account_link: { user_id: string } | null
    } | null
  },
  familyId: string,
): boolean {
  if (chore.assigned_to !== null || !chore.assigned_member_id || chore.member_subject_erased) return false
  const member = chore.assigneeMember
  const role = member ? profileRoleSchema.safeParse(member.role) : null
  return Boolean(
    member &&
      member.id === chore.assigned_member_id &&
      member.family_id === familyId &&
      member.archived_at === null &&
      member.erasure_user_id === null &&
      member.legacy_mapping === null &&
      member.account_link === null &&
      role?.success &&
      isProfileAgeAllowed(role.data, member.age),
  )
}

export interface HomeSummaryData {
  chores: HomeChore[]
  members: HomeMember[]
  toCheckCount: number
  choresHref: string | null
  /** The account-personal summary's selected subject protocol. */
  memberProtocol?: MemberProtocol
  /** A legacy summary must not silently drop a stored profile-only chore. */
  protocolError?: ReturnType<typeof profileChoreProtocolRefusal>
}

export async function loadHomeSummary(
  db: PrismaClient,
  opts: {
    familyId: string
    role: string
    now?: Date
    memberProtocol?: MemberProtocol
  },
): Promise<HomeSummaryData> {
  const start = startOfTodayUTC(opts.now ?? new Date())
  const isParent = opts.role === 'parent'

  const [chores, profileCompatibilityProbe, members, toCheckCount] = await Promise.all([
    // Due dates are UTC-midnight date-only values: yesterday..tomorrow covers
    // "today" in any zone; the client picks the viewer's local day.
    readVisibleChoreRows({
      take: MAX_CHORES, order: 'asc', tieBreakCreatedAt: true,
      read: (after, batchSize) => {
        const where = {
          family_id: opts.familyId,
          // Inspect canonical profile ownership even for the account-personal
          // summary so protocol 1 never silently loses a stored profile row.
          OR: [{ assigned_to: { not: null } }, { assigned_member_id: { not: null } }],
          due_date: { gte: addUTCDays(start, -1), lte: addUTCDays(start, 1) },
        }
        return db.chore.findMany({
          where: after ? { AND: [where, afterCreatedChoreCursor(after)] } : where,
          select: {
            id: true,
            created_at: true,
            title: true,
            due_date: true,
            status: true,
            assigned_to: true,
            assigned_member_id: true,
            member_subject_erased: true,
            assigneeMember: { select: profileCompatibilitySubjectSelect },
          },
          orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }], take: batchSize,
        })
      },
      hidden: (ids) => hiddenRoutineOccurrenceIds(db, opts.familyId, { ids }),
    }),
    opts.memberProtocol !== 2
      ? readVisibleChoreRows({
          take: 1, order: 'asc', tieBreakCreatedAt: true,
          read: (after, batchSize) => {
            const where = profileCompatibilityProbeWhere(opts.familyId, addUTCDays(start, -1), addUTCDays(start, 1))
            return db.chore.findMany({
              where: after ? { AND: [where, afterCreatedChoreCursor(after)] } : where,
              select: { id: true, due_date: true, created_at: true },
              orderBy: [{ due_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }], take: batchSize,
            })
          },
          hidden: (ids) => hiddenRoutineOccurrenceIds(db, opts.familyId, { ids }),
        }).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db.user.findMany({
      where: { family_id: opts.familyId },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    isParent
      ? db.chore.count({
          where: { family_id: opts.familyId, status: 'completed' },
        })
      : Promise.resolve(0),
  ])

  return {
    chores: chores.flatMap((c) =>
      c.assigned_to === null
        ? []
        : [
            {
              id: c.id,
              title: c.title,
              dueDay: toDateOnlyUTC(c.due_date),
              status: c.status,
              assigneeId: c.assigned_to,
            },
          ],
    ),
    members,
    toCheckCount,
    choresHref: canRoleAccessPath(opts.role, '/dashboard/chores') ? '/dashboard/chores' : null,
    memberProtocol: opts.memberProtocol ?? 1,
    ...(opts.memberProtocol !== 2 &&
    (Boolean(profileCompatibilityProbe) || chores.some((chore) => isActiveProfileChore(chore, opts.familyId)))
      ? { protocolError: profileChoreProtocolRefusal() }
      : {}),
  }
}
