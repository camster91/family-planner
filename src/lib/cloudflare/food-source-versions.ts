/**
 * Native D1 food-source continuity.
 *
 * This deliberately mirrors `food-planning/source-versions.ts` instead of
 * using the read Prisma adapter.  Source versions are part of a write lease:
 * the selection must be bounded, household scoped, complete, and made from
 * the same primary session as the rest of the D1 operation.
 */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
import type { D1Store } from "./database";

export const D1_FOOD_SOURCE_KINDS = [
  "Family",
  "User",
  "Recipe",
  "RecipeIngredient",
  "Ingredient",
  "InventoryItem",
  "FamilyMeal",
  "MealPrepSession",
  "MealBatch",
  "MealBatchConsumption",
  "List",
] as const;
export type D1FoodSourceKind = (typeof D1_FOOD_SOURCE_KINDS)[number];
export type D1FoodSourceSelection = Partial<
  Record<D1FoodSourceKind, readonly string[]>
>;

export type D1FoodSourceVersion = {
  kind: D1FoodSourceKind;
  id: string;
  generation: string;
  epoch: number;
};

export class D1FoodSourceVersionsUnavailable extends Error {
  readonly code = "FOOD_SOURCE_VERSIONS_UNAVAILABLE";
  constructor() {
    super("Food source continuity could not be checked.");
  }
}

const rowSchema = z
  .object({
    kind: z.enum(D1_FOOD_SOURCE_KINDS),
    id,
    generation: z.string().uuid(),
    epoch: z.number().int().min(0).max(2147483646),
  })
  .strict();

type SourceTable = {
  name: D1FoodSourceKind;
  rewriteTriggers: readonly string[];
};

const SOURCE_TABLES: readonly SourceTable[] = D1_FOOD_SOURCE_KINDS.map(
  (name) => ({
    name,
    rewriteTriggers: [
      `${name}_food_source_identity_guard`,
      `${name}_food_source_bounds_insert`,
      `${name}_food_source_epoch`,
    ],
  }),
);

function normalizeSelection(raw: D1FoodSourceSelection) {
  if (
    Object.keys(raw).some(
      (kind) => !D1_FOOD_SOURCE_KINDS.includes(kind as D1FoodSourceKind),
    )
  )
    throw new D1FoodSourceVersionsUnavailable();
  const selected = D1_FOOD_SOURCE_KINDS.map((kind) => {
    const ids = raw[kind] ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > 6000 ||
      ids.some((value) => !id.safeParse(value).success)
    )
      throw new D1FoodSourceVersionsUnavailable();
    return { kind, ids: [...new Set(ids)].sort() };
  }).filter((row) => row.ids.length);
  if (selected.reduce((sum, row) => sum + row.ids.length, 0) > 20000)
    throw new D1FoodSourceVersionsUnavailable();
  return selected;
}

/**
 * Check both ignored columns and all three native guards for every source
 * table.  The table and trigger names are a fixed allow-list, never input.
 */
export async function d1FoodSourceStorageAvailable(database: D1Store) {
  const session = database.withSession("first-primary");
  try {
    const checks = await session.batch(
      SOURCE_TABLES.map(({ name, rewriteTriggers }) =>
        session.prepare(
          // D1/workerd does not accept bound parameters inside the
          // table-valued pragma. These identifiers are a fixed source
          // allow-list, never caller input, so keeping them as literals
          // preserves the same guarded storage check without a binding
          // mismatch on native SQLite.
          `SELECT
              (SELECT COUNT(*) FROM pragma_table_info('${name}')
                 WHERE name IN ('food_generation','food_epoch')) AS columns,
              (SELECT COUNT(*) FROM sqlite_master
                 WHERE type='trigger' AND tbl_name='${name}'
                   AND name IN ('${rewriteTriggers[0]}','${rewriteTriggers[1]}','${rewriteTriggers[2]}')) AS triggers`,
        ),
      ),
    );
    return checks.every((result) => {
      const row = result.results?.[0] as
        { columns?: number; triggers?: number } | undefined;
      return row?.columns === 2 && row.triggers === 3;
    });
  } catch {
    // Missing migrations must be a refusal, not an availability exception
    // that can accidentally bypass the source lease.
    return false;
  }
}

function placeholders(count: number, startAt = 1) {
  return Array.from(
    { length: count },
    (_, index) => `?${startAt + index}`,
  ).join(",");
}

type RawVersion = {
  kind: string;
  id: string;
  generation: string;
  epoch: number;
};

function sourceQuery(
  kind: D1FoodSourceKind,
  ids: readonly string[],
  familyId: string,
) {
  const idArgs = placeholders(ids.length, 2);
  // Only names from D1_FOOD_SOURCE_KINDS reach this switch.  Keep this as
  // explicit SQL rather than interpolating a caller-provided table name.
  if (kind === "Family")
    return {
      sql: `SELECT 'Family' AS kind, id, food_generation AS generation, food_epoch AS epoch
            FROM "Family" WHERE id IN (${placeholders(ids.length)})`,
      // Family is its own ownership boundary; unlike every other source it
      // has no family_id column. Do not bind an unused family scope value,
      // which native SQLite correctly rejects as an arity mismatch.
      args: [...ids],
    };
  if (kind === "RecipeIngredient")
    return {
      sql: `SELECT 'RecipeIngredient' AS kind, ri.id, ri.food_generation AS generation, ri.food_epoch AS epoch
            FROM "RecipeIngredient" ri
            JOIN "Recipe" r ON r.id=ri.recipe_id
            JOIN "Ingredient" i ON i.id=ri.ingredient_id
            WHERE r.family_id=?1 AND i.family_id=?1 AND ri.id IN (${idArgs})`,
      args: [familyId, ...ids],
    };
  return {
    sql: `SELECT '${kind}' AS kind, source_row.id, source_row.food_generation AS generation,
                 source_row.food_epoch AS epoch
          FROM "${kind}" source_row
          WHERE source_row.family_id=?1 AND source_row.id IN (${idArgs})`,
    args: [familyId, ...ids],
  };
}

/**
 * Read the exact requested source graph from the D1 primary session.  A
 * missing, foreign, duplicate, malformed, or stale-shaped row refuses the
 * whole read; callers must never continue with a partial grounded snapshot.
 */
export async function readD1FoodSourceVersions(
  database: D1Store,
  familyId: string,
  raw: D1FoodSourceSelection,
): Promise<D1FoodSourceVersion[]> {
  if (!id.safeParse(familyId).success)
    throw new D1FoodSourceVersionsUnavailable();
  const selected = normalizeSelection(raw);
  if (!(await d1FoodSourceStorageAvailable(database)))
    throw new D1FoodSourceVersionsUnavailable();
  if (!selected.length) return [];

  const session = database.withSession("first-primary");
  const rows: RawVersion[] = [];
  // Keep the bind count well below SQLite/D1 limits while allowing callers
  // to use the canonical 6,000-per-kind bound.
  for (const { kind, ids } of selected) {
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      const query = sourceQuery(kind, chunk, familyId);
      const result = await session
        .prepare(query.sql)
        .bind(...query.args)
        .all<RawVersion>();
      rows.push(...(result.results ?? []));
    }
  }

  const expected = new Set(
    selected.flatMap(({ kind, ids }) =>
      ids.map((sourceId) => `${kind}:${sourceId}`),
    ),
  );
  if (rows.length !== expected.size)
    throw new D1FoodSourceVersionsUnavailable();
  const versions: D1FoodSourceVersion[] = [];
  for (const row of rows) {
    const parsed = rowSchema.safeParse(row);
    if (
      !parsed.success ||
      !expected.delete(`${parsed.data.kind}:${parsed.data.id}`)
    )
      throw new D1FoodSourceVersionsUnavailable();
    versions.push(parsed.data);
  }
  if (expected.size) throw new D1FoodSourceVersionsUnavailable();
  return versions.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
}
