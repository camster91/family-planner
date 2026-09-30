// Beta scorecard (#287): each criterion of docs/PRODUCT_PROGRAM.md measured
// from seeded counts, the week arithmetic, the output (numbers only, no ids),
// and the target guard. The SQL itself runs against Postgres in
// beta-metrics.integration.test.ts.
import fs from 'fs'
import path from 'path'
import {
  computeScorecard,
  evaluateScorecardTarget,
  formatScorecard,
  lastCompleteWeeks,
  SCORECARD_ROWS_SQL,
  weekStart,
  windowStartDay,
  type ScorecardRow,
} from '@/lib/beta-scorecard'
import { BETA_METRICS } from '@/lib/beta-metrics'
import { evaluateFixtureTarget } from '@/lib/fixtures/guard'

// Wednesday. The four complete weeks before it start on these Mondays:
const AS_OF = '2026-11-04'
const WEEKS = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']

function day(monday: string, offset: number): string {
  return new Date(Date.parse(`${monday}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}

const LOOP = ['meal_planned', 'chore_assigned', 'chore_completed', 'chore_verified', 'reward_claimed']

/** A household that completes the whole loop in `weeks`, spread over the week. */
function loopRows(household: number, weeks: string[]): ScorecardRow[] {
  return weeks.flatMap((w) => LOOP.map((metric, i) => ({ household, day: day(w, i), metric, count: 2 })))
}

function activationRows(household: number, fast: boolean): ScorecardRow[] {
  return [
    { household, day: '2026-10-01', metric: 'member_joined', count: 1 },
    { household, day: '2026-10-01', metric: 'chore_assigned', count: 1 },
    { household, day: '2026-10-01', metric: fast ? 'first_chore_within_10m' : 'first_chore_after_10m', count: 1 },
  ]
}

function byId(card: ReturnType<typeof computeScorecard>, id: string) {
  return card.criteria.find((c) => c.id === id)!
}

describe('week arithmetic', () => {
  it('uses ISO weeks (Monday, UTC) and the four complete weeks before the current one', () => {
    expect(weekStart('2026-11-04')).toBe('2026-11-02')
    expect(weekStart('2026-11-02')).toBe('2026-11-02')
    expect(weekStart('2026-11-08')).toBe('2026-11-02')
    expect(lastCompleteWeeks(AS_OF, 4)).toEqual(WEEKS)
    expect(windowStartDay(AS_OF)).toBe('2025-10-04')
  })
})

describe('computeScorecard on seeded counts', () => {
  it('no counts: every criterion is insufficient data', () => {
    const card = computeScorecard({ rows: [], householdsOptedIn: 0 }, AS_OF)
    expect(card.criteria.map((c) => [c.id, c.status])).toEqual([
      ['activation', 'insufficient-data'],
      ['weekly-core-loop', 'insufficient-data'],
      ['reliability', 'insufficient-data'],
      ['time-to-first-value', 'insufficient-data'],
      ['recovery', 'insufficient-data'],
    ])
  })

  it('a beta that meets the criteria passes activation, the weekly loop and time to first value', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].flatMap((h) => activationRows(h, h !== 5)),
      ...[1, 2, 3].flatMap((h) => loopRows(h, WEEKS)),
      ...loopRows(4, [WEEKS[1]]),
    ]
    const card = computeScorecard({ rows, householdsOptedIn: 6 }, AS_OF)
    expect(card.householdsOptedIn).toBe(6)
    expect(card.householdsReporting).toBe(5)
    expect(byId(card, 'activation')).toMatchObject({
      status: 'pass',
      measured: '5 of 5 reporting households had a member join and a chore assigned',
    })
    const loop = byId(card, 'weekly-core-loop')
    expect(loop.status).toBe('pass')
    expect(loop.measured).toContain('week of 2026-10-12: 4 of 4 active')
    expect(loop.measured).toContain('week of 2026-10-26: 3 of 3 active')
    expect(byId(card, 'time-to-first-value')).toMatchObject({
      status: 'pass',
      measured: '4 of 5 households assigned their first chore within 10 minutes of registering',
    })
    // Successes are counted; failures are not, so reliability never passes from counts alone.
    expect(byId(card, 'reliability').status).toBe('insufficient-data')
    expect(byId(card, 'reliability').measured).toMatch(/^\d+ successful core mutations counted/)
  })

  it('fails the weekly loop when one week has fewer than three complete households', () => {
    const rows = [
      ...[1, 2, 3].flatMap((h) => loopRows(h, WEEKS.filter((w) => h !== 3 || w !== WEEKS[2]))),
      // Household 3 did everything but the reward that week.
      ...LOOP.slice(0, 4).map((metric) => ({ household: 3, day: day(WEEKS[2], 1), metric, count: 1 })),
    ]
    const loop = byId(computeScorecard({ rows, householdsOptedIn: 3 }, AS_OF), 'weekly-core-loop')
    expect(loop.status).toBe('fail')
    expect(loop.measured).toContain('week of 2026-10-19: 2 of 3 active')
  })

  it('an event instead of a meal counts as planning the week', () => {
    const rows = [1, 2, 3].flatMap((h) =>
      WEEKS.flatMap((w) =>
        ['event_created', 'chore_assigned', 'chore_completed', 'chore_verified', 'reward_claimed'].map((metric) => ({
          household: h,
          day: w,
          metric,
          count: 1,
        }))
      )
    )
    expect(byId(computeScorecard({ rows, householdsOptedIn: 3 }, AS_OF), 'weekly-core-loop').status).toBe('pass')
  })

  it('is insufficient data while the counts do not yet cover four weeks', () => {
    const rows = [1, 2].flatMap((h) => loopRows(h, WEEKS.slice(2)))
    expect(byId(computeScorecard({ rows, householdsOptedIn: 2 }, AS_OF), 'weekly-core-loop').status).toBe(
      'insufficient-data'
    )
  })

  it('activation fails when five households report but fewer than five activated', () => {
    const rows = [
      ...[1, 2, 3, 4].flatMap((h) => activationRows(h, true)),
      { household: 5, day: '2026-10-02', metric: 'event_created', count: 1 },
    ]
    expect(byId(computeScorecard({ rows, householdsOptedIn: 5 }, AS_OF), 'activation').status).toBe('fail')
  })

  it('time to first value fails when half or fewer households were fast (the median is over 10 minutes)', () => {
    const rows = [1, 2, 3, 4, 5, 6].flatMap((h) => activationRows(h, h <= 3))
    expect(byId(computeScorecard({ rows, householdsOptedIn: 6 }, AS_OF), 'time-to-first-value')).toMatchObject({
      status: 'fail',
      measured: '3 of 6 households assigned their first chore within 10 minutes of registering',
    })
  })

  it('ignores counts older than 13 months or after the as-of day', () => {
    const rows = [
      { household: 1, day: '2025-10-03', metric: 'member_joined', count: 1 },
      { household: 1, day: '2026-11-05', metric: 'chore_assigned', count: 1 },
    ]
    expect(computeScorecard({ rows, householdsOptedIn: 1 }, AS_OF).householdsReporting).toBe(0)
  })

  it('the criteria only use metric names from the allowlist', () => {
    const text = fs.readFileSync(path.join(process.cwd(), 'src/lib/beta-scorecard.ts'), 'utf8')
    const used = [...text.matchAll(/'([a-z]+(?:_[a-z0-9]+)+)'/g)].map((m) => m[1])
    for (const name of used) expect(BETA_METRICS as readonly string[]).toContain(name)
  })
})

describe('output', () => {
  it('prints every criterion with its value and status, and households only as numbers', () => {
    const card = computeScorecard({ rows: [...activationRows(1, true), ...activationRows(2, false)], householdsOptedIn: 2 }, AS_OF)
    const text = formatScorecard(card)
    expect(text).toContain('Beta scorecard as of 2026-11-04')
    expect(text).toContain('Households with beta usage counts on: 2; households with counts: 2')
    for (const name of ['Activation', 'Weekly core-loop completion', 'Reliability', 'Time to first value', 'Recovery']) {
      expect(text).toContain(`${name}: `)
    }
    expect(text).toContain('Time to first value: INSUFFICIENT DATA')
    expect(text).toContain('measured:  1 of 2 households assigned their first chore within 10 minutes')
  })

  it('the query numbers households in the database and never selects the id', () => {
    const sql = SCORECARD_ROWS_SQL.replace(/\s+/g, ' ')
    expect(sql).toContain('dense_rank() OVER (ORDER BY "family_id")::int AS household')
    const selected = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf('FROM'))
    expect(selected.replace('dense_rank() OVER (ORDER BY "family_id")', '')).not.toContain('family_id')
  })
})

describe('target guard', () => {
  it('reads a local database without extra consent', () => {
    const v = evaluateScorecardTarget({ DATABASE_URL: 'postgresql://postgres@localhost:5432/fp_x' }, evaluateFixtureTarget)
    expect(v).toMatchObject({ allowed: true, remote: false, host: 'localhost', database: 'fp_x' })
  })

  it('refuses a non-local database unless BETA_SCORECARD_ALLOW_REMOTE=1', () => {
    const env = { DATABASE_URL: 'postgresql://u:secret@db.example.com:5432/family_planner' }
    const refused = evaluateScorecardTarget(env, evaluateFixtureTarget)
    expect(refused.allowed).toBe(false)
    expect(refused.reasons.join(' ')).toContain('BETA_SCORECARD_ALLOW_REMOTE=1')
    expect(JSON.stringify(refused)).not.toContain('secret')
    expect(evaluateScorecardTarget({ ...env, BETA_SCORECARD_ALLOW_REMOTE: '1' }, evaluateFixtureTarget)).toMatchObject({
      allowed: true,
      remote: true,
    })
  })

  it('refuses a missing or malformed URL', () => {
    expect(evaluateScorecardTarget({}, evaluateFixtureTarget).allowed).toBe(false)
    expect(evaluateScorecardTarget({ DATABASE_URL: 'nope' }, evaluateFixtureTarget).allowed).toBe(false)
    expect(evaluateScorecardTarget({ DATABASE_URL: 'mysql://localhost/x' }, evaluateFixtureTarget).allowed).toBe(false)
  })
})
