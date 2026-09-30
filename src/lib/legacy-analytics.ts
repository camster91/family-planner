import type { PrismaClient } from '@prisma/client'
import { escapeLikePattern } from '@/lib/household-search'

/**
 * Legacy page-view/click analytics (#136, #140).
 *
 * `POST /api/analytics/event` used to write one `Activity` row per page view
 * (`type: 'event_page_view'`) and per landing-page click (`event_cta_click`),
 * with the raw browser path (which can carry record ids) and client-supplied
 * metadata in `description`. No product feature used those rows: the
 * activity feed hides them, no dashboard counts them (the analytics page's
 * "recent activity" list only picked them up by accident and now excludes
 * them), and beta measurement uses `src/lib/beta-metrics.ts` only (decision
 * D-6). The endpoint now stores nothing, and the rows already stored are
 * pruned after `LEGACY_ANALYTICS_RETENTION_DAYS`. Until then they stay in the
 * member's own data export and are deleted with the member or household.
 *
 * Legacy rows are `type` = `'event_' + <client event name>`. Real household
 * activity types that share the prefix are listed in `DOMAIN_EVENT_TYPES` and
 * are never matched.
 */

export const LEGACY_ANALYTICS_TYPE_PREFIX = 'event_'

/** Household activity types that start with the legacy prefix but are real feed rows. */
export const DOMAIN_EVENT_TYPES: readonly string[] = ['event_created']

export const LEGACY_ANALYTICS_RETENTION_DAYS = 90
export const LEGACY_ANALYTICS_RETENTION_MS = LEGACY_ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * Prisma `type` filter that matches legacy analytics rows only. Prisma's
 * `startsWith` compiles to LIKE without escaping, and `_` is a LIKE wildcard,
 * so the prefix is escaped: unescaped, `event_` also matches `events_imported`.
 */
export function legacyAnalyticsTypeFilter(): { startsWith: string; notIn: string[] } {
  return { startsWith: escapeLikePattern(LEGACY_ANALYTICS_TYPE_PREFIX), notIn: [...DOMAIN_EVENT_TYPES] }
}

export function isLegacyAnalyticsType(type: unknown): boolean {
  return (
    typeof type === 'string' && type.startsWith(LEGACY_ANALYTICS_TYPE_PREFIX) && !DOMAIN_EVENT_TYPES.includes(type)
  )
}

type PruneDb = { activity: Pick<PrismaClient['activity'], 'deleteMany'> }

/**
 * Delete one household's legacy analytics rows older than the retention
 * window. Bounded: one indexed statement (`Activity(family_id, created_at)`)
 * scoped to the caller's household. Never throws; returns the number deleted
 * (0 on failure).
 */
export async function pruneLegacyAnalytics(db: PruneDb, familyId: string, now: Date = new Date()): Promise<number> {
  if (typeof familyId !== 'string' || familyId.length === 0) return 0
  try {
    const cutoff = new Date(now.getTime() - LEGACY_ANALYTICS_RETENTION_MS)
    const result = await db.activity.deleteMany({
      where: { family_id: familyId, created_at: { lt: cutoff }, type: legacyAnalyticsTypeFilter() },
    })
    return typeof result?.count === 'number' ? result.count : 0
  } catch (error) {
    // Housekeeping only: never fail the request. No household id, no content.
    console.warn('Legacy analytics prune failed:', error instanceof Error ? error.name : 'unknown error')
    return 0
  }
}
