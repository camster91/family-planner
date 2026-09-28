// Meal Planner import retargeted onto the canonical models (ADR-0007, #251),
// against real Postgres. Opt-in like the other integration suites:
// RUN_DB_INTEGRATION=1 DATABASE_URL=... on a database `node scripts/migrate.js`
// has prepared.
//
// Proves: an export writes only FamilyMeal / List / ListItem (+ the already
// canonical Recipe/Ingredient/RecipeIngredient), never the frozen legacy
// tables; re-importing the same export creates 0 rows; mappings written by the
// pre-retarget importer into legacy tables are honoured (whatever their
// target_model), so re-importing an old export after the retarget creates 0
// rows; and everything stays inside the importing household.

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("meal planner import onto canonical tables", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  let importMealPlanner: typeof import("../persist-meal-planner").importMealPlanner;

  const FAM = "mpc-family";
  const LEGACY_FAM = "mpc-family-legacy";
  const OTHER_FAM = "mpc-family-other";
  const PARENT = "mpc-parent";
  const LEGACY_PARENT = "mpc-legacy-parent";
  const OTHER_PARENT = "mpc-other-parent";
  const DAY = new Date("2026-08-28T00:00:00Z");

  async function cleanup() {
    await prisma.family.deleteMany({
      where: { id: { in: [FAM, LEGACY_FAM, OTHER_FAM] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [PARENT, LEGACY_PARENT, OTHER_PARENT] } },
    });
  }

  async function legacyCounts(familyId: string) {
    const [plans, entries, lists, items] = await Promise.all([
      prisma.mealPlan.count({ where: { family_id: familyId } }),
      prisma.mealPlanEntry.count({
        where: { meal_plan: { family_id: familyId } },
      }),
      prisma.shoppingList.count({ where: { family_id: familyId } }),
      prisma.shoppingItem.count({
        where: { shopping_list: { family_id: familyId } },
      }),
    ]);
    return { plans, entries, lists, items };
  }

  async function canonicalCounts(familyId: string) {
    const [meals, lists, items, recipes, ingredients] = await Promise.all([
      prisma.familyMeal.count({ where: { family_id: familyId } }),
      prisma.list.count({ where: { family_id: familyId } }),
      prisma.listItem.count({ where: { list: { family_id: familyId } } }),
      prisma.recipe.count({ where: { family_id: familyId } }),
      prisma.ingredient.count({ where: { family_id: familyId } }),
    ]);
    return { meals, lists, items, recipes, ingredients };
  }

  beforeAll(async () => {
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    prisma = mod.prisma;
    ({ importMealPlanner } = await import("../persist-meal-planner"));
    await cleanup();
    await prisma.family.createMany({
      data: [
        { id: FAM, name: "MPC", invite_code: "mpc-invite" },
        { id: LEGACY_FAM, name: "MPC legacy", invite_code: "mpc-invite-l" },
        { id: OTHER_FAM, name: "MPC other", invite_code: "mpc-invite-o" },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: PARENT,
          email: "p@mpc.test",
          name: "P",
          role: "parent",
          family_id: FAM,
        },
        {
          id: LEGACY_PARENT,
          email: "l@mpc.test",
          name: "L",
          role: "parent",
          family_id: LEGACY_FAM,
        },
        {
          id: OTHER_PARENT,
          email: "o@mpc.test",
          name: "O",
          role: "parent",
          family_id: OTHER_FAM,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const exportData = {
    version: "1",
    users: [{ id: "owner-1", email: "source@example.com", name: "Source" }],
    recipes: [
      {
        id: "recipe-1",
        userId: "owner-1",
        title: "Pasta",
        prepTime: 15,
        servings: 2,
        createdAt: "2026-08-01",
      },
      {
        id: "recipe-2",
        userId: "owner-1",
        title: "Curry",
        servings: 4,
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
      // Collides by name with a meal the family already planned -> linked.
      {
        id: "entry-1",
        mealPlanId: "plan-1",
        recipeId: "recipe-1",
        date: "2026-08-28",
        mealType: "dinner",
        servings: 2,
      },
      // Same slot, different name -> a second meal in the slot (O-1).
      {
        id: "entry-2",
        mealPlanId: "plan-1",
        recipeId: "recipe-2",
        date: "2026-08-28",
        mealType: "Dinner",
        servings: 3,
      },
      // No collision.
      {
        id: "entry-3",
        mealPlanId: "plan-1",
        recipeId: "recipe-2",
        date: "2026-08-29",
        mealType: "lunch",
        servings: 4,
      },
      // Not a canonical meal type -> skipped, never coerced.
      {
        id: "entry-4",
        mealPlanId: "plan-1",
        recipeId: "recipe-1",
        date: "2026-08-30",
        mealType: "Brunch",
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
        ingredientName: " tomato ",
        amount: 500,
        unit: "g",
        checked: false,
        recipeId: "recipe-1",
      },
      {
        id: "item-2",
        shoppingListId: "list-1",
        ingredientName: "Milk",
        checked: true,
        recipeId: "recipe-not-exported",
      },
      {
        id: "item-3",
        shoppingListId: "list-1",
        ingredientName: "   ",
        checked: false,
      },
    ],
  };

  it("writes only canonical tables, links/skips per the rules, and a re-import creates 0 rows", async () => {
    const existing = await prisma.familyMeal.create({
      data: {
        family_id: FAM,
        date: DAY,
        meal_type: "dinner",
        recipe_name: "  pasta ",
        created_by: PARENT,
      },
    });
    const options = {
      familyId: FAM,
      startedBy: PARENT,
      sourceUserToTargetUser: { "owner-1": PARENT },
      dryRun: false,
    };

    const first = await importMealPlanner(exportData, options);
    expect(first.summary.created).toEqual({
      Ingredient: 1,
      Recipe: 2,
      RecipeIngredient: 1,
      FamilyMeal: 2,
      List: 1,
      ListItem: 2,
    });
    expect(first.summary.linked).toEqual({ FamilyMeal: 1 });
    expect(first.summary.archived).toEqual({ MealPlan: 1 });
    expect(first.summary.mealPlans).toEqual([
      {
        sourceId: "plan-1",
        name: "Week",
        startDate: "2026-08-24T00:00:00.000Z",
        endDate: "2026-08-30T00:00:00.000Z",
      },
    ]);
    expect(first.summary.skipped.map((s) => s.sourceId).sort()).toEqual([
      "entry-4",
      "item-3",
    ]);
    expect(first.summary.nulled).toEqual([
      expect.objectContaining({ sourceId: "item-2", field: "recipe_id" }),
    ]);

    // No legacy row was written.
    expect(await legacyCounts(FAM)).toEqual({
      plans: 0,
      entries: 0,
      lists: 0,
      items: 0,
    });

    const pasta = await prisma.recipe.findFirstOrThrow({
      where: { family_id: FAM, title: "Pasta" },
    });
    const curry = await prisma.recipe.findFirstOrThrow({
      where: { family_id: FAM, title: "Curry" },
    });
    const tomato = await prisma.ingredient.findFirstOrThrow({
      where: { family_id: FAM, name: "Tomato" },
    });

    // The live meal is linked, not duplicated; its name is kept.
    const linked = await prisma.familyMeal.findUniqueOrThrow({
      where: { id: existing.id },
    });
    expect(linked).toMatchObject({
      recipe_id: pasta.id,
      recipe_name: "  pasta ",
    });

    const meals = await prisma.familyMeal.findMany({
      where: { family_id: FAM },
      orderBy: [{ date: "asc" }, { created_at: "asc" }],
    });
    expect(
      meals.map((m) => [
        m.date.toISOString().slice(0, 10),
        m.meal_type,
        m.recipe_name,
        m.recipe_id,
        m.servings,
      ]),
    ).toEqual([
      ["2026-08-28", "dinner", "  pasta ", pasta.id, null],
      ["2026-08-28", "dinner", "Curry", curry.id, 3],
      ["2026-08-29", "lunch", "Curry", curry.id, 4],
    ]);
    expect(meals.every((m) => m.created_by === PARENT)).toBe(true);

    const list = await prisma.list.findFirstOrThrow({
      where: { family_id: FAM },
      include: { items: { orderBy: { position: "asc" } } },
    });
    expect(list).toMatchObject({
      name: "Groceries",
      type: "grocery",
      description: "Imported from Meal Planner",
      created_by: PARENT,
    });
    expect(
      list.items.map((i) => ({
        content: i.content,
        amount: i.amount,
        unit: i.unit,
        checked: i.checked,
        checked_by: i.checked_by,
        source: i.source,
        source_key: i.source_key,
        recipe_id: i.recipe_id,
        ingredient_id: i.ingredient_id,
        added_by: i.added_by,
        position: i.position,
      })),
    ).toEqual([
      {
        content: "tomato",
        amount: 500,
        unit: "g",
        checked: false,
        checked_by: null,
        source: "import",
        source_key: null,
        recipe_id: pasta.id,
        ingredient_id: tomato.id,
        added_by: PARENT,
        position: 1,
      },
      {
        content: "Milk",
        amount: null,
        unit: null,
        checked: true,
        checked_by: null,
        source: "import",
        source_key: null,
        recipe_id: null,
        ingredient_id: null,
        added_by: PARENT,
        position: 2,
      },
    ]);

    const before = await canonicalCounts(FAM);
    const second = await importMealPlanner(exportData, options);
    expect(second.summary.created).toEqual({});
    expect(second.summary.linked).toEqual({});
    expect(second.summary.archived).toEqual({});
    expect(second.summary.reused).toEqual({
      Ingredient: 1,
      Recipe: 2,
      RecipeIngredient: 1,
      MealPlan: 1,
      MealPlanEntry: 3,
      ShoppingList: 1,
      ShoppingItem: 2,
    });
    expect(await canonicalCounts(FAM)).toEqual(before);
    expect(await legacyCounts(FAM)).toEqual({
      plans: 0,
      entries: 0,
      lists: 0,
      items: 0,
    });
    // Nothing leaked into another household.
    expect(await canonicalCounts(OTHER_FAM)).toEqual({
      meals: 0,
      lists: 0,
      items: 0,
      recipes: 0,
      ingredients: 0,
    });
  });

  it("honours mappings the pre-retarget importer wrote into legacy tables: re-import creates 0 rows", async () => {
    // What the old importer left behind for exportData: legacy rows plus
    // ImportedRecord mappings whose target_model is a legacy table.
    const recipe1 = await prisma.recipe.create({
      data: {
        family_id: LEGACY_FAM,
        title: "Pasta",
        created_by: LEGACY_PARENT,
      },
    });
    const recipe2 = await prisma.recipe.create({
      data: {
        family_id: LEGACY_FAM,
        title: "Curry",
        created_by: LEGACY_PARENT,
      },
    });
    const ingredient = await prisma.ingredient.create({
      data: { family_id: LEGACY_FAM, name: "Tomato", unit: "g" },
    });
    const link = await prisma.recipeIngredient.create({
      data: {
        recipe_id: recipe1.id,
        ingredient_id: ingredient.id,
        amount: 250,
      },
    });
    const plan = await prisma.mealPlan.create({
      data: {
        family_id: LEGACY_FAM,
        name: "Week",
        start_date: new Date("2026-08-24"),
        end_date: new Date("2026-08-30"),
        created_by: LEGACY_PARENT,
      },
    });
    const entries = await Promise.all(
      [
        ["entry-1", recipe1.id, "2026-08-28", "dinner"],
        ["entry-2", recipe2.id, "2026-08-28", "lunch"],
        ["entry-3", recipe2.id, "2026-08-29", "lunch"],
      ].map(async ([sourceId, recipeId, day, type]) => ({
        sourceId,
        row: await prisma.mealPlanEntry.create({
          data: {
            meal_plan_id: plan.id,
            recipe_id: recipeId,
            date: new Date(day),
            meal_type: type,
          },
        }),
      })),
    );
    const shoppingList = await prisma.shoppingList.create({
      data: {
        family_id: LEGACY_FAM,
        name: "Groceries",
        created_by: LEGACY_PARENT,
      },
    });
    const shoppingItems = await Promise.all(
      ["item-1", "item-2"].map(async (sourceId) => ({
        sourceId,
        row: await prisma.shoppingItem.create({
          data: {
            shopping_list_id: shoppingList.id,
            ingredient_name: sourceId,
          },
        }),
      })),
    );
    const job = await prisma.importJob.create({
      data: {
        family_id: LEGACY_FAM,
        source_app: "meal-planner",
        status: "completed",
        dry_run: false,
        started_by: LEGACY_PARENT,
      },
    });
    const map = (
      source_model: string,
      source_id: string,
      target_model: string,
      target_id: string,
    ) => ({
      family_id: LEGACY_FAM,
      import_job_id: job.id,
      source_app: "meal-planner",
      source_model,
      source_id,
      target_model,
      target_id,
    });
    await prisma.importedRecord.createMany({
      data: [
        map("Recipe", "recipe-1", "Recipe", recipe1.id),
        map("Recipe", "recipe-2", "Recipe", recipe2.id),
        map("Ingredient", "ingredient-1", "Ingredient", ingredient.id),
        map("RecipeIngredient", "link-1", "RecipeIngredient", link.id),
        map("MealPlan", "plan-1", "MealPlan", plan.id),
        ...entries.map((e) =>
          map("MealPlanEntry", e.sourceId, "MealPlanEntry", e.row.id),
        ),
        map("ShoppingList", "list-1", "ShoppingList", shoppingList.id),
        ...shoppingItems.map((i) =>
          map("ShoppingItem", i.sourceId, "ShoppingItem", i.row.id),
        ),
      ],
    });
    // The old importer skipped entry-4 (Brunch has a plan and recipe, so it
    // was imported as a legacy entry too) - map it as well.
    const brunch = await prisma.mealPlanEntry.create({
      data: {
        meal_plan_id: plan.id,
        recipe_id: recipe1.id,
        date: new Date("2026-08-30"),
        meal_type: "brunch",
      },
    });
    await prisma.importedRecord.create({
      data: map("MealPlanEntry", "entry-4", "MealPlanEntry", brunch.id),
    });

    const legacyBefore = await legacyCounts(LEGACY_FAM);
    const canonicalBefore = await canonicalCounts(LEGACY_FAM);
    const options = {
      familyId: LEGACY_FAM,
      startedBy: LEGACY_PARENT,
      sourceUserToTargetUser: { "owner-1": LEGACY_PARENT },
      dryRun: false,
    };

    const again = await importMealPlanner(exportData, options);
    expect(again.summary.created).toEqual({});
    expect(again.summary.linked).toEqual({});
    expect(again.summary.archived).toEqual({});
    expect(again.summary.reused).toMatchObject({
      MealPlan: 1,
      MealPlanEntry: 4,
      ShoppingList: 1,
      ShoppingItem: 2,
    });
    expect(await canonicalCounts(LEGACY_FAM)).toEqual(canonicalBefore);
    expect(await legacyCounts(LEGACY_FAM)).toEqual(legacyBefore);

    // A new export (new source ids) writes only canonical tables. A new item
    // on the list the old importer put in the legacy table is reported, not
    // written anywhere.
    const fresh = {
      ...exportData,
      mealPlans: [{ ...exportData.mealPlans[0], id: "plan-2" }],
      mealPlanEntries: [
        {
          ...exportData.mealPlanEntries[2],
          id: "entry-10",
          mealPlanId: "plan-2",
        },
      ],
      shoppingLists: [
        ...exportData.shoppingLists,
        { ...exportData.shoppingLists[0], id: "list-2", name: "Party" },
      ],
      shoppingItems: [
        {
          ...exportData.shoppingItems[0],
          id: "item-10",
          shoppingListId: "list-2",
        },
        {
          ...exportData.shoppingItems[1],
          id: "item-11",
          shoppingListId: "list-1",
        },
      ],
    };
    const next = await importMealPlanner(fresh, options);
    expect(next.summary.created).toEqual({
      FamilyMeal: 1,
      List: 1,
      ListItem: 1,
    });
    expect(next.summary.archived).toEqual({ MealPlan: 1 });
    expect(next.summary.skipped).toEqual([
      expect.objectContaining({ sourceId: "item-11" }),
    ]);
    expect(await legacyCounts(LEGACY_FAM)).toEqual(legacyBefore);
    const after = await canonicalCounts(LEGACY_FAM);
    expect(after.meals).toBe(canonicalBefore.meals + 1);
    expect(after.lists).toBe(canonicalBefore.lists + 1);
    expect(after.items).toBe(canonicalBefore.items + 1);

    const planMapping = await prisma.importedRecord.findFirstOrThrow({
      where: {
        family_id: LEGACY_FAM,
        source_model: "MealPlan",
        source_id: "plan-2",
      },
    });
    expect(planMapping).toMatchObject({
      target_model: "ImportJob",
      target_id: next.jobId,
    });
  });

  it("drops a recipe deleted since the earlier import instead of failing", async () => {
    const options = {
      familyId: OTHER_FAM,
      startedBy: OTHER_PARENT,
      sourceUserToTargetUser: { "owner-1": OTHER_PARENT },
      dryRun: false,
    };
    const only = {
      version: "1",
      recipes: [exportData.recipes[0]],
      ingredients: exportData.ingredients,
    };
    await importMealPlanner(only, options);
    await prisma.recipe.deleteMany({ where: { family_id: OTHER_FAM } });
    const later = await importMealPlanner(
      {
        ...only,
        recipeIngredients: exportData.recipeIngredients,
        mealPlans: exportData.mealPlans,
        mealPlanEntries: [exportData.mealPlanEntries[0]],
      },
      options,
    );
    expect(later.summary.created).toEqual({});
    expect(later.summary.skipped.map((s) => s.sourceId).sort()).toEqual([
      "entry-1",
      "link-1",
    ]);
    expect(
      await prisma.familyMeal.count({ where: { family_id: OTHER_FAM } }),
    ).toBe(0);
  });
});
