/** Source for the later consolidated run, on an explicitly disposable DB. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  inventoryIntakeInput,
  type InventoryIntakeInput,
} from "@/lib/inventory-intake-contract";
import {
  persistInventoryIntake,
  confirmInventoryIntake,
  INVENTORY_INTAKE_ACTION,
} from "@/lib/inventory-intake";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("canonical reviewed stock intake", () => {
  const familyId = `fx_intake_${crypto.randomUUID()}`;
  const userId = `${familyId}_parent`;
  const actor = { userId, familyId, tokenVersion: 0 };
  const input = () =>
    inventoryIntakeInput.parse({
      protocol: "herewoven.inventory-intake.v1",
      expected_user_id: userId,
      expected_family_id: familyId,
      issued_at: new Date().toISOString(),
      item: {
        name: "Fixture beans",
        amount: 2,
        unit: "cans",
        location: "pantry",
        expires_on: "2027-10-19",
        date_kind: "best_before",
      },
    });
  async function receipt(body: InventoryIntakeInput) {
    return prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: INVENTORY_INTAKE_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_INTAKE_ACTION, body),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.create({
      data: {
        id: familyId,
        name: "Intake fixture",
        features: { inventory: true },
      },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        family_id: familyId,
        name: "Fixture parent",
        role: "parent",
        email: `${userId}@example.invalid`,
      },
    });
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({ where: { id: familyId } });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("serializes concurrent recovery to one canonical item and never recreates a deleted item", async () => {
    const body = input();
    const r = await receipt(body);
    const results = await Promise.all([
      persistInventoryIntake(prisma!, actor, body, r.id),
      persistInventoryIntake(prisma!, actor, body, r.id),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    const itemId = (results[0].body as { itemId: string }).itemId;
    expect(
      await prisma!.inventoryItem.count({
        where: { id: itemId, family_id: familyId },
      }),
    ).toBe(1);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).response_body,
    ).toEqual({ itemId });
    await prisma!.inventoryItem.delete({ where: { id: itemId } });
    const replay = await persistInventoryIntake(prisma!, actor, body, r.id);
    expect((await confirmInventoryIntake(prisma!, actor, replay)).body).toEqual(
      { error: { code: "INTAKE_ITEM_REMOVED" } },
    );
    expect(await prisma!.inventoryItem.count({ where: { id: itemId } })).toBe(
      0,
    );
  });
  it("rolls stock and receipt back together when transaction completion fails", async () => {
    const body = input();
    const r = await receipt(body);
    const before = await prisma!.inventoryItem.count({
      where: { family_id: familyId },
    });
    const failing = {
      $transaction: (
        operation: (
          tx: import("@prisma/client").Prisma.TransactionClient,
        ) => Promise<unknown>,
      ) =>
        prisma!.$transaction(async (tx) => {
          await operation(tx);
          throw new Error("Fixture commit failure");
        }),
    } as unknown as Pick<NonNullable<typeof prisma>, "$transaction">;
    await expect(
      persistInventoryIntake(failing, actor, body, r.id),
    ).rejects.toThrow("Fixture commit failure");
    expect(
      await prisma!.inventoryItem.count({ where: { family_id: familyId } }),
    ).toBe(before);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).response_status,
    ).toBeNull();
  });
  it("refuses actor/family/role/session/expired intent before creating stock", async () => {
    const body = input();
    const r = await receipt(body);
    expect(
      (
        await persistInventoryIntake(
          prisma!,
          { ...actor, tokenVersion: 1 },
          body,
          r.id,
        )
      ).status,
    ).toBe(401);
    for (const change of [
      { expected_family_id: "foreign_fixture" },
      { expected_user_id: "foreign_user" },
      { issued_at: new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString() },
    ]) {
      const draft = { ...body, ...change };
      const record = await receipt(draft);
      expect(
        (await persistInventoryIntake(prisma!, actor, draft, record.id)).status,
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await prisma!.idempotencyRecord.findUniqueOrThrow({
            where: { id: record.id },
          })
        ).response_status,
      ).toBeNull();
    }
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "child" },
    });
    expect(
      (await persistInventoryIntake(prisma!, actor, body, r.id)).status,
    ).toBe(403);
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "parent" },
    });
  });
});
