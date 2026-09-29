'use client'

/**
 * Browser wiring for the offline queue (#162): one queue per signed-in user
 * per page, IndexedDB with a localStorage fallback, `fetch` with the
 * Idempotency-Key header, and `online` / `visibilitychange` triggers.
 * Policy and states: docs/architecture/OFFLINE_SYNC.md.
 */
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import { DeviceApiError, type DeviceClient } from '@/lib/device-client'
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

// Contains ':', which no user id can (queueLocation's id pattern), so it never collides with a person queue.
const DEVICE_QUEUE = 'device:tablet'
let deviceQueueClient: DeviceClient | null = null

/**
 * Sends a shared tablet's queued write through its device client (#274), so
 * a `401 DEVICE_ACCESS_EXPIRED` is refreshed and retried once, and a terminal
 * answer (revoked, kill switch) runs the §8 purge, which also deletes this
 * queue's storage. A network failure rejects, like the person sender.
 */
export function deviceQueueSend(client: DeviceClient): SendFn {
  return async ({ method, path, body, idempotencyKey }) => {
    try {
      const res = await client.request(path, {
        method: method as 'PATCH' | 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      return { status: 200, body: res }
    } catch (error) {
      if (error instanceof DeviceApiError && error.status > 0) {
        return { status: error.status, body: { error: { code: error.code } } }
      }
      throw error
    }
  }
}

/**
 * The shared tablet's queue (#274): grocery ticks only, stored under the
 * reserved `fp-device:v1:queue` key of the `fp-device` database, which the
 * device purge deletes (SHARED_DEVICE.md §8). One per page.
 */
export function getDeviceQueue(client: DeviceClient): OfflineQueue {
  const existing = queues.get(DEVICE_QUEUE)
  if (existing && deviceQueueClient === client) return existing
  if (existing) {
    existing.dispose()
    queues.delete(DEVICE_QUEUE)
  }
  const queue = createOfflineQueue({
    namespace: 'device',
    store: preferredQueueStore(queueLocation({ kind: 'device' }), {
      indexedDB: safeIndexedDb(),
      localStorage: safeLocalStorage(),
    }),
    send: deviceQueueSend(client),
    now: () => Date.now(),
    random: () => Math.random(),
    newKey: () => newIdempotencyKey(),
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  })
  queues.set(DEVICE_QUEUE, queue)
  deviceQueueClient = client
  const forget = () => {
    if (queues.get(DEVICE_QUEUE) !== queue) return
    queue.dispose()
    queues.delete(DEVICE_QUEUE)
    deviceQueueClient = null
  }
  queue.subscribe((event) => {
    if (event.type === 'auth-lost') forget()
  })
  // The purge wipes the stored queue; drop the in-memory one with it, never replaying anything.
  client.subscribe((event) => {
    if (event === 'purge') forget()
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
  for (const [name, queue] of Array.from(queues.entries())) {
    if (name === DEVICE_QUEUE) continue // A tablet's queue belongs to the device, not a person.
    await queue.clear().catch(() => {})
    queue.dispose()
    queues.delete(name)
  }
  const storage = safeLocalStorage()
  await clearPersonQueues({ storages: storage ? [storage] : [], deleteIndexedDb })
}
