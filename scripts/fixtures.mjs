#!/usr/bin/env node
// Deterministic dev/test fixtures (#154).
//
//   npm run fixtures:seed    # create or reconcile fixture rows (idempotent)
//   npm run fixtures:reset   # delete fixture-owned rows only
//
// Refuses unless FIXTURES_ALLOW=1, NODE_ENV != production and DATABASE_URL
// points at a loopback or clearly disposable database. See
// docs/testing/TEST_DATA.md and src/lib/fixtures/guard.ts.
//
// The fixture modules are TypeScript loaded through Node's built-in type
// stripping (Node >= 22.18), so this script needs no extra runtime tooling.

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const lib = new URL('../src/lib/', import.meta.url)
const { assertFixtureTargetAllowed, FixtureTargetRefusedError } = await import(new URL('fixtures/guard.ts', lib).href)
const { buildFixtureDataset, resolveFixtureAnchor, FIXTURE_PASSWORD } = await import(new URL('fixtures/dataset.ts', lib).href)
const { seedFixtures, resetFixtures } = await import(new URL('fixtures/seed.ts', lib).href)
const { hashPassword, verifyPassword } = await import(new URL('auth.ts', lib).href)

const command = process.argv[2]
if (command !== 'seed' && command !== 'reset') {
  console.error('Usage: node scripts/fixtures.mjs <seed|reset>')
  process.exit(2)
}

let verdict
try {
  verdict = assertFixtureTargetAllowed(process.env)
} catch (err) {
  if (err instanceof FixtureTargetRefusedError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
}

const anchor = resolveFixtureAnchor(process.env.FIXTURES_ANCHOR_DATE)
const dataset = buildFixtureDataset(anchor)
console.log(`fixtures:${command} -> ${verdict.host}/${verdict.database} (anchor ${dataset.anchor})`)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

try {
  if (command === 'seed') {
    const summary = await seedFixtures(prisma, dataset, {
      password: FIXTURE_PASSWORD,
      hashPassword,
      verifyPassword,
    })
    console.log('upserted:', JSON.stringify(summary.upserted))
    console.log('pruned:  ', JSON.stringify(summary.pruned))
    console.log('passwords (re)hashed:', summary.passwordsRehashed)
  } else {
    const summary = await resetFixtures(prisma, dataset)
    console.log('deleted:', JSON.stringify(summary))
  }
} catch (err) {
  console.error(`fixtures:${command} failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
  await pool.end().catch(() => {})
}
