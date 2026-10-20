/** Source only: consolidated fault/ownership pass is deferred. */
import { createInventoryRecoveryStore } from "../inventory-recovery-store";
import {
  INVENTORY_RECOVERY_CONTRACT,
  type InventoryRecoveryEntry,
} from "../inventory-recovery-contract";
import {
  RETIRED_QUEUE_ENVELOPE,
  type QueueOwner,
} from "../queue-owner-contract";
import type { QueueStore } from "../offline-queue";
import {
  ownedQueueLocation,
  retireOwnedQueueRecords,
} from "../owned-queue-persistence";
const owner: QueueOwner = {
  kind: "person",
  ownerId: "fixture-parent",
  generation: 0,
  scope: "a".repeat(64),
  householdScope: "b".repeat(64),
};
const context = {
  contract: INVENTORY_RECOVERY_CONTRACT,
  enabled: true,
  owner,
  userId: owner.ownerId,
  familyId: "fixture-family",
};
const entry: InventoryRecoveryEntry = {
  kind: "intake",
  key: "original_fixture_key_001",
  body: JSON.stringify({
    protocol: "herewoven.inventory-intake.v1",
    expected_user_id: context.userId,
    expected_family_id: context.familyId,
    issued_at: "2026-10-20T12:00:00.000Z",
    item: {
      name: "Private fixture beans",
      amount: 2,
      unit: "cans",
      location: "pantry",
    },
  }),
};
function memory() {
  let value: string | null = null;
  let rejectWrites = false;
  let rejectReads = false;
  let rejectRemoves = false;
  const store: QueueStore = {
    read: async () => {
      if (rejectReads) throw new Error("unavailable");
      return value;
    },
    write: async (next) => {
      if (rejectWrites) throw new Error("quota");
      value = next;
    },
    remove: async () => {
      if (rejectRemoves) throw new Error("cleanup");
      value = null;
    },
  };
  return {
    store,
    set: (next: string | null) => {
      value = next;
    },
    get: () => value,
    writesFail: (fail: boolean) => {
      rejectWrites = fail;
    },
    readsFail: (fail: boolean) => {
      rejectReads = fail;
    },
    removesFail: (fail: boolean) => {
      rejectRemoves = fail;
    },
  };
}
const lease = async <T>(_owner: QueueOwner, run: () => Promise<T>) => run();
function fixture() {
  const first = memory(),
    second = memory();
  let current = context;
  const review = jest.fn(async () => true);
  const build = () =>
    createInventoryRecoveryStore({
      runtime: "fixture_runtime_001",
      resolveContext: async () => current,
      candidates: () => [first.store, second.store],
      withLease: lease,
      reviewRecovered: review,
    });
  return {
    first,
    second,
    build,
    review,
    setContext: (next: typeof context) => {
      current = next;
    },
  };
}
it("retains exact online intent across replacement, requires explicit canonical review and never auto-sends", async () => {
  const f = fixture(),
    original = f.build();
  expect(await original.initialize()).toEqual([]);
  await original.stage(entry);
  const replacement = f.build(),
    send = jest.fn(async (row) => row);
  expect(await replacement.initialize()).toEqual([
    { ...entry, reviewRequired: true },
  ]);
  expect(send).not.toHaveBeenCalled();
  await expect(replacement.send(entry.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  expect(send).not.toHaveBeenCalled();
  expect(await replacement.send(entry.key, true, send)).toEqual(entry);
  expect(send).toHaveBeenCalledWith(entry, owner.scope);
  expect(f.review).toHaveBeenCalledTimes(1);
  expect(f.first.get()).toContain("original_fixture_key_001");
  // A successful HTTP callback does not itself erase recovery evidence.
  await replacement.dismiss(entry.key);
  expect(await f.build().initialize()).toEqual([]);
});
it("rejects original-key body replacement and household rebasing", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.stage(entry);
  await expect(
    store.stage({ ...entry, body: entry.body.replace("beans", "rice") }),
  ).rejects.toMatchObject({ reason: "INTENT_CHANGED" });
  f.setContext({
    ...context,
    familyId: "other-family",
    owner: { ...owner, scope: "c".repeat(64) },
  });
  const send = jest.fn();
  await expect(store.send(entry.key, true, send)).rejects.toMatchObject({
    reason: "OWNER_CHANGED",
  });
  expect(send).not.toHaveBeenCalled();
});
it("retains failed-write intent and repairs only that exact transition on deliberate recovery", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  f.first.writesFail(true);
  f.second.writesFail(true);
  await expect(store.stage(entry)).rejects.toMatchObject({
    reason: "UNAVAILABLE",
  });
  f.first.writesFail(false);
  await expect(store.initialize()).rejects.toMatchObject({
    reason: "UNAVAILABLE",
  });
  expect(await store.recoverStorage()).toEqual([
    { ...entry, reviewRequired: true },
  ]);
  const send = jest.fn();
  await expect(store.send(entry.key, false, send)).rejects.toMatchObject({
    reason: "REVIEW_REQUIRED",
  });
  expect(send).not.toHaveBeenCalled();
});
it("repairs uncertain cleanup without replacing newer or retired copies", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  f.second.removesFail(true);
  await expect(store.stage(entry)).rejects.toMatchObject({
    reason: "UNAVAILABLE",
  });
  f.second.removesFail(false);
  f.second.set("unknown future bytes");
  await expect(store.recoverStorage()).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
  expect(f.second.get()).toBe("unknown future bytes");
  f.second.set(RETIRED_QUEUE_ENVELOPE);
  await expect(store.recoverStorage()).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
  expect(f.second.get()).toBe(RETIRED_QUEUE_ENVELOPE);
});
it("pauses unread/divergent and retired journals without clearing evidence", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.stage(entry);
  f.second.readsFail(true);
  await expect(f.build().initialize()).rejects.toMatchObject({
    reason: "UNAVAILABLE",
  });
  f.second.readsFail(false);
  f.second.set("future version");
  await expect(f.build().initialize()).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
  f.first.set(RETIRED_QUEUE_ENVELOPE);
  f.second.set(null);
  await expect(f.build().initialize()).rejects.toMatchObject({
    reason: "OWNER_CHANGED",
  });
});
it("disabled negotiation and owner change during recovered review never call the sender", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.stage(entry);
  const replacement = f.build();
  await replacement.initialize();
  f.review.mockImplementation(async () => {
    f.setContext({
      ...context,
      owner: { ...owner, generation: 1, scope: "d".repeat(64) },
    });
    return true;
  });
  const send = jest.fn();
  await expect(replacement.send(entry.key, true, send)).rejects.toMatchObject({
    reason: "OWNER_CHANGED",
  });
  expect(send).not.toHaveBeenCalled();
  f.setContext({ ...context, enabled: false });
  await expect(f.build().initialize()).rejects.toMatchObject({
    reason: "DISABLED",
  });
  expect(f.first.get()).toContain(entry.key);
});
it("uses existing generation retirement for unloaded inventory journals without touching future records", async () => {
  const f = fixture(),
    store = f.build();
  await store.initialize();
  await store.stage(entry);
  const key = ownedQueueLocation(owner).key;
  const values = new Map<string, string>([
    [key, f.first.get()!],
    ["fp-owned:v2:person:future", "unrecognized future record"],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => {
      values.set(name, value);
    },
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
  const locks = {
    request: async (
      _name: string,
      _options: unknown,
      run: (lock: object) => unknown,
    ) => run({}),
  } as unknown as Pick<LockManager, "request">;
  expect(
    await retireOwnedQueueRecords(
      { mode: "generation", ownerId: owner.ownerId, throughGeneration: 0 },
      { storage, indexedDB: null, locks },
    ),
  ).toBe(true);
  expect(values.get(key)).toBe(RETIRED_QUEUE_ENVELOPE);
  expect(values.get("fp-owned:v2:person:future")).toBe(
    "unrecognized future record",
  );
});
