/** Authored for the consolidated disposable-DB pass; never production fixtures. */
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  inventoryChangeInput,
  type InventoryChangeInput,
  type InventoryChangeOperation,
} from "../inventory-change-contract";
import {
  persistInventoryChange,
  confirmInventoryChange,
  INVENTORY_CHANGE_ACTION,
} from "../inventory-change";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "../idempotency";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("atomic reviewed inventory changes", () => {
  const familyId = `fx_change_${crypto.randomUUID()}`,
    otherId = `${familyId}_other`,
    userId = `${familyId}_parent`;
  const actor = { userId, familyId, tokenVersion: 0 };
  const input = (operation: InventoryChangeOperation) =>
    inventoryChangeInput.parse({
      protocol: "herewoven.inventory-change.v1",
      expected_user_id: userId,
      expected_family_id: familyId,
      issued_at: new Date().toISOString(),
      operation,
    });
  const stock = (household = familyId) =>
    prisma!.inventoryItem.create({
      data: {
        family_id: household,
        name: "Fixture beans",
        amount: 2,
        unit: "cans",
        location: "pantry",
        added_by: userId,
      },
    });
  async function receipt(body: InventoryChangeInput) {
    return prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: INVENTORY_CHANGE_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_CHANGE_ACTION, body),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  }
  async function execute(body: InventoryChangeInput) {
    const r = await receipt(body);
    return persistInventoryChange(prisma!, actor, body, r.id);
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.createMany({
      data: [
        { id: familyId, name: "Stock fixture", features: { inventory: true } },
        { id: otherId, name: "Other fixture", features: { inventory: true } },
      ],
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
    await prisma!.family.deleteMany({
      where: { id: { in: [familyId, otherId] } },
    });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("serializes duplicate recovery, keeps a compact receipt and refuses a new stale-version deduction", async () => {
    const item = await stock();
    const body = input({
      kind: "consume",
      item_id: item.id,
      expected_version: item.updated_at.toISOString(),
      amount: 0.5,
    });
    const r = await receipt(body);
    const results = await Promise.all([
      persistInventoryChange(prisma!, actor, body, r.id),
      persistInventoryChange(prisma!, actor, body, r.id),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0].body).toEqual(results[1].body);
    expect(
      (
        await prisma!.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).amount,
    ).toBe(1.5);
    expect(
      await prisma!.inventoryAdjustment.count({ where: { item_id: item.id } }),
    ).toBe(1);
    expect((await execute(body)).body).toEqual({
      error: { code: "CHANGE_CONFLICT" },
    });
    expect(results[0].body).not.toHaveProperty("amount");
    const saved = await prisma!.idempotencyRecord.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(saved.response_body).toEqual(results[0].body);
    await prisma!.inventoryItem.delete({ where: { id: item.id } });
    expect(
      (await confirmInventoryChange(prisma!, actor, results[0])).body,
    ).toEqual({ error: { code: "CHANGE_ORIGINAL_REMOVED" } });
  });
  it("rolls stock, history and confirmation back together when the transaction fails", async () => {
    const item = await stock();
    const body = input({
      kind: "discard",
      item_id: item.id,
      expected_version: item.updated_at.toISOString(),
    });
    const r = await receipt(body);
    const failing = {
      $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        prisma!.$transaction(async (tx) => {
          await run(tx);
          throw new Error("fixture commit failure");
        }),
    } as unknown as Pick<NonNullable<typeof prisma>, "$transaction">;
    await expect(
      persistInventoryChange(failing, actor, body, r.id),
    ).rejects.toThrow("fixture commit failure");
    expect(
      (
        await prisma!.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).status,
    ).toBe("active");
    expect(
      await prisma!.inventoryAdjustment.count({ where: { item_id: item.id } }),
    ).toBe(0);
    expect(
      (
        await prisma!.idempotencyRecord.findUniqueOrThrow({
          where: { id: r.id },
        })
      ).response_status,
    ).toBeNull();
  });
  it("restores one unchanged adjustment once and refuses Undo after a later item edit", async () => {
    const item = await stock();
    const changed = await execute(
      input({
        kind: "consume",
        item_id: item.id,
        expected_version: item.updated_at.toISOString(),
        amount: 0.5,
      }),
    );
    const adjustmentId = (changed.body as { adjustmentId: string })
      .adjustmentId;
    const undo = input({ kind: "undo", adjustment_id: adjustmentId });
    const r = await receipt(undo);
    expect(
      (await persistInventoryChange(prisma!, actor, undo, r.id)).status,
    ).toBe(200);
    expect(
      (await persistInventoryChange(prisma!, actor, undo, r.id)).status,
    ).toBe(200);
    expect(
      (
        await prisma!.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).amount,
    ).toBe(2);
    const now = await prisma!.inventoryItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const later = await execute(
      input({
        kind: "discard",
        item_id: item.id,
        expected_version: now.updated_at.toISOString(),
      }),
    );
    await prisma!.inventoryItem.update({
      where: { id: item.id },
      data: { name: "Later edit", updated_at: new Date(Date.now() + 1000) },
    });
    expect(
      (
        await execute(
          input({
            kind: "undo",
            adjustment_id: (later.body as { adjustmentId: string })
              .adjustmentId,
          }),
        )
      ).body,
    ).toEqual({ error: { code: "CHANGE_CONFLICT" } });
  });
  it("refuses foreign targets, excessive amounts, revoked sessions, role changes and expired intent", async () => {
    const foreign = await stock(otherId);
    const item = await stock();
    expect(
      (
        await execute(
          input({
            kind: "discard",
            item_id: foreign.id,
            expected_version: foreign.updated_at.toISOString(),
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await execute(
          input({
            kind: "consume",
            item_id: item.id,
            expected_version: item.updated_at.toISOString(),
            amount: 3,
          }),
        )
      ).body,
    ).toEqual({ error: { code: "CHANGE_AMOUNT_INVALID" } });
    const body = input({
      kind: "discard",
      item_id: item.id,
      expected_version: item.updated_at.toISOString(),
    });
    const r = await receipt(body);
    expect(
      (
        await persistInventoryChange(
          prisma!,
          { ...actor, tokenVersion: 1 },
          body,
          r.id,
        )
      ).status,
    ).toBe(401);
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "child" },
    });
    expect(
      (await persistInventoryChange(prisma!, actor, body, r.id)).status,
    ).toBe(403);
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "parent" },
    });
    const expired = {
      ...body,
      issued_at: new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString(),
    };
    expect((await execute(expired)).body).toEqual({
      error: { code: "CHANGE_INTENT_EXPIRED" },
    });
    expect(
      (
        await prisma!.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).status,
    ).toBe("active");
  });
});
