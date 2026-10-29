/** PostgreSQL row continuity for the exact scoped, bounded food source graph.
 * Not authority or a lock on absence. Call only after current actor/household
 * authorization, inside the same repeatable-read/serializable source transaction. */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import type { D1Store } from "../cloudflare/database";
import {
  d1FoodSourceStorageAvailable,
  readD1FoodSourceVersions,
  type D1FoodSourceSelection,
} from "../cloudflare/food-source-versions";
export const FOOD_SOURCE_KINDS = [
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
export type FoodSourceKind = (typeof FOOD_SOURCE_KINDS)[number];
export type FoodSourceSelection = Partial<
  Record<FoodSourceKind, readonly string[]>
>;
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
type SourceReader = Reader | D1Store;
const version = z
  .object({
    kind: z.enum(FOOD_SOURCE_KINDS),
    id,
    generation: z.string().uuid(),
    epoch: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type FoodSourceVersion = z.infer<typeof version>;
export class FoodSourceVersionsUnavailable extends Error {
  readonly code = "FOOD_SOURCE_VERSIONS_UNAVAILABLE";
  constructor() {
    super("Food source continuity could not be checked.");
  }
}
export async function foodSourceStorageAvailable(tx: SourceReader) {
  if (isD1SourceReader(tx)) return d1FoodSourceStorageAvailable(tx);
  const rows = await tx.$queryRaw<Array<{ ready: boolean }>>`
    SELECT COUNT(*) = 11 AND bool_and(
      (SELECT COUNT(*) = 2 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', expected.name))
        AND NOT a.attisdropped AND a.attnotnull AND (
          (a.attname = 'food_generation' AND a.atttypid = 'text'::regtype) OR
          (a.attname = 'food_epoch' AND a.atttypid = 'integer'::regtype)))
      AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(format('public.%I', expected.name))
        AND t.tgname = 'herewoven_food_source_version' AND NOT t.tgisinternal
        AND t.tgenabled = 'A' AND t.tgtype = 23
        AND t.tgfoid = to_regprocedure('public.herewoven_food_source_version()'))
    ) AS ready FROM unnest(ARRAY['Family','User','Recipe','RecipeIngredient','Ingredient','InventoryItem','FamilyMeal','MealPrepSession','MealBatch','MealBatchConsumption','List']) expected(name)`;
  return rows[0]?.ready === true;
}
function normalizedSelection(raw: FoodSourceSelection) {
  if (
    Object.keys(raw).some(
      (kind) => !FOOD_SOURCE_KINDS.includes(kind as FoodSourceKind),
    )
  )
    throw new FoodSourceVersionsUnavailable();
  const selected = FOOD_SOURCE_KINDS.map((kind) => {
    const ids = raw[kind] ?? [];
    if (
      !Array.isArray(ids) ||
      ids.length > 6000 ||
      ids.some((value) => !id.safeParse(value).success)
    )
      throw new FoodSourceVersionsUnavailable();
    return { kind, ids: [...new Set(ids)].sort() };
  }).filter((row) => row.ids.length);
  if (selected.reduce((sum, row) => sum + row.ids.length, 0) > 20000)
    throw new FoodSourceVersionsUnavailable();
  return selected;
}
/** Content is intentionally not selected. Row IDs must exactly equal the known
 * source selection; foreign/missing/duplicated/incomplete versions all refuse. */
export async function readFoodSourceVersions(
  tx: SourceReader,
  familyId: string,
  raw: FoodSourceSelection,
): Promise<FoodSourceVersion[]> {
  if (isD1SourceReader(tx)) {
    return readD1FoodSourceVersions(
      tx,
      familyId,
      raw as D1FoodSourceSelection,
    ) as Promise<FoodSourceVersion[]>;
  }
  if (!id.safeParse(familyId).success)
    throw new FoodSourceVersionsUnavailable();
  const selected = normalizedSelection(raw);
  if (!(await foodSourceStorageAvailable(tx)))
    throw new FoodSourceVersionsUnavailable();
  if (!selected.length) return [];
  const queries = selected.map(({ kind, ids }) => {
    // Only fixed names from FOOD_SOURCE_KINDS enter raw SQL identifiers.
    const table = Prisma.raw(`public."${kind}"`);
    const ownership =
      kind === "Family"
        ? Prisma.sql`source_row."id" = ${familyId}`
        : kind === "RecipeIngredient"
          ? Prisma.sql`EXISTS (SELECT 1 FROM public."Recipe" r JOIN public."Ingredient" i ON i."id"=source_row."ingredient_id" WHERE r."id"=source_row."recipe_id" AND r."family_id"=${familyId} AND i."family_id"=${familyId})`
          : Prisma.sql`source_row."family_id" = ${familyId}`;
    return Prisma.sql`SELECT ${kind}::text AS kind, source_row."id", source_row."food_generation" AS generation, source_row."food_epoch" AS epoch FROM ${table} AS source_row WHERE ${ownership} AND source_row."id" IN (${Prisma.join(ids)})`;
  });
  const rows = await tx.$queryRaw<unknown[]>(
    Prisma.sql`${Prisma.join(queries, " UNION ALL ")} ORDER BY kind, id`,
  );
  const expected = new Set(
    selected.flatMap(({ kind, ids }) => ids.map((id) => `${kind}:${id}`)),
  );
  if (!Array.isArray(rows) || rows.length !== expected.size)
    throw new FoodSourceVersionsUnavailable();
  const versions: FoodSourceVersion[] = [];
  for (const row of rows) {
    const parsed = version.safeParse(row);
    if (
      !parsed.success ||
      !expected.delete(`${parsed.data.kind}:${parsed.data.id}`)
    )
      throw new FoodSourceVersionsUnavailable();
    versions.push(parsed.data);
  }
  if (expected.size) throw new FoodSourceVersionsUnavailable();
  return versions.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
}

function isD1SourceReader(value: SourceReader): value is D1Store {
  return (
    typeof (value as D1Store).prepare === "function" &&
    typeof (value as D1Store).withSession === "function"
  );
}
