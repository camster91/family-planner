/** Fault containment source. Real auth/DB, browser locks and native acceptance remain separate. */
import {
  createOfflineQueue,
  serializeQueue,
  QUEUE_RETENTION_MS,
  type QueueStore,
  type QueuedOperation,
} from "@/lib/offline-queue";
import { ownerQueueStore } from "@/lib/queue-owner-store";
import {
  ORIGINAL_DEVICE_REQUIRED,
  RETIRED_QUEUE_ENVELOPE,
  type QueueOwner,
} from "@/lib/queue-owner-contract";
import {
  reviewFingerprint,
  type QueueReviewEntry,
} from "@/lib/queue-review-contract";
import { createLegacyMigration } from "@/lib/legacy-queue-migration";

const owner: QueueOwner = {
  kind: "person",
  ownerId: "fx_person_a",
  scope: "a".repeat(64),
  householdScope: "b".repeat(64),
  generation: 0,
};
const now = 1_800_000_000_000;
const add: QueuedOperation = {
  id: "fx_saved_request_123456",
  action: "list-item.grocery-add",
  v: 1,
  target: "list-add:fx_saved_request_123456",
  payload: { listId: "fx_list_a", content: "Fixture milk" },
  createdAt: now - 1000,
  state: "pending",
  attempts: 0,
  nextAttemptAt: 0,
};
function memory(value: string | null = null) {
  const store: QueueStore & { value: string | null; loseAck: boolean } = {
    value,
    loseAck: false,
    read: async () => store.value,
    write: async (value) => {
      store.value = value;
      if (store.loseAck) {
        store.loseAck = false;
        throw new Error("Fixture lost acknowledgement");
      }
    },
    remove: async () => {
      store.value = null;
    },
  };
  return store;
}
function setup(op = add, actor = owner) {
  const legacy = memory(serializeQueue([op]));
  const owned = memory();
  let online = false;
  let currentOwner = actor;
  let available = true;
  const review = jest.fn(async (entries: QueueReviewEntry[]) => ({
    contract: "herewoven.queue-review.v1",
    owner: currentOwner,
    rows: entries.map((entry) => ({
      id: entry.id,
      fingerprint: reviewFingerprint(entry),
      target: available
        ? {
            listId: "fx_list_a",
            listName: "Fixture list",
            itemId: "itemId" in entry ? entry.itemId : null,
            itemName: "itemId" in entry ? "Fixture item" : null,
            checked: "itemId" in entry ? false : null,
            actorId: "actingMemberId" in entry ? entry.actingMemberId : null,
            actorName: "actingMemberId" in entry ? "Fixture member" : null,
          }
        : null,
    })),
  }));
  const guarded = ownerQueueStore({
    candidates: [legacy],
    persistenceLane: {},
    namespace:
      actor.kind === "person"
        ? { kind: "person", userId: actor.ownerId }
        : { kind: "device" },
    runtime: "fx_current_runtime_1234",
    ownedCandidates: () => [owned],
    withLease: async (_owner, run) => run(),
    withLegacyLease: async (run) => run(),
    resolveOwner: async () => ({
      contract: "herewoven.queue-owner.v1",
      enabled: true,
      owner: currentOwner,
    }),
    reviewLegacy: review,
  });
  const sender = jest.fn(async () => ({
    status: 200,
    body: { item: { id: "fx_confirmed_item" } },
  }));
  const queue = createOfflineQueue({
    namespace: actor.kind,
    store: guarded.store,
    send: (request) => guarded.send(request, sender),
    now: () => now,
    random: () => 0.5,
    newKey: () => "fx_unused_new_request_1234",
    isOnline: () => online,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  return {
    queue,
    legacy,
    owned,
    sender,
    review,
    online: () => {
      online = true;
    },
    unavailable: () => {
      available = false;
    },
    changeOwner: () => {
      currentOwner = { ...actor, scope: "c".repeat(64) };
    },
  };
}

describe("explicit legacy queue migration", () => {
  it.each(["unread", "divergent"])(
    "preserves every source when a legacy copy is %s",
    async (kind) => {
      const first = memory(serializeQueue([add]));
      const second = memory(
        serializeQueue([
          { ...add, payload: { listId: "fx_list_b", content: "Other intent" } },
        ]),
      );
      if (kind === "unread")
        second.read = async () => {
          throw new Error("Fixture unread store");
        };
      const originals = [first.value, second.value];
      const review = jest.fn();
      const copy = jest.fn();
      const migration = createLegacyMigration({
        stores: [first, second],
        namespace: "person",
        runtime: "fx_runtime",
        getOwner: async () => owner,
        reviewTargets: review,
        lease: async (run) => run(),
        copy,
        copied: () => {},
        copyStarted: () => false,
      });
      await expect(migration.preview()).rejects.toBeDefined();
      expect([first.value, second.value]).toEqual(originals);
      expect(review).not.toHaveBeenCalled();
      expect(copy).not.toHaveBeenCalled();
    },
  );

  it("keeps the old copy when ownership changes after copying but before retirement", async () => {
    const legacy = memory(serializeQueue([add]));
    const original = legacy.value;
    let current = owner;
    let copied = false;
    const finished = jest.fn();
    const migration = createLegacyMigration({
      stores: [legacy],
      namespace: "person",
      runtime: "fx_runtime",
      getOwner: async () => current,
      reviewTargets: async (entries) => ({
        contract: "herewoven.queue-review.v1",
        owner,
        rows: entries.map((entry) => ({
          id: entry.id,
          fingerprint: reviewFingerprint(entry),
          target: {
            listId: "fx_list_a",
            listName: "Fixture list",
            itemId: null,
            itemName: null,
            checked: null,
            actorId: null,
            actorName: null,
          },
        })),
      }),
      lease: async (run) => run(),
      copy: async () => {
        copied = true;
        current = { ...owner, scope: "c".repeat(64) };
      },
      copied: finished,
      copyStarted: () => copied,
    });
    const preview = await migration.preview();
    await expect(
      migration.migrate({ token: preview.token, keep: [add.id], discard: [] }),
    ).rejects.toBeDefined();
    expect(copied).toBe(true);
    expect(legacy.value).toBe(original);
    expect(finished).not.toHaveBeenCalled();
  });

  it("moves verified personal intent with its original key/body/time and no automatic send", async () => {
    const t = setup();
    await t.queue.ready;
    expect(t.queue.hasStorageReadError()).toBe(true);
    const preview = await t.queue.previewLegacy();
    await t.queue.migrateLegacy({
      token: preview.token,
      keep: [add.id],
      discard: [],
    });
    expect(t.legacy.value).toBe(RETIRED_QUEUE_ENVELOPE);
    expect(t.queue.list()).toEqual([
      expect.objectContaining({
        id: add.id,
        payload: add.payload,
        createdAt: add.createdAt,
        state: "conflict",
        lastError: "QUEUE_REVIEW_REQUIRED",
      }),
    ]);
    expect(t.sender).not.toHaveBeenCalled();
    t.online();
    await t.queue.retry(add.id);
    await t.queue.drain();
    expect(t.sender).toHaveBeenCalledTimes(1);
    expect(t.sender).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: add.id,
        body: { listId: "fx_list_a", content: "Fixture milk" },
        ownerScope: owner.scope,
      }),
    );
  });

  it("locks a legacy tablet create rather than rebinding its idempotency scope", async () => {
    const device: QueueOwner = {
      ...owner,
      kind: "device",
      ownerId: "fx_new_pairing",
    };
    const op: QueuedOperation = {
      ...add,
      action: "device.list-item.add",
      payload: {
        listId: "fx_list_a",
        content: "Fixture milk",
        actingMemberId: "fx_member_a",
      },
    };
    const t = setup(op, device);
    await t.queue.ready;
    const preview = await t.queue.previewLegacy();
    await t.queue.migrateLegacy({
      token: preview.token,
      keep: [op.id],
      discard: [],
    });
    expect(t.queue.list()[0]).toEqual(
      expect.objectContaining({
        id: op.id,
        payload: op.payload,
        lastError: ORIGINAL_DEVICE_REQUIRED,
      }),
    );
    t.online();
    await t.queue.retry(op.id);
    await t.queue.drain();
    expect(t.sender).not.toHaveBeenCalled();
    expect(t.queue.list()[0].lastError).toBe(ORIGINAL_DEVICE_REQUIRED);
  });

  it("refuses foreign or unavailable targets without moving or erasing their bytes", async () => {
    const t = setup();
    t.unavailable();
    await t.queue.ready;
    const original = t.legacy.value;
    const preview = await t.queue.previewLegacy();
    expect(preview.targets[add.id]).toBeNull();
    await expect(
      t.queue.migrateLegacy({
        token: preview.token,
        keep: [add.id],
        discard: [],
      }),
    ).rejects.toBeDefined();
    expect(t.legacy.value).toBe(original);
    expect(t.owned.value).toBeNull();
    // An explicit discard decision is allowed; it is never a forced migration.
    await t.queue.migrateLegacy({
      token: preview.token,
      keep: [],
      discard: [add.id],
    });
    expect(t.legacy.value).toBe(RETIRED_QUEUE_ENVELOPE);
    expect(t.queue.list()).toEqual([]);
    expect(t.sender).not.toHaveBeenCalled();
  });

  it("recovers the exact copied snapshot after a lost storage acknowledgement", async () => {
    const t = setup();
    await t.queue.ready;
    const preview = await t.queue.previewLegacy();
    t.owned.loseAck = true;
    const decision = { token: preview.token, keep: [add.id], discard: [] };
    await expect(t.queue.migrateLegacy(decision)).rejects.toBeDefined();
    const copied = t.owned.value;
    expect(copied).not.toBeNull();
    expect(t.legacy.value).not.toBe(RETIRED_QUEUE_ENVELOPE);
    await expect(
      t.queue.migrateLegacy({
        token: preview.token,
        keep: [],
        discard: [add.id],
      }),
    ).rejects.toBeDefined();
    expect(t.owned.value).toBe(copied);
    await t.queue.migrateLegacy(decision);
    expect(t.queue.list().map((op) => op.id)).toEqual([add.id]);
    expect(t.sender).not.toHaveBeenCalled();
  });

  it("does not adopt under a different current owner context", async () => {
    const t = setup();
    await t.queue.ready;
    const preview = await t.queue.previewLegacy();
    const raw = t.legacy.value;
    t.changeOwner();
    await expect(
      t.queue.migrateLegacy({
        token: preview.token,
        keep: [add.id],
        discard: [],
      }),
    ).rejects.toBeDefined();
    expect(t.legacy.value).toBe(raw);
    expect(t.owned.value).toBeNull();
  });

  it("keeps unknown payload fields opaque instead of stripping them during migration", async () => {
    const t = setup();
    const raw = JSON.parse(serializeQueue([add]));
    raw.ops[0].payload.futureField = "fx_private_future_intent";
    t.legacy.value = JSON.stringify(raw);
    await t.queue.ready;
    const original = t.legacy.value;
    await expect(t.queue.previewLegacy()).rejects.toBeDefined();
    expect(t.review).not.toHaveBeenCalled();
    expect(t.legacy.value).toBe(original);
    expect(t.owned.value).toBeNull();
  });

  it("holds recovered failures past retention until the person actually reviews them", async () => {
    const op: QueuedOperation = {
      ...add,
      createdAt: now - QUEUE_RETENTION_MS - 1,
      state: "failed",
      lastError: "MAX_ATTEMPTS",
    };
    const t = setup(op);
    t.legacy.value = null;
    t.owned.value = JSON.stringify({
      v: 2,
      envelope: "herewoven.queue-store.v2",
      state: "active",
      owner,
      runtime: "fx_earlier_runtime_1234",
      queue: serializeQueue([op]),
    });
    await t.queue.ready;
    expect(t.queue.list()).toEqual([
      expect.objectContaining({
        id: op.id,
        payload: op.payload,
        createdAt: op.createdAt,
        lastError: "MAX_ATTEMPTS",
      }),
    ]);
    expect(t.sender).not.toHaveBeenCalled();
    expect(t.owned.value).toContain("MAX_ATTEMPTS");
  });
});
