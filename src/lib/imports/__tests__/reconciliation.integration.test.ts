// Import reconciliation (#288, PR101 D-7) against real Postgres. Opt-in like
// the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=... on a
// database `node scripts/migrate.js` has prepared.
//
// For every supported import source (FAMILY_IMPORT_SOURCES), an export that
// exercises both the happy path and each skip path is imported twice. Every
// source record must end up as exactly one of:
//   - one ImportedRecord provenance row whose target row exists in the
//     importing household (created, linked or archived), or
//   - one recorded skip in the completed ImportJob's summary,
// never both and never neither; and each completed job's stored counts must
// add up to the export and to the provenance rows it wrote.

import type { FamilyImportSource } from "../run-family-import";

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

// Mirrors FAMILY_IMPORT_SOURCES (asserted below) without loading the importers,
// and so Prisma, when the suite is skipped.
const SOURCES: readonly FamilyImportSource[] = [
  "chore-champs",
  "meal-planner",
  "budget-app",
];

const FAMILY = "recon-family";
const PARENT = "recon-parent";
const CHILD = "recon-child";

type Skip = { sourceModel: string; sourceId: string; reason: string };
type StoredSummary = {
  created?: Record<string, number>;
  reused?: Record<string, number>;
  archived?: Record<string, number>;
  linked?: Record<string, number>;
  skipped?: Skip[];
};

/** Export array field -> the source_model name the importer records. */
const SOURCE_MODELS: Record<FamilyImportSource, Record<string, string>> = {
  "chore-champs": {
    chores: "Chore",
    assignments: "ChoreAssignment",
    habits: "Habit",
    habitLogs: "HabitLog",
    rewards: "Reward",
    redemptions: "Redemption",
    familyGoals: "FamilyGoal",
    badges: "BadgeDefinition",
    earnedBadges: "EarnedBadge",
  },
  "meal-planner": {
    recipes: "Recipe",
    ingredients: "Ingredient",
    recipeIngredients: "RecipeIngredient",
    mealPlans: "MealPlan",
    mealPlanEntries: "MealPlanEntry",
    shoppingLists: "ShoppingList",
    shoppingItems: "ShoppingItem",
  },
  "budget-app": {
    categories: "Category",
    transactions: "Transaction",
    wishlistItems: "WishlistItem",
    accounts: "accounts",
    bills: "bills",
    billPayments: "billPayments",
    budgets: "budgets",
    goals: "goals",
    goalContributions: "goalContributions",
    incomes: "incomes",
    screenshotReceipts: "screenshotReceipts",
    spendingPatterns: "spendingPatterns",
    dailyPeriods: "dailyPeriods",
    noSpendEntries: "noSpendEntries",
  },
};

// kid-2 / user-2 are deliberately left unmapped to exercise identity skips.
const EXPORTS: Record<FamilyImportSource, Record<string, unknown>> = {
  "chore-champs": {
    version: "1",
    family: { id: "source-family", name: "Source" },
    kids: [
      { id: "kid-1", name: "Mapped" },
      { id: "kid-2", name: "Unmapped" },
    ],
    chores: [
      { id: "chore-1", title: "Dishes", createdAt: "2026-08-01" },
      // Only assigned to the unmapped kid: skipped at persist time.
      { id: "chore-2", title: "Lawn", createdAt: "2026-08-01" },
    ],
    assignments: [
      {
        id: "assignment-1",
        choreId: "chore-1",
        kidId: "kid-1",
        dueDate: "2026-08-29",
        createdAt: "2026-08-28",
      },
      {
        id: "assignment-2",
        choreId: "chore-2",
        kidId: "kid-2",
        dueDate: "2026-08-29",
        createdAt: "2026-08-28",
      },
      {
        id: "assignment-3",
        choreId: "chore-missing",
        kidId: "kid-1",
        dueDate: "2026-08-29",
        createdAt: "2026-08-28",
      },
    ],
    habits: [{ id: "habit-1", title: "Read", createdAt: "2026-08-01" }],
    habitLogs: [
      {
        id: "habit-log-1",
        habitId: "habit-1",
        kidId: "kid-1",
        loggedDate: "2026-08-28",
        loggedAt: "2026-08-28T12:00:00Z",
      },
      {
        id: "habit-log-2",
        habitId: "habit-missing",
        kidId: "kid-1",
        loggedDate: "2026-08-28",
        loggedAt: "2026-08-28T12:00:00Z",
      },
      {
        id: "habit-log-3",
        habitId: "habit-1",
        kidId: "kid-2",
        loggedDate: "2026-08-28",
        loggedAt: "2026-08-28T12:00:00Z",
      },
    ],
    rewards: [
      { id: "reward-1", title: "Movie", cost: 20, createdAt: "2026-08-01" },
    ],
    redemptions: [
      {
        id: "redemption-1",
        rewardId: "reward-1",
        kidId: "kid-1",
        points: 20,
        createdAt: "2026-08-28T13:00:00Z",
      },
      {
        id: "redemption-2",
        rewardId: "reward-missing",
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
        id: "earned-1",
        badgeId: "badge-1",
        kidId: "kid-1",
        earnedAt: "2026-08-28T14:00:00Z",
      },
      {
        id: "earned-2",
        badgeId: "badge-1",
        kidId: "kid-2",
        earnedAt: "2026-08-28T14:00:00Z",
      },
    ],
  },
  "meal-planner": {
    version: "1",
    users: [
      { id: "user-1", email: "one@source.test", name: "Mapped" },
      { id: "user-2", email: "two@source.test", name: "Unmapped" },
    ],
    recipes: [
      {
        id: "recipe-1",
        userId: "user-1",
        title: "Recon pancakes",
        createdAt: "2026-08-01",
      },
      {
        id: "recipe-2",
        userId: "user-2",
        title: "Recon soup",
        createdAt: "2026-08-01",
      },
    ],
    ingredients: [
      { id: "ingredient-1", name: "Recon flour", unit: "g" },
      { id: "ingredient-2", name: "Recon stock", unit: "ml" },
    ],
    recipeIngredients: [
      {
        id: "ri-1",
        recipeId: "recipe-1",
        ingredientId: "ingredient-1",
        amount: 200,
      },
      // Recipe skipped (unmapped owner): skipped at persist time.
      {
        id: "ri-2",
        recipeId: "recipe-2",
        ingredientId: "ingredient-2",
        amount: 500,
      },
      {
        id: "ri-3",
        recipeId: "recipe-missing",
        ingredientId: "ingredient-1",
        amount: 1,
      },
    ],
    mealPlans: [
      {
        id: "plan-1",
        userId: "user-1",
        name: "Week",
        startDate: "2026-08-24",
        endDate: "2026-08-30",
        createdAt: "2026-08-20",
      },
      {
        id: "plan-2",
        userId: "user-2",
        name: "Other week",
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
        date: "2026-08-27",
        mealType: "dinner",
      },
      {
        id: "entry-2",
        mealPlanId: "plan-1",
        recipeId: "recipe-1",
        date: "2026-08-27",
        mealType: "brunch",
      },
      // Plan skipped (unmapped owner): skipped at persist time.
      {
        id: "entry-3",
        mealPlanId: "plan-2",
        recipeId: "recipe-1",
        date: "2026-08-27",
        mealType: "lunch",
      },
      {
        id: "entry-4",
        mealPlanId: "plan-missing",
        recipeId: "recipe-1",
        date: "2026-08-27",
        mealType: "dinner",
      },
      // Same slot and name as entry-1: linked to that meal, not duplicated.
      {
        id: "entry-5",
        mealPlanId: "plan-1",
        recipeId: "recipe-1",
        date: "2026-08-27",
        mealType: "dinner",
      },
    ],
    shoppingLists: [
      {
        id: "list-1",
        userId: "user-1",
        name: "Groceries",
        createdAt: "2026-08-20",
      },
      {
        id: "list-2",
        userId: "user-2",
        name: "Other groceries",
        createdAt: "2026-08-20",
      },
    ],
    shoppingItems: [
      { id: "item-1", shoppingListId: "list-1", ingredientName: "Milk" },
      // List skipped (unmapped owner): skipped at persist time.
      { id: "item-2", shoppingListId: "list-2", ingredientName: "Bread" },
      { id: "item-3", shoppingListId: "list-missing", ingredientName: "Jam" },
      { id: "item-4", shoppingListId: "list-1", ingredientName: "   " },
      // Recipe not imported: row created with recipe_id nulled (not a skip).
      {
        id: "item-5",
        shoppingListId: "list-1",
        ingredientName: "Eggs",
        recipeId: "recipe-2",
      },
    ],
  },
  "budget-app": {
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
  },
};

/** Expected split per source, so a silent change in behaviour is visible. */
const EXPECTED: Record<
  FamilyImportSource,
  { records: number; provenance: number; skipped: number }
> = {
  "chore-champs": { records: 16, provenance: 9, skipped: 7 },
  "meal-planner": { records: 21, provenance: 10, skipped: 11 },
  "budget-app": { records: 14, provenance: 14, skipped: 0 },
};

const IDENTITY_MAP: Record<FamilyImportSource, Record<string, string>> = {
  "chore-champs": { "kid-1": CHILD },
  "meal-planner": { "user-1": PARENT },
  "budget-app": {},
};

function sourceKeys(source: FamilyImportSource): string[] {
  const data = EXPORTS[source];
  return Object.entries(SOURCE_MODELS[source]).flatMap(([field, model]) =>
    ((data[field] as Array<{ id: string }> | undefined) ?? []).map(
      (record) => `${model}:${record.id}`,
    ),
  );
}

const total = (bucket: Record<string, number> | undefined) =>
  Object.values(bucket ?? {}).reduce((sum, n) => sum + n, 0);

describeWithDatabase("import reconciliation", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  let runFamilyImport: typeof import("../run-family-import").runFamilyImport;

  /** Ids among `ids` that exist as `model` rows inside FAMILY. */
  async function liveTargets(model: string, ids: string[]) {
    const byId = { id: { in: ids } };
    const scoped = { ...byId, family_id: FAMILY };
    const select = { id: true } as const;
    const lookups: Record<string, () => Promise<Array<{ id: string }>>> = {
      Chore: () => prisma.chore.findMany({ where: scoped, select }),
      ChoreAssignment: () =>
        prisma.choreAssignment.findMany({ where: scoped, select }),
      Habit: () => prisma.habit.findMany({ where: scoped, select }),
      HabitLog: () => prisma.habitLog.findMany({ where: scoped, select }),
      Reward: () => prisma.reward.findMany({ where: scoped, select }),
      RewardRedemption: () =>
        prisma.rewardRedemption.findMany({ where: scoped, select }),
      FamilyGoal: () => prisma.familyGoal.findMany({ where: scoped, select }),
      BadgeDefinition: () =>
        prisma.badgeDefinition.findMany({ where: scoped, select }),
      EarnedBadge: () => prisma.earnedBadge.findMany({ where: scoped, select }),
      BudgetCategory: () =>
        prisma.budgetCategory.findMany({ where: scoped, select }),
      Transaction: () => prisma.transaction.findMany({ where: scoped, select }),
      WishlistItem: () =>
        prisma.wishlistItem.findMany({ where: scoped, select }),
      FinancialArchiveRecord: () =>
        prisma.financialArchiveRecord.findMany({ where: scoped, select }),
      Ingredient: () => prisma.ingredient.findMany({ where: scoped, select }),
      Recipe: () => prisma.recipe.findMany({ where: scoped, select }),
      RecipeIngredient: () =>
        prisma.recipeIngredient.findMany({
          where: { ...byId, recipe: { family_id: FAMILY } },
          select,
        }),
      ImportJob: () => prisma.importJob.findMany({ where: scoped, select }),
      FamilyMeal: () => prisma.familyMeal.findMany({ where: scoped, select }),
      List: () => prisma.list.findMany({ where: scoped, select }),
      ListItem: () =>
        prisma.listItem.findMany({
          where: { ...byId, list: { family_id: FAMILY } },
          select,
        }),
    };
    const lookup = lookups[model];
    if (!lookup) throw new Error(`No reconciliation lookup for ${model}`);
    return new Set((await lookup()).map((row) => row.id));
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: FAMILY } });
    await prisma.user.deleteMany({ where: { id: { in: [PARENT, CHILD] } } });
  }

  beforeAll(async () => {
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    prisma = mod.prisma;
    ({ runFamilyImport } = await import("../run-family-import"));
    await cleanup();
    await prisma.family.create({
      data: { id: FAMILY, name: "Reconciliation", invite_code: "recon-inv" },
    });
    await prisma.user.createMany({
      data: [
        {
          id: PARENT,
          email: "parent@recon.test",
          name: "Parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: CHILD,
          email: "child@recon.test",
          name: "Child",
          role: "child",
          family_id: FAMILY,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("covers every supported import source", async () => {
    const { FAMILY_IMPORT_SOURCES } = await import("../run-family-import");
    expect([...SOURCES].sort()).toEqual([...FAMILY_IMPORT_SOURCES].sort());
    expect(Object.keys(EXPORTS).sort()).toEqual([...SOURCES].sort());
  });

  it.each(SOURCES.map((source) => [source]))(
    "reconciles every source record and completed import job: %s",
    async (source) => {
      const keys = sourceKeys(source);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toHaveLength(EXPECTED[source].records);

      const options = {
        source,
        data: EXPORTS[source],
        familyId: FAMILY,
        startedBy: PARENT,
        identityMap: IDENTITY_MAP[source],
        dryRun: false,
      };
      const first = await runFamilyImport(options);
      const second = await runFamilyImport(options);

      const provenance = await prisma.importedRecord.findMany({
        where: { family_id: FAMILY, source_app: source },
      });
      const provenanceKeys = provenance.map(
        (r) => `${r.source_model}:${r.source_id}`,
      );
      expect(new Set(provenanceKeys).size).toBe(provenanceKeys.length);
      expect(provenance).toHaveLength(EXPECTED[source].provenance);

      // Every provenance row points at a live row inside this household.
      const byTarget = new Map<string, string[]>();
      for (const r of provenance) {
        byTarget.set(r.target_model, [
          ...(byTarget.get(r.target_model) ?? []),
          r.target_id,
        ]);
      }
      for (const [model, ids] of byTarget) {
        const live = await liveTargets(model, ids);
        expect({ model, missing: ids.filter((id) => !live.has(id)) }).toEqual({
          model,
          missing: [],
        });
      }

      for (const [run, result] of [
        ["first", first],
        ["second", second],
      ] as const) {
        const job = await prisma.importJob.findUniqueOrThrow({
          where: { id: result.jobId! },
          include: { _count: { select: { records: true } } },
        });
        expect({ run, status: job.status, dryRun: job.dry_run }).toEqual({
          run,
          status: "completed",
          dryRun: false,
        });
        expect(job.completed_at).not.toBeNull();
        expect(job.family_id).toBe(FAMILY);

        // The stored summary is what the importer reported.
        const stored = job.summary as unknown as StoredSummary;
        expect(stored).toEqual(JSON.parse(JSON.stringify(result.summary)));

        const skipped = stored.skipped ?? [];
        const skippedKeys = skipped.map(
          (s) => `${s.sourceModel}:${s.sourceId}`,
        );
        expect(new Set(skippedKeys).size).toBe(skippedKeys.length);
        expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
        expect(skipped).toHaveLength(EXPECTED[source].skipped);

        // Exactly one outcome per source record: provenance XOR skip.
        const accounted = [...provenanceKeys, ...skippedKeys].sort();
        expect(accounted).toEqual([...keys].sort());

        // Counts add up to the export and to the rows this job wrote.
        const written =
          total(stored.created) + total(stored.archived) + total(stored.linked);
        expect(written + total(stored.reused) + skipped.length).toBe(
          keys.length,
        );
        expect(job._count.records).toBe(written);
        if (run === "first") {
          expect(total(stored.reused)).toBe(0);
          expect(written).toBe(EXPECTED[source].provenance);
        } else {
          expect(written).toBe(0);
          expect(total(stored.reused)).toBe(EXPECTED[source].provenance);
        }
      }

      const jobs = await prisma.importJob.count({
        where: { family_id: FAMILY, source_app: source },
      });
      expect(jobs).toBe(2);
    },
  );
});
