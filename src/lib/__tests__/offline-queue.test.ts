/**
 * Offline mutation queue (#162; OFFLINE_SYNC.md). Pure unit tests with an
 * injected store, network, clock, randomness and timers. Restart persistence
 * runs against fake-indexeddb and the localStorage fallback.
 */
import { IDBFactory } from 'fake-indexeddb'
import {
  backoffDelay,
  classifyResponse,
  clearPersonQueues,
  createOfflineQueue,
  isCheckedOperation,
  fallbackQueueStore,
  indexedDbQueueStore,
  isQueueableAction,
  localStorageQueueStore,
  parseStoredQueue,
  preferredQueueStore,
  QUEUE_MAX_AGE_MS,
  QUEUE_MAX_OPS,
  QUEUE_RETENTION_MS,
  QUEUE_SCHEMA_VERSION,
  QUEUEABLE_ACTIONS,
  QueueError,
  QueueStorageError,
  queueLocation,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  serializeQueue,
  type OfflineQueueDeps,
  type QueueEvent,
  type QueueStore,
  type SendRequest,
} from '../offline-queue'
import { createDeviceClient, DEVICE_IDB_NAME, DEVICE_QUEUE_KEY } from '../device-client'

class MemoryStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null
  }
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  keys() {
    return Array.from(this.map.keys())
  }
}

function memoryStore(initial: string | null = null): QueueStore & { value: string | null } {
  const s = {
    value: initial,
    read: async () => s.value,
    write: async (v: string) => {
      s.value = v
    },
    remove: async () => {
      s.value = null
    },
  }
  return s
}

type Reply = { status: number; body?: unknown } | 'network'

function setup(
  opts: {
    store?: QueueStore
    replies?: Reply[]
    online?: boolean
    now?: number
    random?: number
    namespace?: 'person' | 'device'
  } = {}
) {
  let now = opts.now ?? 1_000_000
  let online = opts.online ?? true
  let keySeq = 0
  const replies = [...(opts.replies ?? [])]
  const sent: SendRequest[] = []
  const timers: Array<{ fn: () => void; at: number; id: number }> = []
  let timerSeq = 0
  const store = opts.store ?? memoryStore()
  const deps: OfflineQueueDeps = {
    namespace: opts.namespace,
    store,
    send: async (r) => {
      sent.push(r)
      const reply = replies.shift() ?? { status: 200, body: { success: true } }
      if (reply === 'network') throw new TypeError('Failed to fetch')
      return { status: reply.status, body: reply.body ?? null }
    },
    now: () => now,
    random: () => opts.random ?? 0.5,
    newKey: () => `key-${String(++keySeq).padStart(4, '0')}-abcdefghijkl`,
    isOnline: () => online,
    setTimer: (fn, ms) => {
      const id = ++timerSeq
      timers.push({ fn, at: now + ms, id })
      return id
    },
    clearTimer: (id) => {
      const idx = timers.findIndex((t) => t.id === id)
      if (idx >= 0) timers.splice(idx, 1)
    },
  }
  const queue = createOfflineQueue(deps)
  const events: QueueEvent[] = []
  queue.subscribe((e) => events.push(e))
  return {
    queue,
    store,
    sent,
    events,
    replies,
    timers,
    setOnline: (v: boolean) => (online = v),
    advance: async (ms: number) => {
      now += ms
      for (const t of [...timers].filter((t) => t.at <= now)) {
        timers.splice(timers.indexOf(t), 1)
        t.fn()
      }
      await flush()
    },
    get now() {
      return now
    },
  }
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((r) => setImmediate(r))
}

const tick = (itemId: string, checked = true) => ({ itemId, checked })

describe('allowlist', () => {
  it('queues only allowlisted actions, never arbitrary requests', async () => {
    const { queue } = setup({ online: false })
    for (const action of ['list.delete', 'list-item.delete', 'budget.transaction', 'chore.verify', 'auth.password', 'fetch', '__proto__', 'toString']) {
      expect(isQueueableAction(action)).toBe(false)
      await expect(queue.enqueue(action as any, {})).rejects.toMatchObject({ code: 'NOT_QUEUEABLE' })
    }
    expect(queue.list()).toHaveLength(0)
  })

  it('allowlisted routes are non-destructive, non-finance, non-auth', () => {
    for (const [name, spec] of Object.entries(QUEUEABLE_ACTIONS)) {
      expect(spec.method).not.toBe('DELETE')
      const path =
        typeof spec.path === 'function' ? spec.path({ itemId: 'x', checked: true, actingMemberId: 'm', listId: 'l', content: 'Milk' }) : spec.path
      // The shared tablet's own variant (#274) lives under /api/device/ by design (SHARED_DEVICE.md §12.3).
      const words =
        spec.namespace === 'device'
          ? `${name.replace(/^device\./, '')} ${path.replace(/^\/api\/device\//, '/api/')}`
          : `${name} ${path}`
      expect(words).not.toMatch(/delete|budget|transaction|allowance|verify|approve|auth|password|pin|elevation|device|invite|export|medic/i)
    }
    expect(QUEUEABLE_ACTIONS['device.list-item.set-checked'].path({ itemId: 'item-1', checked: true })).toBe(
      '/api/device/lists/items/item-1'
    )
  })

  it('keeps the minimum payload (ids and desired state only) and validates it', async () => {
    const { queue, store } = setup({ online: false })
    await queue.enqueue('list-item.set-checked', { itemId: 'item-1', checked: true, content: 'Secret milk', name: 'Avery' })
    expect((store as any).value).not.toMatch(/Secret|Avery/)
    expect(queue.list()[0].payload).toEqual({ itemId: 'item-1', checked: true })
    for (const bad of [{ itemId: 'x' }, { itemId: '', checked: true }, { itemId: 'a b', checked: true }, { itemId: 'x', checked: 'yes' }, null]) {
      await expect(queue.enqueue('list-item.set-checked', bad)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })
})

describe('state transitions', () => {
  it('pending -> syncing -> synced (removed), with the key sent as Idempotency-Key', async () => {
    const t = setup({ online: false })
    const op = await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(t.queue.list()[0].state).toBe('pending')
    t.setOnline(true)
    const states: string[] = []
    t.queue.subscribe(() => states.push(t.queue.list()[0]?.state ?? 'gone'))
    await t.queue.handleOnline()
    expect(states).toContain('syncing')
    expect(t.sent).toEqual([
      { method: 'PATCH', path: '/api/lists/items/update', body: { itemId: 'item-1', checked: true }, idempotencyKey: op.id },
    ])
    expect(t.queue.list()).toHaveLength(0)
    expect(t.events.some((e) => e.type === 'synced' && e.op.id === op.id && e.op.state === 'synced')).toBe(true)
    expect((t.store as any).value).toBeNull()
  })

  it('network failure keeps it pending with backoff and retries with the same key', async () => {
    const t = setup({ replies: ['network', { status: 200 }] })
    const op = await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await flush()
    expect(t.queue.list()[0]).toMatchObject({ state: 'pending', attempts: 1, lastError: 'NETWORK' })
    expect(t.timers).toHaveLength(1)
    await t.advance(RETRY_MAX_DELAY_MS)
    expect(t.sent.map((s) => s.idempotencyKey)).toEqual([op.id, op.id])
    expect(t.queue.list()).toHaveLength(0)
  })

  it('5xx and 409 IN_PROGRESS are retried; after RETRY_MAX_ATTEMPTS it is failed and stays visible', async () => {
    const replies: Reply[] = [{ status: 409, body: { error: { code: 'IDEMPOTENCY_IN_PROGRESS' } } }]
    for (let i = 1; i < RETRY_MAX_ATTEMPTS; i++) replies.push({ status: 503 })
    const t = setup({ replies })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    for (let i = 0; i < RETRY_MAX_ATTEMPTS + 2; i++) await t.advance(RETRY_MAX_DELAY_MS)
    expect(t.sent).toHaveLength(RETRY_MAX_ATTEMPTS)
    expect(t.queue.list()[0]).toMatchObject({ state: 'failed', lastError: 'MAX_ATTEMPTS' })
    expect(t.timers).toHaveLength(0)
  })

  it('404 is a conflict, 403 and 422 are failed; retry and discard work', async () => {
    const t = setup({
      replies: [
        { status: 404, body: { error: 'Item not found' } },
        { status: 403, body: { error: 'Forbidden' } },
        { status: 200 },
      ],
    })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await t.queue.enqueue('list-item.set-checked', tick('item-2'))
    await flush()
    const [a, b] = t.queue.list()
    expect(a).toMatchObject({ state: 'conflict', lastError: 'NOT_FOUND' })
    expect(b).toMatchObject({ state: 'failed', lastError: 'FORBIDDEN' })
    await t.queue.discard(a.id)
    await t.queue.retry(b.id)
    await flush()
    expect(t.sent.at(-1)!.idempotencyKey).toBe(b.id)
    expect(t.queue.list()).toHaveLength(0)
  })

  it('a key the server calls reused gets a fresh key on retry', async () => {
    const t = setup({ replies: [{ status: 422, body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } } }, { status: 200 }] })
    const op = await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await flush()
    expect(t.queue.list()[0]).toMatchObject({ state: 'failed', lastError: 'IDEMPOTENCY_KEY_REUSED' })
    await t.queue.retry(op.id)
    await flush()
    expect(t.sent[1].idempotencyKey).not.toBe(op.id)
  })

  it('401 drops the whole queue and never replays', async () => {
    const t = setup({ replies: [{ status: 401, body: { error: { code: 'DEVICE_REVOKED' } } }] })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    t.setOnline(false)
    await t.queue.enqueue('list-item.set-checked', tick('item-2'))
    t.setOnline(true)
    await t.queue.drain()
    await flush()
    expect(t.queue.list()).toHaveLength(0)
    expect(t.sent).toHaveLength(1)
    expect(t.events.some((e) => e.type === 'auth-lost')).toBe(true)
    expect((t.store as any).value).toBeNull()
  })

  it('newest intent per item wins; per-item order is kept while one is in flight', async () => {
    const t = setup({ online: false })
    await t.queue.enqueue('list-item.set-checked', tick('item-1', true))
    await t.queue.enqueue('list-item.set-checked', tick('item-1', false))
    expect(t.queue.list()).toHaveLength(1)
    expect(t.queue.list().filter(isCheckedOperation)[0].payload.checked).toBe(false)

    // In flight: the new intent is queued behind it, not dropped.
    let release!: (v: { status: number; body: unknown }) => void
    const slow = new Promise<{ status: number; body: unknown }>((r) => (release = r))
    const sent: SendRequest[] = []
    const q = createOfflineQueue({
      store: memoryStore(),
      send: async (r) => {
        sent.push(r)
        return sent.length === 1 ? slow : { status: 200, body: null }
      },
      now: () => 0,
      random: () => 0.5,
      newKey: (() => {
        let n = 0
        return () => `k-${++n}-aaaaaaaaaaaaaaaaaa`
      })(),
      isOnline: () => true,
      setTimer: () => 0,
      clearTimer: () => {},
    })
    await q.enqueue('list-item.set-checked', tick('item-1', true))
    await flush()
    await q.enqueue('list-item.set-checked', tick('item-1', false))
    expect(q.list().map((o) => o.state)).toEqual(['syncing', 'pending'])
    release({ status: 200, body: null })
    await flush()
    await q.drain()
    expect(sent.map((s) => s.body.checked)).toEqual([true, false])
    expect(q.list()).toHaveLength(0)
  })

  it('single flight: concurrent drains share one run and send each op once', async () => {
    const t = setup({ online: false })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await t.queue.enqueue('list-item.set-checked', tick('item-2'))
    t.setOnline(true)
    const a = t.queue.drain()
    const b = t.queue.drain()
    const c = t.queue.handleOnline()
    expect(a).toBe(b)
    await Promise.all([a, b, c])
    expect(t.sent.map((s) => s.body.itemId)).toEqual(['item-1', 'item-2'])
  })

  it('does not send while offline', async () => {
    const t = setup({ online: false })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await t.queue.drain()
    await t.advance(RETRY_MAX_DELAY_MS * 10)
    expect(t.sent).toHaveLength(0)
    expect(t.queue.list()[0].state).toBe('pending')
  })
})

describe('bounds and cleanup', () => {
  it(`refuses the ${QUEUE_MAX_OPS + 1}th operation instead of evicting one`, async () => {
    const t = setup({ online: false })
    for (let i = 0; i < QUEUE_MAX_OPS; i++) await t.queue.enqueue('list-item.set-checked', tick(`item-${i}`))
    await expect(t.queue.enqueue('list-item.set-checked', tick('item-new'))).rejects.toBeInstanceOf(QueueError)
    await expect(t.queue.enqueue('list-item.set-checked', tick('item-new'))).rejects.toMatchObject({ code: 'QUEUE_FULL' })
    // Replacing an existing item's intent is still allowed at the limit.
    await t.queue.enqueue('list-item.set-checked', tick('item-0', false))
    expect(t.queue.list()).toHaveLength(QUEUE_MAX_OPS)
  })

  it('a pending operation older than the max age becomes failed (EXPIRED) and is not sent', async () => {
    const t = setup({ online: false })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await t.advance(QUEUE_MAX_AGE_MS + 1)
    t.setOnline(true)
    await t.queue.drain()
    expect(t.sent).toHaveLength(0)
    expect(t.queue.list()[0]).toMatchObject({ state: 'failed', lastError: 'EXPIRED' })
    // Retry is an explicit, fresh intent.
    await t.queue.retry(t.queue.list()[0].id)
    await flush()
    expect(t.sent).toHaveLength(1)
  })

  it('drops failed/conflict operations past the retention on load and reports them', async () => {
    const now = 50 * QUEUE_RETENTION_MS
    const old = { id: 'old-key-aaaaaaaaaaaaaa', action: 'list-item.set-checked', v: 1, payload: tick('a'), createdAt: now - QUEUE_RETENTION_MS - 1, state: 'failed', attempts: 8, nextAttemptAt: 0 }
    const fresh = { ...old, id: 'fresh-key-aaaaaaaaaaaa', createdAt: now - 1000, state: 'conflict' }
    const t = setup({ online: false, now, store: memoryStore(JSON.stringify({ v: 1, ops: [old, fresh] })) })
    await t.queue.ready
    expect(t.queue.list().map((o) => o.id)).toEqual(['fresh-key-aaaaaaaaaaaa'])
    expect(t.queue.loadReport().dropped).toBe(1)
    expect(t.events.some((e) => e.type === 'dropped')).toBe(true)
  })

  it('clear() empties memory and storage', async () => {
    const t = setup({ online: false })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    await t.queue.clear()
    expect(t.queue.list()).toHaveLength(0)
    expect((t.store as any).value).toBeNull()
  })
})

describe('versioning and corruption', () => {
  const op = { id: 'aaaaaaaaaaaaaaaaaaaa', action: 'list-item.set-checked', v: 1, payload: tick('i'), createdAt: 1, state: 'pending', attempts: 0, nextAttemptAt: 0 }

  it('round-trips the current schema version', () => {
    const parsed = parseStoredQueue(JSON.stringify({ v: QUEUE_SCHEMA_VERSION, ops: [op] }))
    expect(parsed.dropped).toBe(0)
    expect(JSON.parse(serializeQueue(parsed.ops))).toMatchObject({ v: QUEUE_SCHEMA_VERSION, ops: [{ id: op.id, target: 'list-item:i' }] })
  })

  it.each([
    { v: 2, ops: [op] },
    { v: 1, ops: [op, { ...op, id: 'bbbbbbbbbbbbbbbbbbbb', v: 2 }] },
    { v: 1, ops: [op, { ...op, id: 'bbbbbbbbbbbbbbbbbbbb', action: 'future-action' }] },
  ])('retains unfamiliar stored work byte-for-byte without sending or overwriting it: %j', async container => {
    const raw = JSON.stringify(container, null, 2)
    const store = memoryStore(raw)
    const write = jest.spyOn(store, 'write')
    const remove = jest.spyOn(store, 'remove')
    const t = setup({ store })
    await t.queue.ready
    expect(t.queue.requiresCompatibleClient()).toBe(true)
    expect(t.queue.list()).toEqual([])
    expect(t.queue.loadReport()).toEqual({ dropped: 0 })
    await t.queue.drain()
    await t.queue.handleOnline()
    await t.queue.retry(op.id)
    await t.queue.discard(op.id)
    await expect(t.queue.enqueue('list-item.set-checked', tick('new'))).rejects.toMatchObject({ code: 'COMPATIBLE_CLIENT_REQUIRED' })
    expect(t.sent).toEqual([])
    expect(t.timers).toEqual([])
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(store.value).toBe(raw)
    t.queue.dispose()
    const restarted = setup({ store })
    await restarted.queue.ready
    await restarted.queue.drain()
    expect(restarted.queue.requiresCompatibleClient()).toBe(true)
    expect(restarted.sent).toEqual([])
    expect(store.value).toBe(raw)
    // Privacy purge is still explicit and terminal, including unfamiliar work.
    await restarted.queue.clear()
    expect(store.value).toBeNull()
    expect(restarted.queue.requiresCompatibleClient()).toBe(false)
  })

  it('does not let a foreign queue action turn into replay or a compatibility grant', async () => {
    const foreign = { ...op, action: 'device.list-item.set-checked', v: 2 }
    const t = setup({ online: false, store: memoryStore(JSON.stringify({ v: 1, ops: [foreign, op] })) })
    await t.queue.ready
    expect(t.queue.requiresCompatibleClient()).toBe(false)
    expect(t.queue.loadReport().dropped).toBe(1)
    expect(t.queue.list().map(o => o.id)).toEqual([op.id])
    expect(t.sent).toEqual([])
  })

  it('does not overwrite retained work if an explicit purge cannot remove storage', async () => {
    const store = memoryStore(JSON.stringify({ v: 2, ops: [op] }))
    jest.spyOn(store, 'remove').mockRejectedValue(new Error('blocked storage'))
    const original = store.value
    const t = setup({ store })
    await t.queue.ready
    await t.queue.clear()
    expect(t.queue.requiresCompatibleClient()).toBe(true)
    await expect(t.queue.enqueue('list-item.set-checked', tick('new'))).rejects.toMatchObject({ code: 'COMPATIBLE_CLIENT_REQUIRED' })
    expect(store.value).toBe(original)
    expect(t.sent).toEqual([])
  })

  it('drops unknown container versions, unknown operation versions, unknown actions and corrupt data', () => {
    expect(parseStoredQueue(JSON.stringify({ v: 99, ops: [op, op] }))).toEqual({ ops: [], dropped: 2 })
    expect(parseStoredQueue('{not json').dropped).toBe(1)
    expect(parseStoredQueue(JSON.stringify([op])).dropped).toBe(1)
    const mixed = parseStoredQueue(
      JSON.stringify({
        v: 1,
        ops: [
          op,
          { ...op, id: 'bbbbbbbbbbbbbbbbbbbb', v: 2 },
          { ...op, id: 'cccccccccccccccccccc', action: 'list-item.delete' },
          { ...op, id: 'dddddddddddddddddddd', payload: { itemId: 'i' } },
          { ...op, id: 'short' },
          { ...op }, // duplicate id
          { ...op, id: 'eeeeeeeeeeeeeeeeeeee', state: 'weird' },
        ],
      })
    )
    expect(mixed.ops.map((o) => o.id)).toEqual([op.id])
    expect(mixed.dropped).toBe(6)
  })

  it('an operation that was syncing when the app died is pending again (same key)', () => {
    const parsed = parseStoredQueue(JSON.stringify({ v: 1, ops: [{ ...op, state: 'syncing' }] }))
    expect(parsed.ops[0]).toMatchObject({ state: 'pending', id: op.id })
  })

  it('never keeps more than the maximum from storage', () => {
    const ops = Array.from({ length: QUEUE_MAX_OPS + 5 }, (_, i) => ({ ...op, id: `${'k'.repeat(16)}${i}`, payload: tick(`i${i}`) }))
    const parsed = parseStoredQueue(JSON.stringify({ v: 1, ops }))
    expect(parsed.ops).toHaveLength(QUEUE_MAX_OPS)
    expect(parsed.dropped).toBe(5)
  })
})

describe('backoff', () => {
  it('grows exponentially with jitter and is capped', () => {
    expect(backoffDelay(1, 0)).toBe(RETRY_BASE_DELAY_MS / 2)
    expect(backoffDelay(1, 1)).toBe(RETRY_BASE_DELAY_MS)
    expect(backoffDelay(3, 1)).toBe(RETRY_BASE_DELAY_MS * 4)
    for (let n = 1; n < 40; n++) {
      for (const r of [0, 0.3, 1, 7]) {
        const d = backoffDelay(n, r)
        expect(d).toBeLessThanOrEqual(RETRY_MAX_DELAY_MS)
        expect(d).toBeGreaterThanOrEqual(RETRY_BASE_DELAY_MS / 2)
      }
    }
    expect(backoffDelay(30, 1)).toBe(RETRY_MAX_DELAY_MS)
  })

  it('classifies responses', () => {
    expect(classifyResponse(200, null).kind).toBe('synced')
    expect(classifyResponse(401, null).kind).toBe('auth')
    expect(classifyResponse(409, { error: { code: 'IDEMPOTENCY_IN_PROGRESS' } }).kind).toBe('retry')
    expect(classifyResponse(429, null).kind).toBe('retry')
    expect(classifyResponse(500, null).kind).toBe('retry')
    expect(classifyResponse(404, null).kind).toBe('conflict')
    expect(classifyResponse(409, null).kind).toBe('conflict')
    expect(classifyResponse(400, null).kind).toBe('failed')
  })
})

describe('persistence across restart', () => {
  it('IndexedDB: a queued operation survives a new queue instance and syncs once with its key', async () => {
    const idb = new IDBFactory()
    const loc = queueLocation({ kind: 'person', userId: 'user-1' })
    const first = setup({ online: false, store: indexedDbQueueStore(idb, loc.dbName, loc.key) })
    const op = await first.queue.enqueue('list-item.set-checked', tick('item-1'))
    first.queue.dispose()

    const second = setup({ online: true, store: indexedDbQueueStore(idb, loc.dbName, loc.key) })
    await second.queue.ready
    expect(second.queue.list().map((o) => o.id)).toEqual([op.id])
    await second.queue.drain()
    expect(second.sent.map((s) => s.idempotencyKey)).toEqual([op.id])
    const third = setup({ online: true, store: indexedDbQueueStore(idb, loc.dbName, loc.key) })
    await third.queue.ready
    expect(third.queue.list()).toHaveLength(0)
  })

  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    const storage = new MemoryStorage()
    const loc = queueLocation({ kind: 'person', userId: 'user-1' })
    const broken = { open: () => { throw new Error('blocked') } } as unknown as IDBFactory
    const first = setup({ online: false, store: preferredQueueStore(loc, { indexedDB: broken, localStorage: storage }) })
    const op = await first.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(storage.keys()).toEqual(['fp-sync:v1:user-1:queue'])
    const second = setup({ online: false, store: localStorageQueueStore(storage, loc.key) })
    await second.queue.ready
    expect(second.queue.list()[0].id).toBe(op.id)
  })

  it('prefers IndexedDB when it works', async () => {
    const storage = new MemoryStorage()
    const idb = new IDBFactory()
    const loc = queueLocation({ kind: 'person', userId: 'user-1' })
    const t = setup({ online: false, store: preferredQueueStore(loc, { indexedDB: idb, localStorage: storage }) })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(storage.keys()).toEqual([])
    expect(await indexedDbQueueStore(idb, loc.dbName, loc.key).read()).toContain('item-1')
  })
})

describe('namespaces, logout and device purge', () => {
  it('scopes person queues by user id', () => {
    expect(queueLocation({ kind: 'person', userId: 'u1' }).key).toBe('fp-sync:v1:u1:queue')
    expect(queueLocation({ kind: 'person', userId: 'u2' }).key).not.toBe(queueLocation({ kind: 'person', userId: 'u1' }).key)
    expect(() => queueLocation({ kind: 'person', userId: '../x' })).toThrow()
  })

  it('logout clears every person queue on the browser (localStorage and IndexedDB)', async () => {
    const storage = new MemoryStorage()
    storage.setItem('fp-sync:v1:u1:queue', '{}')
    storage.setItem('fp-sync:v1:u2:queue', '{}')
    storage.setItem('familyPlanner_theme', 'dark')
    const idb = new IDBFactory()
    const loc = queueLocation({ kind: 'person', userId: 'u1' })
    await indexedDbQueueStore(idb, loc.dbName, loc.key).write('x')
    await clearPersonQueues({
      storages: [storage],
      deleteIndexedDb: (name) =>
        new Promise<void>((resolve) => {
          const req = idb.deleteDatabase(name)
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
        }),
    })
    expect(storage.keys()).toEqual(['familyPlanner_theme'])
    expect(await indexedDbQueueStore(idb, loc.dbName, loc.key).read()).toBeNull()
  })

  it('the device queue uses the reserved fp-device key and database, which the §8 purge deletes', async () => {
    expect(queueLocation({ kind: 'device' })).toEqual({ dbName: DEVICE_IDB_NAME, key: DEVICE_QUEUE_KEY })
    const storage = new MemoryStorage()
    const t = setup({ online: false, store: localStorageQueueStore(storage, DEVICE_QUEUE_KEY) })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(storage.keys()).toEqual([DEVICE_QUEUE_KEY])
    const deleted: string[] = []
    const client = createDeviceClient({
      fetch: async () => new Response(null, { status: 404 }),
      csrfToken: () => null,
      now: () => 0,
      isVisible: () => true,
      storages: () => [storage],
      deleteIndexedDb: async (name: string) => {
        deleted.push(name)
      },
      clearCaches: async () => {},
      navigate: () => {},
    })
    await client.purge()
    expect(storage.keys()).toEqual([])
    expect(deleted).toContain(DEVICE_IDB_NAME)
  })
})

describe('offline: no retry timers (Codex P1 on #247)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  function realTimerQueue(online: { value: boolean }, send: OfflineQueueDeps['send']) {
    let n = 0
    return createOfflineQueue({
      store: memoryStore(),
      send,
      now: () => Date.now(),
      random: () => 0.5,
      newKey: () => `offline-key-${++n}-aaaaaaaaaa`,
      isOnline: () => online.value,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
  }

  it('a due operation while offline schedules no timer, and draining resumes on online', async () => {
    jest.useFakeTimers()
    const online = { value: false }
    const sent: SendRequest[] = []
    const queue = realTimerQueue(online, async (r) => {
      sent.push(r)
      return { status: 200, body: null }
    })
    await queue.enqueue('list-item.set-checked', tick('item-1'))
    for (let i = 0; i < 5; i++) await queue.drain()
    expect(jest.getTimerCount()).toBe(0)
    // Time passing during the outage does nothing at all.
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(jest.getTimerCount()).toBe(0)
    expect(sent).toHaveLength(0)
    expect(queue.list()[0]).toMatchObject({ state: 'pending', attempts: 0 })

    online.value = true
    await queue.handleOnline()
    expect(sent).toHaveLength(1)
    expect(queue.list()).toHaveLength(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('a backoff timer that fires after the connection dropped does not re-arm itself', async () => {
    jest.useFakeTimers()
    const online = { value: true }
    let fail = true
    const sent: SendRequest[] = []
    const queue = realTimerQueue(online, async (r) => {
      sent.push(r)
      if (fail) throw new TypeError('Failed to fetch')
      return { status: 200, body: null }
    })
    await queue.enqueue('list-item.set-checked', tick('item-1'))
    await jest.advanceTimersByTimeAsync(0)
    expect(sent).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(1) // backoff while online

    online.value = false
    await jest.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS)
    expect(jest.getTimerCount()).toBe(0)
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(sent).toHaveLength(1)

    fail = false
    online.value = true
    await queue.handleOnline()
    expect(sent).toHaveLength(2)
    expect(queue.list()).toHaveLength(0)
  })
})

describe('durability (Codex P2 on #247)', () => {
  function flakyStore(): QueueStore & { failing: boolean; value: string | null } {
    const s = {
      failing: false,
      value: null as string | null,
      read: async () => s.value,
      write: async (v: string) => {
        if (s.failing) throw new DOMException('quota', 'QuotaExceededError')
        s.value = v
      },
      remove: async () => {
        if (s.failing) throw new DOMException('quota', 'QuotaExceededError')
        s.value = null
      },
    }
    return s
  }

  it('reports a failed write: enqueue says not durable, the queue says so, and it recovers', async () => {
    const store = flakyStore()
    const t = setup({ online: false, store })
    const first = await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(first.durable).toBe(true)
    expect(t.queue.isDurable()).toBe(true)

    store.failing = true
    const changes = t.events.length
    const second = await t.queue.enqueue('list-item.set-checked', tick('item-2'))
    expect(second.durable).toBe(false)
    expect(t.queue.isDurable()).toBe(false)
    expect(t.events.length).toBeGreaterThan(changes)
    // Still queued in memory and still sent once the network is back.
    expect(t.queue.list().filter(isCheckedOperation).map((o) => o.payload.itemId)).toEqual(['item-1', 'item-2'])
    expect(store.value).not.toContain('item-2')

    store.failing = false
    const third = await t.queue.enqueue('list-item.set-checked', tick('item-3'))
    expect(third.durable).toBe(true)
    expect(t.queue.isDurable()).toBe(true)
    expect(store.value).toContain('item-2')
    t.setOnline(true)
    await t.queue.handleOnline()
    expect(t.sent).toHaveLength(3)
  })

  it('falls back to the next store when the current one starts refusing writes', async () => {
    const primary = flakyStore()
    const secondary = flakyStore()
    const store = fallbackQueueStore([primary, secondary])
    const t = setup({ online: false, store })
    await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(primary.value).toContain('item-1')

    primary.failing = true
    const op = await t.queue.enqueue('list-item.set-checked', tick('item-2'))
    expect(op.durable).toBe(true)
    expect(secondary.value).toContain('item-2')
    expect(secondary.value).toContain('item-1')

    // A restart reads the store that holds the data.
    primary.failing = false
    const reread = await store.read()
    expect(reread).toContain('item-2')
  })

  it('is not durable when every store refuses writes, and never pretends to be', async () => {
    const a = flakyStore()
    const b = flakyStore()
    a.failing = true
    b.failing = true
    const store = fallbackQueueStore([a, b])
    await expect(store.write('x')).rejects.toBeInstanceOf(QueueStorageError)
    const t = setup({ online: false, store })
    const op = await t.queue.enqueue('list-item.set-checked', tick('item-1'))
    expect(op.durable).toBe(false)
    expect(t.queue.isDurable()).toBe(false)
  })

  it('with no readable store at all, reads are empty and writes are not durable', async () => {
    const broken: QueueStore = {
      read: async () => {
        throw new Error('blocked')
      },
      write: async () => {
        throw new Error('blocked')
      },
      remove: async () => {
        throw new Error('blocked')
      },
    }
    const store = fallbackQueueStore([broken])
    expect(await store.read()).toBeNull()
    await expect(store.write('x')).rejects.toBeInstanceOf(QueueStorageError)
    const none = preferredQueueStore(queueLocation({ kind: 'person', userId: 'u1' }), {})
    await expect(none.write('x')).rejects.toBeInstanceOf(QueueStorageError)
  })
})

// #274: the shared tablet's queue variant (SHARED_DEVICE.md §9.2).
describe('device queue variant', () => {
  const deviceTick = (itemId: string, checked = true) => ({ itemId, checked, actingMemberId: 'member-1' })

  it('sends a tick to the device route with the picked member and the key as Idempotency-Key', async () => {
    const t = setup({ namespace: 'device' })
    const op = await t.queue.enqueue('device.list-item.set-checked', { ...deviceTick('item-1'), content: 'Secret milk' })
    await flush()
    expect(t.sent).toEqual([
      {
        method: 'PATCH',
        path: '/api/device/lists/items/item-1',
        body: { checked: true, actingMemberId: 'member-1' },
        idempotencyKey: op.id,
      },
    ])
    expect(t.queue.list()).toEqual([])
    expect((t.store as any).value).toBeNull()
  })

  it('a device queue refuses person actions and a person queue refuses device actions', async () => {
    const device = setup({ namespace: 'device', online: false })
    await expect(device.queue.enqueue('list-item.set-checked', { itemId: 'x', checked: true })).rejects.toMatchObject({
      code: 'NOT_QUEUEABLE',
    })
    const person = setup({ online: false })
    await expect(person.queue.enqueue('device.list-item.set-checked', deviceTick('x'))).rejects.toMatchObject({
      code: 'NOT_QUEUEABLE',
    })
  })

  it('requires a well-formed actingMemberId', async () => {
    const t = setup({ namespace: 'device', online: false })
    for (const bad of [{ itemId: 'x', checked: true }, { itemId: 'x', checked: true, actingMemberId: 'a b' }]) {
      await expect(t.queue.enqueue('device.list-item.set-checked', bad)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    }
  })

  it('drops stored operations of the other namespace on load', () => {
    const stored = serializeQueue([
      {
        id: 'key-0001-abcdefghijkl',
        action: 'list-item.set-checked',
        v: 1,
        target: 'list-item:a',
        payload: { itemId: 'a', checked: true },
        createdAt: 1,
        state: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
      },
      {
        id: 'key-0002-abcdefghijkl',
        action: 'device.list-item.set-checked',
        v: 1,
        target: 'list-item:b',
        payload: { itemId: 'b', checked: true, actingMemberId: 'm' },
        createdAt: 1,
        state: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
      },
    ])
    expect(parseStoredQueue(stored, 'device').ops.filter(isCheckedOperation).map((o) => o.payload.itemId)).toEqual(['b'])
    expect(parseStoredQueue(stored, 'device').dropped).toBe(1)
    expect(parseStoredQueue(stored).ops.filter(isCheckedOperation).map((o) => o.payload.itemId)).toEqual(['a'])
  })

  it('a terminal device answer (401) drops the whole queue, a conflict stays visible', async () => {
    const t = setup({
      namespace: 'device',
      replies: [{ status: 404, body: { error: { code: 'NOT_FOUND' } } }],
    })
    await t.queue.enqueue('device.list-item.set-checked', deviceTick('gone'))
    await flush()
    expect(t.queue.list()[0]).toMatchObject({ state: 'conflict', lastError: 'NOT_FOUND' })

    const revoked = setup({ namespace: 'device', replies: [{ status: 401, body: { error: { code: 'DEVICE_REVOKED' } } }] })
    await revoked.queue.enqueue('device.list-item.set-checked', deviceTick('a'))
    await flush()
    expect(revoked.queue.list()).toEqual([])
    expect(revoked.events.some((e) => e.type === 'auth-lost')).toBe(true)
  })
})

// #274: a device purge while a send is in flight must not write the queue back.
describe('abandon (device purge)', () => {
  it('drops the in-flight operation and never persists again', async () => {
    const store = memoryStore()
    const writes: string[] = []
    const write = store.write
    store.write = async (v: string) => {
      writes.push(v)
      await write(v)
    }
    let release!: (r: { status: number; body: unknown }) => void
    const queue = createOfflineQueue({
      namespace: 'device',
      store,
      send: () => new Promise((resolve) => (release = resolve)),
      now: () => 1_000_000,
      random: () => 0.5,
      newKey: () => 'key-0001-abcdefghijkl',
      isOnline: () => true,
      setTimer: () => 0,
      clearTimer: () => undefined,
    })
    await queue.enqueue('device.list-item.set-checked', { itemId: 'item-1', checked: true, actingMemberId: 'm' })
    await flush()
    expect(queue.list()[0].state).toBe('syncing')

    // The purge deletes the stored queue, then the queue is abandoned...
    store.value = null
    const before = writes.length
    queue.abandon()
    expect(queue.list()).toEqual([])
    // ...and the answer that arrives afterwards (the kill-switch 404) changes nothing.
    release({ status: 404, body: { error: { code: 'NOT_FOUND' } } })
    await flush()
    expect(writes.length).toBe(before)
    expect(store.value).toBeNull()
    expect(queue.list()).toEqual([])
  })
})

describe('content-free sync diagnostics', () => {
  it('reports offline depth, state and durability without identifiers or content', async () => {
    const t = setup({ online: false, store: { read: async () => null, write: async () => { throw Error('blocked') }, remove: async () => {} } })
    await t.queue.enqueue('list-item.set-checked', { itemId: 'private-item-identifier', checked: true, name: 'PRIVATE GROCERY TEXT', token: 'PRIVATE TOKEN' })
    const report = t.queue.diagnostics()
    expect(report).toEqual({ version: 1, depth: 1, states: { pending: 1, syncing: 0, failed: 0, conflict: 0 }, durable: false, dropped: 0, replay: { attempts: 0, completed: 0, successes: 0, failures: 0, conflicts: 0 }, rates: { success: null, failure: null, conflict: null } })
    expect(JSON.stringify(report)).not.toMatch(/private-item|PRIVATE|key-|itemId|payload|target|createdAt|lastError/)
    report.states.pending = 999
    report.replay.attempts = 999
    expect(t.queue.diagnostics().states.pending).toBe(1)
    expect(t.queue.diagnostics().replay.attempts).toBe(0)
  })

  it('counts completed sends, including retry failure and conflict, without server bodies', async () => {
    const t = setup({ online: false, replies: ['network', { status: 409, body: { error: { code: 'CONFLICT', message: 'PRIVATE SERVER CONTENT' } } }, { status: 200, body: { item: 'PRIVATE SUCCESS BODY' } }] })
    await t.queue.enqueue('list-item.set-checked', tick('a'))
    t.setOnline(true)
    await t.queue.handleOnline()
    expect(t.queue.diagnostics().replay).toEqual({ attempts: 1, completed: 1, successes: 0, failures: 1, conflicts: 0 })
    await t.queue.handleOnline()
    expect(t.queue.diagnostics().states.conflict).toBe(1)
    await t.queue.retry(t.queue.list()[0].id)
    await t.queue.drain()
    const d = t.queue.diagnostics()
    expect(d.depth).toBe(0)
    expect(d.replay).toEqual({ attempts: 3, completed: 3, successes: 1, failures: 2, conflicts: 1 })
    expect(d.rates).toEqual({ success: 1 / 3, failure: 2 / 3, conflict: 1 / 3 })
    expect(JSON.stringify(d)).not.toMatch(/PRIVATE|key-|CONFLICT/)
    expect(JSON.stringify(t.store)).not.toContain('replay')
  })

  it('counts load cleanup and resets on clear, auth loss and disposal', async () => {
    const corrupt = setup({ store: memoryStore('{broken') })
    await corrupt.queue.ready
    expect(corrupt.queue.diagnostics().dropped).toBeGreaterThan(0)
    await corrupt.queue.clear()
    expect(corrupt.queue.diagnostics().dropped).toBe(0)
    const t = setup({ replies: [{ status: 401 }] })
    await t.queue.enqueue('list-item.set-checked', tick('a'))
    await t.queue.drain()
    expect(t.queue.diagnostics().replay.attempts).toBe(0)
    expect(t.queue.diagnostics().depth).toBe(0)
    const q = setup({ online: false })
    await q.queue.enqueue('list-item.set-checked', tick('b'))
    q.queue.dispose()
    expect(q.queue.diagnostics().depth).toBe(0)
  })

  it('does not attribute an old in-flight response to a reset report', async () => {
    let resolve!: (v: { status: number; body: unknown }) => void
    const queue = createOfflineQueue({ store: memoryStore(), send: () => new Promise(r => { resolve = r }), now: () => 1000, random: () => 0, newKey: () => 'diagnostics-abcdefghijkl', isOnline: () => true, setTimer: () => null, clearTimer: () => {} })
    await queue.enqueue('list-item.set-checked', tick('a'))
    await flush()
    expect(queue.diagnostics().replay.attempts).toBe(1)
    queue.resetDiagnostics()
    resolve({ status: 200, body: { private: 'DO NOT REPORT' } })
    await queue.drain()
    expect(queue.diagnostics().replay).toEqual({ attempts: 0, completed: 0, successes: 0, failures: 0, conflicts: 0 })
    expect(queue.diagnostics().depth).toBe(0)
  })
})

describe('bounded device grocery creates', () => {
  const add = { listId: 'list-a', content: 'Milk', actingMemberId: 'member-a' }
  it('accepts only minimal validated grocery payloads in the device namespace', async () => {
    const t = setup({ namespace: 'device', online: false })
    await t.queue.enqueue('device.list-item.add', { ...add, content: '  Milk  ', notes: 'PRIVATE NOTES', token: 'SECRET', price: 99 })
    expect(t.queue.list()[0].payload).toEqual(add)
    const stored = (t.store as ReturnType<typeof memoryStore>).value!
    expect(stored).not.toMatch(/PRIVATE|SECRET|price|notes/)
    expect(parseStoredQueue(stored).ops).toEqual([])
    const person = setup({ online: false })
    await expect(person.queue.enqueue('device.list-item.add', add)).rejects.toMatchObject({ code: 'NOT_QUEUEABLE' })
    for (const payload of [{ ...add, listId: '../foreign' }, { ...add, actingMemberId: '' }, { ...add, content: ' ' }, { ...add, content: 'x'.repeat(201) }]) await expect(t.queue.enqueue('device.list-item.add', payload)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
    expect(JSON.stringify(t.queue.diagnostics())).not.toMatch(/Milk|list-a|member-a/)
  })
  it('preserves separate identical adds and their unique targets across a restart', async () => {
    const t = setup({ namespace: 'device', online: false })
    const first = await t.queue.enqueue('device.list-item.add', add)
    const second = await t.queue.enqueue('device.list-item.add', add)
    expect(first.id).not.toBe(second.id)
    expect(t.queue.list()).toHaveLength(2)
    expect(first.target).not.toBe(second.target)
    const stored = JSON.parse((t.store as ReturnType<typeof memoryStore>).value!)
    stored.ops[0].target = stored.ops[1].target
    const restored = parseStoredQueue(JSON.stringify(stored), 'device').ops
    expect(restored.map(o => o.target)).toEqual([first.target, second.target])
  })
  it('replays an uncertain create after restart with the original body, member and key', async () => {
    const t = setup({ namespace: 'device', replies: ['network'] })
    const op = await t.queue.enqueue('device.list-item.add', add)
    await t.queue.drain()
    const stored = (t.store as ReturnType<typeof memoryStore>).value!
    t.queue.dispose()
    const restarted = setup({ namespace: 'device', store: memoryStore(stored), now: t.now + 10000 })
    await restarted.queue.drain()
    expect(restarted.sent).toEqual([{ method: 'POST', path: '/api/device/lists/list-a/items', body: { content: 'Milk', actingMemberId: 'member-a' }, idempotencyKey: op.id }])
    expect(restarted.queue.list()).toEqual([])
  })
  it('does not renew an expired create or replace a rejected reused key', async () => {
    const t = setup({ namespace: 'device', online: false })
    const op = await t.queue.enqueue('device.list-item.add', add)
    await t.advance(QUEUE_MAX_AGE_MS + 1)
    t.setOnline(true)
    await t.queue.drain()
    await t.queue.retry(op.id)
    await t.queue.drain()
    expect(t.sent).toEqual([])
    expect(t.queue.list()[0]).toMatchObject({ id: op.id, createdAt: op.createdAt, state: 'failed', lastError: 'EXPIRED' })
    const reused = setup({ namespace: 'device', replies: [{ status: 422, body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } } }] })
    const rejected = await reused.queue.enqueue('device.list-item.add', add)
    await reused.queue.drain()
    await reused.queue.retry(rejected.id)
    expect(reused.sent).toHaveLength(1)
    expect(reused.queue.list()[0].id).toBe(rejected.id)
  })
  it('does not rehydrate or write a purged queue when an initial storage read arrives late', async () => {
    const t = setup({ namespace: 'device', online: false })
    await t.queue.enqueue('device.list-item.add', add)
    const raw = (t.store as ReturnType<typeof memoryStore>).value!
    let resolve!: (value: string) => void
    const write = jest.fn(), remove = jest.fn()
    const late = setup({ namespace: 'device', store: { read: () => new Promise(r => { resolve = r }), write, remove } })
    late.queue.abandon()
    resolve(raw)
    await late.queue.ready
    await late.queue.drain()
    expect(late.queue.list()).toEqual([])
    expect(late.sent).toEqual([])
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('minimal personal grocery creates', () => {
  const add = { listId: 'list-a', content: 'Milk' }
  it('minimises personal payload and refuses cross-namespace storage/replay', async () => {
    const t = setup({ online: false })
    await t.queue.enqueue('list-item.grocery-add', { ...add, content: '  Milk  ', notes: 'PRIVATE', actingMemberId: 'foreign', token: 'SECRET' })
    expect(t.queue.list()[0].payload).toEqual(add)
    const raw = (t.store as ReturnType<typeof memoryStore>).value!
    expect(raw).not.toMatch(/PRIVATE|SECRET|actingMemberId|notes/)
    expect(parseStoredQueue(raw, 'device').ops).toEqual([])
    const device = setup({ namespace: 'device', online: false })
    await expect(device.queue.enqueue('list-item.grocery-add', add)).rejects.toMatchObject({ code: 'NOT_QUEUEABLE' })
    for (const payload of [{ ...add, listId: '../x' }, { ...add, content: ' ' }, { ...add, content: 'x'.repeat(501) }])
      await expect(t.queue.enqueue('list-item.grocery-add', payload)).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
  })
  it('preserves separate same-text intents and uncertain same-key/body replay after restart', async () => {
    const t = setup({ replies: ['network'], online: false })
    const first = await t.queue.enqueue('list-item.grocery-add', add)
    const second = await t.queue.enqueue('list-item.grocery-add', add)
    expect(first.target).not.toBe(second.target)
    t.setOnline(true); await t.queue.drain()
    const raw = (t.store as ReturnType<typeof memoryStore>).value!
    t.queue.dispose()
    const restarted = setup({ store: memoryStore(raw), now: t.now + 10000 })
    await restarted.queue.drain()
    expect(restarted.sent[0]).toEqual({ method: 'POST', path: '/api/lists/items/grocery-add', body: add, idempotencyKey: first.id })
    expect(restarted.sent.map(x => x.idempotencyKey)).toEqual([first.id, second.id])
  })
  it('never renews expired or rejected create keys and clears submitted text on terminal auth', async () => {
    const t = setup({ online: false })
    const op = await t.queue.enqueue('list-item.grocery-add', add)
    await t.advance(QUEUE_MAX_AGE_MS + 1); t.setOnline(true)
    await t.queue.drain(); await t.queue.retry(op.id)
    expect(t.sent).toEqual([])
    expect(t.queue.list()[0]).toMatchObject({ id: op.id, createdAt: op.createdAt, state: 'failed', lastError: 'EXPIRED' })
    const reused = setup({ replies: [{ status: 422, body: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } } }] })
    const key = (await reused.queue.enqueue('list-item.grocery-add', add)).id
    await reused.queue.drain(); await reused.queue.retry(key)
    expect(reused.sent).toHaveLength(1); expect(reused.queue.list()[0].id).toBe(key)
    const auth = setup({ replies: [{ status: 401 }] })
    await auth.queue.enqueue('list-item.grocery-add', add); await auth.queue.drain()
    expect(auth.queue.list()).toEqual([])
    expect((auth.store as ReturnType<typeof memoryStore>).value).toBeNull()
  })
})
