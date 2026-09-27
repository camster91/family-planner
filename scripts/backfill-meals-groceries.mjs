#!/usr/bin/env node
// Legacy meal/grocery -> canonical backfill (ADR-0007, #250).
//
//   npm run backfill:meals-groceries                                  # dry-run, every family, writes nothing
//   npm run backfill:meals-groceries -- --apply --family <id>         # copy one family
//   npm run backfill:meals-groceries -- --reverse --family <id>       # undo that family's backfill jobs
//
// Refuses any target that is not local/disposable (fixture guard rules,
// src/lib/fixtures/guard.ts) unless BOTH --i-have-approval is passed and
// BACKFILL_ALLOW_PRODUCTION=1 is set. A production run needs Cameron's
// explicit approval for that run: docs/runbooks/MEALS_GROCERIES_BACKFILL.md.
//
// Legacy tables are only read. Rules and invariants:
// src/lib/backfill/meals-groceries.ts and docs/architecture/MEALS_AND_GROCERIES.md.
//
// Needs Node >= 22.18 (TypeScript modules loaded via built-in type stripping).

import pg from 'pg'

const lib = new URL('../src/lib/', import.meta.url)
const { evaluateFixtureTarget } = await import(new URL('fixtures/guard.ts', lib).href)
const bf = await import(new URL('backfill/meals-groceries.ts', lib).href)

let args
try {
  args = bf.parseBackfillArgs(process.argv.slice(2))
} catch (err) {
  if (err instanceof bf.BackfillUsageError) {
    console.error(`${err.message}\n\n${bf.BACKFILL_USAGE}`)
    process.exit(2)
  }
  throw err
}
if (args.help) {
  console.log(bf.BACKFILL_USAGE)
  process.exit(0)
}

const verdict = bf.evaluateBackfillTarget(process.env, { approvalFlag: args.approvalFlag }, evaluateFixtureTarget)
if (!verdict.allowed) {
  console.error(`Refusing to run the meal/grocery backfill against this database:\n  - ${verdict.reasons.join('\n  - ')}`)
  process.exit(1)
}
const log = args.json ? () => {} : (line) => console.log(line)
log(
  `backfill:meals-groceries ${args.mode} -> ${verdict.host}/${verdict.database}${verdict.approvedRemote ? ' (APPROVED NON-LOCAL TARGET)' : ''}`
)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const results = []
let failed = false
try {
  let families = args.families
  if (families.length === 0) {
    families = (await client.query('SELECT id FROM "Family" ORDER BY created_at, id')).rows.map((r) => r.id)
  }
  for (const familyId of families) {
    try {
      if (args.mode === 'reverse') {
        const r = await bf.reverseFamily(client, familyId, { jobId: args.jobId })
        results.push(r)
        log(bf.formatReverseResult(r))
      } else {
        const r = await bf.runFamily(client, familyId, { mode: args.mode, startedBy: args.startedBy })
        results.push(r)
        if (!r.reconciled) failed = true
        const c = r.counts.source
        const hasLegacy = c.mealPlans + c.mealPlanEntries + c.shoppingLists + c.shoppingItems > 0
        if (hasLegacy || args.families.length > 0) log(bf.formatRunResult(r))
      }
    } catch (err) {
      failed = true
      const message = err instanceof Error ? err.message : String(err)
      results.push({ familyId, mode: args.mode, error: message })
      log(`family ${familyId} [${args.mode}] FAILED (rolled back): ${message}`)
    }
  }
  if (args.mode !== 'reverse') {
    const total = results.reduce((n, r) => n + (r.rowsWritten ?? 0), 0)
    log(`families: ${families.length}; canonical rows written: ${total}${args.mode === 'dry-run' ? ' (dry-run: nothing written)' : ''}`)
  }
  if (args.json) console.log(JSON.stringify({ mode: args.mode, target: { host: verdict.host, database: verdict.database }, results }, null, 2))
} finally {
  await client.end().catch(() => {})
}
if (failed) process.exitCode = 1
