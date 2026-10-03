export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeWithDatabase("family import persistence", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  const familyId = "integration-family";
  const parentId = "integration-parent";
  const childId = "integration-child";

  // User.family_id is ON DELETE SET NULL, so deleting the family alone leaves
  // integration-parent / integration-child behind. Delete both, before and
  // after, so the suite also passes on a database an earlier run has used
  // (otherwise beforeAll hits P2002 on User_pkey and every test fails).
  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: familyId } });
    await prisma.user.deleteMany({
      where: { id: { in: [parentId, childId] } },
    });
  }

  async function seed() {
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
  }

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    if (!prismaModule.prisma)
      throw new Error("Integration database is not configured");
    prisma = prismaModule.prisma;
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("can be set up again over rows left by an earlier run", async () => {
    // Rows from beforeAll stand in for an earlier run's leftovers. Deleting
    // the family alone would orphan the users rather than remove them.
    await prisma.family.delete({ where: { id: familyId } });
    expect(
      await prisma.user.count({ where: { id: { in: [parentId, childId] } } }),
    ).toBe(2);
    await cleanup();
    await expect(seed()).resolves.toBeUndefined();
    expect(
      await prisma.user.count({
        where: { id: { in: [parentId, childId] }, family_id: familyId },
      }),
    ).toBe(2);
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

  // Meal Planner persistence (retargeted onto the canonical models by ADR-0007,
  // #251) is covered in meal-planner-canonical.integration.test.ts.

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
