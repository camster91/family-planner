/**
 * ADR-0007 backfill rehearsal (#250) against a real database, on the #154
 * fixtures. Skipped unless RUN_DB_INTEGRATION=1. The fixture target guard
 * still applies, so FIXTURES_ALLOW=1 and a loopback or disposable
 * DATABASE_URL are also required; run `node scripts/migrate.js` first.
 *
 * Covers: CLI dry-run writes nothing; apply matches the section 6 counts;
 * re-apply creates 0 rows; reverse removes exactly the created rows (and
 * keeps modified ones); legacy tables byte-identical throughout; two-household
 * isolation; the foreign recipe_id nulled; skipped rows archived verbatim;
 * MealPlan -> ImportJob mappings; fixtures:reset still cleans up.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import pg from 'pg'
import { hashPassword, verifyPassword } from '@/lib/auth'
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { buildFixtureDataset, FIXTURE_IDS, FIXTURE_LEGACY_MEAL_IDS, FIXTURE_PASSWORD } from '@/lib/fixtures/dataset'
import { resetFixtures, seedFixtures } from '@/lib/fixtures/seed'
import { BACKFILL_SOURCE_APP, reverseFamily, runFamily } from '../meals-groceries'
import type { FamilyRunResult } from '../meals-groceries'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

jest.setTimeout(120_000)

const ROOT = path.resolve(__dirname, '../../../..')
const LEGACY = ['MealPlan', 'MealPlanEntry', 'ShoppingList', 'ShoppingItem'] as const
const CANONICAL = ['FamilyMeal', 'List', 'ListItem', 'ImportJob', 'ImportedRecord', 'Recipe', 'Ingredient', 'RecipeIngredient'] as const
const L = FIXTURE_LEGACY_MEAL_IDS
const A = FIXTURE_IDS.familyA.family
const B = FIXTURE_IDS.familyB.family

function runCli(args: string[], env: Record<string, string | undefined> = process.env) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      'scripts/backfill-meals-groceries.mjs',
      ...args,
    ],
    { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: 'utf8' }
  )
}

describeWithDatabase('meal/grocery backfill against a database', () => {
  let prisma: NonNullable<typeof import('@/lib/prisma').prisma>
  let pool: pg.Pool
  const ds = buildFixtureDataset()
  const pw = { password: FIXTURE_PASSWORD, hashPassword, verifyPassword }

  /** md5 over every row's row_to_json, in id order: byte-level table fingerprint. */
  async function hashes(tables: readonly string[]) {
    const out: Record<string, string> = {}
    for (const t of tables) {
      const r = await pool.query(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, E'\\n' ORDER BY x.id), '')) AS h FROM "${t}" x`
      )
      out[t] = `${r.rows[0].n}:${r.rows[0].h}`
    }
    return out
  }

  async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      return await fn(c)
    } finally {
      c.release()
    }
  }
  const apply = (familyId: string) => withClient((c) => runFamily(c, familyId, { mode: 'apply' }))
  const reverse = (familyId: string, jobId?: string) => withClient((c) => reverseFamily(c, familyId, { jobId }))

  let baseline: Record<string, string>
  let legacyBaseline: Record<string, string>

  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    const mod = await import('@/lib/prisma')
    if (!mod.prisma) throw new Error('Integration database is not configured')
    prisma = mod.prisma
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
    await resetFixtures(prisma, ds)
    await seedFixtures(prisma, ds, pw)
    baseline = await hashes(CANONICAL)
    legacyBaseline = await hashes(LEGACY)
  })

  afterAll(async () => {
    if (prisma) {
      await resetFixtures(prisma, ds).catch(() => {})
      await prisma.$disconnect()
    }
    await pool?.end()
  })

  afterEach(async () => {
    // Legacy tables are never modified, whatever a test did.
    expect(await hashes(LEGACY)).toEqual(legacyBaseline)
  })

  it('refuses a non-local target before connecting unless approved twice over', () => {
    const env = { ...process.env, DATABASE_URL: 'postgresql://u:p@db.example.invalid:5432/family_planner' }
    const refused = runCli(['--apply', '--family', A], env)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toMatch(/Refusing to run/)
    expect(refused.stderr).toMatch(/--i-have-approval/)
    const flagOnly = runCli(['--i-have-approval'], env)
    expect(flagOnly.status).toBe(1)
    expect(flagOnly.stderr).toMatch(/BACKFILL_ALLOW_PRODUCTION=1/)
  })

  it('dry-run (CLI default) prints the section 6 counts and writes nothing', async () => {
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--disable-warning=ExperimentalWarning',
        'scripts/backfill-meals-groceries.mjs',
        '--json',
        '--family',
        A,
        '--family',
        B,
      ],
      { cwd: ROOT, env: process.env, encoding: 'utf8' }
    )
    const report = JSON.parse(out) as { mode: string; results: FamilyRunResult[] }
    expect(report.mode).toBe('dry-run')
    const [a, b] = report.results
    expect(a.counts.meals).toEqual({ created: 2, linked: 1, skipped: 1, alreadyMapped: 0 })
    expect(a.counts.lists.created).toBe(1)
    expect(a.counts.items).toEqual({ created: 2, skipped: 0, alreadyMapped: 0 })
    expect(b.counts.meals).toEqual({ created: 0, linked: 0, skipped: 1, alreadyMapped: 0 })
    expect(b.counts.items).toEqual({ created: 1, skipped: 1, alreadyMapped: 0 })
    expect(b.counts.recipeRefsNulled).toBe(1)
    expect(b.nulled).toEqual([{ sourceModel: 'ShoppingItem', sourceId: L.familyB.itemForeignRecipe, reason: 'foreign_recipe' }])
    for (const r of report.results) {
      expect(r.reconciled).toBe(true)
      expect(r.rowsWritten).toBe(0)
      expect(r.jobId).toBeNull()
    }
    // Counts only on stdout: no legacy content leaks into the report.
    expect(out).not.toMatch(/Paper towels|Lasagna sheets|Tomato soup/)
    expect(await hashes(CANONICAL)).toEqual(baseline)
  })

  it('apply creates exactly the expected rows, per household, with provenance', async () => {
    const a = await apply(A)
    const b = await apply(B)
    expect(a).toMatchObject({ reconciled: true, rowsWritten: 6 })
    expect(b).toMatchObject({ reconciled: true, rowsWritten: 2 })

    // Family A meals: 2 created, 1 linked (recipe set on the existing fx_ meal).
    const aMeals = await pool.query(
      `SELECT id, to_char(date, 'YYYY-MM-DD HH24:MI:SS') AS d, meal_type, recipe_name, recipe_id, servings,
              updated_at = created_at AS pristine
         FROM "FamilyMeal" WHERE family_id = $1 AND id NOT LIKE 'fx\\_%' ORDER BY date`,
      [A]
    )
    expect(aMeals.rows.map((r) => [r.meal_type, r.recipe_name, r.recipe_id, r.servings, r.pristine])).toEqual([
      ['dinner', 'Tomato soup', L.familyA.recipeSoup, 4, true],
      ['lunch', 'Tofu stir-fry', L.familyA.recipeStirFry, 3, true],
    ])
    for (const r of aMeals.rows) expect(r.d).toMatch(/ 00:00:00$/)
    const linked = await prisma.familyMeal.findUniqueOrThrow({ where: { id: L.familyA.mealSameName } })
    expect(linked.recipe_id).toBe(L.familyA.recipeLasagna)
    expect(linked.updated_at.getTime()).toBe(linked.created_at.getTime())
    expect((await prisma.familyMeal.findUniqueOrThrow({ where: { id: L.familyA.mealOtherName } })).recipe_id).toBeNull()

    // Family A: one imported grocery list with two provenance-tagged items.
    const aLists = await prisma.list.findMany({ where: { family_id: A, description: 'Imported from Meal Planner' }, include: { items: { orderBy: { position: 'asc' } } } })
    expect(aLists).toHaveLength(1)
    expect(aLists[0]).toMatchObject({ type: 'grocery', name: 'Imported shopping (Family A)' })
    expect(aLists[0].items.map((i) => [i.content, i.checked, i.source, i.ingredient_id, i.recipe_id, i.amount, i.unit, i.quantity])).toEqual([
      ['Lasagna sheets', true, 'import', L.familyA.ingredientLasagnaSheets, null, 1, 'box', 1],
      ['tomatoes', false, 'import', L.familyA.ingredientTomatoes, L.familyA.recipeSoup, 8, null, 1],
    ])
    for (const i of aLists[0].items) expect(i.source_key).toBeNull()

    // Family B: no meal (the foreign-recipe entry is archived), one item with the foreign recipe_id nulled.
    expect(await prisma.familyMeal.count({ where: { family_id: B } })).toBe(0)
    const bItems = await prisma.listItem.findMany({ where: { list: { family_id: B }, source: 'import' } })
    expect(bItems.map((i) => [i.content, i.recipe_id, i.ingredient_id])).toEqual([['Paper towels (Family B)', null, null]])

    // Isolation: no canonical row in either household references the other's recipes/ingredients/meals/lists.
    const leaks = await pool.query(
      `SELECT 'meal' AS k, m.id FROM "FamilyMeal" m JOIN "Recipe" r ON r.id = m.recipe_id WHERE r.family_id <> m.family_id
       UNION ALL
       SELECT 'item-recipe', i.id FROM "ListItem" i JOIN "List" l ON l.id = i.list_id JOIN "Recipe" r ON r.id = i.recipe_id WHERE r.family_id <> l.family_id
       UNION ALL
       SELECT 'item-ingredient', i.id FROM "ListItem" i JOIN "List" l ON l.id = i.list_id JOIN "Ingredient" g ON g.id = i.ingredient_id WHERE g.family_id <> l.family_id
       UNION ALL
       SELECT 'record', ir.id FROM "ImportedRecord" ir JOIN "ImportJob" j ON j.id = ir.import_job_id WHERE j.family_id <> ir.family_id`
    )
    expect(leaks.rows).toEqual([])

    // Provenance: MealPlan -> ImportJob mapping and skipped rows archived verbatim in the job summary.
    for (const [fam, res, plan] of [
      [A, a, L.familyA.mealPlan],
      [B, b, L.familyB.mealPlan],
    ] as const) {
      const job = await prisma.importJob.findUniqueOrThrow({ where: { id: res.jobId! } })
      expect(job).toMatchObject({ family_id: fam, source_app: BACKFILL_SOURCE_APP, status: 'completed', dry_run: false })
      const planMap = await prisma.importedRecord.findUniqueOrThrow({
        where: { family_id_source_app_source_model_source_id: { family_id: fam, source_app: BACKFILL_SOURCE_APP, source_model: 'MealPlan', source_id: plan } },
      })
      expect(planMap).toMatchObject({ target_model: 'ImportJob', target_id: job.id, import_job_id: job.id })
      const summary = job.summary as { mealPlans: Array<{ id: string; name: string }>; skipped: Array<{ sourceId: string; reason: string; row: Record<string, unknown> }> }
      expect(summary.mealPlans.map((p) => p.id)).toEqual([plan])
      if (fam === A) {
        expect(summary.skipped).toEqual([
          {
            sourceModel: 'MealPlanEntry',
            sourceId: L.familyA.entryBrunch,
            reason: 'unmappable_meal_type',
            row: expect.objectContaining({ id: L.familyA.entryBrunch, meal_type: 'Brunch', recipe_id: L.familyA.recipeSoup, servings: 2, meal_plan_id: L.familyA.mealPlan }),
          },
        ])
      } else {
        expect(summary.skipped.map((s) => [s.sourceId, s.reason])).toEqual([
          [L.familyB.entryForeignRecipe, 'foreign_recipe'],
          [L.familyB.itemEmptyName, 'empty_name'],
        ])
        const empty = summary.skipped.find((s) => s.sourceId === L.familyB.itemEmptyName)!
        expect(empty.row).toEqual({
          id: L.familyB.itemEmptyName,
          shopping_list_id: L.familyB.shoppingList,
          ingredient_name: '   ',
          amount: 2,
          unit: 'kg',
          category: null,
          checked: false,
          recipe_id: null,
        })
      }
    }
    // Every source row is accounted for by exactly one ImportedRecord per family.
    const recs = await pool.query(
      `SELECT family_id, source_model, count(*)::int AS n FROM "ImportedRecord" WHERE source_app = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [BACKFILL_SOURCE_APP]
    )
    expect(recs.rows).toEqual([
      { family_id: A, source_model: 'MealPlan', n: 1 },
      { family_id: A, source_model: 'MealPlanEntry', n: 4 },
      { family_id: A, source_model: 'ShoppingItem', n: 2 },
      { family_id: A, source_model: 'ShoppingList', n: 1 },
      { family_id: B, source_model: 'MealPlan', n: 1 },
      { family_id: B, source_model: 'MealPlanEntry', n: 1 },
      { family_id: B, source_model: 'ShoppingItem', n: 2 },
      { family_id: B, source_model: 'ShoppingList', n: 1 },
    ])
  })

  it('a second apply creates 0 rows (no job either)', async () => {
    const before = await hashes(CANONICAL)
    for (const fam of [A, B, FIXTURE_IDS.familyEmpty.family]) {
      const again = await apply(fam)
      expect(again).toMatchObject({ rowsWritten: 0, jobId: null, reconciled: true })
      expect(again.counts.meals.created + again.counts.lists.created + again.counts.items.created).toBe(0)
    }
    expect(await hashes(CANONICAL)).toEqual(before)
  })

  it('reverse removes exactly the rows it created and restores the linked meal', async () => {
    const a = await reverse(A)
    const b = await reverse(B)
    expect(a).toMatchObject({ jobs: 1, jobsDeleted: 1, removed: { FamilyMeal: 2, List: 1, ListItem: 2 }, unlinked: 1, kept: [] })
    expect(b).toMatchObject({ jobs: 1, jobsDeleted: 1, removed: { FamilyMeal: 0, List: 1, ListItem: 1 }, unlinked: 0, kept: [] })
    expect(await hashes(CANONICAL)).toEqual(baseline)
  })

  it('reverse keeps rows a person changed after the backfill, then finishes once they are gone', async () => {
    const res = await apply(A)
    const item = await prisma.listItem.findFirstOrThrow({ where: { list: { family_id: A }, source: 'import', content: 'tomatoes' } })
    // A real edit through Prisma bumps updated_at (@updatedAt).
    await prisma.listItem.update({ where: { id: item.id }, data: { checked: true } })

    const partial = await reverse(A, res.jobId!)
    expect(partial.removed).toEqual({ FamilyMeal: 2, List: 0, ListItem: 1 })
    expect(partial.kept.map((k) => [k.model, k.reason]).sort()).toEqual([
      ['List', 'not_empty'],
      ['ListItem', 'modified'],
    ])
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: res.jobId! } })
    expect(job.status).toBe('partially_reversed')
    expect((job.summary as { skipped: unknown[] }).skipped).toHaveLength(1)
    // Kept rows stay mapped, so a re-apply does not duplicate them.
    const reapply = await apply(A)
    expect(reapply.counts.items).toEqual({ created: 1, skipped: 0, alreadyMapped: 1 })
    expect(reapply.counts.lists).toEqual({ created: 0, alreadyMapped: 1 })
    await reverse(A, reapply.jobId!)

    await prisma.listItem.delete({ where: { id: item.id } })
    const rest = await reverse(A)
    expect(rest).toMatchObject({ jobsDeleted: 1, removed: { List: 1 }, alreadyGone: 1, kept: [] })
    expect(await hashes(CANONICAL)).toEqual(baseline)
  })

  it('fixtures:reset still removes everything after an apply', async () => {
    await apply(A)
    await apply(B)
    await resetFixtures(prisma, ds)
    const famIds = ds.families.map((f) => f.id)
    expect(await prisma.importJob.count({ where: { family_id: { in: famIds } } })).toBe(0)
    expect(await prisma.familyMeal.count({ where: { family_id: { in: famIds } } })).toBe(0)
    expect(await prisma.list.count({ where: { family_id: { in: famIds } } })).toBe(0)
    expect(await prisma.shoppingItem.count({ where: { id: { in: ds.shoppingItems.map((i) => i.id) } } })).toBe(0)
    // Put the fixtures back so the legacy-table check (and later suites) see the baseline.
    await seedFixtures(prisma, ds, pw)
  })
})
