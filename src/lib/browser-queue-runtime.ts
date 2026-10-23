"use client";

/**
 * Shared browser runtime for the personal and paired-device offline queues.
 * The registry and lifecycle listeners stay singletons when both entrypoints
 * are used in one browser session.
 */
import {
  queueStoreCandidates,
  type OfflineQueue,
  type StorageLike,
} from "@/lib/offline-queue";
import { ownedQueueLocation } from "@/lib/owned-queue-persistence";
import type { QueueOwner } from "@/lib/queue-owner-contract";

export const queues = new Map<string, OfflineQueue>();
export const DEVICE_QUEUE_KEY = "device:tablet";
let listenersAttached = false;

export function safeLocalStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function safeIndexedDb(): IDBFactory | null {
  try {
    return window.indexedDB ?? null;
  } catch {
    return null;
  }
}

export function ownedCandidates(owner: QueueOwner) {
  return queueStoreCandidates(ownedQueueLocation(owner), {
    indexedDB: safeIndexedDb(),
    localStorage: safeLocalStorage(),
  }).candidates;
}

export function attachQueueListeners() {
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
