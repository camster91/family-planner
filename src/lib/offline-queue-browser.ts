"use client";

/**
 * Browser wiring for the offline queue (#162): one queue per signed-in user
 * per page, IndexedDB with a localStorage fallback, `fetch` with the
 * Idempotency-Key header, and `online` / `visibilitychange` triggers.
 * Policy and states: docs/architecture/OFFLINE_SYNC.md.
 */
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { DeviceApiError, type DeviceClient } from "@/lib/device-client";
import {
  clearPersonQueues,
  createOfflineQueue,
  queueStoreCandidates,
  queueLocation,
  type OfflineQueue,
  type SendFn,
  type StorageLike,
} from "@/lib/offline-queue";
import { ownerQueueStore } from "@/lib/queue-owner-store";
import {
  QUEUE_OWNER_HEADER,
  queueRetirementSchema,
  type QueueOwner,
  type QueueRetirement,
} from "@/lib/queue-owner-contract";
import {
  captureQueueRetirements,
  ownedQueueLocation,
  retireOwnedQueueRecords,
  withOwnedQueueLease,
  withQueueLease,
} from "@/lib/owned-queue-persistence";

const queues = new Map<string, OfflineQueue>();
let listenersAttached = false;

function safeLocalStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeIndexedDb(): IDBFactory | null {
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}

function ownedCandidates(owner: QueueOwner) {
  return queueStoreCandidates(ownedQueueLocation(owner), {
    indexedDB: safeIndexedDb(),
    localStorage: safeLocalStorage(),
  }).candidates;
}

/** Only a validated server generation receipt can expand a captured scope purge. */
export async function retirePersonQueueGeneration(
  receipt: unknown,
  userId: string,
): Promise<boolean> {
  const parsed = queueRetirementSchema.safeParse(receipt);
  if (
    !parsed.success ||
    parsed.data.mode !== "generation" ||
    parsed.data.ownerId !== userId
  )
    return false;
  return retireOwnedQueueRecords(parsed.data, {
    storage: safeLocalStorage(),
    indexedDB: safeIndexedDb(),
  });
}
/** Only consume this receipt after the server confirmed account erasure. */
export async function retireErasedAccountQueues(
  receipt: unknown,
): Promise<boolean> {
  const values = Array.isArray(receipt) ? receipt : [receipt];
  if (!values.length || values.length > 2) return false;
  const parsed = values.map((value) => queueRetirementSchema.safeParse(value));
  if (
    parsed.some(
      (row) =>
        !row.success ||
        !(
          row.data.mode === "household" ||
          (row.data.mode === "generation" &&
            row.data.throughGeneration === Number.MAX_SAFE_INTEGER)
        ),
    )
  )
    return false;
  const results = await Promise.allSettled(
    parsed.map((row) =>
      row.success
        ? retireOwnedQueueRecords(row.data, {
            storage: safeLocalStorage(),
            indexedDB: safeIndexedDb(),
          })
        : Promise.resolve(false),
    ),
  );
  return results.every(
    (result) => result.status === "fulfilled" && result.value,
  );
}

async function retireCaptured(retirements: QueueRetirement[]) {
  await Promise.allSettled(
    retirements.map((retirement) =>
      retireOwnedQueueRecords(retirement, {
        storage: safeLocalStorage(),
        indexedDB: safeIndexedDb(),
      }),
    ),
  );
}

const send: SendFn = async ({
  method,
  path,
  body,
  idempotencyKey,
  ownerScope,
}) => {
  // Rejects on a network failure; the global fetch wrapper adds the CSRF header.
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      [IDEMPOTENCY_HEADER]: idempotencyKey,
      ...(ownerScope ? { [QUEUE_OWNER_HEADER]: ownerScope } : {}),
    },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
};

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("online", () => {
    for (const queue of Array.from(queues.values())) void queue.handleOnline();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    for (const queue of Array.from(queues.values())) void queue.drain();
  });
}

/** The queue of the signed-in person `userId` (created on first use). */
export function getPersonQueue(userId: string): OfflineQueue {
  const existing = queues.get(userId);
  if (existing) return existing;
  const guarded = ownerQueueStore({
    ...queueStoreCandidates(queueLocation({ kind: "person", userId }), {
      indexedDB: safeIndexedDb(),
      localStorage: safeLocalStorage(),
    }),
    namespace: { kind: "person", userId },
    ownedCandidates,
    withLease: withOwnedQueueLease,
    withLegacyLease: (run) =>
      withQueueLease(`herewoven-legacy-queue:person:${userId}`, run),
    reviewLegacy: async (entries) => {
      const response = await fetch("/api/queue/review", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      if (!response.ok) throw new Error("Older change review unavailable");
      return response.json();
    },
    runtime: newIdempotencyKey(),
    resolveOwner: async () => {
      const response = await fetch("/api/queue/owner", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Queue ownership unavailable");
      return response.json();
    },
  });
  const queue = createOfflineQueue({
    store: guarded.store,
    send: (request) => guarded.send(request, send),
    now: () => Date.now(),
    random: () => Math.random(),
    newKey: () => newIdempotencyKey(),
    isOnline: () =>
      typeof navigator === "undefined" ? true : navigator.onLine !== false,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  queues.set(userId, queue);
  queue.subscribe((event) => {
    // Terminal auth: this queue is empty now; forget it so a later sign-in starts clean.
    if (event.type === "auth-lost") queues.delete(userId);
  });
  attachListeners();
  void queue.drain();
  return queue;
}

/** Read only an already-loaded personal queue. Does not start replay, read storage or send a request. */
export function readPersonQueueDiagnostics(userId: string) {
  // Never accept the reserved device namespace through this personal support API.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  return queues.get(userId)?.diagnostics() ?? null;
}

// Contains ':', which no user id can (queueLocation's id pattern), so it never collides with a person queue.
const DEVICE_QUEUE = "device:tablet";
let deviceQueueClient: DeviceClient | null = null;

/**
 * Sends a shared tablet's queued write through its device client (#274), so
 * a `401 DEVICE_ACCESS_EXPIRED` is refreshed and retried once, and a terminal
 * answer (revoked, kill switch) runs the §8 purge, which also deletes this
 * queue's storage. A network failure rejects, like the person sender.
 */
export function deviceQueueSend(client: DeviceClient): SendFn {
  return async ({ method, path, body, idempotencyKey, ownerScope }) => {
    try {
      const res = await client.request(path, {
        method: method as "PATCH" | "POST",
        body,
        headers: {
          "Idempotency-Key": idempotencyKey,
          ...(ownerScope ? { [QUEUE_OWNER_HEADER]: ownerScope } : {}),
        },
      });
      return { status: 200, body: res };
    } catch (error) {
      if (error instanceof DeviceApiError && error.status > 0) {
        return { status: error.status, body: { error: { code: error.code } } };
      }
      throw error;
    }
  };
}

/**
 * The shared tablet's queue (#274): grocery ticks and submitted quick adds, stored under the
 * reserved `fp-device:v1:queue` key of the `fp-device` database, which the
 * device purge deletes (SHARED_DEVICE.md §8). One per page.
 */
export function getDeviceQueue(client: DeviceClient): OfflineQueue {
  const existing = queues.get(DEVICE_QUEUE);
  if (existing && deviceQueueClient === client) return existing;
  if (existing) {
    existing.dispose();
    queues.delete(DEVICE_QUEUE);
  }
  const guarded = ownerQueueStore({
    ...queueStoreCandidates(queueLocation({ kind: "device" }), {
      indexedDB: safeIndexedDb(),
      localStorage: safeLocalStorage(),
    }),
    namespace: { kind: "device" },
    ownedCandidates,
    withLease: withOwnedQueueLease,
    withLegacyLease: (run) =>
      withQueueLease("herewoven-legacy-queue:device", run),
    reviewLegacy: (entries) =>
      client.request("/api/device/queue-review", {
        method: "POST",
        body: { entries },
      }),
    runtime: newIdempotencyKey(),
    resolveOwner: () => client.request("/api/device/queue-owner"),
  });
  const queue = createOfflineQueue({
    namespace: "device",
    store: guarded.store,
    send: (request) => guarded.send(request, deviceQueueSend(client)),
    now: () => Date.now(),
    random: () => Math.random(),
    newKey: () => newIdempotencyKey(),
    isOnline: () =>
      typeof navigator === "undefined" ? true : navigator.onLine !== false,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  queues.set(DEVICE_QUEUE, queue);
  deviceQueueClient = client;
  const forget = () => {
    // Abandon, not dispose: an operation in flight when the purge ran (e.g. the
    // enveloped kill-switch 404) must not persist itself afterwards, which would
    // recreate the just-deleted `fp-device` database with the old household's ids.
    queue.abandon();
    if (queues.get(DEVICE_QUEUE) !== queue) return;
    queues.delete(DEVICE_QUEUE);
    deviceQueueClient = null;
  };
  queue.subscribe((event) => {
    if (event.type === "auth-lost") forget();
  });
  // The purge wipes the stored queue; drop the in-memory one with it, never replaying anything.
  client.subscribe((event) => {
    if (event === "purge") forget();
  });
  attachListeners();
  void queue.drain();
  return queue;
}

function deleteIndexedDb(name: string): Promise<void> {
  const idb = safeIndexedDb();
  if (!idb) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const req = idb.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Sign-out: drop every person queue on this browser; nothing is replayed.
 * Bounded to one second so a stuck storage layer can never block sign-out.
 */
export function clearAllPersonQueues(): Promise<void> {
  return Promise.race([
    clearAll(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1000)),
  ]);
}

async function clearAll(): Promise<void> {
  const retirements = captureQueueRetirements("person");
  const personQueues = Array.from(queues.entries()).filter(
    ([name]) => name !== DEVICE_QUEUE,
  );
  // Retire every queue before any storage await: the one-second sign-out
  // deadline must not leave a stuck person's queue able to replay or enqueue.
  for (const [name, queue] of personQueues) {
    queue.abandon();
    queues.delete(name);
  }
  const storage = safeLocalStorage();
  await Promise.all([
    ...personQueues.map(([, queue]) => queue.clear().catch(() => {})),
    clearPersonQueues({ storages: storage ? [storage] : [], deleteIndexedDb }),
    retireCaptured(retirements),
  ]);
}
