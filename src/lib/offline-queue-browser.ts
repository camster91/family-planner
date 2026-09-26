'use client'

/**
 * Browser wiring for the offline queue (#162): one queue per signed-in user
 * per page, IndexedDB with a localStorage fallback, `fetch` with the
 * Idempotency-Key header, and `online` / `visibilitychange` triggers.
 * Policy and states: docs/architecture/OFFLINE_SYNC.md.
 */
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import {
  clearPersonQueues,
  createOfflineQueue,
  preferredQueueStore,
  queueLocation,
  type OfflineQueue,
  type SendFn,
  type StorageLike,
} from '@/lib/offline-queue'

const queues = new Map<string, OfflineQueue>()
let listenersAttached = false

function safeLocalStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function safeIndexedDb(): IDBFactory | null {
  try {
    return window.indexedDB ?? null
  } catch {
    return null
  }
}

const send: SendFn = async ({ method, path, body, idempotencyKey }) => {
  // Rejects on a network failure; the global fetch wrapper adds the CSRF header.
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: idempotencyKey },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  })
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  return { status: res.status, body: parsed }
}

function attachListeners() {
  if (listenersAttached) return
  listenersAttached = true
  window.addEventListener('online', () => {
    for (const queue of Array.from(queues.values())) void queue.handleOnline()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    for (const queue of Array.from(queues.values())) void queue.drain()
  })
}

/** The queue of the signed-in person `userId` (created on first use). */
export function getPersonQueue(userId: string): OfflineQueue {
  const existing = queues.get(userId)
  if (existing) return existing
  const queue = createOfflineQueue({
    store: preferredQueueStore(queueLocation({ kind: 'person', userId }), {
      indexedDB: safeIndexedDb(),
      localStorage: safeLocalStorage(),
    }),
    send,
    now: () => Date.now(),
    random: () => Math.random(),
    newKey: () => newIdempotencyKey(),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  })
  queues.set(userId, queue)
  queue.subscribe((event) => {
    // Terminal auth: this queue is empty now; forget it so a later sign-in starts clean.
    if (event.type === 'auth-lost') queues.delete(userId)
  })
  attachListeners()
  void queue.drain()
  return queue
}

function deleteIndexedDb(name: string): Promise<void> {
  const idb = safeIndexedDb()
  if (!idb) return Promise.resolve()
  return new Promise((resolve) => {
    try {
      const req = idb.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * Sign-out: drop every person queue on this browser; nothing is replayed.
 * Bounded to one second so a stuck storage layer can never block sign-out.
 */
export function clearAllPersonQueues(): Promise<void> {
  return Promise.race([clearAll(), new Promise<void>((resolve) => window.setTimeout(resolve, 1000))])
}

async function clearAll(): Promise<void> {
  for (const queue of Array.from(queues.values())) {
    await queue.clear().catch(() => {})
    queue.dispose()
  }
  queues.clear()
  const storage = safeLocalStorage()
  await clearPersonQueues({ storages: storage ? [storage] : [], deleteIndexedDb })
}
