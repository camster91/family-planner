import {
  readInventoryRecoveryContext,
  readInventoryRecoveryReview,
  INVENTORY_RECOVERY_REQUEST_MS,
} from "../inventory-recovery-client";
import {
  INVENTORY_RECOVERY_CONTRACT,
  type InventoryRecoveryContext,
  type InventoryRecoveryEntry,
} from "../inventory-recovery-contract";
import { INVENTORY_RECOVERY_REVIEW_CONTRACT } from "../inventory-recovery-review-contract";
const context: InventoryRecoveryContext = {
  contract: INVENTORY_RECOVERY_CONTRACT,
  enabled: true,
  userId: "fixture-parent",
  familyId: "fixture-family",
  owner: {
    kind: "person",
    ownerId: "fixture-parent",
    scope: "a".repeat(64),
    generation: 0,
    householdScope: "b".repeat(64),
  },
};
const entry: InventoryRecoveryEntry = {
  kind: "intake",
  key: "original_fixture_key_001",
  body: JSON.stringify({
    protocol: "herewoven.inventory-intake.v1",
    expected_user_id: context.userId,
    expected_family_id: context.familyId,
    issued_at: "2026-10-20T12:00:00.000Z",
    item: { name: "Private fixture food" },
  }),
};
const reply = {
  contract: INVENTORY_RECOVERY_REVIEW_CONTRACT,
  ownerScope: context.owner!.scope,
  entry,
  state: "ready",
  canRetry: true,
  name: "Private fixture food",
  current: null,
  receipt: null,
};
const oldFetch = global.fetch;
afterEach(() => {
  jest.useRealTimers();
  global.fetch = oldFetch;
});
it("bounds negotiation even when a fetch bridge ignores cancellation", async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
  const pending = readInventoryRecoveryContext();
  const assertion = expect(pending).rejects.toThrow(
    "Inventory recovery unavailable",
  );
  jest.advanceTimersByTime(INVENTORY_RECOVERY_REQUEST_MS + 1);
  await assertion;
});
it("matches the exact owner/key/kind/body and refuses changed or contradictory replies", async () => {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(reply)));
  expect(await readInventoryRecoveryReview(entry, context)).toMatchObject({
    state: "ready",
    entry,
  });
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          ...reply,
          entry: { ...entry, body: entry.body.replace("food", "rice") },
        }),
      ),
  );
  await expect(readInventoryRecoveryReview(entry, context)).rejects.toThrow(
    "Inventory recovery review changed",
  );
  global.fetch = jest.fn(
    async () =>
      new Response(JSON.stringify({ ...reply, ownerScope: "c".repeat(64) })),
  );
  await expect(readInventoryRecoveryReview(entry, context)).rejects.toThrow();
  global.fetch = jest.fn(
    async () => new Response(JSON.stringify({ ...reply, state: "expired" })),
  );
  await expect(readInventoryRecoveryReview(entry, context)).rejects.toThrow();
});
it("does not accept oversized or unavailable responses as completed review", async () => {
  global.fetch = jest.fn(async () => new Response("x".repeat(32769)));
  await expect(readInventoryRecoveryReview(entry, context)).rejects.toThrow();
  global.fetch = jest.fn(async () => new Response("{}", { status: 403 }));
  await expect(readInventoryRecoveryContext()).rejects.toThrow();
});
