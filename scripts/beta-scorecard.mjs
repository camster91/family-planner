#!/usr/bin/env node
// Beta scorecard (#287, PR101 D-6).
//
//   npm run beta:scorecard                      # as of today (UTC), plain text
//   npm run beta:scorecard -- --json            # the same as JSON
//   npm run beta:scorecard -- --as-of 2026-11-02
//
// Reads the BetaMetricDaily counts and prints each beta criterion of
// docs/PRODUCT_PROGRAM.md with its measured value and PASS / FAIL /
// INSUFFICIENT DATA. Households appear as numbers only (numbered inside the
// database; no id or name is read). Read-only: one READ ONLY transaction.
//
// Local/disposable databases only (fixture guard rules, src/lib/fixtures/guard.ts)
// unless BETA_SCORECARD_ALLOW_REMOTE=1 is set. Recruiting beta households, and
// reading production, need Cameron's approval (AGENTS.md).
//
// Needs Node >= 22.18 (TypeScript modules loaded via built-in type stripping).

import pg from 'pg'

const lib = new URL('../src/lib/', import.meta.url)
const { evaluateFixtureTarget } = await import(new URL('fixtures/guard.ts', lib).href)
const sc = await import(new URL('beta-scorecard.ts', lib).href)

const USAGE = 'Usage: npm run beta:scorecard -- [--json] [--as-of YYYY-MM-DD]'

const argv = process.argv.slice(2)
let json = false
let asOf = new Date().toISOString().slice(0, 10)
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--json') json = true
  else if (arg === '--as-of' && /^\d{4}-\d{2}-\d{2}$/.test(argv[i + 1] ?? '')) asOf = argv[++i]
  else if (arg === '--help' || arg === '-h') {
    console.log(USAGE)
    process.exit(0)
  } else {
    console.error(USAGE)
    process.exit(2)
  }
}

const verdict = sc.evaluateScorecardTarget(process.env, evaluateFixtureTarget)
if (!verdict.allowed) {
  console.error(`Refusing to read this database:\n  - ${verdict.reasons.join('\n  - ')}`)
  process.exit(1)
}
if (!json) {
  console.log(`beta:scorecard -> ${verdict.host}/${verdict.database}${verdict.remote ? ' (NON-LOCAL TARGET, allowed by env)' : ''}`)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
let card
try {
  await client.query('BEGIN READ ONLY')
  const rows = (await client.query(sc.SCORECARD_ROWS_SQL, [sc.windowStartDay(asOf)])).rows
  const optedIn = (await client.query(sc.SCORECARD_OPTED_IN_SQL)).rows[0]?.n ?? 0
  await client.query('COMMIT')
  card = sc.computeScorecard({ rows, householdsOptedIn: optedIn }, asOf)
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error('beta:scorecard failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  await client.end()
}

if (card) console.log(json ? JSON.stringify(card, null, 2) : sc.formatScorecard(card))
