/** Authored/unrun. Requires an explicitly allowed disposable PostgreSQL target. */
import crypto from "node:crypto";
import { prisma } from "../../prisma";
import { assertFixtureTargetAllowed } from "../../fixtures/guard";
import { hashIdempotentRequest } from "../../idempotency";
import { prepAction, prepCommand, PREP_RECOVERY } from "../contract";
import { persistOwnedPrep } from "../server";
jest.mock("../owner", () => ({ prepRecoveryEnabled: jest.fn(() => true) }));
import { prepRecoveryEnabled } from "../owner";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("owned bulk transaction rollback", () => {
  const familyId = `owned-prep-${crypto.randomUUID()}`,
    userId = `${familyId}-parent`;
  const actor = { familyId, userId, role: "parent", generation: 0 };
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.create({
      data: { id: familyId, name: "Isolated owned prep QA" },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        email: `${userId}@example.invalid`,
        name: "QA Parent",
        family_id: familyId,
        role: "parent",
        email_verified: true,
      },
    });
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({ where: { id: familyId } });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("rolls back canonical rows and success receipt if readiness changes before commit", async () => {
    const command = prepCommand.parse({
      protocol: PREP_RECOVERY,
      kind: "create",
      generation: 0,
      role: "parent",
      issuedAt: new Date().toISOString(),
      input: {
        expected_user_id: userId,
        expected_family_id: familyId,
        prepared_on: "2026-10-22",
        next_prep_on: null,
        dishes: [
          {
            name: "Synthetic rice",
            total_servings: 2,
            reserve_storage: "fridge",
            meals: [{ date: "2026-10-23", meal_type: "dinner", servings: 1 }],
          },
        ],
      },
    });
    const record = await prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: prepAction(command),
        request_hash: hashIdempotentRequest(prepAction(command), command),
        expires_at: new Date(Date.now() + 86400000),
      },
    });
    jest
      .mocked(prepRecoveryEnabled)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    await expect(
      persistOwnedPrep(prisma!, actor, command, record.id),
    ).rejects.toThrow();
    expect(
      await prisma!.mealPrepSession.count({ where: { family_id: familyId } }),
    ).toBe(0);
    expect(
      await prisma!.familyMeal.count({ where: { family_id: familyId } }),
    ).toBe(0);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: record.id },
        })
      ).response_status,
    ).toBeNull();
    jest.mocked(prepRecoveryEnabled).mockReturnValue(true);
    expect(
      (await persistOwnedPrep(prisma!, actor, command, record.id)).status,
    ).toBe(201);
    expect(
      await prisma!.mealPrepSession.count({ where: { family_id: familyId } }),
    ).toBe(1);
    expect(
      await prisma!.familyMeal.count({ where: { family_id: familyId } }),
    ).toBe(1);
    expect(
      (await persistOwnedPrep(prisma!, actor, command, record.id)).status,
    ).toBe(201);
    expect(
      await prisma!.familyMeal.count({ where: { family_id: familyId } }),
    ).toBe(1);
  });
});
