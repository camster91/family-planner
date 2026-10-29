/** Native D1 recipe library boundary.
 *
 * The PostgreSQL recipe handlers intentionally remain the source of the
 * product contract. This adapter mirrors those contracts with a read-plan /
 * SQL-effect split so Workers never instantiate the write Prisma client.
 * Every read is household scoped and every mutation is receipt-capable.
 */
import { randomUUID, createHash } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { RecipeSearch } from "@/lib/recipe-search";
import type { IngredientLine } from "@/lib/recipe-input-contract";
import {
  canonicalRecipeSource,
  legacyRecipeSource,
} from "@/lib/recipe-curation-contract";
import {
  RECIPE_OWNER_PROTOCOL,
  recipeOwnerSchema,
  sameRecipeOwner,
} from "@/lib/recipe-owner-contract";
import {
  RECIPE_DETAIL_SELECT,
  RECIPE_SUMMARY_SELECT,
  canDeleteRecipe,
  canEditRecipe,
} from "@/lib/recipes";
import { normalizeName, cleanContent } from "@/lib/backfill/meals-groceries";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/feature-flags";
import {
  executeD1PersonEffect,
  type NativePersonPlan,
  type NativePersonResult,
} from "./person-effect";
import { d1WriteCheck } from "./write-check";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { withD1ReadClient, type D1ReadClient } from "./read-client";

export type D1RecipeActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
const actorForEffect = (actor: D1RecipeActor) => ({
  userId: actor.userId,
  familyId: actor.familyId,
  role: actor.role,
  generation: actor.generation,
});
const failure = (
  status: number,
  code: string,
  message?: string,
): EffectResult => ({
  status,
  body: { error: { code, ...(message ? { message } : {}) } },
});
const noStore = { "Cache-Control": "private, no-store" };

function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function authorize(
  db: D1ReadClient,
  actor: D1RecipeActor,
  write = false,
): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({
      where: { id: actor.familyId },
      select: { features: true },
    }),
  ]);
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation
  )
    return failure(401, "UNAUTHORIZED");
  if (!(
    user.role === "parent" ||
    user.role === "teen" ||
    user.role === "child"
  ))
    return failure(403, "FORBIDDEN");
  if (write && !canEditRecipe(user.role)) return failure(403, "FORBIDDEN");
  if (!family) return failure(404, "HOUSEHOLD_UNAVAILABLE");
  if (
    !isFeatureEnabled(normalizeFeatures(parsedJson(family.features)), "meals")
  )
    return failure(403, "MEALS_DISABLED");
  return null;
}

export async function authorizeD1RecipeRead(
  actor: D1RecipeActor,
  database?: D1Store,
) {
  return withD1ReadClient((db) => authorize(db, actor), database as any);
}

function sourceKey(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
function canonicalSource(value: string | null | undefined): string | null {
  return value ? canonicalRecipeSource(value) : null;
}

function summaryWhere(
  familyId: string,
  input: RecipeSearch,
): Record<string, unknown> {
  const q = input.q?.normalize("NFC");
  const ingredient = input.ingredient?.normalize("NFC");
  return {
    family_id: familyId,
    ...(input.favorite ? { favorite: true } : {}),
    ...(input.collection
      ? {
          collection_entries: {
            some: { collection_id: input.collection, family_id: familyId },
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(ingredient
      ? {
          ingredients: {
            some: {
              ingredient: {
                family_id: familyId,
                name: { contains: ingredient, mode: "insensitive" },
              },
            },
          },
        }
      : {}),
    ...(input.maxPrep !== undefined
      ? { prep_time: { lte: input.maxPrep } }
      : {}),
    ...(input.minServings !== undefined
      ? { servings: { gte: input.minServings } }
      : {}),
  };
}

export async function readD1Recipes(
  actor: D1RecipeActor,
  options: { limit: number; offset: number; search: RecipeSearch },
  database?: D1Store,
) {
  return withD1ReadClient(async (db) => {
    const denied = await authorize(db, actor);
    if (denied) return denied;
    const rows = await db.recipe.findMany({
      where: summaryWhere(actor.familyId, options.search) as any,
      select: {
        ...RECIPE_SUMMARY_SELECT,
        _count: { select: { ingredients: true } },
      } as any,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip: options.offset,
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    return {
      status: 200,
      body: {
        recipes: hasMore ? rows.slice(0, options.limit) : rows,
        nextOffset: hasMore ? options.offset + options.limit : null,
      },
    };
  }, database as any);
}

export async function readD1Recipe(
  actor: D1RecipeActor,
  id: string,
  database?: D1Store,
) {
  return withD1ReadClient(async (db) => {
    const denied = await authorize(db, actor);
    if (denied) return denied;
    const recipe = await db.recipe.findFirst({
      where: { id, family_id: actor.familyId },
      select: RECIPE_DETAIL_SELECT as any,
    });
    return recipe
      ? { status: 200, body: { recipe } }
      : failure(404, "NOT_FOUND");
  }, database as any);
}

type ResolvedLine = {
  ingredientId: string;
  amount: number;
  unit: string | null;
  note: string | null;
  newIngredient?: { id: string; name: string; unit: string | null };
};
async function resolveLines(
  db: D1ReadClient,
  familyId: string,
  lines: readonly IngredientLine[],
): Promise<{ lines?: ResolvedLine[]; refusal?: EffectResult }> {
  const ids = [
    ...new Set(
      lines.flatMap((line) => (line.ingredient_id ? [line.ingredient_id] : [])),
    ),
  ];
  if (ids.length) {
    const owned = await db.ingredient.findMany({
      where: { id: { in: ids }, family_id: familyId },
      select: { id: true },
    });
    if (owned.length !== ids.length)
      return { refusal: failure(400, "INGREDIENT_NOT_FOUND") };
  }
  const needed = new Set(
    lines.flatMap((line) => (line.name ? [normalizeName(line.name)] : [])),
  );
  const byName = new Map<
    string,
    { id: string; name: string; unit: string | null }
  >();
  if (needed.size) {
    const rows = await db.ingredient.findMany({
      where: { family_id: familyId },
      orderBy: { id: "asc" },
      take: 2001,
      select: { id: true, name: true, unit: true },
    });
    for (const row of rows) {
      const key = normalizeName(row.name);
      if (needed.has(key)) {
        needed.delete(key);
        byName.set(key, row);
      }
    }
    if (needed.size && rows.length >= 2001)
      return { refusal: failure(409, "INGREDIENT_CATALOG_UNAVAILABLE") };
  }
  const resolved: ResolvedLine[] = [],
    seen = new Set<string>();
  for (const line of lines) {
    let ingredientId = line.ingredient_id;
    let newIngredient: ResolvedLine["newIngredient"];
    if (!ingredientId) {
      const display = cleanContent(line.name);
      const key = normalizeName(display);
      const existing = byName.get(key);
      if (existing) ingredientId = existing.id;
      else {
        ingredientId = randomUUID();
        newIngredient = {
          id: ingredientId,
          name: display,
          unit: line.unit ?? null,
        };
        byName.set(key, newIngredient);
      }
    }
    if (!ingredientId || seen.has(ingredientId))
      return { refusal: failure(400, "INGREDIENT_DUPLICATE") };
    seen.add(ingredientId);
    resolved.push({
      ingredientId,
      amount: line.amount,
      unit: line.unit ?? null,
      note: line.note ?? null,
      newIngredient,
    });
  }
  return { lines: resolved };
}

function insertIngredientStatements(
  session: Pick<D1Store, "prepare">,
  lines: readonly ResolvedLine[],
  familyId: string,
): D1Statement[] {
  return lines.flatMap((line) =>
    line.newIngredient
      ? [
          session
            .prepare(
              "INSERT OR IGNORE INTO Ingredient(id,family_id,name,unit) VALUES(?1,?2,?3,?4)",
            )
            .bind(
              line.newIngredient.id,
              familyId,
              line.newIngredient.name,
              line.newIngredient.unit,
            ),
        ]
      : [],
  );
}

function recipeCreatePlan(
  db: D1ReadClient,
  actor: D1RecipeActor,
  input: any,
  receiptId: string | null,
  now: Date,
): Promise<NativePersonPlan> {
  return (async () => {
    const source =
      canonicalSource(input.source_url) ??
      legacyRecipeSource(input.description) ??
      null;
    const key = source ? sourceKey(source) : null;
    if (source && !input.source_copy) {
      const existing = await db.recipe.findFirst({
        where: { family_id: actor.familyId, source_key: key },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        select: { id: true, title: true },
      });
      if (existing)
        return {
          status: 409,
          body: {
            error: { code: "RECIPE_SOURCE_EXISTS" },
            existingRecipe: existing,
          },
        };
      const legacy = await db.recipe.findMany({
        where: {
          family_id: actor.familyId,
          source_key: null,
          description: { startsWith: "Source: https://" },
        },
        orderBy: { id: "asc" },
        take: 2001,
        select: { id: true, title: true, description: true },
      });
      const old = legacy.find(
        (row) => legacyRecipeSource(row.description) === source,
      );
      if (old)
        return {
          status: 409,
          body: {
            error: { code: "RECIPE_SOURCE_EXISTS" },
            existingRecipe: { id: old.id, title: old.title },
          },
        };
      if (legacy.length > 2000)
        return failure(409, "RECIPE_SOURCE_CHECK_UNAVAILABLE");
    }
    const resolved = await resolveLines(
      db,
      actor.familyId,
      input.ingredients ?? [],
    );
    if (resolved.refusal) return resolved.refusal;
    const id = randomUUID(),
      generation = randomUUID();
    const recipe = {
      id,
      family_id: actor.familyId,
      title: input.title,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      prep_time: input.prep_time ?? null,
      cook_time: input.cook_time ?? null,
      servings: input.servings ?? 2,
      image_url: input.image_url ?? null,
      source_url: source,
      source_key: key,
      favorite: false,
      revision: 0,
      created_by: actor.userId,
      created_at: now,
      updated_at: now,
    };
    const lines = resolved.lines ?? [];
    return {
      status: 201,
      body: {
        recipeId: id,
        recipeGeneration: generation,
        ...(input.creation_owner
          ? { creationOwner: input.creation_owner }
          : {}),
      },
      effects: (session) => [
        session
          .prepare(
            "INSERT INTO Recipe(id,family_id,title,description,instructions,prep_time,cook_time,servings,image_url,source_url,source_key,favorite,revision,created_by,created_at,updated_at,food_generation,food_epoch) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,0,?12,?13,?13,?14,0)",
          )
          .bind(
            id,
            actor.familyId,
            recipe.title,
            recipe.description,
            recipe.instructions,
            recipe.prep_time,
            recipe.cook_time,
            recipe.servings,
            recipe.image_url,
            recipe.source_url,
            recipe.source_key,
            actor.userId,
            now.getTime(),
            generation,
          ),
        ...insertIngredientStatements(session, lines, actor.familyId),
        ...lines.map((line) =>
          session
            .prepare(
              "INSERT INTO RecipeIngredient(id,recipe_id,ingredient_id,amount,unit,note) VALUES(?1,?2,?3,?4,?5,?6)",
            )
            .bind(
              randomUUID(),
              id,
              line.ingredientId,
              line.amount,
              line.unit,
              line.note,
            ),
        ),
      ],
    };
  })();
}

export async function createD1Recipe(
  actor: D1RecipeActor,
  input: any,
  key: string | null,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor: actorForEffect(actor),
    action: "recipe.create",
    input,
    key,
    database,
    authorize: (db) => authorize(db, actor, true),
    plan: (db, receiptId) =>
      recipeCreatePlan(db, actor, input, receiptId, new Date()),
  });
}

export async function updateD1Recipe(
  actor: D1RecipeActor,
  id: string,
  input: any,
  database?: D1Store,
): Promise<NativePersonResult> {
  const now = new Date();
  return executeD1PersonEffect({
    actor: actorForEffect(actor),
    action: "recipe.update",
    input: { id, ...input },
    key: null,
    database,
    now,
    authorize: (db) => authorize(db, actor, true),
    plan: async (db) => {
      const current = await db.recipe.findFirst({
        where: { id, family_id: actor.familyId },
        select: { id: true, revision: true, updated_at: true },
      });
      if (!current) return failure(404, "NOT_FOUND");
      if (
        input.base_revision !== undefined &&
        current.revision !== input.base_revision
      )
        return failure(409, "REVISION_CONFLICT");
      if (
        input.base_updated_at !== undefined &&
        current.updated_at.getTime() !== Date.parse(input.base_updated_at)
      )
        return failure(409, "REVISION_CONFLICT");
      const resolved =
        input.ingredients === undefined
          ? { lines: null, refusal: undefined }
          : await resolveLines(db, actor.familyId, input.ingredients);
      if (resolved.refusal) return resolved.refusal;
      const fields: Array<[string, string | number | null]> = [];
      for (const key of [
        "title",
        "description",
        "instructions",
        "prep_time",
        "cook_time",
        "servings",
      ] as const)
        if (input[key] !== undefined) fields.push([key, input[key] ?? null]);
      const set = fields
        .map(([name]) => `"${name}"=?`)
        .concat(["updated_at=?", "revision=revision+1"]);
      const values: Array<string | number | null> = fields
        .map(([, value]) => value)
        .concat([now.getTime()]);
      return {
        status: 200,
        body: { recipeId: id },
        effects: (session) => {
          const check = d1WriteCheck(
            session,
            `EXISTS(SELECT 1 FROM Recipe WHERE id=?1 AND family_id=?2 AND revision=?3 AND updated_at=?4)`,
            [
              id,
              actor.familyId,
              current.revision,
              current.updated_at.getTime(),
            ],
          );
          const statements: D1Statement[] = [
            check,
            session
              .prepare(
                `UPDATE Recipe SET ${set.join(",")} WHERE id=? AND family_id=?`,
              )
              .bind(...values, id, actor.familyId),
            d1WriteCheck(session, "changes()=1"),
          ];
          if (resolved.lines) {
            statements.push(
              ...insertIngredientStatements(
                session,
                resolved.lines,
                actor.familyId,
              ),
            );
            statements.push(
              session
                .prepare("DELETE FROM RecipeIngredient WHERE recipe_id=?1")
                .bind(id),
            );
            statements.push(
              ...resolved.lines.map((line) =>
                session
                  .prepare(
                    "INSERT INTO RecipeIngredient(id,recipe_id,ingredient_id,amount,unit,note) VALUES(?1,?2,?3,?4,?5,?6)",
                  )
                  .bind(
                    randomUUID(),
                    id,
                    line.ingredientId,
                    line.amount,
                    line.unit,
                    line.note,
                  ),
              ),
            );
          }
          return statements;
        },
      };
    },
  });
}

export async function deleteD1Recipe(
  actor: D1RecipeActor,
  id: string,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor: actorForEffect(actor),
    action: "recipe.delete",
    input: { id },
    key: null,
    database,
    authorize: (db) => authorize(db, actor, false),
    plan: async (db) => {
      if (!canDeleteRecipe(actor.role)) return failure(403, "FORBIDDEN");
      const recipe = await db.recipe.findFirst({
        where: { id, family_id: actor.familyId },
        select: { id: true },
      });
      if (!recipe) return failure(404, "NOT_FOUND");
      const refs = await db.mealPlanEntry.count({ where: { recipe_id: id } });
      if (refs > 0) return failure(409, "RECIPE_IN_ARCHIVED_PLAN");
      return {
        status: 200,
        body: { success: true },
        effects: (session) => [
          d1WriteCheck(
            session,
            "EXISTS(SELECT 1 FROM Recipe WHERE id=?1 AND family_id=?2)",
            [id, actor.familyId],
          ),
          session
            .prepare("DELETE FROM Recipe WHERE id=?1 AND family_id=?2")
            .bind(id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export async function readD1Collections(
  actor: D1RecipeActor,
  database?: D1Store,
) {
  return withD1ReadClient(async (db) => {
    const denied = await authorize(db, actor);
    if (denied) return denied;
    const collections = await db.recipeCollection.findMany({
      where: { family_id: actor.familyId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true, name: true, revision: true },
    });
    return { status: 200, body: { collections } };
  }, database as any);
}

export async function readD1Curation(
  actor: D1RecipeActor,
  id: string,
  database?: D1Store,
) {
  return withD1ReadClient(async (db) => {
    const denied = await authorize(db, actor);
    if (denied) return denied;
    const recipe = await db.recipe.findFirst({
      where: { id, family_id: actor.familyId },
      select: { id: true, revision: true, favorite: true },
    });
    if (!recipe) return failure(404, "NOT_FOUND");
    const entries = await db.recipeCollectionEntry.findMany({
      where: { recipe_id: id, family_id: actor.familyId },
      select: { collection_id: true },
    });
    return {
      status: 200,
      body: {
        ...recipe,
        collectionIds: entries.map((entry) => entry.collection_id),
      },
    };
  }, database as any);
}

export async function mutateD1Collection(
  actor: D1RecipeActor,
  input: any,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor: actorForEffect(actor),
    action: "recipe.collection",
    input,
    key: null,
    database,
    authorize: (db) => authorize(db, actor, true),
    plan: async (db) => {
      if (input.action === "create") {
        const key = input.name.toLocaleLowerCase("en-US");
        const existing = await db.recipeCollection.findFirst({
          where: { family_id: actor.familyId, name_key: key },
          select: { id: true, name: true, revision: true },
        });
        if (existing) return { status: 200, body: { collection: existing } };
        if (
          (await db.recipeCollection.count({
            where: { family_id: actor.familyId },
          })) >= 100
        )
          return failure(409, "COLLECTION_LIMIT");
        const id = randomUUID();
        return {
          status: 201,
          body: { collection: { id, name: input.name, revision: 0 } },
          effects: (session) => [
            session
              .prepare(
                "INSERT INTO RecipeCollection(id,family_id,name,name_key,revision) VALUES(?1,?2,?3,?4,0)",
              )
              .bind(id, actor.familyId, input.name, key),
          ],
        };
      }
      const current = await db.recipeCollection.findFirst({
        where: { id: input.id, family_id: actor.familyId },
        select: { id: true, name: true, revision: true },
      });
      if (!current) return failure(404, "NOT_FOUND");
      if (current.revision !== input.revision)
        return failure(409, "REVISION_CONFLICT");
      if (input.action === "delete")
        return {
          status: 200,
          body: { deleted: true },
          effects: (session) => [
            d1WriteCheck(
              session,
              "EXISTS(SELECT 1 FROM RecipeCollection WHERE id=?1 AND family_id=?2 AND revision=?3)",
              [current.id, actor.familyId, current.revision],
            ),
            session
              .prepare(
                "DELETE FROM RecipeCollection WHERE id=?1 AND family_id=?2",
              )
              .bind(current.id, actor.familyId),
            d1WriteCheck(session, "changes()=1"),
          ],
        };
      const key = input.name.toLocaleLowerCase("en-US");
      const duplicate = await db.recipeCollection.findFirst({
        where: {
          family_id: actor.familyId,
          name_key: key,
          id: { not: current.id },
        },
        select: { id: true },
      });
      if (duplicate) return failure(409, "COLLECTION_NAME_EXISTS");
      return {
        status: 200,
        body: {
          collection: {
            id: current.id,
            name: input.name,
            revision: current.revision + 1,
          },
        },
        effects: (session) => [
          d1WriteCheck(
            session,
            "EXISTS(SELECT 1 FROM RecipeCollection WHERE id=?1 AND family_id=?2 AND revision=?3)",
            [current.id, actor.familyId, current.revision],
          ),
          session
            .prepare(
              "UPDATE RecipeCollection SET name=?1,name_key=?2,revision=revision+1 WHERE id=?3 AND family_id=?4",
            )
            .bind(input.name, key, current.id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
        ],
      };
    },
  });
}

export async function mutateD1Curation(
  actor: D1RecipeActor,
  id: string,
  input: any,
  database?: D1Store,
): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor: actorForEffect(actor),
    action: "recipe.curation",
    input: { id, ...input },
    key: null,
    database,
    authorize: (db) => authorize(db, actor, true),
    plan: async (db) => {
      const recipe = await db.recipe.findFirst({
        where: { id, family_id: actor.familyId },
        select: { id: true, revision: true, favorite: true },
      });
      if (!recipe) return failure(404, "NOT_FOUND");
      const collections = await db.recipeCollection.findMany({
        where: { id: { in: input.collectionIds }, family_id: actor.familyId },
        select: { id: true },
      });
      if (collections.length !== input.collectionIds.length)
        return failure(404, "COLLECTION_UNAVAILABLE");
      const entries = await db.recipeCollectionEntry.findMany({
        where: { recipe_id: id, family_id: actor.familyId },
        select: { collection_id: true },
      });
      const same =
        recipe.favorite === input.favorite &&
        entries.length === input.collectionIds.length &&
        entries.every((entry) =>
          input.collectionIds.includes(entry.collection_id),
        );
      if (same)
        return {
          status: 200,
          body: {
            id,
            revision: recipe.revision,
            favorite: recipe.favorite,
            collectionIds: input.collectionIds,
          },
        };
      if (recipe.revision !== input.revision)
        return failure(409, "REVISION_CONFLICT");
      return {
        status: 200,
        body: {
          id,
          revision: recipe.revision + 1,
          favorite: input.favorite,
          collectionIds: input.collectionIds,
        },
        effects: (session) => [
          d1WriteCheck(
            session,
            "EXISTS(SELECT 1 FROM Recipe WHERE id=?1 AND family_id=?2 AND revision=?3)",
            [id, actor.familyId, recipe.revision],
          ),
          session
            .prepare(
              "UPDATE Recipe SET favorite=?1,revision=revision+1,updated_at=?2 WHERE id=?3 AND family_id=?4",
            )
            .bind(input.favorite ? 1 : 0, Date.now(), id, actor.familyId),
          d1WriteCheck(session, "changes()=1"),
          session
            .prepare(
              "DELETE FROM RecipeCollectionEntry WHERE recipe_id=?1 AND family_id=?2",
            )
            .bind(id, actor.familyId),
          ...input.collectionIds.map((collectionId: string) =>
            session
              .prepare(
                "INSERT INTO RecipeCollectionEntry(recipe_id,collection_id,family_id) VALUES(?1,?2,?3)",
              )
              .bind(id, collectionId, actor.familyId),
          ),
        ],
      };
    },
  });
}

export async function readD1RecipeReceipt(
  actor: D1RecipeActor,
  key: string,
  hash: string,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database());
  return withD1ReadClient(async (db) => {
    const denied = await authorize(db, actor, true);
    if (denied) return denied;
    const row = await db.idempotencyRecord.findFirst({
      where: {
        scope: `user:${actor.userId}`,
        key,
        family_id: actor.familyId,
        user_id: actor.userId,
      },
      select: {
        action: true,
        request_hash: true,
        response_status: true,
        response_body: true,
        expires_at: true,
      },
    });
    if (!row) return { status: 200, body: { state: "absent" } };
    if (row.action !== "recipe.create" || row.request_hash !== hash)
      return failure(409, "RECIPE_RECEIPT_CONFLICT");
    if (row.expires_at.getTime() <= Date.now())
      return { status: 200, body: { state: "expired" } };
    if (row.response_status === null)
      return { status: 200, body: { state: "pending" } };
    const body = parsedJson(row.response_body) as any;
    if (body?.creationOwner) {
      const owner = recipeOwnerSchema.safeParse(body.creationOwner);
      if (
        !owner.success ||
        !sameRecipeOwner(owner.data, {
          protocol: RECIPE_OWNER_PROTOCOL,
          actorId: actor.userId,
          familyId: actor.familyId,
          role: actor.role,
          generation: actor.generation,
        })
      )
        return failure(409, "RECIPE_OWNER_CHANGED");
    }
    if (
      row.response_status === 409 &&
      body?.error?.code === "RECIPE_SOURCE_EXISTS"
    )
      return {
        status: 200,
        body: { state: "refused", reason: "source-exists" },
      };
    const id = typeof body?.recipeId === "string" ? body.recipeId : null;
    if (!id)
      return { status: 200, body: { state: "committed", current: "unknown" } };
    const recipeRow = await store
      .withSession("first-primary")
      .prepare(
        'SELECT "id","food_generation" FROM "Recipe" WHERE "id"=?1 AND "family_id"=?2 AND "created_by"=?3',
      )
      .bind(id, actor.familyId, actor.userId)
      .first<{ id: string; food_generation: string }>();
    const present = Boolean(
      recipeRow &&
      recipeRow.id === id &&
      recipeRow.food_generation === body.recipeGeneration,
    );
    return {
      status: 200,
      body: { state: "committed", current: present ? "present" : "removed" },
    };
  }, database as any);
}

export { noStore };
