/**
 * Beta scorecard (#287, PR101 D-6): the beta criteria of
 * docs/PRODUCT_PROGRAM.md ("North-star journey and metrics") measured from the
 * BetaMetricDaily counts (src/lib/beta-metrics.ts). Used by
 * `npm run beta:scorecard` (scripts/beta-scorecard.mjs).
 *
 * Households are reported as numbers only: the query below numbers them inside
 * the database, so no household id or name ever reaches this code or its
 * output. Read-only.
 *
 * Loaded by Node's built-in type stripping from the script, so this file has
 * only type imports and no TypeScript-only runtime syntax.
 */
import type { BetaMetric } from './beta-metrics'

export type CriterionStatus = 'pass' | 'fail' | 'insufficient-data'

export interface ScorecardRow {
  /** 1..n, numbered in the database; never an id. */
  household: number
  /** `YYYY-MM-DD` (UTC). */
  day: string
  metric: string
  count: number
}

export interface CriterionResult {
  id: 'activation' | 'weekly-core-loop' | 'reliability' | 'time-to-first-value' | 'recovery'
  name: string
  criterion: string
  measured: string
  status: CriterionStatus
}

export interface Scorecard {
  asOf: string
  windowStart: string
  householdsOptedIn: number
  householdsReporting: number
  criteria: CriterionResult[]
}

/** Beta cohort size in docs/PRODUCT_PROGRAM.md. */
export const BETA_HOUSEHOLDS = 5
export const LOOP_WEEKS = 4
export const LOOP_HOUSEHOLDS_PER_WEEK = 3
/** Same 13-month window the recorder keeps (src/lib/beta-metrics.ts). */
export const SCORECARD_WINDOW_MONTHS = 13

const PLAN: BetaMetric[] = ['event_created', 'meal_planned']
const LOOP_STEPS: BetaMetric[] = ['chore_assigned', 'chore_completed', 'chore_verified', 'reward_claimed']
const CORE_MUTATIONS: BetaMetric[] = [
  'member_joined',
  'event_created',
  'meal_planned',
  'chore_assigned',
  'chore_completed',
  'chore_verified',
  'reward_claimed',
]
const FIRST_FAST: BetaMetric = 'first_chore_within_10m'
const FIRST_SLOW: BetaMetric = 'first_chore_after_10m'

/**
 * Rows of the last 13 months, households numbered in the database
 * (dense_rank over the id, which is never selected). $1 = first kept day.
 */
export const SCORECARD_ROWS_SQL = `
  SELECT dense_rank() OVER (ORDER BY "family_id")::int AS household,
         to_char("day", 'YYYY-MM-DD') AS day,
         "metric",
         "count"
  FROM "BetaMetricDaily"
  WHERE "day" >= $1::date AND "count" > 0
  ORDER BY household, day, "metric"`

/** Number of households with the counts turned on (a number only). */
export const SCORECARD_OPTED_IN_SQL = `SELECT COUNT(*)::int AS n FROM "Family" WHERE "beta_metrics_enabled" = true`

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000)
}

export function windowStartDay(asOf: string): string {
  const d = parseDay(asOf)
  return formatDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - SCORECARD_WINDOW_MONTHS, d.getUTCDate())))
}

/** Monday (UTC) of the ISO week containing `day`. */
export function weekStart(day: string): string {
  const d = parseDay(day)
  const offset = (d.getUTCDay() + 6) % 7
  return formatDay(addDays(d, -offset))
}

/** The last `n` complete ISO weeks before the week of `asOf`, oldest first (Monday dates). */
export function lastCompleteWeeks(asOf: string, n: number): string[] {
  const current = parseDay(weekStart(asOf))
  const weeks: string[] = []
  for (let i = n; i >= 1; i--) weeks.push(formatDay(addDays(current, -7 * i)))
  return weeks
}

type Totals = Map<number, Map<string, number>>

function totalsBy(rows: ScorecardRow[], keep: (row: ScorecardRow) => boolean): Totals {
  const out: Totals = new Map()
  for (const row of rows) {
    if (!keep(row)) continue
    const perHousehold = out.get(row.household) ?? new Map<string, number>()
    perHousehold.set(row.metric, (perHousehold.get(row.metric) ?? 0) + row.count)
    out.set(row.household, perHousehold)
  }
  return out
}

function has(m: Map<string, number> | undefined, metric: string): boolean {
  return (m?.get(metric) ?? 0) > 0
}

function completedLoop(m: Map<string, number>): boolean {
  return PLAN.some((p) => has(m, p)) && LOOP_STEPS.every((s) => has(m, s))
}

export function computeScorecard(
  input: { rows: ScorecardRow[]; householdsOptedIn: number },
  asOf: string
): Scorecard {
  const windowStart = windowStartDay(asOf)
  const rows = input.rows.filter((r) => r.day >= windowStart && r.day <= asOf && r.count > 0)
  const all = totalsBy(rows, () => true)
  const reporting = all.size
  const criteria: CriterionResult[] = []

  // Activation: family creation (implied by counts existing), a member joined, first assignment.
  const activated = [...all.values()].filter((m) => has(m, 'member_joined') && has(m, 'chore_assigned')).length
  criteria.push({
    id: 'activation',
    name: 'Activation',
    criterion: `${BETA_HOUSEHOLDS} independent households complete family creation, invite, and first assignment`,
    measured: `${activated} of ${reporting} reporting households had a member join and a chore assigned`,
    status: activated >= BETA_HOUSEHOLDS ? 'pass' : reporting < BETA_HOUSEHOLDS ? 'insufficient-data' : 'fail',
  })

  // Weekly core loop: the last four complete ISO weeks.
  const weeks = lastCompleteWeeks(asOf, LOOP_WEEKS)
  const perWeek = weeks.map((monday) => {
    const sunday = formatDay(addDays(parseDay(monday), 6))
    const totals = totalsBy(rows, (r) => r.day >= monday && r.day <= sunday)
    const done = [...totals.values()].filter(completedLoop).length
    return { monday, active: totals.size, done }
  })
  const earliest = rows.reduce<string | null>((min, r) => (min === null || r.day < min ? r.day : min), null)
  const coversWindow = earliest !== null && earliest <= weeks[0]
  const everyWeek = perWeek.every((w) => w.done >= LOOP_HOUSEHOLDS_PER_WEEK)
  criteria.push({
    id: 'weekly-core-loop',
    name: 'Weekly core-loop completion',
    criterion: `At least ${LOOP_HOUSEHOLDS_PER_WEEK} of ${BETA_HOUSEHOLDS} beta households complete the full loop in each of four weeks`,
    measured:
      'households completing plan week -> assign -> complete -> verify -> claim, per week: ' +
      perWeek.map((w) => `week of ${w.monday}: ${w.done} of ${w.active} active`).join('; '),
    status: everyWeek ? 'pass' : coversWindow ? 'fail' : 'insufficient-data',
  })

  // Reliability: successes are counted, failures deliberately are not.
  const successes = rows.filter((r) => (CORE_MUTATIONS as string[]).includes(r.metric)).reduce((n, r) => n + r.count, 0)
  criteria.push({
    id: 'reliability',
    name: 'Reliability',
    criterion: '>=99% successful core mutations in beta; zero cross-family data exposure',
    measured:
      `${successes} successful core mutations counted. Failed requests are not counted here: ` +
      'take the failure rate from server logs (5xx on the core routes); cross-family exposure is covered by the isolation tests',
    status: 'insufficient-data',
  })

  // Time to first value: households per bucket; median <= 10 min iff more than half are fast.
  let fast = 0
  let slow = 0
  for (const m of all.values()) {
    if (has(m, FIRST_FAST)) fast += 1
    else if (has(m, FIRST_SLOW)) slow += 1
  }
  const measuredFirst = fast + slow
  criteria.push({
    id: 'time-to-first-value',
    name: 'Time to first value',
    criterion: 'Median <=10 minutes from registration to first assigned chore',
    measured: `${fast} of ${measuredFirst} households assigned their first chore within 10 minutes of registering`,
    status:
      measuredFirst < BETA_HOUSEHOLDS ? 'insufficient-data' : fast * 2 > measuredFirst ? 'pass' : 'fail',
  })

  criteria.push({
    id: 'recovery',
    name: 'Recovery',
    criterion: 'Backup restored in isolation and review rollback rehearsed before production promotion',
    measured: 'Not a usage count: see the recovery rehearsal evidence (scripts/recovery-rehearsal.sh, #288)',
    status: 'insufficient-data',
  })

  return { asOf, windowStart, householdsOptedIn: input.householdsOptedIn, householdsReporting: reporting, criteria }
}

const STATUS_WORD: Record<CriterionStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  'insufficient-data': 'INSUFFICIENT DATA',
}

export function formatScorecard(card: Scorecard): string {
  const lines = [
    `Beta scorecard as of ${card.asOf} (UTC; counts from ${card.windowStart})`,
    `Households with beta usage counts on: ${card.householdsOptedIn}; households with counts: ${card.householdsReporting}`,
    '',
  ]
  for (const c of card.criteria) {
    lines.push(`${c.name}: ${STATUS_WORD[c.status]}`)
    lines.push(`  criterion: ${c.criterion}`)
    lines.push(`  measured:  ${c.measured}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Target guard

export const SCORECARD_ALLOW_REMOTE_ENV = 'BETA_SCORECARD_ALLOW_REMOTE'

type EnvLike = Record<string, string | undefined>
type LocalVerdict = { allowed: boolean; reasons: string[]; host?: string; database?: string }

export interface ScorecardTargetVerdict {
  allowed: boolean
  remote: boolean
  reasons: string[]
  host?: string
  database?: string
}

/**
 * Local/disposable databases (the fixture guard's rules) are allowed. Any
 * other target, production included, needs BETA_SCORECARD_ALLOW_REMOTE=1: the
 * scorecard only reads, but pointing it at real household data is a
 * deliberate act.
 */
export function evaluateScorecardTarget(
  env: EnvLike,
  evaluateLocal: (env: EnvLike) => LocalVerdict
): ScorecardTargetVerdict {
  const raw = (env.DATABASE_URL ?? '').trim()
  if (!raw) return { allowed: false, remote: false, reasons: ['DATABASE_URL is not set'] }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { allowed: false, remote: false, reasons: ['DATABASE_URL is not a valid URL'] }
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { allowed: false, remote: false, reasons: ['DATABASE_URL must use postgres:// or postgresql://'] }
  }
  const local = evaluateLocal({ DATABASE_URL: raw, FIXTURES_ALLOW: '1' })
  const base = { host: local.host, database: local.database }
  if (local.allowed) return { allowed: true, remote: false, reasons: [], ...base }
  if (env[SCORECARD_ALLOW_REMOTE_ENV] === '1') return { allowed: true, remote: true, reasons: [], ...base }
  return {
    allowed: false,
    remote: true,
    reasons: [...local.reasons, `${SCORECARD_ALLOW_REMOTE_ENV}=1 is required to read a non-local database`],
    ...base,
  }
}
