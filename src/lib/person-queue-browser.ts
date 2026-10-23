"use client";

/** Browser wiring for signed-in-person offline queues. */
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import {
  clearPersonQueues,
  createOfflineQueue,
  queueStoreCandidates,
  queueLocation,
  type OfflineQueue,
  type SendFn,
} from "@/lib/offline-queue";
import { ownerQueueStore } from "@/lib/queue-owner-store";
import {
  QUEUE_OWNER_HEADER,
  queueRetirementSchema,
  type QueueRetirement,
} from "@/lib/queue-owner-contract";
import {
  captureQueueRetirements,
  retireOwnedQueueRecords,
  withOwnedQueueLease,
  withQueueLease,
} from "@/lib/owned-queue-persistence";
import {
  attachQueueListeners,
  DEVICE_QUEUE_KEY,
  ownedCandidates,
  queues,
  safeIndexedDb,
  safeLocalStorage,
} from "@/lib/browser-queue-runtime";

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
  attachQueueListeners();
  void queue.drain();
  return queue;
}

/** Read only an already-loaded personal queue. Does not start replay, read storage or send a request. */
export function readPersonQueueDiagnostics(userId: string) {
  // Never accept the reserved device namespace through this personal support API.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) return null;
  return queues.get(userId)?.diagnostics() ?? null;
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
    ([name]) => name !== DEVICE_QUEUE_KEY,
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
