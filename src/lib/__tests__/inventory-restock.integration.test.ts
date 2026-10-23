/** Authored only; run later against an explicitly disposable prepared database. */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";
import {
  restockInput,
  restockReceipt,
  INVENTORY_RESTOCK_ACTION,
  type RestockInput,
} from "../inventory-restock-contract";
import {
  persistInventoryRestock,
  confirmInventoryRestock,
  reviewInventoryRestock,
  undoInventoryRestock,
} from "../inventory-restock";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "../idempotency";
const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
suite("reviewed canonical inventory replacement restocking", () => {
  const familyId = `fx_restock_${crypto.randomUUID()}`,
    otherId = `${familyId}_other`,
    userId = `${familyId}_parent`;
  const actor = { userId, familyId, tokenVersion: 0 };
  let listId: string;
  const stock = (family_id = familyId) =>
    prisma!.inventoryItem.create({
      data: {
        family_id,
        name: "Fixture beans",
        amount: 0,
        unit: "cans",
        location: "pantry",
        status: "consumed",
        added_by: userId,
      },
    });
  const input = (item: { id: string; updated_at: Date }, extra = {}) =>
    restockInput.parse({
      protocol: "herewoven.inventory-restock.v1",
      expected_user_id: userId,
      expected_family_id: familyId,
      issued_at: new Date().toISOString(),
      item_id: item.id,
      expected_version: item.updated_at.toISOString(),
      list_id: listId,
      content: "Fixture replacement beans",
      amount: 3,
      unit: "cans",
      allow_similar: false,
      ...extra,
    });
  const receipt = (body: RestockInput) =>
    prisma!.idempotencyRecord.create({
      data: {
        scope: `user:${userId}`,
        key: crypto.randomUUID(),
        user_id: userId,
        family_id: familyId,
        action: INVENTORY_RESTOCK_ACTION,
        request_hash: hashIdempotentRequest(INVENTORY_RESTOCK_ACTION, body),
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    await prisma!.family.createMany({
      data: [
        {
          id: familyId,
          name: "Restock fixture",
          features: { inventory: true, lists: true },
        },
        {
          id: otherId,
          name: "Other fixture",
          features: { inventory: true, lists: true },
        },
      ],
    });
    await prisma!.user.create({
      data: {
        id: userId,
        family_id: familyId,
        role: "parent",
        name: "Fixture parent",
        email: `${userId}@example.invalid`,
      },
    });
    const list = await prisma!.list.create({
      data: {
        family_id: familyId,
        name: "Fixture groceries",
        type: "grocery",
        created_by: userId,
      },
    });
    listId = list.id;
  });
  afterAll(async () => {
    await prisma!.family.deleteMany({
      where: { id: { in: [familyId, otherId] } },
    });
    await prisma!.user.deleteMany({ where: { id: userId } });
    await prisma!.$disconnect();
  });
  it("serializes different keys to one open replacement and retains original purchase quantity/provenance", async () => {
    const item = await stock(),
      body = input(item),
      a = await receipt(body),
      b = await receipt(body);
    const results = await Promise.all([
      persistInventoryRestock(prisma!, actor, body, a.id),
      persistInventoryRestock(prisma!, actor, body, b.id),
    ]);
    const parsed = results.map((result) => restockReceipt.parse(result.body));
    expect(parsed.filter((row) => row.created)).toHaveLength(1);
    expect(parsed[0].itemId).toBe(parsed[1].itemId);
    const row = await prisma!.listItem.findUniqueOrThrow({
      where: { id: parsed[0].itemId },
    });
    expect(row.amount).toBe(3);
    expect(row.unit).toBe("cans");
    expect(row.source).toBe("manual");
    expect(row.source_key).toBe(`inventory:${item.id}`);
    expect(
      (
        await prisma!.inventoryItem.findUniqueOrThrow({
          where: { id: item.id },
        })
      ).amount,
    ).toBe(0);
    expect(
      await confirmInventoryRestock(prisma!, actor, results[0], body),
    ).toMatchObject({ status: 201 });
    await prisma!.listItem.delete({ where: { id: row.id } });
    expect(
      await confirmInventoryRestock(prisma!, actor, results[0], body),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "RESTOCK_ORIGINAL_REMOVED" } },
    });
  });
  it("requires explicit similar-item review and leaves foreign/missing sources indistinguishable", async () => {
    const item = await stock(),
      body = input(item);
    const duplicate = await prisma!.listItem.create({
      data: { list_id: listId, content: body.content, added_by: userId },
    });
    const review = await reviewInventoryRestock(prisma!, actor, {
      itemId: item.id,
      listId,
      content: body.content,
    });
    expect(review).toMatchObject({
      status: 200,
      body: {
        similar: expect.arrayContaining([
          expect.objectContaining({ id: duplicate.id }),
        ]),
      },
    });
    const pending = await receipt(body);
    expect(
      await persistInventoryRestock(prisma!, actor, body, pending.id),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "RESTOCK_DUPLICATE_REVIEW_REQUIRED" } },
    });
    const allowed = { ...body, allow_similar: true },
      r = await receipt(allowed);
    expect(
      await persistInventoryRestock(prisma!, actor, allowed, r.id),
    ).toMatchObject({ status: 201 });
    const foreign = await stock(otherId);
    expect(
      await reviewInventoryRestock(prisma!, actor, { itemId: foreign.id }),
    ).toEqual(
      await reviewInventoryRestock(prisma!, actor, {
        itemId: "missing-fixture",
      }),
    );
  });
  it("checks source version, original context and intent age before creating a replacement", async () => {
    const item = await stock(),
      body = input(item, { expected_version: new Date(0).toISOString() }),
      r = await receipt(body);
    expect(
      await persistInventoryRestock(prisma!, actor, body, r.id),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "RESTOCK_SOURCE_CHANGED" } },
    });
    const old = input(item, {
        issued_at: new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString(),
      }),
      oldReceipt = await receipt(old);
    expect(
      await persistInventoryRestock(prisma!, actor, old, oldReceipt.id),
    ).toMatchObject({
      status: 409,
      body: { error: { code: "RESTOCK_INTENT_EXPIRED" } },
    });
    expect(
      await persistInventoryRestock(
        prisma!,
        actor,
        { ...body, expected_family_id: otherId },
        r.id,
      ),
    ).toMatchObject({ status: 403 });
  });
  it("uses owned ten-minute Undo while preserving checked rows and denying a later child role", async () => {
    const item = await stock(),
      body = input(item, { allow_similar: true }),
      r = await receipt(body);
    const result = await persistInventoryRestock(prisma!, actor, body, r.id),
      proof = restockReceipt.parse(result.body);
    await prisma!.listItem.update({
      where: { id: proof.itemId },
      data: { checked: true },
    });
    expect(
      await undoInventoryRestock(prisma!, actor, proof.requestId),
    ).toMatchObject({
      status: 200,
      body: { removedCount: 0, keptCheckedCount: 1 },
    });
    await prisma!.listItem.update({
      where: { id: proof.itemId },
      data: { checked: false },
    });
    expect(
      await undoInventoryRestock(prisma!, actor, proof.requestId),
    ).toMatchObject({ status: 200, body: { removedCount: 1 } });
    expect(
      await undoInventoryRestock(prisma!, actor, proof.requestId),
    ).toMatchObject({ status: 200, body: { removedCount: 0 } });
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "child" },
    });
    expect(
      await reviewInventoryRestock(prisma!, actor, { itemId: item.id }),
    ).toMatchObject({ status: 403 });
    await prisma!.user.update({
      where: { id: userId },
      data: { role: "parent" },
    });
  });
});
