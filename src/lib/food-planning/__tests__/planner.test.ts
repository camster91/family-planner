/** Authored/unrun. Pure planning checks, not provider/DB/food-safety evidence. */
import {
  foodPlanRequest,
  type FoodPlanningInputs,
  type FoodRecipe,
  type FoodStock,
} from "../contract";
import { buildFoodPlan } from "../planner";
const rice = { id: "ingredient-rice", name: "Rice", unit: "g" };
const recipe = (id: string): FoodRecipe => ({
  id,
  title: id,
  servings: 2,
  prep_time: 10,
  cook_time: 20,
  ingredients: [{ ingredient: rice, amount: 100, unit: "g" }],
});
const item: FoodStock = {
  id: "rice-stock",
  ingredient_id: rice.id,
  name: "Rice",
  amount: 150,
  unit: "g",
  expires_on: "2026-10-24",
  date_kind: "use_by",
  status: "active",
};
const inputs = (stock: FoodStock[] = [item]): FoodPlanningInputs => ({
  recipes: [recipe("recipe-a"), recipe("recipe-b")],
  stock,
  occupied: [],
  coverage: { recipes: true, stock: true, meals: true },
});
const request = () =>
  foodPlanRequest.parse({
    timeZone: "UTC",
    slots: [
      {
        key: "one",
        date: "2026-10-22",
        mealType: "dinner",
        servings: 2,
        recipeId: "recipe-a",
      },
      {
        key: "two",
        date: "2026-10-23",
        mealType: "dinner",
        servings: 2,
        recipeId: "recipe-b",
      },
    ],
  });
it("reserves known same-unit quantities across selected slots, without spending alternatives or mutating canonical inputs", () => {
  const source = inputs(),
    before = JSON.stringify(source);
  const result = buildFoodPlan(request(), source);
  expect(result.slots[0].choice!.ingredients[0]).toMatchObject({
    state: "covered",
    required: 100,
    recordedAvailable: 150,
    shortfall: 0,
  });
  expect(result.slots[1].choice!.ingredients[0]).toMatchObject({
    state: "shortfall",
    required: 100,
    recordedAvailable: 50,
    shortfall: 50,
  });
  expect(result).toMatchObject({
    stockReserved: false,
    writesPerformed: false,
    calendarChecked: false,
    existingMealReservationsChecked: false,
  });
  expect(JSON.stringify(source)).toBe(before);
});
it("keeps canonical unlinked-name provenance, while a differently linked same-name stock item cannot cover the ingredient", () => {
  const named = buildFoodPlan(
    request(),
    inputs([{ ...item, ingredient_id: null, name: "  RICE  " }]),
  );
  expect(named.slots[0].choice!.ingredients[0]).toMatchObject({
    match: "name",
    state: "covered",
  });
  const differentlyLinked = buildFoodPlan(
    request(),
    inputs([{ ...item, ingredient_id: "different-ingredient" }]),
  );
  expect(differentlyLinked.slots[0].choice!.ingredients[0]).toMatchObject({
    match: null,
    state: "shortfall",
    shortfall: 100,
  });
});
it("never converts units, treats T/t distinctly, and keeps unknown amounts/zero-authored quantities explicit", () => {
  const source = inputs([{ ...item, unit: "t" }]);
  source.recipes[0].ingredients[0].unit = "T";
  expect(
    buildFoodPlan(request(), source).slots[0].choice!.ingredients[0],
  ).toMatchObject({
    state: "check",
    shortfall: null,
    reasons: expect.arrayContaining(["different-unit"]),
  });
  expect(
    buildFoodPlan(request(), inputs([{ ...item, amount: null }])).slots[0]
      .choice!.ingredients[0],
  ).toMatchObject({ state: "check", shortfall: null });
  source.recipes[0].ingredients[0].amount = 0;
  expect(
    buildFoodPlan(request(), source).slots[0].choice!.ingredients[0].required,
  ).toBeNull();
});
it("uses the planned day for canonical expiry checks and does not count already allocated use-soon stock twice", () => {
  const source = inputs([{ ...item, amount: 100, expires_on: "2026-10-22" }]);
  const result = buildFoodPlan(request(), source);
  expect(result.slots[0].choice!.useSoonCount).toBe(1);
  expect(result.slots[1].choice!.ingredients[0].state).toBe("shortfall");
  expect(result.slots[1].choice!.useSoonCount).toBe(0);
  const pastQuality = buildFoodPlan(
    request(),
    inputs([{ ...item, date_kind: "best_before", expires_on: "2026-10-21" }]),
  );
  expect(pastQuality.slots[0].choice!.coveredCount).toBe(0);
});
it("keeps occupied slots, missing recipe identity, incomplete input and unknown time as holds", () => {
  const source = inputs();
  source.occupied.push({ date: "2026-10-22", mealType: "dinner" });
  expect(buildFoodPlan(request(), source).slots[0].holds).toEqual([
    "slot-occupied",
  ]);
  const draft = request();
  draft.slots[0].recipeId = "unissued-recipe";
  expect(buildFoodPlan(draft, inputs()).slots[0].holds).toEqual([
    "recipe-unavailable",
  ]);
  const timed = request();
  timed.slots[0].maxMinutes = 20;
  source.occupied = [];
  source.recipes[0].cook_time = null;
  source.coverage.stock = false;
  expect(buildFoodPlan(timed, source).slots[0].holds).toEqual(
    expect.arrayContaining(["source-incomplete", "time-unknown"]),
  );
});
it("estimates a several-dish prep session sequentially, preserving authored dish order and holding an exceeded session budget", () => {
  const prep = foodPlanRequest.parse({
    timeZone: "UTC",
    mode: "prep",
    prepMaxMinutes: 45,
    slots: [
      {
        key: "z-first",
        date: "2026-10-22",
        mealType: "dinner",
        servings: 2,
        recipeId: "recipe-b",
      },
      {
        key: "a-second",
        date: "2026-10-22",
        mealType: "dinner",
        servings: 2,
        recipeId: "recipe-a",
      },
    ],
  });
  const result = buildFoodPlan(prep, inputs());
  expect(result.slots.map((slot) => slot.key)).toEqual(["z-first", "a-second"]);
  expect(result.prepMinutes).toBe(60);
  expect(result.prepTime).toBe("over-requested-limit");
  expect(result.slots[1].choice!.ingredients[0].shortfall).toBe(50);
});

it("scales ingredients without inventing scaled-batch cooking time", () => {
  const draft = request();
  draft.slots = [{ ...draft.slots[0], servings: 4, maxMinutes: 60 }];
  const result = buildFoodPlan(draft, inputs());
  expect(result.slots[0].choice).toMatchObject({
    servings: 4,
    baseServings: 2,
    authoredMinutes: 30,
    totalMinutes: null,
    time: "unknown",
  });
  expect(result.slots[0].choice!.ingredients[0].required).toBe(200);
  expect(result.slots[0].holds).toContain("time-unknown");
});

it("reserves recorded ordinary meals and whole pending prep dishes before allocating new proposals", () => {
  const source = inputs([{ ...item, amount: 500 }]);
  source.commitments = {
    horizon: { from: "2026-10-22", through: "2026-10-23" },
    recipes: [],
    prepared: [],
    entries: [
      {
        id: "meal:existing",
        kind: "meal",
        date: "2026-10-22",
        originalDate: "2026-10-22",
        recipeId: "recipe-a",
        servings: null,
      },
      {
        id: "batch:pending",
        kind: "prep-dish",
        date: "2026-10-22",
        originalDate: "2026-10-22",
        recipeId: "recipe-b",
        servings: 6,
      },
    ],
  };
  const result = buildFoodPlan(request(), source);
  expect(result.existingMealReservationsChecked).toBe(true);
  expect(result.commitments.complete).toBe(true);
  expect(
    result.commitments.entries.find((row) => row.kind === "meal"),
  ).toMatchObject({ servings: 2, servingsBasis: "recipe-default" });
  expect(result.slots[0].choice!.ingredients[0]).toMatchObject({
    recordedAvailable: 100,
    state: "covered",
  });
  expect(result.slots[1].choice!.ingredients[0]).toMatchObject({
    recordedAvailable: 0,
    shortfall: 100,
  });
  expect(source.stock[0].amount).toBe(500);
});
it("does not turn an opaque or quantity-unknown existing commitment into free stock", () => {
  const source = inputs([{ ...item, amount: 1000 }]);
  source.commitments = {
    horizon: { from: "2026-10-22", through: "2026-10-23" },
    recipes: [],
    prepared: [],
    entries: [
      {
        id: "meal:opaque",
        kind: "meal",
        date: "2026-10-22",
        originalDate: "2026-10-22",
        recipeId: null,
        servings: null,
      },
    ],
  };
  const result = buildFoodPlan(request(), source);
  expect(result.commitments.complete).toBe(false);
  expect(result.inventoryBasis).toBe(
    "recorded-stock-with-unresolved-commitments",
  );
  expect(result.slots[0].holds).toContain("commitments-unresolved");
  expect(result.slots[0].choice!.ingredients[0]).toMatchObject({
    state: "check",
    shortfall: null,
    reasons: expect.arrayContaining(["existing-commitment-unknown"]),
  });
});
it("keeps explicitly prepared portion counts separate from raw ingredient reservations", () => {
  const source = inputs([{ ...item, amount: 150 }]);
  source.commitments = {
    horizon: { from: "2026-10-22", through: "2026-10-23" },
    recipes: [],
    entries: [],
    prepared: [
      {
        batchId: "prepared-batch",
        sessionId: "prepared-session",
        name: "Already prepared",
        recipeId: "recipe-b",
        preparedOn: "2026-10-21",
        preparedAt: "2026-10-21T12:00:00Z",
        nextPrepOn: "2026-10-28",
        storage: "freezer",
        total: 8,
        eaten: 2,
        planned: 3,
        remaining: 6,
        unplanned: 3,
        recipeHistoryRecorded: true,
      },
    ],
  };
  const result = buildFoodPlan(request(), source);
  expect(result.slots[0].choice!.ingredients[0].recordedAvailable).toBe(150);
  expect(result.commitments.prepared).toEqual(source.commitments.prepared);
  expect(result.commitments.entries).toEqual([]);
});
