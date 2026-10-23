/** Source only for the consolidated run; use a guarded disposable database. */
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { createRecipeWithReceipt } from "@/lib/recipe-write";
import { curateRecipe, mutateCollection } from "@/lib/recipe-curation-server";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("recipe source identity and household curation", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  const family = "fx_recipe_curation_family";
  const other = "fx_recipe_curation_other";
  const user = "fx_recipe_curation_parent";
  const actor = { familyId: family, userId: user, tokenVersion: 0 };
  const input = {
    title: "Fixture soup",
    source_url: "https://recipes.example.test/soup",
  };
  async function clean() {
    await db.family.deleteMany({ where: { id: { in: [family, other] } } });
    await db.user.deleteMany({ where: { id: user } });
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    const client = (await import("@/lib/prisma")).prisma;
    if (!client) throw new Error("Disposable database required");
    db = client;
  });
  beforeEach(async () => {
    await clean();
    await db.family.createMany({
      data: [
        {
          id: family,
          name: "Fixture recipes",
          invite_code: "fx_recipe_curation_a",
          features: { meals: true },
        },
        {
          id: other,
          name: "Other fixture recipes",
          invite_code: "fx_recipe_curation_b",
        },
      ],
    });
    await db.user.create({
      data: {
        id: user,
        family_id: family,
        role: "parent",
        email: "curation-fixture@example.test",
        name: "Fixture parent",
      },
    });
  });
  afterAll(async () => {
    if (db) {
      await clean();
      await db.$disconnect();
    }
  });
  async function recipe() {
    const r = await createRecipeWithReceipt(db, actor, input, null);
    return (r.body as { recipeId: string }).recipeId;
  }
  async function collection(name = "Weeknight") {
    const r = await mutateCollection(db, actor, { action: "create", name });
    return (r.body as any).collection as {
      id: string;
      name: string;
      revision: number;
    };
  }
  it("serializes same-source imports and creates another row only for an explicit copy", async () => {
    const results = await Promise.all([
      createRecipeWithReceipt(db, actor, input, null),
      createRecipeWithReceipt(db, actor, input, null),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const first = await db.recipe.findFirstOrThrow({
      where: { family_id: family },
    });
    await db.recipe.update({
      where: { id: first.id },
      data: { title: "Family edited title" },
    });
    expect((await createRecipeWithReceipt(db, actor, input, null)).status).toBe(
      409,
    );
    expect(
      (
        await createRecipeWithReceipt(
          db,
          actor,
          { ...input, source_copy: true },
          null,
        )
      ).status,
    ).toBe(201);
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(2);
    expect(
      (await db.recipe.findUniqueOrThrow({ where: { id: first.id } })).title,
    ).toBe("Family edited title");
  });
  it("retains old description-only source imports without inventing a new recipe", async () => {
    await db.recipe.create({
      data: {
        family_id: family,
        created_by: user,
        title: "Old fixture",
        description:
          "Source: https://recipes.example.test/soup?utm_source=old\nFamily notes",
      },
    });
    expect((await createRecipeWithReceipt(db, actor, input, null)).status).toBe(
      409,
    );
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(1);
  });
  it("favorites and memberships preserve revision conflicts and delete only collection grouping", async () => {
    const id = await recipe(),
      c = await collection();
    const result = await curateRecipe(db, actor, id, {
      revision: 0,
      favorite: true,
      collectionIds: [c.id],
    });
    expect(result.status).toBe(200);
    expect(
      (
        await curateRecipe(db, actor, id, {
          revision: 0,
          favorite: false,
          collectionIds: [],
        })
      ).status,
    ).toBe(409);
    // Exact state retry converges without incrementing or overwriting again.
    expect(
      await curateRecipe(db, actor, id, {
        revision: 0,
        favorite: true,
        collectionIds: [c.id],
      }),
    ).toEqual(result);
    const rename = await mutateCollection(db, actor, {
      action: "rename",
      id: c.id,
      revision: 0,
      name: "Quick meals",
    });
    expect(rename.status).toBe(200);
    expect(
      (
        await mutateCollection(db, actor, {
          action: "delete",
          id: c.id,
          revision: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await mutateCollection(db, actor, {
          action: "delete",
          id: c.id,
          revision: 1,
        })
      ).status,
    ).toBe(200);
    expect(await db.recipe.count({ where: { id } })).toBe(1);
    expect(
      await db.recipeCollectionEntry.count({ where: { recipe_id: id } }),
    ).toBe(0);
    expect(
      (await db.recipe.findUniqueOrThrow({ where: { id } })).favorite,
    ).toBe(true);
  });
  it("refuses foreign collections in both application validation and composite database ownership", async () => {
    const id = await recipe();
    const foreign = await db.recipeCollection.create({
      data: {
        family_id: other,
        name: "Other private group",
        name_key: "other private group",
      },
    });
    expect(
      (
        await curateRecipe(db, actor, id, {
          revision: 0,
          favorite: true,
          collectionIds: [foreign.id],
        })
      ).status,
    ).toBe(404);
    await expect(
      db.recipeCollectionEntry.create({
        data: { recipe_id: id, collection_id: foreign.id, family_id: family },
      }),
    ).rejects.toBeDefined();
    expect(
      (await db.recipe.findUniqueOrThrow({ where: { id } })).favorite,
    ).toBe(false);
  });
  it("current child role cannot write household curation", async () => {
    const id = await recipe();
    await db.user.update({ where: { id: user }, data: { role: "child" } });
    expect(
      (
        await curateRecipe(db, actor, id, {
          revision: 0,
          favorite: true,
          collectionIds: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mutateCollection(db, actor, {
          action: "create",
          name: "Not permitted",
        })
      ).status,
    ).toBe(403);
  });
});
