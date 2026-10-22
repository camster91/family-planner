import {
  readFoodCommitments,
  FoodCommitmentSourceUnavailable,
} from "./commitment-source";
/** Scoped read-only foundation for grounded food plans. No provider or apply path. */
import { createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getJwtSecret } from "../auth";
import { lockUser, lockHousehold } from "../household-lock";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import { canonicalRequestJson } from "../idempotency-request-json";
import { memberIdentityIdSchema as id } from "../member-subject-contract";
import { parseDateOnly, toDateOnlyUTC } from "../dates";
import { addDaysToKey, dayKeyFor } from "../local-day-key";
import { foodPlanRequest, type FoodRecipe, type FoodStock } from "./contract";
import { buildFoodPlan } from "./planner";
export const foodPlanningEnabled = () =>
  process.env.FAMILY_FOOD_PLANNING_READY === "1";
export const foodPreviewRequest = z
  .object({
    plan: foodPlanRequest,
    recipeIds: z
      .array(id)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .strict();
export class FoodPlanningUnavailable extends Error {
  constructor(
    readonly code:
      | "UNAVAILABLE"
      | "FORBIDDEN"
      | "CONTEXT_CHANGED"
      | "INVALID_DATES"
      | "RECIPES_FILTER_REQUIRED"
      | "SOURCE_LIMIT" = "UNAVAILABLE",
  ) {
    super(code);
  }
}
function assertObservationCurrent(observed: Date) {
  const clock = Date.now();
  if (
    !foodPlanningEnabled() ||
    clock >= +observed + 60000 ||
    clock < +observed - 1000
  )
    throw new FoodPlanningUnavailable();
}
const text = z.string().trim().min(1).max(500);
const amount = z.number().finite().min(0).max(100000);
const unit = z.string().max(100).nullable();
const ingredient = z.object({ id, name: text, unit });
const recipe = z.object({
  id,
  title: text,
  servings: z.number().int().min(1).max(100),
  prep_time: z.number().int().min(0).max(10080).nullable(),
  cook_time: z.number().int().min(0).max(10080).nullable(),
  ingredients: z.array(z.object({ amount, unit, ingredient })).max(100),
});
const stock = z.object({
  id,
  ingredient_id: id.nullable(),
  name: text,
  amount: amount.nullable(),
  unit,
  expires_on: z
    .string()
    .refine((value) => parseDateOnly(value) !== null)
    .nullable(),
  date_kind: z.enum(["best_before", "use_by"]),
  status: z.literal("active"),
});
const foodRecipeSelect = {
  id: true,
  title: true,
  servings: true,
  prep_time: true,
  cook_time: true,
  revision: true,
  created_at: true,
  updated_at: true,
  ingredients: {
    take: 101,
    orderBy: { id: "asc" },
    select: {
      id: true,
      amount: true,
      unit: true,
      ingredient: {
        select: { id: true, name: true, unit: true, family_id: true },
      },
    },
  },
} satisfies Prisma.RecipeSelect;
export type FoodPlanActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};
export async function previewFoodPlan(
  db: Pick<PrismaClient, "$transaction">,
  actor: FoodPlanActor,
  raw: z.infer<typeof foodPreviewRequest>,
  now = new Date(),
) {
  const input = foodPreviewRequest.parse(raw);
  if (!foodPlanningEnabled()) throw new FoodPlanningUnavailable();
  if (!["parent", "teen"].includes(actor.role))
    throw new FoodPlanningUnavailable("FORBIDDEN");
  const today = dayKeyFor({ kind: "tz", timeZone: input.plan.timeZone })(now);
  if (
    !Number.isFinite(+now) ||
    input.plan.slots.some(
      (slot) => slot.date < today || slot.date > addDaysToKey(today, 31),
    )
  )
    throw new FoodPlanningUnavailable("INVALID_DATES");
  const dates = input.plan.slots.map((slot) => slot.date).sort();
  return db.$transaction(
    async (tx) => {
      await lockUser(tx, actor.userId);
      await lockHousehold(tx, actor.familyId);
      // Row-share locks detect a lifecycle update after a repeatable-read snapshot
      // began (serialization refusal), rather than accepting stale authority.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.userId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
      const current = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !current ||
        current.family_id !== actor.familyId ||
        current.role !== actor.role ||
        current.token_version !== actor.generation
      )
        throw new FoodPlanningUnavailable("CONTEXT_CHANGED");
      const family = await tx.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      if (!family) throw new FoodPlanningUnavailable("CONTEXT_CHANGED");
      const features = normalizeFeatures(family.features);
      if (
        !isFeatureEnabled(features, "meals") ||
        !isFeatureEnabled(features, "inventory")
      )
        throw new FoodPlanningUnavailable("FORBIDDEN");
      const recipes = await tx.recipe.findMany({
        where: {
          family_id: actor.familyId,
          ...(input.recipeIds ? { id: { in: input.recipeIds } } : {}),
        },
        select: foodRecipeSelect,
        orderBy: { id: "asc" },
        take: 101,
      });
      if (recipes.length > 100)
        throw new FoodPlanningUnavailable("RECIPES_FILTER_REQUIRED");
      if (recipes.reduce((sum, row) => sum + row.ingredients.length, 0) > 5000)
        throw new FoodPlanningUnavailable("SOURCE_LIMIT");
      if (input.recipeIds && recipes.length !== input.recipeIds.length)
        throw new FoodPlanningUnavailable();
      if (
        recipes.some(
          (row) =>
            row.ingredients.length > 100 ||
            row.ingredients.some(
              (line) => line.ingredient.family_id !== actor.familyId,
            ),
        )
      )
        throw new FoodPlanningUnavailable();
      const inventory = await tx.inventoryItem.findMany({
        where: {
          family_id: actor.familyId,
          status: "active",
          OR: [
            { expires_on: null },
            { expires_on: { gte: parseDateOnly(today)! } },
          ],
        },
        select: {
          id: true,
          ingredient_id: true,
          name: true,
          amount: true,
          unit: true,
          expires_on: true,
          date_kind: true,
          status: true,
          created_at: true,
          updated_at: true,
          ingredient: { select: { id: true, family_id: true } },
        },
        orderBy: { id: "asc" },
        take: 501,
      });
      if (inventory.length > 500)
        throw new FoodPlanningUnavailable("SOURCE_LIMIT");
      if (
        inventory.some(
          (row) =>
            row.ingredient_id !== null &&
            (!row.ingredient || row.ingredient.family_id !== actor.familyId),
        )
      )
        throw new FoodPlanningUnavailable();
      const meals = await tx.familyMeal.findMany({
        where: {
          family_id: actor.familyId,
          date: {
            gte: parseDateOnly(today)!,
            lt: parseDateOnly(addDaysToKey(dates[dates.length - 1], 1))!,
          },
        },
        select: {
          id: true,
          date: true,
          meal_type: true,
          recipe_name: true,
          recipe_id: true,
          batch_id: true,
          servings: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { id: "asc" },
        take: 501,
      });
      if (meals.length > 500) throw new FoodPlanningUnavailable("SOURCE_LIMIT");
      let normalizedRecipes: FoodRecipe[], normalizedStock: FoodStock[];
      try {
        normalizedRecipes = recipes.map((row) => recipe.parse(row));
        normalizedStock = inventory.map((row) =>
          stock.parse({
            ...row,
            expires_on: row.expires_on ? toDateOnlyUTC(row.expires_on) : null,
          }),
        );
      } catch {
        throw new FoodPlanningUnavailable();
      }
      const horizon = { from: today, through: dates[dates.length - 1] };
      let commitments: Awaited<ReturnType<typeof readFoodCommitments>>;
      try {
        commitments = await readFoodCommitments(
          tx,
          actor.familyId,
          horizon,
          meals,
        );
      } catch (error) {
        throw new FoodPlanningUnavailable(
          error instanceof FoodCommitmentSourceUnavailable
            ? error.code
            : "UNAVAILABLE",
        );
      }
      const existingRecipeIds = new Set(recipes.map((row) => row.id));
      const dependencyIds = commitments.pendingRecipeIds.filter(
        (id) => !existingRecipeIds.has(id),
      );
      if (dependencyIds.length > 200)
        throw new FoodPlanningUnavailable("SOURCE_LIMIT");
      const dependencyRecipes = dependencyIds.length
        ? await tx.recipe.findMany({
            where: { family_id: actor.familyId, id: { in: dependencyIds } },
            select: foodRecipeSelect,
            orderBy: { id: "asc" },
            take: 201,
          })
        : [];
      if (
        dependencyRecipes.length !== dependencyIds.length ||
        dependencyRecipes.some(
          (row) =>
            row.ingredients.length > 100 ||
            row.ingredients.some(
              (line) => line.ingredient.family_id !== actor.familyId,
            ),
        )
      )
        throw new FoodPlanningUnavailable();
      if (
        [...recipes, ...dependencyRecipes].reduce(
          (sum, row) => sum + row.ingredients.length,
          0,
        ) > 5000
      )
        throw new FoodPlanningUnavailable("SOURCE_LIMIT");
      let commitmentRecipes: FoodRecipe[];
      try {
        commitmentRecipes = dependencyRecipes.map((row) => recipe.parse(row));
      } catch {
        throw new FoodPlanningUnavailable();
      }
      const verifiedRecipeIds = new Set(
        [...recipes, ...dependencyRecipes].map((row) => row.id),
      );
      const preparedIds = commitments.preparedRecipeIds.filter(
        (id) => !verifiedRecipeIds.has(id),
      );
      const preparedRecipeOwnership = preparedIds.length
        ? await tx.recipe.findMany({
            where: { family_id: actor.familyId, id: { in: preparedIds } },
            select: { id: true },
            orderBy: { id: "asc" },
            take: 201,
          })
        : [];
      if (preparedRecipeOwnership.length !== preparedIds.length)
        throw new FoodPlanningUnavailable();
      const plan = buildFoodPlan(input.plan, {
        recipes: normalizedRecipes,
        stock: normalizedStock,
        occupied: meals.map((row) => ({
          date: toDateOnlyUTC(row.date),
          mealType: row.meal_type,
        })),
        coverage: { recipes: true, stock: true, meals: true },
        commitments: {
          horizon,
          entries: commitments.entries,
          recipes: commitmentRecipes,
          prepared: commitments.prepared,
        },
      });
      assertObservationCurrent(now);
      // Read identity only. This is neither the assistant action proof nor an
      // approval token; future apply must rebuild canonical evidence in its tx.
      const snapshotRevision = createHmac("sha256", getJwtSecret())
        .update(
          canonicalRequestJson([
            "food-plan.snapshot.v1",
            actor,
            input,
            features,
            JSON.parse(
              JSON.stringify({
                recipes,
                inventory,
                meals,
                dependencyRecipes,
                preparedRecipeOwnership,
                commitments: commitments.sources,
              }),
            ),
          ]),
        )
        .digest("hex");
      assertObservationCurrent(now);
      return {
        owner: { ...actor },
        generatedAt: now.toISOString(),
        expiresAt: new Date(+now + 60000).toISOString(),
        recipeScope: input.recipeIds
          ? ("selected" as const)
          : ("library" as const),
        snapshotRevision,
        plan,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
