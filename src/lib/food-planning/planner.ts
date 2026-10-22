/** Canonical ingredient matching + exact same-unit virtual reservations.
 * Produces reviewed proposals only; never consumes food or schedules a meal. */
import { indexCookInventory, matchRecipeIngredients } from "../inventory";
import { normalizeName } from "../backfill/meals-groceries";
import { scaleRecipeAmount } from "../recipe-scaling";
import { parseDateOnly } from "../dates";
import {
  FOOD_PLANNING_PROTOCOL,
  type FoodPlanRequest,
  type FoodPlanningInputs,
  type FoodRecipe,
  type FoodStock,
  type FoodCandidate,
  type IngredientCheck,
  type FoodPlan,
  type FoodCommitmentReview,
} from "./contract";

// Case is significant: authored T/t can mean different cooking units. No
// plural aliases, package inference, density or mass/volume conversions.
const unitKey = (unit: string | null) =>
  unit?.normalize("NFC").trim().replace(/\s+/g, " ") || null;
type Ledger = Map<string, number>;
const order = (a: FoodStock, b: FoodStock) =>
  (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999") ||
  a.id.localeCompare(b.id);
function candidate(
  recipe: FoodRecipe,
  slot: FoodPlanRequest["slots"][number],
  stock: FoodStock[],
  before: Ledger,
): { value: FoodCandidate; after: Ledger } {
  const after = new Map(before);
  const day = parseDateOnly(slot.date)!;
  // Preserve the existing expiry/status/zero-stock and linked/unlinked-name
  // semantics. Presence never proves enough quantity for the recipe.
  const eligible = stock
    .filter((item) => {
      const index = indexCookInventory([item], day);
      return index.haveIds.size + index.haveNames.size > 0;
    })
    .sort(order);
  const byId = new Map<string, FoodStock[]>(),
    byName = new Map<string, FoodStock[]>();
  for (const item of eligible) {
    const map = item.ingredient_id ? byId : byName;
    const key = item.ingredient_id ?? normalizeName(item.name);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  const ingredients: IngredientCheck[] = recipe.ingredients.map((line) => {
    const matching = [
      ...(byId.get(line.ingredient.id) ?? []),
      ...(byName.get(normalizeName(line.ingredient.name)) ?? []),
    ].sort(order);
    const canonical = matchRecipeIngredients(
      [line],
      indexCookInventory(matching, day),
    );
    const unit = line.unit ?? line.ingredient.unit;
    const required =
      line.amount > 0
        ? scaleRecipeAmount(line.amount, recipe.servings, slot.servings)
        : null;
    const reasons: IngredientCheck["reasons"] = [];
    if (required === null) reasons.push("unknown-amount");
    if (!unitKey(unit)) reasons.push("unknown-unit");
    if (canonical.have[0]?.match === "name") reasons.push("name-match");
    let available = 0,
      remainingNeed = required ?? 0,
      uncertain = false,
      useSoon = false;
    for (const item of matching) {
      if (item.amount === null) {
        uncertain = true;
        if (!reasons.includes("unknown-amount")) reasons.push("unknown-amount");
        continue;
      }
      if (!unitKey(item.unit) || !unitKey(unit)) {
        uncertain = true;
        if (!reasons.includes("unknown-unit")) reasons.push("unknown-unit");
        continue;
      }
      if (unitKey(item.unit) !== unitKey(unit)) {
        uncertain = true;
        if (!reasons.includes("different-unit")) reasons.push("different-unit");
        continue;
      }
      const left = after.get(item.id) ?? 0;
      available += left;
      if (left === 0 && !reasons.includes("planned-elsewhere"))
        reasons.push("planned-elsewhere");
      const used = Math.min(left, remainingNeed);
      if (
        used > 0 &&
        matchRecipeIngredients([line], indexCookInventory([item], day))
          .useSoonCount > 0
      )
        useSoon = true;
      if (required !== null) after.set(item.id, left - used);
      remainingNeed -= used;
    }
    if (!matching.length) reasons.push("not-recorded");
    const state =
      required === null || !unitKey(unit)
        ? "check"
        : remainingNeed <= 0
          ? "covered"
          : uncertain
            ? "check"
            : "shortfall";
    return {
      ingredientId: line.ingredient.id,
      name: line.ingredient.name,
      unit,
      required,
      recordedAvailable: available,
      shortfall: state === "check" ? null : Math.max(0, remainingNeed),
      state,
      match: canonical.have[0]?.match ?? null,
      useSoon,
      reasons,
    };
  });
  const total =
    recipe.prep_time !== null && recipe.cook_time !== null
      ? recipe.prep_time + recipe.cook_time
      : null;
  const authoredMinutes =
    total !== null && Number.isFinite(total) && total >= 0 ? total : null;
  // Ingredient arithmetic does not establish cooking time for a different
  // batch size. Retain the authored estimate, but never extrapolate a deadline.
  const totalMinutes =
    slot.servings === recipe.servings ? authoredMinutes : null;
  return {
    after,
    value: {
      recipeId: recipe.id,
      title: recipe.title,
      servings: slot.servings,
      baseServings: recipe.servings,
      authoredMinutes,
      totalMinutes,
      time:
        slot.maxMinutes === undefined
          ? "not-requested"
          : totalMinutes === null
            ? "unknown"
            : totalMinutes <= slot.maxMinutes
              ? "within-requested-limit"
              : "over-requested-limit",
      ingredients,
      useSoonCount: ingredients.filter((line) => line.useSoon).length,
      coveredCount: ingredients.filter((line) => line.state === "covered")
        .length,
      shortfallCount: ingredients.filter((line) => line.state === "shortfall")
        .length,
      checkCount: ingredients.filter((line) => line.state === "check").length,
    },
  };
}
export function buildFoodPlan(
  request: FoodPlanRequest,
  inputs: FoodPlanningInputs,
): FoodPlan {
  let ledger: Ledger = new Map(
    inputs.stock.map((item) => [
      item.id,
      item.amount !== null && Number.isFinite(item.amount) && item.amount > 0
        ? item.amount
        : 0,
    ]),
  );
  const commitmentReviews: FoodCommitmentReview[] = [];
  let commitmentsUnresolved = false;
  if (inputs.commitments) {
    const recipes = new Map(
      [...inputs.recipes, ...inputs.commitments.recipes].map((recipe) => [
        recipe.id,
        recipe,
      ]),
    );
    for (const entry of [...inputs.commitments.entries].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    )) {
      const recipe = entry.recipeId ? recipes.get(entry.recipeId) : undefined;
      const servings = entry.servings ?? recipe?.servings ?? null;
      const review: FoodCommitmentReview = {
        id: entry.id,
        kind: entry.kind,
        date: entry.date,
        originalDate: entry.originalDate,
        label: entry.label ?? recipe?.title ?? null,
        recipeId: entry.recipeId,
        servings,
        servingsBasis:
          entry.servings !== null
            ? "recorded"
            : recipe
              ? "recipe-default"
              : "unknown",
        ingredients: [],
        holds: [],
      };
      if (entry.stateUncertain) review.holds.push("prep-state-unknown");
      if (entry.kind === "prep-dish" && entry.originalDate < entry.date)
        review.holds.push("overdue-prep");
      if (!recipe) review.holds.push("recipe-unknown");
      else if (!recipe.ingredients.length)
        review.holds.push("ingredients-unknown");
      else if (
        servings === null ||
        !Number.isInteger(servings) ||
        servings < 1 ||
        servings > 100
      )
        review.holds.push("quantity-unknown");
      else {
        const evaluated = candidate(
          recipe,
          { key: "existing", date: entry.date, mealType: "dinner", servings },
          inputs.stock,
          ledger,
        );
        review.ingredients = evaluated.value.ingredients;
        ledger = evaluated.after;
        if (evaluated.value.checkCount > 0)
          review.holds.push("quantity-unknown");
      }
      if (review.holds.some((reason) => reason !== "overdue-prep"))
        commitmentsUnresolved = true;
      commitmentReviews.push(review);
    }
  }
  const used = new Set<string>();
  const slots: FoodPlan["slots"] = [];
  // Ordinary slots are chronological. A prep session retains its authored dish
  // order so its virtual allocations follow the reviewed sequence.
  const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  const orderedSlots =
    request.mode === "prep"
      ? [...request.slots]
      : [...request.slots].sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            mealOrder[a.mealType] - mealOrder[b.mealType] ||
            a.key.localeCompare(b.key),
        );
  for (const slot of orderedSlots) {
    if (
      request.mode === "meals" &&
      inputs.occupied.some(
        (row) => row.date === slot.date && row.mealType === slot.mealType,
      )
    ) {
      slots.push({
        key: slot.key,
        choice: null,
        alternatives: [],
        holds: ["slot-occupied"],
      });
      continue;
    }
    const ranked = inputs.recipes
      .filter(
        (recipe) =>
          request.repeatRecipes ||
          !used.has(recipe.id) ||
          slot.recipeId === recipe.id,
      )
      .map((recipe) => {
        const evaluated = candidate(recipe, slot, inputs.stock, ledger);
        if (commitmentsUnresolved) {
          for (const ingredient of evaluated.value.ingredients) {
            ingredient.state = "check";
            ingredient.shortfall = null;
            ingredient.reasons.push("existing-commitment-unknown");
          }
          evaluated.value.coveredCount = 0;
          evaluated.value.shortfallCount = 0;
          evaluated.value.checkCount = evaluated.value.ingredients.length;
        }
        return evaluated;
      })
      .sort((a, b) => {
        const x = a.value,
          y = b.value;
        const time = (value: FoodCandidate) =>
          value.time === "over-requested-limit"
            ? 2
            : value.time === "unknown"
              ? 1
              : 0;
        const primary =
          request.priority === "quick"
            ? (x.totalMinutes ?? Infinity) - (y.totalMinutes ?? Infinity)
            : request.priority === "least-shopping"
              ? x.shortfallCount - y.shortfallCount
              : y.useSoonCount - x.useSoonCount;
        return (
          (x.ingredients.length ? 0 : 1) - (y.ingredients.length ? 0 : 1) ||
          time(x) - time(y) ||
          (Number.isNaN(primary) ? 0 : primary) ||
          x.checkCount - y.checkCount ||
          x.shortfallCount - y.shortfallCount ||
          y.coveredCount - x.coveredCount ||
          x.recipeId.localeCompare(y.recipeId)
        );
      });
    const selected = slot.recipeId
      ? ranked.find((item) => item.value.recipeId === slot.recipeId)
      : ranked[0];
    if (!selected) {
      slots.push({
        key: slot.key,
        choice: null,
        alternatives: ranked.slice(0, 3).map((item) => item.value),
        holds: [slot.recipeId ? "recipe-unavailable" : "no-recipe"],
      });
      continue;
    }
    const choice = selected.value;
    const holds: FoodPlan["slots"][number]["holds"] = [];
    if (commitmentsUnresolved) holds.push("commitments-unresolved");
    if (!Object.values(inputs.coverage).every(Boolean))
      holds.push("source-incomplete");
    if (choice.time === "unknown") holds.push("time-unknown");
    if (choice.time === "over-requested-limit") holds.push("time-exceeded");
    if (!choice.ingredients.length) holds.push("ingredients-unknown");
    // Over-limit/unknown-time/ingredient-free choices stay visible for review,
    // but cannot reserve stock for a plan that has not established feasibility.
    if (!holds.length) {
      ledger = selected.after;
      used.add(choice.recipeId);
    }
    slots.push({
      key: slot.key,
      choice,
      alternatives: ranked
        .filter((item) => item !== selected)
        .slice(0, 3)
        .map((item) => item.value),
      holds,
    });
  }
  const selected = slots.map((slot) => slot.choice);
  const prepMinutes =
    request.mode === "prep" &&
    selected.every((value) => value?.totalMinutes !== null && value !== null)
      ? selected.reduce((sum, value) => sum + value!.totalMinutes!, 0)
      : null;
  return {
    protocol: FOOD_PLANNING_PROTOCOL,
    slots,
    coverage: inputs.coverage,
    prepMinutes,
    prepTime:
      request.mode !== "prep" || request.prepMaxMinutes === undefined
        ? "not-requested"
        : prepMinutes === null
          ? "unknown"
          : prepMinutes <= request.prepMaxMinutes
            ? "within-requested-limit"
            : "over-requested-limit",
    existingMealReservationsChecked: inputs.commitments !== undefined,
    inventoryBasis: inputs.commitments
      ? commitmentsUnresolved
        ? "recorded-stock-with-unresolved-commitments"
        : "recorded-stock-after-recorded-commitments"
      : "recorded-stock-for-new-proposals",
    commitments: {
      complete: inputs.commitments !== undefined && !commitmentsUnresolved,
      horizon: inputs.commitments?.horizon ?? null,
      entries: commitmentReviews,
      prepared: inputs.commitments?.prepared ?? [],
    },
    calendarChecked: false,
    stockReserved: false,
    writesPerformed: false,
  };
}
