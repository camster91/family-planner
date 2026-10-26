import { foodSourceStorageAvailable } from "@/lib/food-planning/source-versions";
import { readRecipeCreateReceiptIdentity } from "@/lib/recipe-create-receipt-identity";
import { recordTimelineFactInTx } from "@/lib/review-inbox/timeline-fact";
/** Recipe creation and a compact durable receipt commit together (#460). */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  RECIPE_DETAIL_SELECT,
  RECIPE_SUMMARY_SELECT,
  canEditRecipe,
  resolveIngredientLines,
  type createRecipeSchema,
} from "@/lib/recipes";
import { hashIdempotentRequest, type EffectResult } from "@/lib/idempotency";
import { createHash } from "node:crypto";
import {
  canonicalRecipeSource,
  legacyRecipeSource,
} from "@/lib/recipe-curation-contract";

type Db = Pick<PrismaClient, "$transaction">;
type Actor = { userId: string; familyId: string; tokenVersion: number; originalRole?: string };
type Input = z.infer<typeof createRecipeSchema>;
export const RECIPE_CREATE_ACTION = "recipe.create";
const failure = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});

export async function recipeWriteAuthority(
  tx: Prisma.TransactionClient,
  actor: Actor,
): Promise<EffectResult | null> {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  if (actor.originalRole !== undefined) {
    // Fence ordinary role/session/feature updates through effects and replay
    // projection, including writers which do not take the advisory locks.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
  }
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    return failure(401, "UNAUTHORIZED");
  if (actor.originalRole !== undefined && user.role !== actor.originalRole)
    return failure(403, "RECIPE_OWNER_CHANGED");
  if (user.family_id !== actor.familyId || !canEditRecipe(user.role))
    return failure(403, "FORBIDDEN");
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family || !isFeatureEnabled(normalizeFeatures(family.features), "meals"))
    return failure(403, "FEATURE_DISABLED");
  return null;
}
export async function authorizeRecipeCreation(db: Db, actor: Actor) {
  return db.$transaction((tx) => recipeWriteAuthority(tx, actor));
}
export async function createRecipeWithReceipt(
  db: Db,
  actor: Actor,
  input: Input,
  recordId: string | null,
  retainSourceRefusal = false,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const refused = await recipeWriteAuthority(tx, actor);
    if (refused) return refused;
    if (recordId) {
      await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
      const receipt = await tx.idempotencyRecord.findFirst({
        where: {
          id: recordId,
          scope: `user:${actor.userId}`,
          family_id: actor.familyId,
          user_id: actor.userId,
          action: RECIPE_CREATE_ACTION,
          request_hash: hashIdempotentRequest(RECIPE_CREATE_ACTION, input),
        },
        select: { response_status: true, response_body: true },
      });
      if (!receipt) return failure(409, "IDEMPOTENCY_IN_PROGRESS");
      if (receipt.response_status !== null)
        return { status: receipt.response_status, body: receipt.response_body };
    }
    const source = input.source_url ?? legacyRecipeSource(input.description);
    const sourceKey = source ? recipeSourceKey(source) : null;
    if (source && !input.source_copy) {
      const duplicate = await findRecipeSource(tx, actor.familyId, source);
      if (duplicate) {
        const code =
          duplicate === "incomplete"
            ? "RECIPE_SOURCE_CHECK_UNAVAILABLE"
            : "RECIPE_SOURCE_EXISTS";
        // Durable review requests need a terminal noncommit receipt, not a
        // fleeting 409 followed by an absent key. A delayed copy of the old
        // request must never create after the editor resumes with a new key.
        // Keep only a fixed code; the source title/id is not a cached response.
        if (retainSourceRefusal && recordId)
          await tx.idempotencyRecord.update({
            where: { id: recordId },
            data: { response_status: 409, response_body: { error: { code } } },
          });
        return {
          status: 409,
          body: {
            error: { code },
            ...(duplicate === "incomplete"
              ? {}
              : { existingRecipe: duplicate }),
          },
        };
      }
    }
    // Require the existing DB insertion-identity trigger before any new effect.
    // A missing migration is a hold, never permission to fabricate a birth.
    if (!(await foodSourceStorageAvailable(tx))) return failure(503, "RECIPE_IDENTITY_UNAVAILABLE");
    const lines = await resolveIngredientLines(
      tx,
      actor.familyId,
      input.ingredients ?? [],
    );
    const recipe = await tx.recipe.create({
      data: {
        family_id: actor.familyId,
        created_by: actor.userId,
        title: input.title,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        prep_time: input.prep_time ?? null,
        cook_time: input.cook_time ?? null,
        servings: input.servings ?? 2,
        source_url: source,
        source_key: sourceKey,
      },
      select: { id: true },
    });
    const births = await tx.$queryRaw<Array<{ recipeId: string; recipeGeneration: string }>>`
      SELECT "id" AS "recipeId", "food_generation" AS "recipeGeneration" FROM "Recipe"
      WHERE "id" = ${recipe.id} AND "family_id" = ${actor.familyId} AND "created_by" = ${actor.userId} FOR SHARE`;
    const identity = births.length === 1 ? readRecipeCreateReceiptIdentity(births[0]) : null;
    if (!identity || identity.recipeId !== recipe.id) throw new Error("Recipe insertion identity unavailable");
    if (lines.length)
      await tx.recipeIngredient.createMany({
        data: lines.map((line) => ({ ...line, recipe_id: recipe.id })),
      });
    // A pointer, not a stale recipe snapshot. Hydrate under current authority
    // after commit; a long instruction/ingredient body cannot truncate this receipt.
    await recordTimelineFactInTx(tx, actor, "recipe_created", {
      kind: "recipe",
      id: recipe.id,
    });
    const body = identity;
    if (recordId)
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: { response_status: 201, response_body: body },
      });
    return { status: 201, body };
  });
}
export async function readCreatedRecipe(
  db: Db,
  actor: Actor,
  recipeId: string,
  recipeGeneration?: string,
): Promise<EffectResult> {
  return db.$transaction(async (tx) => {
    const refused = await recipeWriteAuthority(tx, actor);
    if (refused) return refused;
    // Sequential flat reads preserve the existing pg-adapter transaction
    // contract; nested Prisma relation reads can start parallel tx queries.
    // Existing PATCH takes the recipe row before replacing ingredients.
    // Hold it through projection so those separate reads represent one version.
    if (recipeGeneration !== undefined) {
      if (!readRecipeCreateReceiptIdentity({ recipeId, recipeGeneration })) return failure(409, "RECIPE_CONFIRMATION_UNAVAILABLE");
      if (!(await foodSourceStorageAvailable(tx))) return failure(503, "RECIPE_IDENTITY_UNAVAILABLE");
      const matches = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Recipe"
        WHERE "id" = ${recipeId} AND "family_id" = ${actor.familyId} AND "created_by" = ${actor.userId}
        AND "food_generation" = ${recipeGeneration} FOR SHARE`;
      if (matches.length !== 1 || matches[0].id !== recipeId) return failure(409, "RECIPE_NO_LONGER_AVAILABLE");
    } else await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${recipeId} AND "family_id" = ${actor.familyId} FOR SHARE`;
    const recipe = await tx.recipe.findFirst({
      where: { id: recipeId, family_id: actor.familyId },
      select: { ...RECIPE_SUMMARY_SELECT, instructions: true },
    });
    if (!recipe) return failure(409, "RECIPE_NO_LONGER_AVAILABLE");
    const lines = await tx.recipeIngredient.findMany({
      where: { recipe_id: recipeId },
      orderBy: RECIPE_DETAIL_SELECT.ingredients.orderBy,
      select: {
        id: true,
        amount: true,
        unit: true,
        note: true,
        ingredient_id: true,
      },
    });
    const ingredients = await tx.ingredient.findMany({
      where: {
        id: { in: lines.map((line) => line.ingredient_id) },
        family_id: actor.familyId,
      },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient]),
    );
    if (lines.some((line) => !byId.has(line.ingredient_id)))
      return failure(409, "RECIPE_NO_LONGER_AVAILABLE");
    return {
      status: 200,
      body: {
        recipe: {
          ...recipe,
          ingredients: lines.map(({ ingredient_id, ...line }) => ({
            ...line,
            ingredient: byId.get(ingredient_id)!,
          })),
        },
      },
    };
  });
}

export function recipeSourceKey(source: string) {
  return createHash("sha256").update(source).digest("hex");
}
/** Preserve old imported descriptions, but do not pretend an unbounded legacy scan is complete. */
async function findRecipeSource(
  tx: Prisma.TransactionClient,
  familyId: string,
  raw: string,
): Promise<{ id: string; title: string } | "incomplete" | null> {
  const source = canonicalRecipeSource(raw);
  if (!source) return null;
  const known = await tx.recipe.findFirst({
    where: { family_id: familyId, source_key: recipeSourceKey(source) },
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    select: { id: true, title: true },
  });
  if (known) return known;
  const legacy = await tx.recipe.findMany({
    where: {
      family_id: familyId,
      source_key: null,
      description: { startsWith: "Source: https://" },
    },
    orderBy: { id: "asc" },
    take: 2001,
    select: { id: true, title: true, description: true },
  });
  const match = legacy.find(
    (recipe) => legacyRecipeSource(recipe.description) === source,
  );
  if (match) return { id: match.id, title: match.title };
  return legacy.length > 2000 ? "incomplete" : null;
}
