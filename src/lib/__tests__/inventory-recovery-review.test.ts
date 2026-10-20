/** Authored for consolidated QA; no runtime acceptance claimed. */
import { reviewInventoryRecovery } from "../inventory-recovery-review";
import { INVENTORY_RECOVERY_REVIEW_CONTRACT } from "../inventory-recovery-review-contract";
import { inventoryIntakeInput } from "../inventory-intake-contract";
import { inventoryChangeInput } from "../inventory-change-contract";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "../idempotency";
import type { InventoryRecoveryEntry } from "../inventory-recovery-contract";
import type { PrismaClient } from "@prisma/client";
const mockAuthority = jest.fn();
jest.mock("../inventory-intake", () => ({
  INVENTORY_INTAKE_ACTION: "inventory.intake.v1",
  inventoryIntakeAuthority: (...args: unknown[]) => mockAuthority(...args),
}));
const now = Date.parse("2026-10-20T12:00:00.000Z");
const actor = {
  userId: "fixture-parent",
  familyId: "fixture-family",
  tokenVersion: 2,
};
const ownerScope = "a".repeat(64);
const intake = inventoryIntakeInput.parse({
  protocol: "herewoven.inventory-intake.v1",
  expected_user_id: actor.userId,
  expected_family_id: actor.familyId,
  issued_at: new Date(now).toISOString(),
  item: { name: "Fixture beans" },
});
const entry: InventoryRecoveryEntry = {
  kind: "intake",
  key: "original_fixture_key_01",
  body: JSON.stringify(intake),
};
const item = {
  id: "fixture-item",
  name: "Canonical fixture beans",
  amount: 2,
  unit: "cans",
  location: "pantry",
  status: "active",
  updated_at: new Date(now),
};
const tx = {
  idempotencyRecord: { findUnique: jest.fn() },
  inventoryItem: { findFirst: jest.fn() },
  inventoryAdjustment: { findFirst: jest.fn() },
  ingredient: { findFirst: jest.fn() },
};
const db = {
  $transaction: async (run: (tx: object) => unknown) => run(tx),
} as unknown as Pick<PrismaClient, "$transaction">;
const review = (saved = entry) =>
  reviewInventoryRecovery(db, actor, saved, ownerScope, now);
function receipt(saved = entry, extra = {}) {
  const action =
    saved.kind === "intake" ? "inventory.intake.v1" : "inventory.change.v1";
  const input =
    saved.kind === "intake"
      ? inventoryIntakeInput.parse(JSON.parse(saved.body))
      : inventoryChangeInput.parse(JSON.parse(saved.body));
  return {
    family_id: actor.familyId,
    user_id: actor.userId,
    action,
    request_hash: hashIdempotentRequest(action, input),
    response_status: saved.kind === "intake" ? 201 : 200,
    response_body: { itemId: item.id },
    expires_at: new Date(now + 86400000),
    ...extra,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockAuthority.mockResolvedValue(null);
  tx.idempotencyRecord.findUnique.mockResolvedValue(null);
  tx.inventoryItem.findFirst.mockResolvedValue(item);
  tx.inventoryAdjustment.findFirst.mockResolvedValue(null);
  tx.ingredient.findFirst.mockResolvedValue(null);
});
it("binds a missing-receipt intake review to the exact request without creating stock or a receipt", async () => {
  const result = await review();
  expect(result).toMatchObject({
    status: 200,
    body: {
      contract: INVENTORY_RECOVERY_REVIEW_CONTRACT,
      entry,
      ownerScope,
      state: "ready",
      canRetry: true,
      name: "Fixture beans",
      current: null,
      receipt: null,
    },
  });
  expect(tx.idempotencyRecord.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        scope_key: { scope: `user:${actor.userId}`, key: entry.key },
      },
    }),
  );
  expect(mockAuthority).toHaveBeenCalledWith(tx, actor);
});
it("confirms a matching successful receipt using current owned stock, including historical proof after intent expiry", async () => {
  const old = {
    ...entry,
    body: JSON.stringify({
      ...intake,
      issued_at: new Date(now - IDEMPOTENCY_TTL_MS * 2).toISOString(),
    }),
  };
  tx.idempotencyRecord.findUnique.mockResolvedValue(
    receipt(old, { expires_at: new Date(now - 1000) }),
  );
  expect(await review(old)).toMatchObject({
    status: 200,
    body: {
      state: "committed",
      canRetry: false,
      name: item.name,
      current: { amount: 2 },
      receipt: { itemId: item.id },
    },
  });
  tx.inventoryItem.findFirst.mockResolvedValue(null);
  expect(await review(old)).toMatchObject({
    body: { state: "removed", canRetry: false, name: null, current: null },
  });
});
it("refuses stale/future intent, pending receipt, mismatched hash or foreign receipt without revealing names", async () => {
  const old = {
    ...entry,
    body: JSON.stringify({
      ...intake,
      issued_at: new Date(now - IDEMPOTENCY_TTL_MS).toISOString(),
    }),
  };
  expect(await review(old)).toMatchObject({
    body: { state: "expired", canRetry: false, name: null },
  });
  expect(
    await review({
      ...entry,
      body: JSON.stringify({
        ...intake,
        issued_at: new Date(now + 120000).toISOString(),
      }),
    }),
  ).toMatchObject({
    body: { state: "expired", canRetry: false, name: null },
  });
  tx.idempotencyRecord.findUnique.mockResolvedValue(
    receipt(entry, { response_status: null, response_body: null }),
  );
  expect(await review()).toMatchObject({
    body: { state: "pending", canRetry: false },
  });
  tx.idempotencyRecord.findUnique.mockResolvedValue(
    receipt(entry, { family_id: "other-family" }),
  );
  expect(await review()).toMatchObject({
    body: { state: "conflict", name: null, current: null },
  });
  tx.idempotencyRecord.findUnique.mockResolvedValue(
    receipt(entry, { request_hash: "different" }),
  );
  expect(await review()).toMatchObject({
    body: { state: "conflict", name: null },
  });
  expect(tx.inventoryItem.findFirst).not.toHaveBeenCalled();
});
it("retains canonical authority and original household negatives before any receipt read", async () => {
  mockAuthority.mockResolvedValue({
    status: 403,
    body: { error: { code: "INVENTORY_DISABLED" } },
  });
  expect(await review()).toMatchObject({ status: 403 });
  expect(tx.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  expect(
    await review({
      ...entry,
      body: JSON.stringify({ ...intake, expected_family_id: "other-family" }),
    }),
  ).toMatchObject({ status: 403 });
});
it("reviews versioned stock against canonical versions and confirms removal only from matching receipt proof", async () => {
  const change = (kind: "consume" | "remove"): InventoryRecoveryEntry => ({
    kind: "change",
    key: "original_change_key_01",
    body: JSON.stringify(
      inventoryChangeInput.parse({
        protocol: "herewoven.inventory-change.v1",
        expected_user_id: actor.userId,
        expected_family_id: actor.familyId,
        issued_at: new Date(now).toISOString(),
        operation: {
          kind,
          item_id: item.id,
          expected_version: new Date(now).toISOString(),
          ...(kind === "consume" ? { amount: 1 } : {}),
        },
      }),
    ),
  });
  expect(await review(change("consume"))).toMatchObject({
    body: { state: "ready", name: item.name, canRetry: true },
  });
  tx.inventoryItem.findFirst.mockResolvedValue({
    ...item,
    updated_at: new Date(now + 1000),
  });
  expect(await review(change("consume"))).toMatchObject({
    body: { state: "conflict", canRetry: false },
  });
  const removal = change("remove");
  tx.idempotencyRecord.findUnique.mockResolvedValue(
    receipt(removal, { response_body: { kind: "remove", itemId: item.id } }),
  );
  tx.inventoryItem.findFirst.mockResolvedValue(null);
  expect(await review(removal)).toMatchObject({
    body: {
      state: "committed",
      canRetry: false,
      receipt: { kind: "remove", itemId: item.id },
    },
  });
});
