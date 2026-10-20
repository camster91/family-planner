/** Source for consolidated QA only; explicitly allow a disposable database. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  createMealWithReceipt,
  confirmCreatedMeal,
  MEAL_CREATE_ACTION,
} from "@/lib/meal-create";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";
import {
  mealCreateInput,
  type MealCreateInput,
} from "@/lib/meal-create-contract";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("ordinary meal atomic confirmation", () => {
  const familyId = `fx_meal_create_${crypto.randomUUID()}`;
  const userId = `${familyId}_parent`;
  const actor = { familyId, userId, tokenVersion: 0 };
  const input = (): MealCreateInput =>
    mealCreateInput.parse({
      protocol: "herewoven.meal-create.v1",
      expected_user_id: userId,
      expected_family_id: familyId,
      issued_at: new Date().toISOString(),
      date: "2026-10-19",
      meal_type: "dinner",
      recipe_name: "Fixture dinner",
      servings: 4,
    });
  async function receipt(body: MealCreateInput) {
    return prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: MEAL_CREATE_ACTION,
        request_hash: hashIdempotentRequest(MEAL_CREATE_ACTION, body),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.create({
      data: {
        id: familyId,
        name: "Meal create fixture",
        features: { meals: true },
      },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        family_id: familyId,
        role: "parent",
        email: `${userId}@example.invalid`,
        name: "Fixture parent",
      },
    });
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({ where: { id: familyId } });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("commits one meal and pointer receipt through simultaneous recovery attempts", async () => {
    const body = input();
    const r = await receipt(body);
    const results = await Promise.all([
      createMealWithReceipt(prisma!, actor, body, r.id),
      createMealWithReceipt(prisma!, actor, body, r.id),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    const saved = await prisma!.idempotencyRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(saved.response_status).toBe(201);
    expect(saved.response_body).toEqual(results[0].body);
    const id = (results[0].body as { mealId: string }).mealId;
    expect(
      await prisma!.familyMeal.count({ where: { id, family_id: familyId } }),
    ).toBe(1);
    await prisma!.familyMeal.delete({ where: { id } });
    const replay = await createMealWithReceipt(prisma!, actor, body, r.id);
    expect((await confirmCreatedMeal(prisma!, actor, replay)).status).toBe(409);
    expect(await prisma!.familyMeal.count({ where: { id } })).toBe(0);
  });
  it("refuses changed actor, family, token and over-age requests before creating a meal", async () => {
    for (const change of [
      { expected_family_id: "foreign_fixture" },
      { expected_user_id: "foreign_actor" },
      { issued_at: new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString() },
    ]) {
      const body = { ...input(), ...change };
      const r = await receipt(body);
      expect(
        (await createMealWithReceipt(prisma!, actor, body, r.id)).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await prisma!.idempotencyRecord.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).response_status,
      ).toBeNull();
    }
    const body = input();
    const r = await receipt(body);
    expect(
      (
        await createMealWithReceipt(
          prisma!,
          { ...actor, tokenVersion: 1 },
          body,
          r.id,
        )
      ).status,
    ).toBe(401);
  });
  it("rolls a created meal and its receipt back together when the transaction fails", async () => {
    const body = input();
    const r = await receipt(body);
    const before = await prisma!.familyMeal.count({
      where: { family_id: familyId },
    });
    const failingDb = {
      $transaction: (
        operation: (
          tx: import("@prisma/client").Prisma.TransactionClient,
        ) => Promise<unknown>,
      ) =>
        prisma!.$transaction(async (tx) => {
          await operation(tx);
          throw new Error("Fixture transaction failure");
        }),
    } as Pick<NonNullable<typeof prisma>, "$transaction">;
    await expect(
      createMealWithReceipt(failingDb, actor, body, r.id),
    ).rejects.toThrow("Fixture transaction failure");
    expect(
      await prisma!.familyMeal.count({ where: { family_id: familyId } }),
    ).toBe(before);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).response_status,
    ).toBeNull();
  });
  it("does not use an unrelated receipt or a missing recipe or cook", async () => {
    const body = input();
    const unrelated = await receipt({ ...body, servings: 3 });
    expect(
      (await createMealWithReceipt(prisma!, actor, body, unrelated.id)).status,
    ).toBe(409);
    for (const change of [
      { recipe_id: "foreign_or_missing_recipe" },
      { cook_id: "foreign_or_missing_cook" },
    ]) {
      const invalid = { ...body, ...change };
      const r = await receipt(invalid);
      expect(
        (await createMealWithReceipt(prisma!, actor, invalid, r.id)).status,
      ).toBe(400);
      expect(
        (
          await prisma!.idempotencyRecord.findUniqueOrThrow({
            where: { id: r.id },
          })
        ).response_status,
      ).toBeNull();
    }
  });
});
