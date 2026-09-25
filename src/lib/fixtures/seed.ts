/**
 * Seed (create/reconcile) and reset fixture rows (#154).
 *
 * Ownership rule: a row is fixture-owned when its id starts with
 * FIXTURE_ID_PREFIX (`fx_`). Seed upserts exactly the dataset's ids and prunes
 * stale `fx_` rows inside fixture families; reset deletes `fx_` families and
 * `fx_` users (their household data follows via ON DELETE CASCADE). Neither
 * command updates or deletes a non-`fx_` row, and both refuse (before writing
 * anything) when a non-fixture row is entangled with fixture rows in a way the
 * cascade would touch.
 *
 * Callers MUST run `assertFixtureTargetAllowed` (./guard.ts) first;
 * scripts/fixtures.mjs does.
 *
 * Node type-stripping constraint: only `import type` here (see dataset.ts).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import type { FixtureDataset } from './dataset'

const PREFIX = 'fx_'

/**
 * The ONLY ownership test. Deliberately done in JS: Prisma's `startsWith`
 * compiles to LIKE without escaping `_`, so `startsWith: 'fx_'` also matches
 * ids like `fxZ...` that are not fixture rows. Queries may use `startsWith` to
 * narrow candidates, but every write goes through this filter and an explicit
 * `id IN (...)` list.
 */
export function isFixtureId(id: string): boolean {
  return id.startsWith(PREFIX)
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).filter(isFixtureId)

export interface PasswordHelpers {
  password: string
  hashPassword: (plain: string) => Promise<string>
  verifyPassword: (plain: string, hash: string) => Promise<boolean>
}

export interface SeedSummary {
  upserted: Record<string, number>
  pruned: Record<string, number>
  passwordsRehashed: number
}

export interface ResetSummary {
  families: number
  users: number
}

export class FixtureConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FixtureConflictError'
  }
}

const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 }

function stripId<T extends { id: string }>(row: T): Omit<T, 'id'> {
  const rest: Partial<T> = { ...row }
  delete rest.id
  return rest as Omit<T, 'id'>
}

/** Refuse when a non-fixture row already holds a fixture unique key. */
async function assertNoUniqueCollisions(db: PrismaClient, ds: FixtureDataset): Promise<void> {
  const emailClash = (
    await db.user.findMany({
      where: { email: { in: ds.users.map((u) => u.email) } },
      select: { id: true, email: true },
    })
  ).filter((u) => !isFixtureId(u.id))
  if (emailClash.length > 0) {
    throw new FixtureConflictError(
      `Non-fixture users already use fixture emails: ${emailClash.map((u) => u.email).join(', ')}. Nothing was written.`
    )
  }
  const inviteClash = (
    await db.family.findMany({
      where: { invite_code: { in: ds.families.map((f) => f.invite_code) } },
      select: { id: true },
    })
  ).filter((f) => !isFixtureId(f.id))
  if (inviteClash.length > 0) {
    throw new FixtureConflictError('A non-fixture family already uses a fixture invite code. Nothing was written.')
  }
}

export async function seedFixtures(
  db: PrismaClient,
  ds: FixtureDataset,
  pw: PasswordHelpers
): Promise<SeedSummary> {
  await assertNoUniqueCollisions(db, ds)

  // Hash outside the transaction (bcrypt is slow). Keep an existing hash when
  // it still verifies, so re-runs do not churn the column.
  const existing = await db.user.findMany({
    where: { id: { in: ds.users.map((u) => u.id) } },
    select: { id: true, password: true },
  })
  const existingHash = new Map(existing.map((u) => [u.id, u.password]))
  const passwordFor = new Map<string, string | undefined>()
  let fresh: string | null = null
  let passwordsRehashed = 0
  for (const u of ds.users) {
    const current = existingHash.get(u.id)
    if (current && (await pw.verifyPassword(pw.password, current))) {
      passwordFor.set(u.id, undefined) // unchanged
    } else {
      fresh ??= await pw.hashPassword(pw.password)
      passwordFor.set(u.id, fresh)
      passwordsRehashed++
    }
  }

  const familyIds = ds.families.map((f) => f.id)
  const keep = {
    users: ds.users.map((r) => r.id),
    events: ds.events.map((r) => r.id),
    chores: ds.chores.map((r) => r.id),
    rewards: ds.rewards.map((r) => r.id),
    lists: ds.lists.map((r) => r.id),
    listItems: ds.listItems.map((r) => r.id),
  }

  return db.$transaction(async (tx) => {
    const upserted: Record<string, number> = {}
    const pruned: Record<string, number> = {}

    for (const f of ds.families) {
      const data = stripId(f)
      await tx.family.upsert({
        where: { id: f.id },
        create: f,
        update: data as Prisma.FamilyUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.families = ds.families.length

    for (const u of ds.users) {
      const hash = passwordFor.get(u.id)
      const data = stripId(u)
      await tx.user.upsert({
        where: { id: u.id },
        create: { ...u, password: hash ?? (await pw.hashPassword(pw.password)) },
        update: (hash ? { ...data, password: hash } : data) as Prisma.UserUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.users = ds.users.length

    for (const e of ds.events) {
      await tx.event.upsert({
        where: { id: e.id },
        create: e,
        update: stripId(e) as Prisma.EventUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.events = ds.events.length

    // A recurring-chore expander run against the fixture DB can have generated
    // non-fx occurrences on the same (recurrence_id, due_date) as a fixture
    // occurrence; they belong to the fixture series, so clear them first.
    const seriesKeys = ds.chores.filter((c) => c.recurrence_id)
    if (seriesKeys.length > 0) {
      const clashing = (
        await tx.chore.findMany({
          where: {
            family_id: { in: familyIds },
            OR: seriesKeys.map((c) => ({ recurrence_id: c.recurrence_id, due_date: c.due_date })),
          },
          select: { id: true },
        })
      )
        .map((r) => r.id)
        .filter((id) => !isFixtureId(id))
      pruned.conflictingSeriesOccurrences = clashing.length
        ? (await tx.chore.deleteMany({ where: { id: { in: clashing }, family_id: { in: familyIds } } })).count
        : 0
    }
    for (const c of ds.chores) {
      await tx.chore.upsert({
        where: { id: c.id },
        create: c,
        update: stripId(c) as Prisma.ChoreUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.chores = ds.chores.length

    for (const r of ds.rewards) {
      await tx.reward.upsert({
        where: { id: r.id },
        create: r,
        update: stripId(r) as Prisma.RewardUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.rewards = ds.rewards.length

    for (const l of ds.lists) {
      await tx.list.upsert({
        where: { id: l.id },
        create: l,
        update: stripId(l) as Prisma.ListUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.lists = ds.lists.length

    for (const i of ds.listItems) {
      await tx.listItem.upsert({
        where: { id: i.id },
        create: i,
        update: stripId(i) as Prisma.ListItemUncheckedUpdateInput,
        select: { id: true },
      })
    }
    upserted.listItems = ds.listItems.length

    // Prune stale fx_ rows (from an older dataset version) inside fixture families.
    const stale = (rows: Array<{ id: string }>, keepIds: string[]) => {
      const k = new Set(keepIds)
      return ids(rows).filter((id) => !k.has(id))
    }
    const inFamilies = { family_id: { in: familyIds }, id: { startsWith: PREFIX } }
    const staleItems = stale(
      await tx.listItem.findMany({ where: { id: { startsWith: PREFIX }, list: { family_id: { in: familyIds } } }, select: { id: true } }),
      keep.listItems
    )
    pruned.listItems = (await tx.listItem.deleteMany({ where: { id: { in: staleItems } } })).count
    const staleLists = stale(await tx.list.findMany({ where: inFamilies, select: { id: true } }), keep.lists)
    pruned.lists = (await tx.list.deleteMany({ where: { id: { in: staleLists }, family_id: { in: familyIds } } })).count
    const staleRewards = stale(await tx.reward.findMany({ where: inFamilies, select: { id: true } }), keep.rewards)
    pruned.rewards = (await tx.reward.deleteMany({ where: { id: { in: staleRewards }, family_id: { in: familyIds } } })).count
    const staleChores = stale(await tx.chore.findMany({ where: inFamilies, select: { id: true } }), keep.chores)
    pruned.chores = (await tx.chore.deleteMany({ where: { id: { in: staleChores }, family_id: { in: familyIds } } })).count
    const staleEvents = stale(await tx.event.findMany({ where: inFamilies, select: { id: true } }), keep.events)
    pruned.events = (await tx.event.deleteMany({ where: { id: { in: staleEvents }, family_id: { in: familyIds } } })).count

    return { upserted, pruned, passwordsRehashed }
  }, TX_OPTIONS)
}

/**
 * Delete every fixture family and fixture user. Household data inside those
 * families (including rows the app created during tests) goes with them via
 * the schema's ON DELETE CASCADE.
 */
export async function resetFixtures(db: PrismaClient, ds: FixtureDataset): Promise<ResetSummary> {
  return db.$transaction(async (tx) => {
    const fams = await tx.family.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } })
    const usrs = await tx.user.findMany({ where: { id: { startsWith: PREFIX } }, select: { id: true } })
    const familyIds = Array.from(new Set([...ds.families.map((f) => f.id), ...ids(fams)])).filter(isFixtureId)
    const userIds = Array.from(new Set([...ds.users.map((u) => u.id), ...ids(usrs)])).filter(isFixtureId)

    // Fail closed: refuse if a cascade would reach a non-fixture row.
    const problems: string[] = []
    const strangers = (
      await tx.user.findMany({ where: { family_id: { in: familyIds } }, select: { id: true } })
    ).filter((u) => !isFixtureId(u.id)).length
    if (strangers > 0) problems.push(`${strangers} non-fixture user(s) belong to a fixture family`)

    const outside = { family_id: { notIn: familyIds } }
    const counts: Array<[string, number]> = [
      ['chores', await tx.chore.count({ where: { ...outside, OR: [{ assigned_to: { in: userIds } }, { created_by: { in: userIds } }] } })],
      ['events', await tx.event.count({ where: { ...outside, created_by: { in: userIds } } })],
      ['lists', await tx.list.count({ where: { ...outside, created_by: { in: userIds } } })],
      [
        'list items',
        await tx.listItem.count({
          where: { list: outside, OR: [{ added_by: { in: userIds } }, { checked_by: { in: userIds } }] },
        }),
      ],
      [
        'rewards',
        await tx.reward.count({
          where: {
            ...outside,
            OR: [{ created_by: { in: userIds } }, { claimed_by: { in: userIds } }, { approved_by: { in: userIds } }],
          },
        }),
      ],
    ]
    for (const [label, n] of counts) {
      if (n > 0) problems.push(`${n} ${label} in non-fixture families reference fixture users`)
    }
    if (problems.length > 0) {
      throw new FixtureConflictError(`Refusing to reset; nothing was deleted:\n  - ${problems.join('\n  - ')}`)
    }

    const families = (await tx.family.deleteMany({ where: { id: { in: familyIds } } })).count
    const users = (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count
    return { families, users }
  }, TX_OPTIONS)
}
