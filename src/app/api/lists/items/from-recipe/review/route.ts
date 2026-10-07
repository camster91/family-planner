import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { featureGate } from "@/lib/feature-gate-server";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  indexCookInventory,
  loadCookInventory,
  matchRecipeIngredients,
  resolveToday,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Read-only preparation. Default-list creation belongs exclusively to the add transaction. */
export async function GET(request: NextRequest) {
  try {
    const refusal = await refusePairedDevice(request);
    if (refusal) return refusal;
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    if (!["parent", "teen", "child"].includes(auth.user.role))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    for (const key of ["meals", "lists"] as const) {
      const gate = await featureGate(auth.user.family_id, key);
      if (gate) return gate;
    }
    const familyId = auth.user.family_id;
    const recipeId = new URL(request.url).searchParams.get("recipeId");
    if (!recipeId)
      return NextResponse.json(
        { error: "recipeId is required" },
        { status: 400 },
      );
    const recipe = await prisma!.recipe.findFirst({
      where: { id: recipeId, family_id: familyId },
      select: {
        id: true,
        title: true,
        servings: true,
        ingredients: {
          select: {
            amount: true,
            unit: true,
            ingredient: {
              select: { id: true, name: true, unit: true, family_id: true },
            },
          },
        },
      },
    });
    if (!recipe)
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    let targetServings = recipe.servings > 0 ? recipe.servings : 1;
    const mealId = new URL(request.url).searchParams.get("mealId");
    if (mealId) {
      const meal = await prisma!.familyMeal.findFirst({
        where: { id: mealId, family_id: familyId },
        select: { recipe_id: true, servings: true },
      });
      if (!meal)
        return NextResponse.json({ error: "Meal not found" }, { status: 404 });
      if (meal.recipe_id !== recipe.id)
        return NextResponse.json(
          { error: "That meal does not use this recipe" },
          { status: 400 },
        );
      targetServings = meal.servings ?? targetServings;
    }
    const listRows = await prisma!.list.findMany({
      where: { family_id: familyId, type: { in: ["grocery", "shopping"] } },
      select: { id: true, name: true, type: true },
      orderBy: [{ type: "asc" }, { updated_at: "desc" }, { id: "asc" }],
      take: 101,
    });
    const lists = listRows.slice(0, 100);
    const ownedLines = recipe.ingredients.filter(
      (l) => l.ingredient?.family_id === familyId,
    );
    let inventory:
      | { state: "unavailable" }
      | {
          state: "available";
          haveIngredientIds: string[];
          truncated: boolean;
        } = { state: "unavailable" };
    // Optional hints must not turn a disabled/failed comparison into a claim of absence.
    try {
      if (!(await featureGate(familyId, "inventory"))) {
        const today = resolveToday(null)!;
        const loaded = await loadCookInventory(prisma!, familyId, {
          from: today,
        });
        const { have } = matchRecipeIngredients(
          ownedLines,
          indexCookInventory(loaded.items, today),
        );
        inventory = {
          state: "available",
          haveIngredientIds: have.map((i) => i.ingredientId),
          truncated: loaded.truncated,
        };
      }
    } catch {
      // Review and selection remain usable without inventory.
    }
    return NextResponse.json(
      {
        recipeId: recipe.id,
        title: recipe.title,
        baseServings: recipe.servings > 0 ? recipe.servings : 1,
        targetServings,
        ingredients: ownedLines.map((l) => ({
          ingredientId: l.ingredient.id,
          name: l.ingredient.name,
          amount: l.amount,
          unit: l.unit ?? l.ingredient.unit ?? null,
        })),
        lists,
        listsTruncated: listRows.length > 100,
        defaultListId:
          (lists.find((l) => l.type === "grocery") ?? lists[0])?.id ?? null,
        inventory,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    logRouteError(
      "GET /api/lists/items/from-recipe/review",
      error,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: "Could not load grocery review" },
      { status: 500 },
    );
  }
}
