#!/usr/bin/env node
// Smoke read of a RESTORED rehearsal database (#288, step 7 of
// scripts/recovery-rehearsal.sh). Not a standalone tool: it is only ever run
// by the rehearsal against its throwaway fp_rehearsal_* copy.
//
// Opens the application's Prisma client (same adapter as src/lib/prisma.ts)
// and checks what the app needs right after a restore:
//   - readiness: the same `SELECT 1` /api/health performs;
//   - both fixture households and their members are readable through Prisma;
//   - a fixture parent can still log in (bcrypt hash survived the dump);
//   - household isolation survived: no Family A member is attached to B;
//   - a few family-owned domains (events, chores, lists, meals) are readable.
//
// Writes a JSON result to the path given as argv[2] and exits non-zero on any
// failed check. Loaded with Node type stripping like scripts/fixtures.mjs.

import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const lib = new URL('../src/lib/', import.meta.url)
const { FIXTURE_IDS, FIXTURE_EMAILS, FIXTURE_PASSWORD } = await import(new URL('fixtures/dataset.ts', lib).href)
const { verifyPassword } = await import(new URL('auth.ts', lib).href)

const out = process.argv[2]
const url = process.env.DATABASE_URL ?? ''
if (!out || !/^postgres(ql)?:\/\/[^/]+\/fp_rehearsal_[a-z0-9_]+$/.test(url)) {
  console.error('recovery-rehearsal-smoke: needs an output path and a fp_rehearsal_* DATABASE_URL')
  process.exit(2)
}

const pool = new pg.Pool({ connectionString: url })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}

try {
  const ready = await prisma.$queryRaw`SELECT 1 AS ok`
  check('readiness query (as /api/health)', Array.isArray(ready) && ready.length === 1)

  const a = FIXTURE_IDS.familyA.family
  const b = FIXTURE_IDS.familyB.family
  const families = await prisma.family.findMany({ where: { id: { in: [a, b] } }, select: { id: true } })
  check('both fixture households restored', families.length === 2, families.map((f) => f.id).sort())

  const [membersA, membersB] = await Promise.all([
    prisma.user.count({ where: { family_id: a } }),
    prisma.user.count({ where: { family_id: b } }),
  ])
  check('household members readable', membersA > 0 && membersB > 0, { familyA: membersA, familyB: membersB })

  const parent = await prisma.user.findUnique({
    where: { email: FIXTURE_EMAILS.familyA.parent },
    select: { id: true, family_id: true, password: true, role: true },
  })
  const loginOk = Boolean(parent?.password) && (await verifyPassword(FIXTURE_PASSWORD, parent.password))
  check('fixture parent can log in (password hash intact)', loginOk && parent.family_id === a && parent.role === 'parent')

  const leaked = await prisma.user.count({
    where: { id: { in: Object.values(FIXTURE_IDS.familyA).filter((id) => id.startsWith('fx_user_')) }, family_id: b },
  })
  check('no Family A member attached to Family B', leaked === 0, { leaked })

  const [events, chores, lists, meals] = await Promise.all([
    prisma.event.count({ where: { family_id: a } }),
    prisma.chore.count({ where: { family_id: a } }),
    prisma.list.count({ where: { family_id: a } }),
    prisma.familyMeal.count({ where: { family_id: a } }),
  ])
  check('family-owned domains readable', events > 0 && chores > 0 && lists > 0, { events, chores, lists, meals })
} catch (err) {
  check('smoke read completed', false, err instanceof Error ? err.message : String(err))
} finally {
  await prisma.$disconnect().catch(() => {})
  await pool.end().catch(() => {})
}

const ok = checks.length > 0 && checks.every((c) => c.ok)
writeFileSync(out, JSON.stringify({ ok, checks }, null, 2))
process.exit(ok ? 0 : 1)
