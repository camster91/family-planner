/**
 * Beta usage counts (#287, PR101 D-6; docs/PRODUCT_PROGRAM.md "How the beta
 * criteria are measured").
 *
 * A privacy-safe store that keeps counts and nothing else, separate from
 * `src/lib/analytics.ts` (which keeps free-form metadata tied to a user):
 *
 * - One `BetaMetricDaily` row per household, UTC day and metric name, holding
 *   a count. No user id, no text, no content, no role.
 * - Metric names are the fixed list `BETA_METRICS`, derived from the beta
 *   criteria and nothing more. An unknown name is a type error and, at run
 *   time, a logged no-op.
 * - Per-household opt-in (`Family.beta_metrics_enabled`, default off). While
 *   off nothing is counted; a parent turning it off deletes the household's
 *   rows (`setBetaMetricsEnabled`).
 * - Kept 13 months: each recording also deletes the household's rows older
 *   than that (no scheduled job). Deleted with the household.
 * - Recording never fails the caller's request: every error is caught and
 *   logged without the household id. Callers record only after their own write
 *   committed, with the base client (never inside their transaction).
 *
 * This file is the only writer of the table (source-scan test in
 * src/lib/__tests__/beta-metrics.test.ts).
 */
import type { Prisma, PrismaClient } from '@prisma/client'

export const BETA_METRICS = [
  // Activation: family creation, invite (a member joined), first assignment.
  'member_joined',
  // Weekly core loop: plans week -> assigns chore -> child completes ->
  // parent verifies -> child claims reward.
  'event_created',
  'meal_planned',
  'chore_assigned',
  'chore_completed',
  'chore_verified',
  'reward_claimed',
  // Time to first value: the household's first chore, bucketed by the time
  // since its first member registered (the median is <= 10 minutes exactly
  // when more than half of the households are in the first bucket).
  'first_chore_within_10m',
  'first_chore_after_10m',
] as const

export type BetaMetric = (typeof BETA_METRICS)[number]

/** Metrics a caller records directly; the first-chore buckets come from `recordChoreAssigned`. */
export type DirectBetaMetric = Exclude<BetaMetric, 'first_chore_within_10m' | 'first_chore_after_10m'>

/** Retention: 13 calendar months (UTC days). */
export const BETA_METRICS_RETENTION_MONTHS = 13

export function isBetaMetric(value: unknown): value is BetaMetric {
  return typeof value === 'string' && (BETA_METRICS as readonly string[]).includes(value)
}

/** `YYYY-MM-DD` of `now` in UTC. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** The first UTC day that is still kept on `now` (rows before it are pruned). */
export function retentionCutoffDay(now: Date): string {
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - BETA_METRICS_RETENTION_MONTHS, now.getUTCDate())
  )
  return utcDay(cutoff)
}

type RecorderDb = Pick<PrismaClient, '$executeRaw'>

function logFailure(error: unknown) {
  // Never the household id, never the metric's context.
  console.warn('Beta metric not recorded:', error instanceof Error ? error.name : 'unknown error')
}

/**
 * Add one to today's count of `metric` for the household, if it has the
 * counts turned on. One statement: the household row is read `FOR SHARE`, so a
 * parent turning the counts off (which locks the row, then deletes) either
 * waits for this increment and deletes it, or makes this a no-op.
 */
export async function recordBetaMetric(
  db: RecorderDb,
  familyId: string,
  metric: DirectBetaMetric,
  options: { now?: Date } = {}
): Promise<void> {
  try {
    if (!isBetaMetric(metric) || metric.startsWith('first_chore_')) {
      console.warn('Beta metric not recorded: unknown metric name')
      return
    }
    if (typeof familyId !== 'string' || familyId.length === 0) return
    const now = options.now ?? new Date()
    const day = utcDay(now)
    const cutoff = retentionCutoffDay(now)
    await db.$executeRaw`
      WITH target AS (
        SELECT "id" FROM "Family" WHERE "id" = ${familyId} AND "beta_metrics_enabled" = true FOR SHARE
      ), bumped AS (
        INSERT INTO "BetaMetricDaily" ("family_id", "day", "metric", "count")
        SELECT "id", ${day}::date, ${metric}, 1 FROM target
        ON CONFLICT ("family_id", "day", "metric") DO UPDATE SET "count" = "BetaMetricDaily"."count" + 1
        RETURNING 1
      )
      DELETE FROM "BetaMetricDaily"
      WHERE "family_id" = ${familyId} AND "day" < ${cutoff}::date AND EXISTS (SELECT 1 FROM bumped)`
  } catch (error) {
    logFailure(error)
  }
}

/**
 * A parent assigned a chore (`chore` is the row just created). Records
 * `chore_assigned`, and when it is the household's first chore, one of the two
 * time-to-first-value buckets: the chore's creation time minus the earliest
 * member registration of the household, at most once per household. A
 * household that turned the counts on after its first chore gets no bucket
 * (an earlier chore exists), so a late opt-in is never misread as slow.
 */
export async function recordChoreAssigned(
  db: RecorderDb,
  familyId: string,
  chore: { id: string },
  options: { now?: Date } = {}
): Promise<void> {
  await recordBetaMetric(db, familyId, 'chore_assigned', options)
  try {
    if (typeof familyId !== 'string' || familyId.length === 0) return
    const day = utcDay(options.now ?? new Date())
    await db.$executeRaw`
      INSERT INTO "BetaMetricDaily" ("family_id", "day", "metric", "count")
      SELECT f."id", ${day}::date,
        CASE
          WHEN c."created_at" - (SELECT MIN(u."created_at") FROM "User" u WHERE u."family_id" = f."id")
               <= INTERVAL '10 minutes'
          THEN 'first_chore_within_10m'
          ELSE 'first_chore_after_10m'
        END,
        1
      FROM "Family" f
      JOIN "Chore" c ON c."id" = ${chore.id} AND c."family_id" = f."id"
      WHERE f."id" = ${familyId}
        AND f."beta_metrics_enabled" = true
        AND NOT EXISTS (
          SELECT 1 FROM "Chore" e
          WHERE e."family_id" = f."id" AND e."id" <> c."id" AND e."created_at" <= c."created_at"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "BetaMetricDaily" b
          WHERE b."family_id" = f."id" AND b."metric" IN ('first_chore_within_10m', 'first_chore_after_10m')
        )
      FOR SHARE OF f
      ON CONFLICT ("family_id", "day", "metric") DO UPDATE SET "count" = "BetaMetricDaily"."count" + 1`
  } catch (error) {
    logFailure(error)
  }
}

type SwitchDb = Pick<Prisma.TransactionClient, 'family' | 'betaMetricDaily' | '$queryRaw'>

/**
 * Turn the household's counts on or off, inside the caller's transaction.
 * Off also deletes every stored count of the household. The household row is
 * locked first, so an increment running at the same time either lands before
 * (and is deleted here) or waits and sees the switch off.
 * Returns the stored value before the change, or null if the household is gone.
 */
export async function setBetaMetricsEnabled(
  tx: SwitchDb,
  familyId: string,
  enabled: boolean
): Promise<{ before: boolean } | null> {
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${familyId} FOR UPDATE`
  const family = await tx.family.findUnique({ where: { id: familyId }, select: { beta_metrics_enabled: true } })
  if (!family) return null
  const before = family.beta_metrics_enabled === true
  if (before !== enabled) {
    await tx.family.update({ where: { id: familyId }, data: { beta_metrics_enabled: enabled }, select: { id: true } })
  }
  if (!enabled) await tx.betaMetricDaily.deleteMany({ where: { family_id: familyId } })
  return { before }
}
