import {
  batchPortionCounts,
  createMealPrepSchema,
  mealPrepActionSchema,
} from "../meal-batches";
const context = {
  expected_family_id: "family-a",
  expected_user_id: "parent-a",
};
const meal = { date: "2026-10-13", meal_type: "dinner", servings: 4 };
const draft = {
  ...context,
  prepared_on: "2026-10-12",
  next_prep_on: "2026-10-19",
  dishes: [
    {
      name: "Soup",
      total_servings: 10,
      reserve_storage: "freezer",
      meals: [meal],
    },
    {
      name: "Rice",
      total_servings: 6,
      reserve_storage: "fridge",
      meals: [{ ...meal, servings: 6 }],
    },
  ],
};
describe("multi-dish prep planning", () => {
  it("accepts several dishes with independent portion budgets and an explicit next prep", () => {
    expect(createMealPrepSchema.parse(draft).dishes).toHaveLength(2);
  });
  it("rejects an overallocated dish even when another dish has spare portions", () => {
    expect(
      createMealPrepSchema.safeParse({
        ...draft,
        dishes: [draft.dishes[0], { ...draft.dishes[1], total_servings: 5 }],
      }).success,
    ).toBe(false);
  });
  it("rejects impossible days, early meals and early next prep", () => {
    for (const change of [
      { prepared_on: "2026-02-30" },
      { prepared_on: "2026-10-14" },
      { next_prep_on: "2026-10-11" },
    ]) {
      expect(
        createMealPrepSchema.safeParse({ ...draft, ...change }).success,
      ).toBe(false);
    }
  });
  it("allows a freezer prep with no scheduled meals but requires a dish and household context", () => {
    expect(
      createMealPrepSchema.safeParse({
        ...draft,
        dishes: [{ ...draft.dishes[0], meals: [] }],
      }).success,
    ).toBe(true);
    expect(
      createMealPrepSchema.safeParse({ ...draft, dishes: [] }).success,
    ).toBe(false);
    expect(
      createMealPrepSchema.safeParse({ ...draft, expected_family_id: "" })
        .success,
    ).toBe(false);
    expect(
      createMealPrepSchema.safeParse({
        ...draft,
        dishes: Array(9).fill(draft.dishes[0]),
      }).success,
    ).toBe(false);
  });
  it("counts eaten planned portions once and preserves other reservations", () => {
    expect(
      batchPortionCounts(
        10,
        [
          { id: "m1", servings: 4 },
          { id: "m2", servings: 3 },
        ],
        [
          { meal_id: "m1", servings: 2 },
          { meal_id: null, servings: 1 },
        ],
      ),
    ).toEqual({ eaten: 3, remaining: 7, planned: 5, unplanned: 2 });
  });
  it("preserves eaten counts after a meal is deleted and restores its remaining reservation on Undo", () => {
    const eaten = [{ meal_id: null, servings: 2 }];
    expect(batchPortionCounts(10, [], eaten)).toEqual({
      eaten: 2,
      remaining: 8,
      planned: 0,
      unplanned: 8,
    });
    expect(
      batchPortionCounts(
        10,
        [{ id: "restored", servings: 4 }],
        [{ meal_id: "restored", servings: 2 }],
      ),
    ).toEqual({ eaten: 2, remaining: 8, planned: 2, unplanned: 6 });
  });
  it("requires positive integral consumption and a compared saved next-prep date", () => {
    for (const servings of [0, -1, 1.5, 51])
      expect(
        mealPrepActionSchema.safeParse({
          ...context,
          action: "eaten",
          batch_id: "dish",
          servings,
        }).success,
      ).toBe(false);
    expect(
      mealPrepActionSchema.safeParse({
        ...context,
        action: "next-prep",
        session_id: "prep",
        next_prep_on: null,
      }).success,
    ).toBe(false);
  });
});
