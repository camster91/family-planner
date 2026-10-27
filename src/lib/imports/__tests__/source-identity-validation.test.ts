/** Pure export-schema source cases, authored UNRUN; no DB/provider modules. */
import { sourceDuplicateDiagnostics } from "../source-identity-validation";
import { budgetAppExportSchema, planBudgetAppImport } from "../budget-app";
import { choreChampsExportSchema } from "../chore-champs";
import { mealPlannerExportSchema } from "../meal-planner";
const day = "2026-10-25";
const id = "synthetic-shared-id";
const budgetRows = {
  categories: { id, name: "Synthetic category", createdAt: day },
  transactions: {
    id,
    amount: 1999,
    description: "Synthetic transaction",
    date: day,
    createdAt: day,
  },
  wishlistItems: { id, name: "Synthetic wish", price: 100, createdAt: day },
  accounts: { id },
  bills: { id },
  billPayments: { id },
  budgets: { id },
  goals: { id },
  goalContributions: { id },
  incomes: { id },
  screenshotReceipts: { id },
  spendingPatterns: { id },
  dailyPeriods: { id },
  noSpendEntries: { id },
};
it.each(Object.entries(budgetRows))(
  "refuses duplicate Budget source IDs in %s before producing a plan",
  (field, row) => {
    const input = { version: "synthetic-v1", [field]: [row, { ...row }] };
    const result = budgetAppExportSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: [field, 1, "id"],
            message: "Duplicate source ID in this collection",
          }),
        ]),
      );
    expect(() => planBudgetAppImport(input, "synthetic-parent")).toThrow(
      "Duplicate source ID",
    );
  },
);
const choreBase = {
  version: "synthetic-v1",
  family: { id: "synthetic-family", name: "Synthetic family" },
  kids: [],
  chores: [],
  assignments: [],
};
const choreRows = {
  kids: { id, name: "Synthetic child" },
  chores: { id, title: "Synthetic chore", createdAt: day },
  assignments: {
    id,
    choreId: "synthetic-chore",
    kidId: "synthetic-child",
    dueDate: day,
    createdAt: day,
  },
  habits: { id, title: "Synthetic habit", createdAt: day },
  habitLogs: {
    id,
    habitId: "synthetic-habit",
    kidId: "synthetic-child",
    loggedDate: day,
    loggedAt: day,
  },
  rewards: { id, title: "Synthetic reward", cost: 1, createdAt: day },
  redemptions: {
    id,
    rewardId: "synthetic-reward",
    kidId: "synthetic-child",
    points: 1,
    createdAt: day,
  },
  familyGoals: {
    id,
    title: "Synthetic goal",
    targetPoints: 1,
    currentPoints: 0,
    createdAt: day,
  },
  badges: {
    id,
    name: "Synthetic badge",
    description: "Synthetic",
    icon: "star",
    requirement: "Synthetic",
    createdAt: day,
  },
  earnedBadges: {
    id,
    badgeId: "synthetic-badge",
    kidId: "synthetic-child",
    earnedAt: day,
  },
};
it.each(Object.entries(choreRows))(
  "refuses duplicate ChoreChamps source IDs in %s",
  (field, row) => {
    const result = choreChampsExportSchema.safeParse({
      ...choreBase,
      [field]: [row, { ...row }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [field, 1, "id"] }),
        ]),
      );
  },
);
const mealRows = {
  users: { id, email: "synthetic@example.test", name: "Synthetic member" },
  recipes: {
    id,
    userId: "synthetic-owner",
    title: "Synthetic recipe",
    createdAt: day,
  },
  ingredients: { id, name: "Synthetic ingredient" },
  recipeIngredients: {
    id,
    recipeId: "synthetic-recipe",
    ingredientId: "synthetic-ingredient",
    amount: 1,
  },
  mealPlans: {
    id,
    userId: "synthetic-owner",
    name: "Synthetic plan",
    startDate: day,
    endDate: day,
    createdAt: day,
  },
  mealPlanEntries: {
    id,
    mealPlanId: "synthetic-plan",
    recipeId: "synthetic-recipe",
    date: day,
    mealType: "dinner",
  },
  shoppingLists: {
    id,
    userId: "synthetic-owner",
    name: "Synthetic list",
    createdAt: day,
  },
  shoppingItems: {
    id,
    shoppingListId: "synthetic-list",
    ingredientName: "Synthetic ingredient",
  },
};
it.each(Object.entries(mealRows))(
  "refuses duplicate Meal Planner source IDs in %s",
  (field, row) => {
    const result = mealPlannerExportSchema.safeParse({
      version: "synthetic-v1",
      [field]: [row, { ...row }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [field, 1, "id"] }),
        ]),
      );
  },
);
it("keeps IDs model-scoped and does not guess that equal names/values are duplicate identities", () => {
  expect(
    budgetAppExportSchema.safeParse({
      version: "synthetic-v1",
      accounts: [
        { id, name: "Same name" },
        { id: "another-id", name: "Same name" },
      ],
      bills: [{ id }],
    }).success,
  ).toBe(true);
  expect(
    choreChampsExportSchema.safeParse({
      ...choreBase,
      kids: [choreRows.kids],
      chores: [choreRows.chores],
    }).success,
  ).toBe(true);
  expect(
    mealPlannerExportSchema.safeParse({
      version: "synthetic-v1",
      users: [mealRows.users],
      recipes: [mealRows.recipes],
    }).success,
  ).toBe(true);
});
it("bounds diagnostics to one duplicate per collection and leaves caller rows untouched", () => {
  const rows = Array.from({ length: 100 }, () => ({
    id,
    note: "synthetic-payload",
  }));
  const result = budgetAppExportSchema.safeParse({
    version: "synthetic-v1",
    accounts: rows,
    bills: rows,
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toHaveLength(2);
    expect(JSON.stringify(result.error.issues)).not.toContain(id);
    expect(JSON.stringify(result.error.issues)).not.toContain(
      "synthetic-payload",
    );
  }
  expect(rows).toHaveLength(100);
  expect(rows[0]).toEqual({ id, note: "synthetic-payload" });
});

it("exports only collection/index pointers from marked schema issues, never source IDs", () => {
  const result = budgetAppExportSchema.safeParse({
    version: "synthetic-v1",
    accounts: [{ id }, { id }],
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(sourceDuplicateDiagnostics(result.error)).toEqual([
      { collection: "accounts", rowIndex: 1 },
    ]);
});
it("refuses conflicting payloads under one source ID instead of selecting the first or last", () => {
  const input = {
    version: "synthetic-v1",
    accounts: [
      { id, balance: 100 },
      { id, balance: 200 },
    ],
  };
  expect(() => planBudgetAppImport(input, "synthetic-parent")).toThrow(
    "Duplicate source ID",
  );
  expect(input.accounts.map((row) => row.balance)).toEqual([100, 200]);
});
