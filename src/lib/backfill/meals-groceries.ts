/**
 * Legacy meal/grocery -> canonical backfill (ADR-0007, #250).
 *
 * Copies the frozen import-generation rows into the canonical tables:
 *   MealPlanEntry (+ MealPlan)  -> FamilyMeal
 *   ShoppingList                -> List (type 'grocery')
 *   ShoppingItem                -> ListItem (source 'import')
 * Rules: docs/architecture/MEALS_AND_GROCERIES.md sections 4 and 6.
 *
 * Shape:
 *   - pure helpers (normalisation, guard, argument parsing, planning) that the
 *     unit tests call directly;
 *   - `loadFamilySource` / `runFamily` / `reverseFamily`, which take any
 *     pg-compatible `Queryable` (a `pg.PoolClient`) and speak plain SQL so
 *     timestamps are controlled exactly (created rows get
 *     `updated_at = created_at`, which is how reverse proves "unmodified").
 *
 * Invariants:
 *   - Legacy tables (MealPlan, MealPlanEntry, ShoppingList, ShoppingItem) are
 *     only ever SELECTed.
 *   - One family per transaction, under a per-family advisory lock. Every
 *     query is scoped to that family; a reference to another household's
 *     recipe is never copied (items: nulled and reported; meal entries:
 *     skipped, archived and reported).
 *   - Provenance lives in ImportedRecord (source_app 'fp-canonical-149').
 *     `ImportedRecord.checksum` carries the backfill action marker
 *     (see `RecordMarker`), because reverse must tell created rows from
 *     linked live rows. Anything already mapped is never written again, so
 *     a second apply creates 0 rows (not even an ImportJob).
 *   - Every skipped legacy row is archived verbatim (all columns as JSON)
 *     with its reason in that family's ImportJob.summary.skipped[] and
 *     mapped to the job, as is every MealPlan (O-2: archive only).
 *
 * Node type-stripping constraint (scripts/backfill-meals-groceries.mjs loads
 * this file directly): only `import type`, no enums/namespaces/parameter
 * properties, no runtime imports.
 */

export const BACKFILL_SOURCE_APP = 'fp-canonical-149'
export const BACKFILL_SOURCE_VERSION = 'adr-0007-backfill-v1'
export const BACKFILL_ALLOW_PRODUCTION_ENV = 'BACKFILL_ALLOW_PRODUCTION'
export const BACKFILL_APPROVAL_FLAG = '--i-have-approval'
export const IMPORTED_LIST_DESCRIPTION = 'Imported from Meal Planner'

export const CANONICAL_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type CanonicalMealType = (typeof CANONICAL_MEAL_TYPES)[number]

/** Value stored in ImportedRecord.checksum for rows this backfill maps. */
export type RecordMarker =
  | 'created'
  | 'linked'
  | 'linked:recipe_set'
  | 'archived'
  | `skipped:${SkipReason}`

export type SkipReason = 'unmappable_meal_type' | 'foreign_recipe' | 'empty_name' | 'target_list_missing'
export type NullReason = 'foreign_recipe' | 'missing_recipe'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `lower(trim())`; anything outside the canonical set is null (skip, never coerce). */
export function normalizeMealType(raw: string | null | undefined): CanonicalMealType | null {
  const t = (raw ?? '').trim().toLowerCase()
  return (CANONICAL_MEAL_TYPES as readonly string[]).includes(t) ? (t as CanonicalMealType) : null
}

/** Comparison key for names: NFC, trimmed, inner whitespace collapsed, lower-cased. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Trimmed display text; empty string when nothing is left. */
export function cleanContent(raw: string | null | undefined): string {
  return (raw ?? '').trim()
}

/** Same meal when both names are present and normalise equal. */
export function mealNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeName(a)
  return x !== '' && x === normalizeName(b)
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` -> the UTC-midnight timestamp literal FamilyMeal.date uses (parseDateOnly convention). */
export function utcMidnightLiteral(day: string): string {
  if (!DAY_RE.test(day)) throw new Error(`Not a date-only value: ${JSON.stringify(day)}`)
  return `${day}T00:00:00.000`
}

/**
 * Decide what happens to a legacy recipe reference. Only a recipe that exists
 * AND belongs to the same household is kept.
 */
export function classifyRecipeRef(
  recipeId: string | null | undefined,
  recipeFamilyId: string | null | undefined,
  familyId: string
): { recipeId: string | null; issue: NullReason | null } {
  if (!recipeId) return { recipeId: null, issue: null }
  if (!recipeFamilyId) return { recipeId: null, issue: 'missing_recipe' }
  if (recipeFamilyId !== familyId) return { recipeId: null, issue: 'foreign_recipe' }
  return { recipeId, issue: null }
}

/** Ingredient id for a free-text name when exactly one same-family ingredient normalises equal. */
export function matchIngredient(name: string, ingredients: ReadonlyArray<{ id: string; name: string }>): string | null {
  const key = normalizeName(name)
  if (!key) return null
  const hits = ingredients.filter((i) => normalizeName(i.name) === key)
  return hits.length === 1 ? hits[0].id : null
}

// ---------------------------------------------------------------------------
// Target guard
// ---------------------------------------------------------------------------

type EnvLike = Record<string, string | undefined>

export interface LocalTargetVerdict {
  allowed: boolean
  reasons: string[]
  host?: string
  database?: string
}

export interface BackfillTargetVerdict {
  allowed: boolean
  /** True when the target is not local/disposable and was admitted by the approval gate. */
  approvedRemote: boolean
  reasons: string[]
  host?: string
  database?: string
}

/**
 * Local/disposable targets (the fixture guard's rules minus FIXTURES_ALLOW)
 * are allowed. Anything else, including NODE_ENV=production, a production
 * marker in the URL or a remote host, needs BOTH the `--i-have-approval` flag
 * and BACKFILL_ALLOW_PRODUCTION=1. A malformed DATABASE_URL is always refused.
 *
 * `evaluateLocal` is the fixture guard (`evaluateFixtureTarget`); it is passed
 * in because this module cannot import other TypeScript at runtime.
 */
export function evaluateBackfillTarget(
  env: EnvLike,
  opts: { approvalFlag: boolean },
  evaluateLocal: (env: EnvLike) => LocalTargetVerdict
): BackfillTargetVerdict {
  const raw = (env.DATABASE_URL ?? '').trim()
  const structural: string[] = []
  if (!raw) structural.push('DATABASE_URL is not set')
  else {
    let url: URL | null = null
    try {
      url = new URL(raw)
    } catch {
      structural.push('DATABASE_URL is not a valid URL')
    }
    if (url) {
      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        structural.push('DATABASE_URL must use postgres:// or postgresql://')
      }
      if (!url.hostname) structural.push('DATABASE_URL has no host')
      if (!url.pathname.replace(/^\//, '')) structural.push('DATABASE_URL has no database name')
      if (url.searchParams.has('host')) structural.push('DATABASE_URL must not override the host via a query parameter')
    }
  }
  const local = evaluateLocal({ ...env, FIXTURES_ALLOW: '1' })
  const base = { host: local.host, database: local.database }
  if (structural.length > 0) return { allowed: false, approvedRemote: false, reasons: structural, ...base }
  if (local.allowed) return { allowed: true, approvedRemote: false, reasons: [], ...base }

  const missing: string[] = []
  if (!opts.approvalFlag) missing.push(`${BACKFILL_APPROVAL_FLAG} was not passed`)
  if (env[BACKFILL_ALLOW_PRODUCTION_ENV] !== '1') missing.push(`${BACKFILL_ALLOW_PRODUCTION_ENV}=1 is not set`)
  if (missing.length === 0) return { allowed: true, approvedRemote: true, reasons: [], ...base }
  return {
    allowed: false,
    approvedRemote: false,
    reasons: [
      ...local.reasons.map((r) => `not a local/disposable target: ${r}`),
      ...missing,
      "a production or remote run needs Cameron's explicit approval for that run (docs/runbooks/MEALS_GROCERIES_BACKFILL.md)",
    ],
    ...base,
  }
}

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

export type BackfillMode = 'dry-run' | 'apply' | 'reverse'

export interface BackfillArgs {
  mode: BackfillMode
  families: string[]
  allFamilies: boolean
  jobId: string | null
  startedBy: string | null
  approvalFlag: boolean
  json: boolean
  help: boolean
}

export class BackfillUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackfillUsageError'
  }
}

export const BACKFILL_USAGE = `Usage: node scripts/backfill-meals-groceries.mjs [options]

  (default)            dry-run: print per-family counts, write nothing
  --apply              copy legacy rows into canonical tables
  --reverse            delete rows a backfill job created (only while unmodified)
  --family <id>        limit to a family (repeatable); required for --apply/--reverse
  --all-families       explicit opt-in to --apply/--reverse every family
  --job <id>           with --reverse: only this ImportJob
  --started-by <id>    with --apply and one --family: ImportJob.started_by (default: oldest parent)
  --json               machine-readable output
  ${BACKFILL_APPROVAL_FLAG}    required (with ${BACKFILL_ALLOW_PRODUCTION_ENV}=1) for any non-local target
`

export function parseBackfillArgs(argv: readonly string[]): BackfillArgs {
  const out: BackfillArgs = {
    mode: 'dry-run',
    families: [],
    allFamilies: false,
    jobId: null,
    startedBy: null,
    approvalFlag: false,
    json: false,
    help: false,
  }
  let apply = false
  let reverse = false
  const value = (i: number, flag: string) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--') || v.trim() === '') throw new BackfillUsageError(`${flag} needs a value`)
    return v.trim()
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--apply':
        apply = true
        break
      case '--reverse':
        reverse = true
        break
      case '--dry-run':
        break
      case '--family':
        out.families.push(value(i, a))
        i++
        break
      case '--all-families':
        out.allFamilies = true
        break
      case '--job':
        out.jobId = value(i, a)
        i++
        break
      case '--started-by':
        out.startedBy = value(i, a)
        i++
        break
      case '--json':
        out.json = true
        break
      case BACKFILL_APPROVAL_FLAG:
        out.approvalFlag = true
        break
      case '--help':
      case '-h':
        out.help = true
        break
      default:
        throw new BackfillUsageError(`Unknown argument: ${a}`)
    }
  }
  if (apply && reverse) throw new BackfillUsageError('--apply and --reverse are mutually exclusive')
  out.mode = apply ? 'apply' : reverse ? 'reverse' : 'dry-run'
  out.families = Array.from(new Set(out.families))
  if (out.allFamilies && out.families.length > 0) {
    throw new BackfillUsageError('--all-families and --family are mutually exclusive')
  }
  if (out.mode !== 'dry-run' && !out.allFamilies && out.families.length === 0 && !out.help) {
    throw new BackfillUsageError(`--${out.mode} needs --family <id> (or an explicit --all-families)`)
  }
  if (out.jobId && out.mode !== 'reverse') throw new BackfillUsageError('--job is only valid with --reverse')
  if (out.startedBy && (out.mode !== 'apply' || out.families.length !== 1)) {
    throw new BackfillUsageError('--started-by needs --apply and exactly one --family')
  }
  return out
}

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

export interface MealPlanSource {
  id: string
  raw: Json
}

export interface MealPlanEntrySource {
  id: string
  mealPlanId: string
  /** `YYYY-MM-DD` */
  day: string
  mealType: string
  servings: number | null
  recipeId: string | null
  /** Family of the referenced recipe; null when it does not exist. */
  recipeFamilyId: string | null
  /** Recipe title, loaded only when the recipe is in this family. */
  recipeTitle: string | null
  createdBy: string
  raw: Json
}

export interface ExistingMeal {
  id: string
  day: string
  mealType: string
  recipeName: string | null
  recipeId: string | null
}

export interface ShoppingListSource {
  id: string
  name: string
  createdBy: string
  /** Timestamp literal (no zone) copied to List.created_at/updated_at. */
  createdAt: string
  raw: Json
}

export interface ShoppingItemSource {
  id: string
  shoppingListId: string
  name: string | null
  amount: number | null
  unit: string | null
  category: string | null
  checked: boolean
  recipeId: string | null
  recipeFamilyId: string | null
  raw: Json
}

export interface ExistingMapping {
  targetModel: string
  targetId: string
  marker: string | null
}

export interface FamilySource {
  familyId: string
  mealPlans: MealPlanSource[]
  entries: MealPlanEntrySource[]
  meals: ExistingMeal[]
  shoppingLists: ShoppingListSource[]
  shoppingItems: ShoppingItemSource[]
  ingredients: Array<{ id: string; name: string }>
  /** Key `${source_model}:${source_id}` for this family's backfill ImportedRecords. */
  mappings: Record<string, ExistingMapping>
  /** Mapped List targets that still exist in this family. */
  existingListIds: string[]
}

export interface MealCreate {
  sourceId: string
  id: string
  day: string
  mealType: CanonicalMealType
  recipeId: string | null
  recipeName: string | null
  servings: number | null
  createdBy: string
}

export interface MealLink {
  sourceId: string
  mealId: string
  /** Recipe id written to FamilyMeal.recipe_id (it was null); null = nothing to write. */
  setRecipeId: string | null
}

export interface ListCreate {
  sourceId: string
  id: string
  name: string
  createdBy: string
  createdAt: string
}

export interface ItemCreate {
  sourceId: string
  id: string
  listId: string
  content: string
  amount: number | null
  unit: string | null
  category: string | null
  checked: boolean
  recipeId: string | null
  ingredientId: string | null
  addedBy: string
  position: number
}

export interface SkippedRow {
  sourceModel: 'MealPlanEntry' | 'ShoppingItem'
  sourceId: string
  reason: SkipReason
  /** The legacy row verbatim (all columns). */
  row: Json
}

export interface NulledRef {
  sourceModel: 'ShoppingItem'
  sourceId: string
  reason: NullReason
}

export interface FamilyCounts {
  source: { mealPlans: number; mealPlanEntries: number; shoppingLists: number; shoppingItems: number }
  meals: { created: number; linked: number; skipped: number; alreadyMapped: number }
  mealPlans: { archived: number; alreadyMapped: number }
  lists: { created: number; alreadyMapped: number }
  items: { created: number; skipped: number; alreadyMapped: number }
  recipeRefsNulled: number
  skipReasons: Record<string, number>
  nullReasons: Record<string, number>
}

export interface FamilyPlan {
  familyId: string
  mealCreates: MealCreate[]
  mealLinks: MealLink[]
  planArchives: MealPlanSource[]
  listCreates: ListCreate[]
  itemCreates: ItemCreate[]
  skipped: SkippedRow[]
  nulled: NulledRef[]
  counts: FamilyCounts
}

const key = (model: string, id: string) => `${model}:${id}`

function bump(rec: Record<string, number>, k: string) {
  rec[k] = (rec[k] ?? 0) + 1
}

/** Build every write for one family. Pure: the same source always yields the same plan (given `newId`). */
export function planFamilyBackfill(src: FamilySource, newId: () => string): FamilyPlan {
  const plan: FamilyPlan = {
    familyId: src.familyId,
    mealCreates: [],
    mealLinks: [],
    planArchives: [],
    listCreates: [],
    itemCreates: [],
    skipped: [],
    nulled: [],
    counts: {
      source: {
        mealPlans: src.mealPlans.length,
        mealPlanEntries: src.entries.length,
        shoppingLists: src.shoppingLists.length,
        shoppingItems: src.shoppingItems.length,
      },
      meals: { created: 0, linked: 0, skipped: 0, alreadyMapped: 0 },
      mealPlans: { archived: 0, alreadyMapped: 0 },
      lists: { created: 0, alreadyMapped: 0 },
      items: { created: 0, skipped: 0, alreadyMapped: 0 },
      recipeRefsNulled: 0,
      skipReasons: {},
      nullReasons: {},
    },
  }
  const c = plan.counts
  const mapped = (model: string, id: string) => src.mappings[key(model, id)]
  const skip = (row: SkippedRow) => {
    plan.skipped.push(row)
    bump(c.skipReasons, row.reason)
  }

  // MealPlan: archive only (O-2); mapped to the job that archives it.
  for (const p of src.mealPlans) {
    if (mapped('MealPlan', p.id)) c.mealPlans.alreadyMapped++
    else {
      plan.planArchives.push(p)
      c.mealPlans.archived++
    }
  }

  // MealPlanEntry -> FamilyMeal. Meals created in this run join the collision pool.
  const pool: ExistingMeal[] = src.meals.map((m) => ({ ...m }))
  const entries = [...src.entries].sort(
    (a, b) => a.day.localeCompare(b.day) || a.mealType.localeCompare(b.mealType) || a.id.localeCompare(b.id)
  )
  for (const e of entries) {
    if (mapped('MealPlanEntry', e.id)) {
      c.meals.alreadyMapped++
      continue
    }
    const mealType = normalizeMealType(e.mealType)
    if (!mealType) {
      skip({ sourceModel: 'MealPlanEntry', sourceId: e.id, reason: 'unmappable_meal_type', row: e.raw })
      c.meals.skipped++
      continue
    }
    const ref = classifyRecipeRef(e.recipeId, e.recipeFamilyId, src.familyId)
    if (ref.issue) {
      // The entry's only content is its recipe; copying it would leak or
      // invent data, so it is archived instead of created.
      skip({ sourceModel: 'MealPlanEntry', sourceId: e.id, reason: 'foreign_recipe', row: e.raw })
      c.meals.skipped++
      continue
    }
    const title = e.recipeTitle
    const collision = pool.find((m) => m.day === e.day && m.mealType === mealType && mealNamesMatch(m.recipeName, title))
    if (collision) {
      const setRecipeId = collision.recipeId === null && ref.recipeId ? ref.recipeId : null
      if (setRecipeId) collision.recipeId = setRecipeId
      plan.mealLinks.push({ sourceId: e.id, mealId: collision.id, setRecipeId })
      c.meals.linked++
      continue
    }
    const id = newId()
    plan.mealCreates.push({
      sourceId: e.id,
      id,
      day: e.day,
      mealType,
      recipeId: ref.recipeId,
      recipeName: title,
      servings: e.servings,
      createdBy: e.createdBy,
    })
    pool.push({ id, day: e.day, mealType, recipeName: title, recipeId: ref.recipeId })
    c.meals.created++
  }

  // ShoppingList -> List; ShoppingItem -> ListItem.
  const listTarget = new Map<string, string | null>()
  const existingLists = new Set(src.existingListIds)
  const listOwner = new Map<string, string>()
  for (const s of src.shoppingLists) {
    listOwner.set(s.id, s.createdBy)
    const m = mapped('ShoppingList', s.id)
    if (m) {
      c.lists.alreadyMapped++
      listTarget.set(s.id, existingLists.has(m.targetId) ? m.targetId : null)
      continue
    }
    const id = newId()
    plan.listCreates.push({ sourceId: s.id, id, name: s.name, createdBy: s.createdBy, createdAt: s.createdAt })
    listTarget.set(s.id, id)
    c.lists.created++
  }
  const positions = new Map<string, number>()
  for (const it of src.shoppingItems) {
    const position = positions.get(it.shoppingListId) ?? 0
    positions.set(it.shoppingListId, position + 1)
    if (mapped('ShoppingItem', it.id)) {
      c.items.alreadyMapped++
      continue
    }
    const content = cleanContent(it.name)
    if (!content) {
      skip({ sourceModel: 'ShoppingItem', sourceId: it.id, reason: 'empty_name', row: it.raw })
      c.items.skipped++
      continue
    }
    const listId = listTarget.get(it.shoppingListId) ?? null
    if (!listId) {
      skip({ sourceModel: 'ShoppingItem', sourceId: it.id, reason: 'target_list_missing', row: it.raw })
      c.items.skipped++
      continue
    }
    const ref = classifyRecipeRef(it.recipeId, it.recipeFamilyId, src.familyId)
    if (ref.issue) {
      plan.nulled.push({ sourceModel: 'ShoppingItem', sourceId: it.id, reason: ref.issue })
      bump(c.nullReasons, ref.issue)
      c.recipeRefsNulled++
    }
    plan.itemCreates.push({
      sourceId: it.id,
      id: newId(),
      listId,
      content,
      amount: it.amount,
      unit: it.unit,
      category: it.category,
      checked: it.checked,
      recipeId: ref.recipeId,
      ingredientId: matchIngredient(content, src.ingredients),
      addedBy: listOwner.get(it.shoppingListId) ?? '',
      position,
    })
    c.items.created++
  }
  return plan
}

/** Rows this plan would write to canonical tables (excluding the ImportJob/ImportedRecord bookkeeping). */
export function planWriteCount(p: FamilyPlan): number {
  return p.mealCreates.length + p.mealLinks.filter((l) => l.setRecipeId).length + p.listCreates.length + p.itemCreates.length
}

/** True when the plan needs a job at all (anything new to create, link, archive or map). */
export function planHasWork(p: FamilyPlan): boolean {
  return (
    p.mealCreates.length + p.mealLinks.length + p.planArchives.length + p.listCreates.length + p.itemCreates.length + p.skipped.length >
    0
  )
}

/** Per-family reconciliation: every source row is accounted for exactly once. */
export function reconcile(c: FamilyCounts): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  const m = c.meals
  if (c.source.mealPlanEntries !== m.created + m.linked + m.skipped + m.alreadyMapped) {
    problems.push('MealPlanEntry != created + linked + archived-skipped + already mapped')
  }
  if (c.source.mealPlans !== c.mealPlans.archived + c.mealPlans.alreadyMapped) {
    problems.push('MealPlan != archived + already mapped')
  }
  if (c.source.shoppingLists !== c.lists.created + c.lists.alreadyMapped) {
    problems.push('ShoppingList != created + already mapped')
  }
  const i = c.items
  if (c.source.shoppingItems !== i.created + i.skipped + i.alreadyMapped) {
    problems.push('ShoppingItem != created + archived-skipped + already mapped')
  }
  return { ok: problems.length === 0, problems }
}

// ---------------------------------------------------------------------------
// Database access
// ---------------------------------------------------------------------------

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}

const lockKey = (familyId: string) => `${BACKFILL_SOURCE_APP}:${familyId}`

/** Load everything the planner needs for one family. SELECT-only. */
export async function loadFamilySource(db: Queryable, familyId: string): Promise<FamilySource> {
  const plans = await db.query(
    `SELECT p.id, to_jsonb(p) AS raw FROM "MealPlan" p WHERE p.family_id = $1 ORDER BY p.start_date, p.id`,
    [familyId]
  )
  const entries = await db.query(
    `SELECT e.id, e.meal_plan_id, e.date::text AS day, e.meal_type, e.servings, e.recipe_id,
            p.created_by, r.family_id AS recipe_family_id,
            CASE WHEN r.family_id = $1 THEN r.title END AS recipe_title,
            to_jsonb(e) AS raw
       FROM "MealPlanEntry" e
       JOIN "MealPlan" p ON p.id = e.meal_plan_id
       LEFT JOIN "Recipe" r ON r.id = e.recipe_id
      WHERE p.family_id = $1
      ORDER BY e.date, e.meal_type, e.id`,
    [familyId]
  )
  const meals = await db.query(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS day, meal_type, recipe_name, recipe_id
       FROM "FamilyMeal" WHERE family_id = $1 ORDER BY created_at, id`,
    [familyId]
  )
  const lists = await db.query(
    `SELECT s.id, s.name, s.created_by, to_char(s.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS created_at_text,
            to_jsonb(s) AS raw
       FROM "ShoppingList" s WHERE s.family_id = $1 ORDER BY s.created_at, s.id`,
    [familyId]
  )
  const items = await db.query(
    `SELECT i.id, i.shopping_list_id, i.ingredient_name, i.amount, i.unit, i.category, i.checked, i.recipe_id,
            r.family_id AS recipe_family_id, to_jsonb(i) AS raw
       FROM "ShoppingItem" i
       JOIN "ShoppingList" s ON s.id = i.shopping_list_id
       LEFT JOIN "Recipe" r ON r.id = i.recipe_id
      WHERE s.family_id = $1
      ORDER BY s.created_at, s.id, i.id`,
    [familyId]
  )
  const ingredients = await db.query(`SELECT id, name FROM "Ingredient" WHERE family_id = $1 ORDER BY id`, [familyId])
  const records = await db.query(
    `SELECT source_model, source_id, target_model, target_id, checksum
       FROM "ImportedRecord" WHERE family_id = $1 AND source_app = $2`,
    [familyId, BACKFILL_SOURCE_APP]
  )
  const mappings: Record<string, ExistingMapping> = {}
  for (const r of records.rows) {
    mappings[key(r.source_model, r.source_id)] = { targetModel: r.target_model, targetId: r.target_id, marker: r.checksum }
  }
  const listTargets = records.rows.filter((r) => r.source_model === 'ShoppingList').map((r) => r.target_id as string)
  const existingLists = listTargets.length
    ? await db.query(`SELECT id FROM "List" WHERE family_id = $1 AND id = ANY($2::text[])`, [familyId, listTargets])
    : { rows: [] }

  return {
    familyId,
    mealPlans: plans.rows.map((r) => ({ id: r.id, raw: r.raw })),
    entries: entries.rows.map((r) => ({
      id: r.id,
      mealPlanId: r.meal_plan_id,
      day: r.day,
      mealType: r.meal_type,
      servings: r.servings ?? null,
      recipeId: r.recipe_id ?? null,
      recipeFamilyId: r.recipe_family_id ?? null,
      recipeTitle: r.recipe_title ?? null,
      createdBy: r.created_by,
      raw: r.raw,
    })),
    meals: meals.rows.map((r) => ({
      id: r.id,
      day: r.day,
      mealType: r.meal_type,
      recipeName: r.recipe_name ?? null,
      recipeId: r.recipe_id ?? null,
    })),
    shoppingLists: lists.rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdBy: r.created_by,
      createdAt: r.created_at_text,
      raw: r.raw,
    })),
    shoppingItems: items.rows.map((r) => ({
      id: r.id,
      shoppingListId: r.shopping_list_id,
      name: r.ingredient_name ?? null,
      amount: r.amount ?? null,
      unit: r.unit ?? null,
      category: r.category ?? null,
      checked: Boolean(r.checked),
      recipeId: r.recipe_id ?? null,
      recipeFamilyId: r.recipe_family_id ?? null,
      raw: r.raw,
    })),
    ingredients: ingredients.rows.map((r) => ({ id: r.id, name: r.name })),
    mappings,
    existingListIds: existingLists.rows.map((r) => r.id as string),
  }
}

export interface RunOptions {
  mode: 'dry-run' | 'apply'
  /** ImportJob.started_by; defaults to the family's oldest parent, then its oldest member. */
  startedBy?: string | null
  newId?: () => string
  now?: () => Date
}

export interface FamilyRunResult {
  familyId: string
  mode: 'dry-run' | 'apply'
  jobId: string | null
  counts: FamilyCounts
  reconciled: boolean
  problems: string[]
  /** Canonical rows written (0 in dry-run). */
  rowsWritten: number
  nulled: NulledRef[]
  skipped: Array<Omit<SkippedRow, 'row'>>
  error?: string
}

const defaultId = () => globalThis.crypto.randomUUID()

/** Timestamp literal without zone, UTC wall time, millisecond precision (Prisma's convention). */
function tsLiteral(d: Date): string {
  return d.toISOString().replace('Z', '')
}

/**
 * Plan (and in apply mode, write) one family inside one transaction. The
 * caller owns the connection; this function issues BEGIN/COMMIT/ROLLBACK.
 */
export async function runFamily(db: Queryable, familyId: string, opts: RunOptions): Promise<FamilyRunResult> {
  const newId = opts.newId ?? defaultId
  const now = tsLiteral((opts.now ?? (() => new Date()))())
  const apply = opts.mode === 'apply'
  await db.query(apply ? 'BEGIN' : 'BEGIN READ ONLY')
  try {
    if (apply) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(familyId)])
    const exists = await db.query('SELECT 1 FROM "Family" WHERE id = $1', [familyId])
    if (exists.rows.length === 0) throw new Error(`Family ${familyId} does not exist`)

    const src = await loadFamilySource(db, familyId)
    const plan = planFamilyBackfill(src, newId)
    const rec = reconcile(plan.counts)
    const result: FamilyRunResult = {
      familyId,
      mode: opts.mode,
      jobId: null,
      counts: plan.counts,
      reconciled: rec.ok,
      problems: rec.problems,
      rowsWritten: 0,
      nulled: plan.nulled,
      skipped: plan.skipped.map((s) => ({ sourceModel: s.sourceModel, sourceId: s.sourceId, reason: s.reason })),
    }
    if (!apply || !planHasWork(plan)) {
      await db.query(apply ? 'COMMIT' : 'ROLLBACK')
      return result
    }
    if (!rec.ok) throw new Error(`Reconciliation failed: ${rec.problems.join('; ')}`)

    const starter = await resolveStarter(db, familyId, opts.startedBy ?? null)
    const jobId = newId()
    await db.query(
      `INSERT INTO "ImportJob" (id, family_id, source_app, source_version, status, dry_run, started_by, started_at)
       VALUES ($1, $2, $3, $4, 'running', false, $5, $6::timestamp(3))`,
      [jobId, familyId, BACKFILL_SOURCE_APP, BACKFILL_SOURCE_VERSION, starter, now]
    )
    const track = async (sourceModel: string, sourceId: string, targetModel: string, targetId: string, marker: RecordMarker) => {
      await db.query(
        `INSERT INTO "ImportedRecord"
           (id, family_id, import_job_id, source_app, source_model, source_id, target_model, target_id, checksum, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamp(3))`,
        [newId(), familyId, jobId, BACKFILL_SOURCE_APP, sourceModel, sourceId, targetModel, targetId, marker, now]
      )
    }

    let written = 0
    for (const m of plan.mealCreates) {
      await db.query(
        `INSERT INTO "FamilyMeal"
           (id, family_id, date, meal_type, recipe_name, recipe_id, servings, notes, cook_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3::timestamp(3), $4, $5, $6, $7, NULL, NULL, $8, $9::timestamp(3), $9::timestamp(3))`,
        [m.id, familyId, utcMidnightLiteral(m.day), m.mealType, m.recipeName, m.recipeId, m.servings, m.createdBy, now]
      )
      await track('MealPlanEntry', m.sourceId, 'FamilyMeal', m.id, 'created')
      written++
    }
    for (const l of plan.mealLinks) {
      if (l.setRecipeId) {
        // Only the recipe link; updated_at is left alone so reverse restores the row byte-for-byte.
        const r = await db.query(
          `UPDATE "FamilyMeal" SET recipe_id = $1 WHERE id = $2 AND family_id = $3 AND recipe_id IS NULL`,
          [l.setRecipeId, l.mealId, familyId]
        )
        written += r.rowCount ?? 0
        await track('MealPlanEntry', l.sourceId, 'FamilyMeal', l.mealId, r.rowCount ? 'linked:recipe_set' : 'linked')
      } else {
        await track('MealPlanEntry', l.sourceId, 'FamilyMeal', l.mealId, 'linked')
      }
    }
    for (const p of plan.planArchives) await track('MealPlan', p.id, 'ImportJob', jobId, 'archived')
    for (const l of plan.listCreates) {
      await db.query(
        `INSERT INTO "List" (id, family_id, name, type, description, is_repeatable, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'grocery', $4, false, $5, $6::timestamp(3), $6::timestamp(3))`,
        [l.id, familyId, l.name, IMPORTED_LIST_DESCRIPTION, l.createdBy, l.createdAt]
      )
      await track('ShoppingList', l.sourceId, 'List', l.id, 'created')
      written++
    }
    for (const it of plan.itemCreates) {
      // The list is either created above or a mapped List proven to be in this family.
      const ins = await db.query(
        `INSERT INTO "ListItem"
           (id, list_id, content, checked, quantity, purchased, category, added_by, position, created_at, updated_at,
            ingredient_id, recipe_id, amount, unit, source)
         SELECT $1, l.id, $3, $4, 1, false, $5, $6, $7, $8::timestamp(3), $8::timestamp(3), $9, $10, $11, $12, 'import'
           FROM "List" l WHERE l.id = $2 AND l.family_id = $13`,
        [
          it.id,
          it.listId,
          it.content,
          it.checked,
          it.category,
          it.addedBy,
          it.position,
          now,
          it.ingredientId,
          it.recipeId,
          it.amount,
          it.unit,
          familyId,
        ]
      )
      if (ins.rowCount !== 1) throw new Error(`Target list for ShoppingItem ${it.sourceId} is not in this family`)
      await track('ShoppingItem', it.sourceId, 'ListItem', it.id, 'created')
      written++
    }
    for (const s of plan.skipped) await track(s.sourceModel, s.sourceId, 'ImportJob', jobId, `skipped:${s.reason}`)

    const summary = {
      adr: 'ADR-0007',
      issue: 250,
      counts: plan.counts,
      mealPlans: plan.planArchives.map((p) => p.raw),
      linked: plan.mealLinks.map((l) => ({ sourceId: l.sourceId, mealId: l.mealId, recipeSet: Boolean(l.setRecipeId) })),
      nulled: plan.nulled,
      skipped: plan.skipped,
    }
    await db.query(
      `UPDATE "ImportJob" SET status = 'completed', completed_at = $2::timestamp(3), summary = $3::jsonb WHERE id = $1`,
      [jobId, now, JSON.stringify(summary)]
    )
    await db.query('COMMIT')
    result.jobId = jobId
    result.rowsWritten = written
    return result
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}

async function resolveStarter(db: Queryable, familyId: string, requested: string | null): Promise<string> {
  if (requested) {
    const r = await db.query('SELECT id FROM "User" WHERE id = $1 AND family_id = $2', [requested, familyId])
    if (r.rows.length === 0) throw new Error('--started-by is not a member of this family')
    return requested
  }
  const r = await db.query(
    `SELECT id FROM "User" WHERE family_id = $1 ORDER BY (role = 'parent') DESC, created_at, id LIMIT 1`,
    [familyId]
  )
  if (r.rows.length === 0) throw new Error('Family has no members to record as ImportJob.started_by')
  return r.rows[0].id
}

// ---------------------------------------------------------------------------
// Reverse
// ---------------------------------------------------------------------------

export interface ReverseResult {
  familyId: string
  jobs: number
  jobsDeleted: number
  removed: { FamilyMeal: number; List: number; ListItem: number }
  unlinked: number
  kept: Array<{ model: string; id: string; reason: 'modified' | 'not_empty' | 'relinked' }>
  alreadyGone: number
}

/**
 * Undo backfill jobs for one family: delete created rows that are still
 * unmodified (`updated_at = created_at`), clear recipe links the job set if
 * they are unchanged, then drop the provenance. A job whose rows were all
 * reverted is deleted (its archive records go with it); otherwise it stays,
 * marked 'partially_reversed', with the records for what was kept.
 */
export async function reverseFamily(
  db: Queryable,
  familyId: string,
  opts: { jobId?: string | null; now?: () => Date } = {}
): Promise<ReverseResult> {
  const now = tsLiteral((opts.now ?? (() => new Date()))())
  const out: ReverseResult = {
    familyId,
    jobs: 0,
    jobsDeleted: 0,
    removed: { FamilyMeal: 0, List: 0, ListItem: 0 },
    unlinked: 0,
    kept: [],
    alreadyGone: 0,
  }
  await db.query('BEGIN')
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(familyId)])
    const jobs = await db.query(
      `SELECT id FROM "ImportJob" WHERE family_id = $1 AND source_app = $2 AND ($3::text IS NULL OR id = $3)
       ORDER BY started_at DESC, id`,
      [familyId, BACKFILL_SOURCE_APP, opts.jobId ?? null]
    )
    for (const { id: jobId } of jobs.rows as Array<{ id: string }>) {
      out.jobs++
      const recs = (
        await db.query(
          `SELECT id, source_model, source_id, target_model, target_id, checksum FROM "ImportedRecord"
            WHERE import_job_id = $1 AND family_id = $2`,
          [jobId, familyId]
        )
      ).rows as Array<{ id: string; source_model: string; source_id: string; target_model: string; target_id: string; checksum: string | null }>
      const drop: string[] = []
      let keptHere = 0
      const keep = (model: string, id: string, reason: ReverseResult['kept'][number]['reason']) => {
        out.kept.push({ model, id, reason })
        keptHere++
      }
      const byTarget = (model: string, marker: string) => recs.filter((r) => r.target_model === model && r.checksum === marker)

      for (const r of byTarget('ListItem', 'created')) {
        const del = await db.query(
          `DELETE FROM "ListItem" li USING "List" l
            WHERE li.id = $1 AND li.list_id = l.id AND l.family_id = $2 AND li.updated_at = li.created_at`,
          [r.target_id, familyId]
        )
        if (del.rowCount) {
          out.removed.ListItem++
          drop.push(r.id)
        } else if (await existsInFamily(db, 'ListItem', r.target_id, familyId)) keep('ListItem', r.target_id, 'modified')
        else {
          out.alreadyGone++
          drop.push(r.id)
        }
      }
      for (const r of byTarget('List', 'created')) {
        const del = await db.query(
          `DELETE FROM "List" l WHERE l.id = $1 AND l.family_id = $2 AND l.updated_at = l.created_at
              AND NOT EXISTS (SELECT 1 FROM "ListItem" i WHERE i.list_id = l.id)`,
          [r.target_id, familyId]
        )
        if (del.rowCount) {
          out.removed.List++
          drop.push(r.id)
        } else if (await existsInFamily(db, 'List', r.target_id, familyId)) {
          const empty = await db.query('SELECT 1 FROM "ListItem" WHERE list_id = $1 LIMIT 1', [r.target_id])
          keep('List', r.target_id, empty.rows.length ? 'not_empty' : 'modified')
        } else {
          out.alreadyGone++
          drop.push(r.id)
        }
      }
      for (const r of byTarget('FamilyMeal', 'created')) {
        const del = await db.query(
          `DELETE FROM "FamilyMeal" WHERE id = $1 AND family_id = $2 AND updated_at = created_at`,
          [r.target_id, familyId]
        )
        if (del.rowCount) {
          out.removed.FamilyMeal++
          drop.push(r.id)
        } else if (await existsInFamily(db, 'FamilyMeal', r.target_id, familyId)) keep('FamilyMeal', r.target_id, 'modified')
        else {
          out.alreadyGone++
          drop.push(r.id)
        }
      }
      for (const r of byTarget('FamilyMeal', 'linked:recipe_set')) {
        // The legacy entry is never modified, so its recipe_id is the value this job wrote.
        const upd = await db.query(
          `UPDATE "FamilyMeal" m SET recipe_id = NULL
             FROM "MealPlanEntry" e
            WHERE m.id = $1 AND m.family_id = $2 AND e.id = $3 AND m.recipe_id = e.recipe_id`,
          [r.target_id, familyId, r.source_id]
        )
        if (upd.rowCount) {
          out.unlinked++
          drop.push(r.id)
        } else if (await existsInFamily(db, 'FamilyMeal', r.target_id, familyId)) keep('FamilyMeal', r.target_id, 'relinked')
        else {
          out.alreadyGone++
          drop.push(r.id)
        }
      }
      for (const r of byTarget('FamilyMeal', 'linked')) drop.push(r.id)

      if (keptHere === 0) {
        // Cascades the remaining (archive/skip) ImportedRecords.
        await db.query('DELETE FROM "ImportJob" WHERE id = $1 AND family_id = $2', [jobId, familyId])
        out.jobsDeleted++
      } else {
        if (drop.length) {
          await db.query('DELETE FROM "ImportedRecord" WHERE id = ANY($1::text[]) AND family_id = $2', [drop, familyId])
        }
        await db.query(
          `UPDATE "ImportJob" SET status = 'partially_reversed',
                  summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object('reversal', $3::jsonb)
            WHERE id = $1 AND family_id = $2`,
          [jobId, familyId, JSON.stringify({ at: now, kept: keptHere })]
        )
      }
    }
    await db.query('COMMIT')
    return out
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}

async function existsInFamily(db: Queryable, model: 'ListItem' | 'List' | 'FamilyMeal', id: string, familyId: string) {
  const sql =
    model === 'ListItem'
      ? 'SELECT 1 FROM "ListItem" li JOIN "List" l ON l.id = li.list_id WHERE li.id = $1 AND l.family_id = $2'
      : `SELECT 1 FROM "${model}" WHERE id = $1 AND family_id = $2`
  return (await db.query(sql, [id, familyId])).rows.length > 0
}

// ---------------------------------------------------------------------------
// Reporting (counts only, never row content)
// ---------------------------------------------------------------------------

export function formatRunResult(r: FamilyRunResult): string {
  const c = r.counts
  const reasons = (rec: Record<string, number>) =>
    Object.entries(rec)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'none'
  return [
    `family ${r.familyId} [${r.mode}]${r.jobId ? ` job ${r.jobId}` : ''}${r.reconciled ? '' : ' RECONCILIATION FAILED'}`,
    `  source: MealPlan=${c.source.mealPlans} MealPlanEntry=${c.source.mealPlanEntries} ShoppingList=${c.source.shoppingLists} ShoppingItem=${c.source.shoppingItems}`,
    `  FamilyMeal: create=${c.meals.created} link=${c.meals.linked} skip(archived)=${c.meals.skipped} already=${c.meals.alreadyMapped}`,
    `  MealPlan: archive=${c.mealPlans.archived} already=${c.mealPlans.alreadyMapped}`,
    `  List: create=${c.lists.created} already=${c.lists.alreadyMapped}`,
    `  ListItem: create=${c.items.created} skip(archived)=${c.items.skipped} already=${c.items.alreadyMapped}`,
    `  skipped: ${c.meals.skipped + c.items.skipped} (${reasons(c.skipReasons)}); recipe refs nulled: ${c.recipeRefsNulled} (${reasons(c.nullReasons)})`,
    `  rows written: ${r.rowsWritten}`,
    ...r.problems.map((p) => `  problem: ${p}`),
  ].join('\n')
}

export function formatReverseResult(r: ReverseResult): string {
  return [
    `family ${r.familyId} [reverse] jobs=${r.jobs} jobsDeleted=${r.jobsDeleted}`,
    `  removed: FamilyMeal=${r.removed.FamilyMeal} List=${r.removed.List} ListItem=${r.removed.ListItem}; recipe links cleared=${r.unlinked}; already gone=${r.alreadyGone}`,
    `  kept (modified since backfill): ${r.kept.length}${r.kept.length ? ' -> ' + r.kept.map((k) => `${k.model}:${k.id}(${k.reason})`).join(', ') : ''}`,
  ].join('\n')
}
