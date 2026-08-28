const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeWithDatabase("family import persistence", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  const familyId = "integration-family";
  const parentId = "integration-parent";
  const childId = "integration-child";

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    if (!prismaModule.prisma)
      throw new Error("Integration database is not configured");
    prisma = prismaModule.prisma;
    await prisma.family.create({
      data: {
        id: familyId,
        name: "Import Test Family",
        invite_code: "integration-invite",
      },
    });
    await prisma.user.createMany({
      data: [
        {
          id: parentId,
          email: "parent@integration.test",
          name: "Parent",
          role: "parent",
          family_id: familyId,
        },
        {
          id: childId,
          email: "child@integration.test",
          name: "Child",
          role: "child",
          family_id: familyId,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.family.delete({ where: { id: familyId } });
    await prisma.$disconnect();
  });

  it("persists and reuses ChoreChamps records transactionally", async () => {
    const { importChoreChamps } = await import("../persist-chore-champs");
    const data = {
      version: "1",
      family: { id: "source-family", name: "Source" },
      kids: [{ id: "kid-1", name: "Child" }],
      chores: [
        {
          id: "chore-1",
          title: "Dishes",
          basePoints: 10,
          difficulty: "EASY",
          isActive: true,
          createdAt: "2026-08-01",
        },
      ],
      assignments: [
        {
          id: "assignment-1",
          choreId: "chore-1",
          kidId: "kid-1",
          dueDate: "2026-08-29",
          status: "PENDING",
          createdAt: "2026-08-28",
        },
      ],
    };
    const options = {
      familyId,
      startedBy: parentId,
      kidToUserId: { "kid-1": childId },
      dryRun: false,
    };
    const first = await importChoreChamps(data, options);
    const second = await importChoreChamps(data, options);
    expect(first.summary.created).toMatchObject({
      Chore: 1,
      ChoreAssignment: 1,
    });
    expect(second.summary.reused).toMatchObject({
      Chore: 1,
      ChoreAssignment: 1,
    });
  });

  it("persists and reuses Meal Planner relationships", async () => {
    const { importMealPlanner } = await import("../persist-meal-planner");
    const data = {
      version: "1",
      users: [{ id: "owner-1", email: "source@example.com", name: "Source" }],
      recipes: [
        {
          id: "recipe-1",
          userId: "owner-1",
          title: "Pasta",
          servings: 2,
          createdAt: "2026-08-01",
        },
      ],
      ingredients: [{ id: "ingredient-1", name: "Tomato", unit: "g" }],
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
          name: "Week",
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
          mealType: "dinner",
          servings: 2,
        },
      ],
      shoppingLists: [
        {
          id: "list-1",
          userId: "owner-1",
          name: "Groceries",
          createdAt: "2026-08-20",
        },
      ],
      shoppingItems: [
        {
          id: "item-1",
          shoppingListId: "list-1",
          ingredientName: "Tomato",
          checked: false,
          recipeId: "recipe-1",
        },
      ],
    };
    const options = {
      familyId,
      startedBy: parentId,
      sourceUserToTargetUser: { "owner-1": parentId },
      dryRun: false,
    };
    const first = await importMealPlanner(data, options);
    const second = await importMealPlanner(data, options);
    expect(first.summary.created.Recipe).toBe(1);
    expect(first.summary.created.MealPlanEntry).toBe(1);
    expect(second.summary.reused.Recipe).toBe(1);
    expect(second.summary.reused.MealPlanEntry).toBe(1);
  });

  it("persists native Budget App records and lossless archives", async () => {
    const { importBudgetApp } = await import("../persist-budget-app");
    const data = {
      version: "1",
      categories: [
        {
          id: "cat-1",
          name: "Groceries",
          type: "expense",
          createdAt: "2026-08-01",
        },
      ],
      transactions: [
        {
          id: "tx-1",
          amount: 1234,
          description: "Market",
          date: "2026-08-28",
          categoryId: "cat-1",
          createdAt: "2026-08-28",
        },
      ],
      wishlistItems: [
        { id: "wish-1", name: "Bike", price: 29999, createdAt: "2026-08-20" },
      ],
      accounts: [{ id: "account-1", name: "Chequing", balance: 50000 }],
    };
    const options = { familyId, startedBy: parentId, dryRun: false };
    const first = await importBudgetApp(data, options);
    const second = await importBudgetApp(data, options);
    expect(first.summary.created).toMatchObject({
      BudgetCategory: 1,
      Transaction: 1,
      WishlistItem: 1,
      FinancialArchiveRecord: 1,
    });
    expect(second.summary.reused).toMatchObject({
      BudgetCategory: 1,
      Transaction: 1,
      WishlistItem: 1,
      FinancialArchiveRecord: 1,
    });
  });
});
