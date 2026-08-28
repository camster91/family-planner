import { planMealPlannerImport } from "../meal-planner";
import { importMealPlanner } from "../persist-meal-planner";

const source = {
  version: "1",
  users: [{ id: "owner-1", email: "owner@example.com", name: "Owner" }],
  recipes: [
    {
      id: "recipe-1",
      userId: "owner-1",
      title: " Pasta ",
      servings: 4,
      createdAt: "2026-08-01T00:00:00Z",
    },
  ],
  ingredients: [{ id: "ingredient-1", name: " Tomato ", unit: "g" }],
  recipeIngredients: [
    {
      id: "link-1",
      recipeId: "recipe-1",
      ingredientId: "ingredient-1",
      amount: 250,
    },
  ],
  mealPlans: [
    {
      id: "plan-1",
      userId: "owner-1",
      name: " Week ",
      startDate: "2026-08-24",
      endDate: "2026-08-30",
      createdAt: "2026-08-20",
    },
  ],
  mealPlanEntries: [
    {
      id: "entry-1",
      mealPlanId: "plan-1",
      recipeId: "recipe-1",
      date: "2026-08-28",
      mealType: "DINNER",
      servings: 4,
    },
  ],
  shoppingLists: [
    {
      id: "list-1",
      userId: "owner-1",
      name: " Groceries ",
      createdAt: "2026-08-20",
    },
  ],
  shoppingItems: [
    {
      id: "item-1",
      shoppingListId: "list-1",
      ingredientName: " Tomato ",
      checked: true,
      recipeId: "recipe-1",
    },
  ],
};

describe("planMealPlannerImport", () => {
  it("normalizes a complete export and maps source owners explicitly", () => {
    const plan = planMealPlannerImport(source, { "owner-1": "user-1" });
    expect(plan.recipes[0]).toMatchObject({
      title: "Pasta",
      createdBy: "user-1",
    });
    expect(plan.ingredients[0]).toMatchObject({ name: "Tomato", unit: "g" });
    expect(plan.mealPlanEntries[0]).toMatchObject({
      mealType: "dinner",
      servings: 4,
    });
    expect(plan.shoppingItems[0]).toMatchObject({
      ingredientName: "Tomato",
      checked: true,
    });
    expect(plan.skippedRecords).toEqual([]);
  });

  it("skips owned records when identity mapping is absent", () => {
    const plan = planMealPlannerImport(source, {});
    expect(plan.recipes).toEqual([]);
    expect(plan.mealPlans).toEqual([]);
    expect(plan.shoppingLists).toEqual([]);
    expect(plan.skippedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceModel: "Recipe" }),
        expect.objectContaining({ sourceModel: "MealPlan" }),
        expect.objectContaining({ sourceModel: "ShoppingList" }),
      ]),
    );
  });

  it("defaults to a database-free dry run", async () => {
    const result = await importMealPlanner(source, {
      familyId: "family-1",
      startedBy: "user-1",
      sourceUserToTargetUser: { "owner-1": "user-1" },
    });
    expect(result.jobId).toBeNull();
    expect(result.plan.recipes).toHaveLength(1);
    expect(result.summary.created).toEqual({});
  });
});
