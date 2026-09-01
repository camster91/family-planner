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
      habits: [
        {
          id: "habit-1",
          title: "Read",
          points: 5,
          isActive: true,
          createdAt: "2026-08-01",
        },
      ],
      habitLogs: [
        {
          id: "habit-log-1",
          habitId: "habit-1",
          kidId: "kid-1",
          loggedDate: "2026-08-28",
          loggedAt: "2026-08-28T12:00:00Z",
        },
      ],
      rewards: [
        {
          id: "reward-1",
          title: "Movie",
          cost: 20,
          isActive: true,
          createdAt: "2026-08-01",
        },
      ],
      redemptions: [
        {
          id: "redemption-1",
          rewardId: "reward-1",
          kidId: "kid-1",
          points: 20,
          createdAt: "2026-08-28T13:00:00Z",
        },
      ],
      familyGoals: [
        {
          id: "goal-1",
          title: "Team week",
          targetPoints: 100,
          currentPoints: 45,
          isActive: true,
          createdAt: "2026-08-01",
        },
      ],
      badges: [
        {
          id: "badge-1",
          name: "Starter",
          description: "First chore",
          icon: "star",
          requirement: "FIRST_CHORE",
          createdAt: "2026-08-01",
        },
      ],
      earnedBadges: [
        {
          id: "earned-badge-1",
          badgeId: "badge-1",
          kidId: "kid-1",
          earnedAt: "2026-08-28T14:00:00Z",
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
      Habit: 1,
      HabitLog: 1,
      Reward: 1,
      RewardRedemption: 1,
      FamilyGoal: 1,
      BadgeDefinition: 1,
      EarnedBadge: 1,
    });
    expect(second.summary.reused).toMatchObject({
      Chore: 1,
      ChoreAssignment: 1,
      Habit: 1,
      HabitLog: 1,
      Reward: 1,
      RewardRedemption: 1,
      FamilyGoal: 1,
      BadgeDefinition: 1,
      EarnedBadge: 1,
    });
    expect(first.summary.skipped).toEqual([]);
    expect(second.summary.skipped).toEqual([]);
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
    expect(first.summary.created).toMatchObject({
      Ingredient: 1,
      Recipe: 1,
      RecipeIngredient: 1,
      MealPlan: 1,
      MealPlanEntry: 1,
      ShoppingList: 1,
      ShoppingItem: 1,
    });
    expect(second.summary.reused).toMatchObject({
      Ingredient: 1,
      Recipe: 1,
      RecipeIngredient: 1,
      MealPlan: 1,
      MealPlanEntry: 1,
      ShoppingList: 1,
      ShoppingItem: 1,
    });
    expect(first.summary.skipped).toEqual([]);
    expect(second.summary.skipped).toEqual([]);
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
      bills: [{ id: "bill-1", name: "Hydro", amount: 7500 }],
      billPayments: [{ id: "payment-1", billId: "bill-1", amount: 7500 }],
      budgets: [{ id: "budget-1", categoryId: "cat-1", amount: 40000 }],
      goals: [{ id: "savings-goal-1", name: "Emergency fund", target: 100000 }],
      goalContributions: [
        { id: "contribution-1", goalId: "savings-goal-1", amount: 5000 },
      ],
      incomes: [{ id: "income-1", name: "Pay", amount: 100000 }],
      screenshotReceipts: [{ id: "receipt-1", total: 1234 }],
      spendingPatterns: [{ id: "pattern-1", merchant: "Market" }],
      dailyPeriods: [{ id: "period-1", allowance: 2500 }],
      noSpendEntries: [{ id: "no-spend-1", date: "2026-08-29" }],
    };
    const options = { familyId, startedBy: parentId, dryRun: false };
    const first = await importBudgetApp(data, options);
    const second = await importBudgetApp(data, options);
    expect(first.summary.created).toMatchObject({
      BudgetCategory: 1,
      Transaction: 1,
      WishlistItem: 1,
      FinancialArchiveRecord: 11,
    });
    expect(second.summary.reused).toMatchObject({
      BudgetCategory: 1,
      Transaction: 1,
      WishlistItem: 1,
      FinancialArchiveRecord: 11,
    });
    expect(first.summary.skipped).toEqual([]);
    expect(second.summary.skipped).toEqual([]);
  });

  it("reconciles every source record and completed import job", async () => {
    const records = await prisma.importedRecord.findMany({
      where: { family_id: familyId },
      select: { source_app: true, source_model: true, source_id: true },
    });
    const jobs = await prisma.importJob.findMany({
      where: { family_id: familyId },
      select: { source_app: true, status: true, summary: true },
    });

    const recordsBySource = records.reduce<Record<string, number>>(
      (counts, record) => {
        counts[record.source_app] = (counts[record.source_app] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const jobsBySource = jobs.reduce<Record<string, number>>((counts, job) => {
      counts[job.source_app] = (counts[job.source_app] ?? 0) + 1;
      return counts;
    }, {});

    expect(recordsBySource).toEqual({
      "chore-champs": 9,
      "meal-planner": 7,
      "budget-app": 14,
    });
    expect(jobsBySource).toEqual({
      "chore-champs": 2,
      "meal-planner": 2,
      "budget-app": 2,
    });
    expect(jobs).toHaveLength(6);
    expect(jobs.every((job) => job.status === "completed")).toBe(true);

    const uniqueProvenance = new Set(
      records.map(
        (record) =>
          `${record.source_app}:${record.source_model}:${record.source_id}`,
      ),
    );
    expect(uniqueProvenance.size).toBe(records.length);

    console.info(
      "Legacy import reconciliation:",
      JSON.stringify({ recordsBySource, jobsBySource, skipped: 0 }),
    );
  });

  it("hashes and atomically consumes account tokens", async () => {
    const {
      consumeResetToken,
      createResetToken,
      createVerificationToken,
      markEmailVerified,
      verifyEmailToken,
      verifyResetToken,
    } = await import("@/lib/tokens");

    const resetToken = await createResetToken(parentId);
    const storedReset = await prisma.user.findUniqueOrThrow({
      where: { id: parentId },
      select: { reset_token: true },
    });
    expect(storedReset.reset_token).not.toBe(resetToken);
    expect(await verifyResetToken(resetToken)).toBe(parentId);
    expect(await consumeResetToken(resetToken, "new-password-hash")).toBe(true);
    expect(await consumeResetToken(resetToken, "reused-password-hash")).toBe(
      false,
    );

    const resetUser = await prisma.user.findUniqueOrThrow({
      where: { id: parentId },
      select: { password: true, reset_token: true },
    });
    expect(resetUser).toEqual({
      password: "new-password-hash",
      reset_token: null,
    });

    const verifyToken = await createVerificationToken(childId);
    const storedVerify = await prisma.user.findUniqueOrThrow({
      where: { id: childId },
      select: { verify_token: true },
    });
    expect(storedVerify.verify_token).not.toBe(verifyToken);
    expect(await verifyEmailToken(verifyToken)).toBe(childId);
    await markEmailVerified(childId);
    expect(await verifyEmailToken(verifyToken)).toBeNull();
  });
});
