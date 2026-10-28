import type { CalendarSubscriptionActor } from '@/lib/calendar-subscription-access'
import { MAX_SUBSCRIPTIONS_PER_FAMILY } from '@/lib/calendar-subscription-list'
import { STALE_AFTER_MS } from '@/lib/calendar-import/sync-values'
import { getD1Database, type D1Store } from './database'
export async function readD1StaleCalendarSubscriptions(familyId: string, now: Date, actor?: CalendarSubscriptionActor, database?: D1Store) {
  const db = database ?? await getD1Database()
  if (actor && (actor.familyId !== familyId || !['parent', 'teen'].includes(actor.role) || !Number.isSafeInteger(actor.generation) || actor.generation < 0)) return []
  return (await db.withSession('first-primary').prepare(`SELECT id FROM "CalendarSubscription"
    WHERE family_id=?1 AND (last_fetched_at IS NULL OR last_fetched_at<?2)
    ${actor ? `AND EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
      WHERE u.id=?4 AND u.family_id=?1 AND u.role=?5 AND u.token_version=?6)` : ''}
    ORDER BY last_fetched_at,id LIMIT ?3`).bind(familyId, now.getTime() - STALE_AFTER_MS, MAX_SUBSCRIPTIONS_PER_FAMILY,
      ...(actor ? [actor.userId, actor.role, actor.generation] : [])).all<{ id: string }>()).results
}
