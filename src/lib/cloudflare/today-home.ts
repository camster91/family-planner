import { getD1Database, type D1Store } from './database'
import { isActiveProfileChoreRow, readChores } from './today-board'
import { addUTCDays, startOfTodayUTC } from '@/lib/dates'
import { canRoleAccessPath } from '@/lib/kid-access'
import type { MemberProtocol } from '@/lib/member-subject-contract'
import type { HomeSummaryData } from '@/app/dashboard/today/home-summary-data'
import type { GetStartedSteps, TodayStarts } from '@/app/dashboard/today/get-started-data'

function profileProtocolRefusal() {
  return { code: 'MEMBER_PROTOCOL_UNAVAILABLE' as const, recovery: 'refresh-and-retain-pending' as const, requiredProtocol: 2 as const, receivedProtocol: 1 as const }
}

/** Native D1 counterpart of the small personal summary above the shared board. */
export async function readD1HomeSummary(
  familyId: string,
  role: string,
  now = new Date(),
  memberProtocol: MemberProtocol = 1,
  database?: D1Store,
): Promise<HomeSummaryData> {
  const store = database ?? await getD1Database()
  const db = store.withSession('first-primary')
  const from = addUTCDays(startOfTodayUTC(now), -1), through = addUTCDays(startOfTodayUTC(now), 2)
  // The board's paged reader: it keeps going past hidden routine occurrences,
  // so they can never use up the cap (owner decision 2026-11-19,
  // src/lib/chore-today.ts). Overdue rows come back most recently due first.
  const [overdue, windowRows] = await Promise.all([
    readChores(store, familyId, new Date(-8640000000000000), from, false, memberProtocol, true),
    readChores(store, familyId, from, through, false, memberProtocol),
  ])
  const rows = [...overdue.rows.slice().reverse(), ...windowRows.rows]
  // The summary is account-personal: profile-only chores are not listed here.
  // A protocol-1 client gets an explicit refusal instead of a silent drop.
  const chores = rows.flatMap(row => row.assigned_to === null ? [] : [{ id: row.id, title: row.title, dueDay: new Date(row.due_date).toISOString().slice(0, 10), status: row.status, assigneeId: row.assigned_to }])
  const members = await db.prepare(`SELECT id,name FROM "User" WHERE family_id=?1 ORDER BY name ASC,id ASC`).bind(familyId).all<{ id: string; name: string }>()
  const completed = role === 'parent' ? await db.prepare(`SELECT COUNT(*) AS total FROM "Chore" WHERE family_id=?1 AND status='completed'`).bind(familyId).first<{ total: number }>() : null
  let protocolError: HomeSummaryData['protocolError']
  if (memberProtocol === 1 && rows.some(row => isActiveProfileChoreRow(row, familyId))) protocolError = profileProtocolRefusal()
  return { chores, members: members.results, toCheckCount: Number(completed?.total ?? 0), choresHref: canRoleAccessPath(role, '/dashboard/chores') ? '/dashboard/chores' : null, memberProtocol, ...(protocolError ? { protocolError } : {}) }
}

export async function readD1GetStarted(
  familyId: string,
  role: string,
  now = new Date(),
  database?: D1Store,
): Promise<GetStartedSteps | null> {
  if (role !== 'parent') return null
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const [members, invite, chore, event, calendar] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM "User" WHERE family_id=?1`).bind(familyId).first<{ total: number }>(),
    db.prepare(`SELECT id FROM "FamilyInvite" WHERE family_id=?1 AND accepted_at IS NULL AND expires_at>?2 LIMIT 1`).bind(familyId, now.getTime()).first<{ id: string }>(),
    db.prepare(`SELECT id FROM "Chore" WHERE family_id=?1 LIMIT 1`).bind(familyId).first<{ id: string }>(),
    db.prepare(`SELECT id FROM "Event" WHERE family_id=?1 LIMIT 1`).bind(familyId).first<{ id: string }>(),
    db.prepare(`SELECT 1 AS found WHERE EXISTS (SELECT 1 FROM "CalendarConnection" WHERE family_id=?1)
      OR EXISTS (SELECT 1 FROM "CalendarSubscription" WHERE family_id=?1)`).bind(familyId).first<{ found: number }>(),
  ])
  return { invited: Number(members?.total ?? 0) > 1 || invite !== null, hasChore: chore !== null, hasEvent: event !== null, hasCalendar: calendar !== null }
}

/** Native D1 counterpart of `loadTodayStarts` (honest Today empty states). */
export async function readD1TodayStarts(familyId: string, database?: D1Store): Promise<TodayStarts> {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const [chore, list] = await Promise.all([
    db.prepare(`SELECT id FROM "Chore" WHERE family_id=?1 LIMIT 1`).bind(familyId).first<{ id: string }>(),
    db.prepare(`SELECT id FROM "List" WHERE family_id=?1 AND type IN ('grocery','shopping') LIMIT 1`).bind(familyId).first<{ id: string }>(),
  ])
  return { hasChore: chore !== null, hasGroceryList: list !== null }
}
