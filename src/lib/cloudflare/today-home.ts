import { getD1Database, type D1Store } from './database'
import { hiddenD1RoutineOccurrenceIds } from './chore-read-policy'
import { addUTCDays, startOfTodayUTC } from '@/lib/dates'
import { canRoleAccessPath } from '@/lib/kid-access'
import type { MemberProtocol } from '@/lib/member-subject-contract'
import type { HomeSummaryData } from '@/app/dashboard/today/home-summary-data'
import type { GetStartedSteps, TodayStarts } from '@/app/dashboard/today/get-started-data'
import { MAX_OVERDUE_CHORES } from '@/lib/chore-today'

type SummaryRow = { id: string; title: string; due_date: number; status: string; assigned_to: string | null; assigned_member_id: string | null; member_subject_erased: number }

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
  const [result, overdue] = await Promise.all([
    db.prepare(`SELECT c.id,c.title,c.due_date,c.status,c.assigned_to,c.assigned_member_id,c.member_subject_erased
    FROM "Chore" c WHERE c.family_id=?1 AND c.due_date>=?2 AND c.due_date<?3
      AND (c.assigned_to IS NOT NULL OR c.assigned_member_id IS NOT NULL)
    ORDER BY c.due_date ASC,c.created_at ASC,c.id ASC LIMIT 121`).bind(familyId, from.getTime(), through.getTime()).all<SummaryRow>(),
    // Still-open chores due before the window (owner decision 2026-11-19,
    // src/lib/chore-today.ts): same household, bounded, most recently due first.
    db.prepare(`SELECT c.id,c.title,c.due_date,c.status,c.assigned_to,c.assigned_member_id,c.member_subject_erased
    FROM "Chore" c WHERE c.family_id=?1 AND c.due_date<?2 AND c.status IN ('pending','in_progress','overdue')
      AND (c.assigned_to IS NOT NULL OR c.assigned_member_id IS NOT NULL)
    ORDER BY c.due_date DESC,c.created_at DESC,c.id DESC LIMIT ?3`).bind(familyId, from.getTime(), MAX_OVERDUE_CHORES * 2).all<SummaryRow>(),
  ])
  const rows = [...overdue.results.slice().reverse(), ...result.results]
  const hidden = new Set(await hiddenD1RoutineOccurrenceIds(familyId, { ids: rows.map(row => row.id) }, store))
  const overdueVisible = overdue.results.filter(row => !hidden.has(row.id) && row.assigned_to !== null).slice(0, MAX_OVERDUE_CHORES).reverse()
  const windowVisible = result.results.filter(row => !hidden.has(row.id) && row.assigned_to !== null).slice(0, 120)
  const chores = [...overdueVisible, ...windowVisible].map(row => ({ id: row.id, title: row.title, dueDay: new Date(row.due_date).toISOString().slice(0, 10), status: row.status, assigneeId: row.assigned_to! }))
  const members = await db.prepare(`SELECT id,name FROM "User" WHERE family_id=?1 ORDER BY name ASC,id ASC`).bind(familyId).all<{ id: string; name: string }>()
  const completed = role === 'parent' ? await db.prepare(`SELECT COUNT(*) AS total FROM "Chore" WHERE family_id=?1 AND status='completed'`).bind(familyId).first<{ total: number }>() : null
  let protocolError: HomeSummaryData['protocolError']
  if (memberProtocol !== 2) {
    const profiles = rows.filter(row => row.assigned_to === null && row.assigned_member_id !== null && row.member_subject_erased === 0)
    if (profiles.length && memberProtocol === 1) protocolError = profileProtocolRefusal()
  }
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
