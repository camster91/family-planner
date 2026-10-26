/** Atomic create/receipt and fresh projection, disposable Postgres only; not run in this pass. */
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  createRecipeWithReceipt,
  readCreatedRecipe,
  RECIPE_CREATE_ACTION,
} from "@/lib/recipe-write";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("recipe create replay containment", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  const family = "fx_recipe_receipt_family";
  const user = "fx_recipe_receipt_parent";
  const actor = { familyId: family, userId: user, tokenVersion: 0 };
  const input = {
    creation_protocol: "herewoven.recipe-create.v1" as const,
    title: "Fixture soup",
    instructions: "Fixture method. ".repeat(800),
    ingredients: [{ name: "Fixture onion", amount: 2 }],
  };
  async function cleanup() {
    await db.family.deleteMany({ where: { id: family } });
    await db.user.deleteMany({ where: { id: user } });
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    const client = (await import("@/lib/prisma")).prisma;
    if (!client) throw new Error("Disposable database required");
    db = client;
  });
  beforeEach(async () => {
    await cleanup();
    await db.family.create({
      data: {
        id: family,
        name: "Fixture recipe household",
        invite_code: "fx_recipe_receipt_invite",
        features: { meals: true },
      },
    });
    await db.user.create({
      data: {
        id: user,
        family_id: family,
        email: "recipe-fixture@example.test",
        role: "parent",
        name: "Fixture parent",
      },
    });
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });
  async function receipt() {
    return db.idempotencyRecord.create({
      data: {
        scope: `user:${user}`,
        key: "fx_recipe_receipt_stable_key",
        family_id: family,
        user_id: user,
        action: RECIPE_CREATE_ACTION,
        request_hash: hashIdempotentRequest(RECIPE_CREATE_ACTION, input),
        expires_at: new Date(Date.now() + 86400000),
      },
    });
  }
  // Authored UNRUN; requires the existing food source identity migration/trigger.
  it("hydrates only the stored insertion generation for an ordinary create response", async () => {
    const result = await createRecipeWithReceipt(db, actor, input, null);
    const identity = result.body as { recipeId: string; recipeGeneration: string };
    expect(identity.recipeGeneration).toMatch(/^[a-f0-9-]{36}$/i);
    expect((await readCreatedRecipe(db, actor, identity.recipeId, identity.recipeGeneration)).status).toBe(200);
    expect((await readCreatedRecipe(db, actor, identity.recipeId, '00000000-0000-4000-8000-000000000000')).status).toBe(409);
  });
  // Authored UNRUN: new command-body provenance participates in existing hashing.
  it("does not let a new generation adopt an older owner-bound create body", async () => {
    const bound = { ...input, creation_owner: { protocol: 'herewoven.recipe-owner.v1' as const,
      actorId: user, familyId: family, role: 'parent', generation: 0 } };
    expect(hashIdempotentRequest(RECIPE_CREATE_ACTION, bound)).not.toBe(hashIdempotentRequest(RECIPE_CREATE_ACTION,
      { ...bound, creation_owner: { ...bound.creation_owner, generation: 1 } }));
    expect((await createRecipeWithReceipt(db, actor, bound, null)).status).toBe(201);
    await db.user.update({ where: { id: user }, data: { token_version: 1 } });
    expect((await createRecipeWithReceipt(db, { ...actor, tokenVersion: 1 }, bound, null)).status).toBe(409);
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(1);
  });
  it("concurrent exact retries create one recipe and one ingredient set, even with a long method", async () => {
    const record = await receipt();
    const results = await Promise.all([
      createRecipeWithReceipt(db, actor, input, record.id),
      createRecipeWithReceipt(db, actor, input, record.id),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(1);
    const saved = await db.idempotencyRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(saved.response_status).toBe(201);
    expect(JSON.stringify(saved.response_body).length).toBeLessThan(512);
    const id = (results[0].body as { recipeId: string }).recipeId;
    const detail = await readCreatedRecipe(db, actor, id);
    expect((detail.body as any).recipe.instructions).toBe(input.instructions);
    expect((detail.body as any).recipe.ingredients).toHaveLength(1);
  });
  it("a lost-response retry does not resurrect a recipe deleted after the original save", async () => {
    const record = await receipt();
    const result = await createRecipeWithReceipt(db, actor, input, record.id);
    const id = (result.body as { recipeId: string }).recipeId;
    await db.recipe.delete({ where: { id } });
    expect(await createRecipeWithReceipt(db, actor, input, record.id)).toEqual(
      result,
    );
    expect((await readCreatedRecipe(db, actor, id)).status).toBe(409);
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(0);
  });
  it("retains a terminal source refusal so a delayed old create cannot run after the draft resumes", async () => {
    const sourced = {
      ...input,
      source_url: "https://example.com/fixture-soup",
    };
    const created = await createRecipeWithReceipt(db, actor, sourced, null);
    const existingId = (created.body as { recipeId: string }).recipeId;
    const record = await db.idempotencyRecord.create({
      data: {
        scope: `user:${user}`,
        key: "fx_recipe_refused_stable_key",
        family_id: family,
        user_id: user,
        action: RECIPE_CREATE_ACTION,
        request_hash: hashIdempotentRequest(RECIPE_CREATE_ACTION, sourced),
        expires_at: new Date(Date.now() + 86400000),
      },
    });
    expect(
      (await createRecipeWithReceipt(db, actor, sourced, record.id, true))
        .status,
    ).toBe(409);
    const saved = await db.idempotencyRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(saved.response_status).toBe(409);
    expect(saved.response_body).toEqual({
      error: { code: "RECIPE_SOURCE_EXISTS" },
    });
    await db.recipe.delete({ where: { id: existingId } });
    // Source no longer exists, but the OLD exact request remains terminal.
    expect(
      await createRecipeWithReceipt(db, actor, sourced, record.id, true),
    ).toEqual({
      status: 409,
      body: { error: { code: "RECIPE_SOURCE_EXISTS" } },
    });
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(0);
  });
  it("revoked session generations cannot hydrate or replay private recipe content", async () => {
    const record = await receipt();
    const result = await createRecipeWithReceipt(db, actor, input, record.id);
    await db.user.update({ where: { id: user }, data: { token_version: 1 } });
    expect(
      (await createRecipeWithReceipt(db, actor, input, record.id)).status,
    ).toBe(401);
    expect(
      (
        await readCreatedRecipe(
          db,
          actor,
          (result.body as { recipeId: string }).recipeId,
        )
      ).status,
    ).toBe(401);
  });
  it("a failed receipt completion rolls back the recipe and resolved ingredient rows", async () => {
    const record = await receipt();
    const broken = {
      $transaction: (run: any) =>
        db.$transaction((tx) =>
          run(
            new Proxy(tx, {
              get(target, field) {
                if (field === "idempotencyRecord")
                  return {
                    findFirst: target.idempotencyRecord.findFirst.bind(
                      target.idempotencyRecord,
                    ),
                    update: async () => {
                      throw new Error("Fixture receipt failure");
                    },
                  };
                const value = Reflect.get(target, field);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        ),
    } as unknown as Pick<typeof db, "$transaction">;
    await expect(
      createRecipeWithReceipt(broken, actor, input, record.id),
    ).rejects.toThrow("Fixture receipt failure");
    expect(await db.recipe.count({ where: { family_id: family } })).toBe(0);
    expect(await db.ingredient.count({ where: { family_id: family } })).toBe(0);
  });
});
