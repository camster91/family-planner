"use client";

/** Browser wiring for the paired shared-device offline queue. */
import { DeviceApiError, type DeviceClient } from "@/lib/device-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import {
  createOfflineQueue,
  queueStoreCandidates,
  queueLocation,
  type OfflineQueue,
  type SendFn,
} from "@/lib/offline-queue";
import { ownerQueueStore } from "@/lib/queue-owner-store";
import { QUEUE_OWNER_HEADER } from "@/lib/queue-owner-contract";
import {
  attachQueueListeners,
  DEVICE_QUEUE_KEY,
  ownedCandidates,
  queues,
  safeIndexedDb,
  safeLocalStorage,
} from "@/lib/browser-queue-runtime";
import {
  withOwnedQueueLease,
  withQueueLease,
} from "@/lib/owned-queue-persistence";

// Contains ':', which no user id can (queueLocation's id pattern), so it never collides with a person queue.
let deviceQueueClient: DeviceClient | null = null;

/** Sends a shared tablet's queued write through its device client. */
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

/** The paired tablet queue, stored under the reserved device namespace. */
export function getDeviceQueue(client: DeviceClient): OfflineQueue {
  const existing = queues.get(DEVICE_QUEUE_KEY);
  if (existing && deviceQueueClient === client) return existing;
  if (existing) {
    existing.dispose();
    queues.delete(DEVICE_QUEUE_KEY);
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
  queues.set(DEVICE_QUEUE_KEY, queue);
  deviceQueueClient = client;
  const forget = () => {
    // Abandon, not dispose: an in-flight operation must not recreate purged storage.
    queue.abandon();
    if (queues.get(DEVICE_QUEUE_KEY) !== queue) return;
    queues.delete(DEVICE_QUEUE_KEY);
    deviceQueueClient = null;
  };
  queue.subscribe((event) => {
    if (event.type === "auth-lost") forget();
  });
  client.subscribe((event) => {
    if (event === "purge") forget();
  });
  attachQueueListeners();
  void queue.drain();
  return queue;
}
