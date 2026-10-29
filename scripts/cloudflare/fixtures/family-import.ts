import type { D1Store } from "../../../src/lib/cloudflare/database";
import { runD1FamilyImport } from "../../../src/lib/cloudflare/family-import";

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

function count(
  result: { summary: { created: Record<string, number> } },
  key: string,
) {
  return result.summary.created[key] ?? 0;
}

function reused(
  result: { summary: { reused: Record<string, number> } },
  key: string,
) {
  return result.summary.reused[key] ?? 0;
}

/** Disposable D1 coverage for all supported family-import sources. */
export async function testFamilyImport(db: D1Store) {
  const familyId = "family-import-family";
  const parentId = "family-import-parent";
  const childId = "family-import-child";
  await db.batch([
    db
      .prepare(`INSERT INTO "Family"(id,name,invite_code) VALUES (?1,?2,?3)`)
      .bind(familyId, "Import fixture", "family-import-code"),
    db
      .prepare(
        `INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES (?1,?2,?3,?4,'parent',0),(?5,?6,?7,?4,'child',0)`,
      )
      .bind(
        parentId,
        "family-import-parent@example.test",
        "Import Parent",
        familyId,
        childId,
        "family-import-child@example.test",
        "Import Child",
      ),
    db
      .prepare(
        `INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES (?1,?2,'Import Child','child',8)`,
      )
      .bind("family-import-child-member", familyId),
    db
      .prepare(
        `INSERT INTO "HouseholdMemberLegacyMapping"(user_id,member_id,family_id) VALUES (?1,?2,?3)`,
      )
      .bind(childId, "family-import-child-member", familyId),
  ]);

  const budget = await runD1FamilyImport({
    source: "budget-app",
    familyId,
    startedBy: parentId,
    sessionVersion: 0,
    data: {
      version: "fixture-1",
      categories: [
        {
          id: "category-1",
          name: "Home",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      transactions: [
        {
          id: "transaction-1",
          amount: 1250,
          description: "Groceries",
          date: "2026-10-01T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      wishlistItems: [
        {
          id: "wish-1",
          name: "Board game",
          price: 2500,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    },
    database: db,
    dryRun: false,
  });
  check(
    count(budget, "BudgetCategory") === 1 && count(budget, "Transaction") === 1,
    "budget import",
  );
  const budgetReplay = await runD1FamilyImport({
    source: "budget-app",
    familyId,
    startedBy: parentId,
    sessionVersion: 0,
    data: {
      version: "fixture-1",
      categories: [
        {
          id: "category-1",
          name: "Home",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    },
    database: db,
    dryRun: false,
  });
  check(
    reused(budgetReplay, "BudgetCategory") === 1,
    "budget provenance replay",
  );
  const concurrentBudget = {
    version: "fixture-concurrent",
    categories: [
      {
        id: "category-concurrent",
        name: "Concurrent",
        createdAt: "2026-10-02T00:00:00.000Z",
      },
    ],
  };
  const concurrent = await Promise.all(
    [0, 1].map(() =>
      runD1FamilyImport({
        source: "budget-app",
        familyId,
        startedBy: parentId,
        sessionVersion: 0,
        data: concurrentBudget,
        database: db,
        dryRun: false,
      }),
    ),
  );
  const concurrentRows = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM "ImportedRecord" WHERE family_id=?1 AND source_app='budget-app' AND source_model='Category' AND source_id='category-concurrent'`,
    )
    .bind(familyId)
    .first<{ count: number }>();
  check(
    concurrentRows?.count === 1 &&
      concurrent.some((result) => count(result, "BudgetCategory") === 1),
    "concurrent import replay",
  );

  const chores = await runD1FamilyImport({
    source: "chore-champs",
    familyId,
    startedBy: parentId,
    identityMap: { "kid-1": childId },
    sessionVersion: 0,
    data: {
      version: "fixture-1",
      family: { id: "source-family", name: "Source family" },
      kids: [{ id: "kid-1", name: "Child" }],
      chores: [
        {
          id: "chore-1",
          title: "Tidy room",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      assignments: [
        {
          id: "assignment-1",
          choreId: "chore-1",
          kidId: "kid-1",
          dueDate: "2026-10-02T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    },
    database: db,
    dryRun: false,
  });
  check(
    count(chores, "Chore") === 1 && count(chores, "ChoreAssignment") === 1,
    "chore import",
  );
  const choreSubjects = await db
    .prepare(
      `SELECT c.assigned_member_id AS chore_member,a.assigned_member_id AS assignment_member
    FROM "Chore" c JOIN "ChoreAssignment" a ON a.chore_id=c.id
    WHERE c.family_id=?1 AND c.id=(SELECT target_id FROM "ImportedRecord" WHERE family_id=?1 AND source_app='chore-champs' AND source_model='Chore' AND source_id='chore-1')`,
    )
    .bind(familyId)
    .first<{ chore_member: string | null; assignment_member: string | null }>();
  check(
    choreSubjects?.chore_member === "family-import-child-member" &&
      choreSubjects.assignment_member === "family-import-child-member",
    "chore profile subject",
  );

  const meals = await runD1FamilyImport({
    source: "meal-planner",
    familyId,
    startedBy: parentId,
    identityMap: { "source-parent": parentId },
    sessionVersion: 0,
    data: {
      version: "fixture-1",
      users: [
        {
          id: "source-parent",
          email: "source@example.test",
          name: "Source Parent",
        },
      ],
      recipes: [
        {
          id: "recipe-1",
          userId: "source-parent",
          title: "Pasta",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      ingredients: [{ id: "ingredient-1", name: "Pasta" }],
      recipeIngredients: [
        {
          id: "recipe-ingredient-1",
          recipeId: "recipe-1",
          ingredientId: "ingredient-1",
          amount: 1,
        },
      ],
      mealPlans: [
        {
          id: "plan-1",
          userId: "source-parent",
          name: "Week",
          startDate: "2026-10-01T00:00:00.000Z",
          endDate: "2026-10-07T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      mealPlanEntries: [
        {
          id: "entry-1",
          mealPlanId: "plan-1",
          recipeId: "recipe-1",
          date: "2026-10-02T00:00:00.000Z",
          mealType: "dinner",
        },
      ],
      shoppingLists: [
        {
          id: "shopping-list-1",
          userId: "source-parent",
          name: "Groceries",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      shoppingItems: [
        {
          id: "shopping-item-1",
          shoppingListId: "shopping-list-1",
          ingredientName: "Pasta",
          recipeId: "recipe-1",
        },
      ],
    },
    database: db,
    dryRun: false,
  });
  check(
    count(meals, "Recipe") === 1 &&
      count(meals, "FamilyMeal") === 1 &&
      count(meals, "ListItem") === 1,
    "meal import",
  );

  const recipe = await db
    .prepare(
      `SELECT target_id FROM "ImportedRecord" WHERE family_id=?1 AND source_app='meal-planner' AND source_model='Recipe' AND source_id='recipe-1'`,
    )
    .bind(familyId)
    .first<{ target_id: string }>();
  check(Boolean(recipe), "recipe provenance");
  await db
    .prepare(`DELETE FROM "Recipe" WHERE id=?1 AND family_id=?2`)
    .bind(recipe!.target_id, familyId)
    .run();
  const staleReplay = await runD1FamilyImport({
    source: "meal-planner",
    familyId,
    startedBy: parentId,
    identityMap: { "source-parent": parentId },
    sessionVersion: 0,
    data: {
      version: "fixture-2",
      users: [
        {
          id: "source-parent",
          email: "source@example.test",
          name: "Source Parent",
        },
      ],
      recipes: [
        {
          id: "recipe-1",
          userId: "source-parent",
          title: "Pasta",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      ingredients: [{ id: "ingredient-1", name: "Pasta" }],
      recipeIngredients: [
        {
          id: "recipe-ingredient-2",
          recipeId: "recipe-1",
          ingredientId: "ingredient-1",
          amount: 2,
        },
      ],
      mealPlans: [
        {
          id: "plan-2",
          userId: "source-parent",
          name: "Week 2",
          startDate: "2026-10-08T00:00:00.000Z",
          endDate: "2026-10-14T00:00:00.000Z",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      mealPlanEntries: [
        {
          id: "entry-2",
          mealPlanId: "plan-2",
          recipeId: "recipe-1",
          date: "2026-10-09T00:00:00.000Z",
          mealType: "dinner",
        },
      ],
      shoppingLists: [
        {
          id: "shopping-list-2",
          userId: "source-parent",
          name: "Groceries 2",
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      shoppingItems: [
        {
          id: "shopping-item-2",
          shoppingListId: "shopping-list-2",
          ingredientName: "Pasta",
          recipeId: "recipe-1",
        },
      ],
    },
    database: db,
    dryRun: false,
  });
  const staleSummary = staleReplay.summary as {
    skipped: Array<{ sourceId: string }>;
    nulled: Array<{ sourceId: string; field: string }>;
  };
  check(
    count(staleReplay, "List") === 1 &&
      count(staleReplay, "ListItem") === 1 &&
      staleSummary.skipped.some((item) => item.sourceId === "entry-2") &&
      staleSummary.skipped.some(
        (item) => item.sourceId === "recipe-ingredient-2",
      ) &&
      staleSummary.nulled.some(
        (item) =>
          item.sourceId === "shopping-item-2" && item.field === "recipe_id",
      ),
    "deleted recipe replay remains scoped",
  );

  const foreign = await runD1FamilyImport({
    source: "budget-app",
    familyId,
    startedBy: "not-this-family",
    sessionVersion: 0,
    data: { version: "fixture-1" },
    database: db,
    dryRun: false,
  }).catch((error: unknown) => error);
  check(
    foreign instanceof Error && foreign.message.includes("Household"),
    "family isolation",
  );
  return {
    budget: true,
    chores: true,
    choreProfileSubject: true,
    meals: true,
    staleReplay: true,
    concurrentReplay: true,
    replay: true,
    isolation: true,
  };
}
