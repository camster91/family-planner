/**
 * Bounded offline mutation queue (#162). Contract, states and policy numbers:
 * docs/architecture/OFFLINE_SYNC.md.
 *
 * - Only actions in `QUEUEABLE_ACTIONS` can be queued. There is no generic
 *   "replay this request" path: each action has a fixed method, path, payload
 *   parser (which keeps ids and the desired state only) and version.
 * - Every operation carries its own idempotency key, generated once when it is
 *   queued and reused for every retry, so a retry after a lost response is
 *   replayed by the server instead of applied twice.
 * - States: pending -> syncing -> synced (removed), or failed / conflict,
 *   which stay visible until the person retries or discards them.
 * - Bounds: at most QUEUE_MAX_OPS operations; a pending operation older than
 *   QUEUE_MAX_AGE_MS stops being sent and becomes `failed` (EXPIRED).
 * - Retry: bounded exponential backoff with jitter, at most RETRY_MAX_ATTEMPTS
 *   sends; one drain at a time (single flight); an `online` event retries now.
 * - A 401 from the server is terminal: the whole queue is dropped.
 *
 * Storage, network, clock, randomness and timers are injected so the module
 * is unit-testable without a DOM (src/lib/__tests__/offline-queue.test.ts).
 * Browser wiring: src/lib/offline-queue-browser.ts.
 */
import { DEVICE_IDB_NAME, DEVICE_QUEUE_KEY } from '@/lib/device-client'

// ---------------------------------------------------------------------------
// Policy. Product policy numbers, documented in OFFLINE_SYNC.md; change them
// here and there together.

/** Version of the stored queue container. Unknown versions are dropped on load. */
export const QUEUE_SCHEMA_VERSION = 1
/** Maximum operations kept (all states). Enqueueing beyond it is refused, never evicts. */
export const QUEUE_MAX_OPS = 50
/** A pending operation older than this is no longer sent automatically (24 h). */
export const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000
/**
 * A failed or conflicted operation older than this is dropped on load: the
 * server keeps idempotency records for 7 days, so an older retry could no
 * longer be de-duplicated.
 */
export const QUEUE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const RETRY_BASE_DELAY_MS = 1000
export const RETRY_MAX_DELAY_MS = 60 * 1000
/** Sends per operation (first try included) before it becomes `failed`. */
export const RETRY_MAX_ATTEMPTS = 8

// ---------------------------------------------------------------------------
// Allowlist.

export interface SetCheckedPayload {
  itemId: string
  checked: boolean
  /**
   * Device variant only (#274): the household member picked with "Who's this?"
   * on a shared tablet (SHARED_DEVICE.md O-5). Person operations never carry it.
   */
  actingMemberId?: string
}

interface ActionSpec<P> {
  /** Operation schema version for this action. Stored operations of another version are dropped. */
  version: number
  /** Which queue may hold it: a person's queue or the shared tablet's (#274). */
  namespace: QueueNamespace['kind']
  method: 'PATCH' | 'POST'
  /** Fixed path, or a fixed pattern filled with the payload's validated id. */
  path: string | ((payload: P) => string)
  /** Returns the minimal payload (ids and desired state only), or null when invalid. */
  parse(payload: unknown): P | null
  body(payload: P): Record<string, unknown>
  /** Operations on the same target supersede each other (latest intent wins). */
  target(payload: P): string
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The only actions that may be queued offline. Reviewed per OFFLINE_SYNC.md
 * "Offline mutation allowlist": non-destructive, explicit-state, no finance,
 * verification, account or re-authentication semantics. Adding one needs its
 * domain issue, an idempotent server route and an update to that document.
 */
export const QUEUEABLE_ACTIONS = {
  /** Tick or untick a list item (grocery list proof action). Explicit state, not a toggle. */
  'list-item.set-checked': {
    version: 1,
    namespace: 'person',
    method: 'PATCH',
    path: '/api/lists/items/update',
    parse(payload: unknown): SetCheckedPayload | null {
      if (!isRecord(payload)) return null
      const { itemId, checked } = payload
      if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId) || typeof checked !== 'boolean') return null
      return { itemId, checked }
    },
    body: (p: SetCheckedPayload) => ({ itemId: p.itemId, checked: p.checked }),
    target: (p: SetCheckedPayload) => `list-item:${p.itemId}`,
  } satisfies ActionSpec<SetCheckedPayload>,
  /**
   * Shared tablet grocery tick/untick (#274, SHARED_DEVICE.md §9.2): the same
   * explicit desired state, sent to the device route with the member picked
   * with "Who's this?". Only the device queue (`fp-device:v1:queue`, purged
   * with the rest of the tablet's storage) may hold it.
   */
  'device.list-item.set-checked': {
    version: 1,
    namespace: 'device',
    method: 'PATCH',
    path: (p: SetCheckedPayload) => `/api/device/lists/items/${encodeURIComponent(p.itemId)}`,
    parse(payload: unknown): SetCheckedPayload | null {
      if (!isRecord(payload)) return null
      const { itemId, checked, actingMemberId } = payload
      if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId) || typeof checked !== 'boolean') return null
      if (typeof actingMemberId !== 'string' || !ID_PATTERN.test(actingMemberId)) return null
      return { itemId, checked, actingMemberId }
    },
    body: (p: SetCheckedPayload) => ({ checked: p.checked, actingMemberId: p.actingMemberId }),
    target: (p: SetCheckedPayload) => `list-item:${p.itemId}`,
  } satisfies ActionSpec<SetCheckedPayload>,
} as const

export type QueueableAction = keyof typeof QUEUEABLE_ACTIONS
type PayloadOf<A extends QueueableAction> = NonNullable<ReturnType<(typeof QUEUEABLE_ACTIONS)[A]['parse']>>

export function isQueueableAction(action: unknown): action is QueueableAction {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(QUEUEABLE_ACTIONS, action)
}

function specOf(action: QueueableAction): ActionSpec<any> {
  return QUEUEABLE_ACTIONS[action] as ActionSpec<any>
}

// ---------------------------------------------------------------------------
// Types.

export type QueueState = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict'

export interface QueuedOperation {
  /** Also the Idempotency-Key sent with every attempt. */
  id: string
  action: QueueableAction
  /** Operation schema version (the action spec's `version`). */
  v: number
  target: string
  payload: SetCheckedPayload
  /** Client clock, epoch ms. UX and max age only; never used for server ordering. */
  createdAt: number
  state: QueueState
  attempts: number
  nextAttemptAt: number
  /** Machine code of the last failure (never server text or item content). */
  lastError?: string
}

export type QueueErrorCode = 'NOT_QUEUEABLE' | 'INVALID_PAYLOAD' | 'QUEUE_FULL'

export class QueueError extends Error {
  readonly code: QueueErrorCode
  constructor(code: QueueErrorCode) {
    super(code)
    this.name = 'QueueError'
    this.code = code
  }
}

export interface QueueStore {
  read(): Promise<string | null>
  write(value: string): Promise<void>
  remove(): Promise<void>
}

export interface SendRequest {
  method: string
  path: string
  body: Record<string, unknown>
  idempotencyKey: string
}

/** Resolve with the HTTP outcome; reject only when the network failed. */
export type SendFn = (request: SendRequest) => Promise<{ status: number; body: unknown }>

export interface OfflineQueueDeps {
  /**
   * Which actions this queue accepts (default `person`). A stored operation of
   * the other namespace is dropped on load and enqueueing one is refused.
   */
  namespace?: QueueNamespace['kind']
  store: QueueStore
  send: SendFn
  now: () => number
  random: () => number
  newKey: () => string
  isOnline: () => boolean
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export interface LoadReport {
  /** Operations that could not be kept (corrupt, unknown version, too old, over the limit). */
  dropped: number
}

/** Content-free, page-session support metrics. Never persisted or transmitted by the queue. */
export interface QueueDiagnostics {
  version: 1
  depth: number
  states: { pending: number; syncing: number; failed: number; conflict: number }
  durable: boolean
  dropped: number
  replay: { attempts: number; completed: number; successes: number; failures: number; conflicts: number }
  /** Fractions of completed sends, null when no send has completed. Conflicts are also failures. */
  rates: { success: number | null; failure: number | null; conflict: number | null }
}

export type QueueEvent =
  | { type: 'change' }
  | { type: 'synced'; op: QueuedOperation; body: unknown }
  | { type: 'auth-lost' }
  | { type: 'dropped'; count: number }

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests).

/** Equal-jitter exponential backoff, capped at RETRY_MAX_DELAY_MS. `attempts` >= 1. */
export function backoffDelay(attempts: number, random: number): number {
  const exp = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1))
  const r = Math.min(1, Math.max(0, random))
  return Math.round(exp / 2 + (r * exp) / 2)
}

export type Outcome =
  | { kind: 'synced' }
  | { kind: 'retry'; code: string }
  | { kind: 'failed'; code: string }
  | { kind: 'conflict'; code: string }
  | { kind: 'auth'; code: string }

function errorCode(body: unknown): string | null {
  if (!isRecord(body)) return null
  const err = body.error
  if (isRecord(err) && typeof err.code === 'string') return err.code
  return null
}

/** How the queue treats an HTTP status (OFFLINE_SYNC.md "Retry"). */
export function classifyResponse(status: number, body: unknown): Outcome {
  const code = errorCode(body)
  if (status >= 200 && status < 300) return { kind: 'synced' }
  if (status === 401) return { kind: 'auth', code: code ?? 'UNAUTHORIZED' }
  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') return { kind: 'retry', code }
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { kind: 'retry', code: `HTTP_${status}` }
  if (status === 404) return { kind: 'conflict', code: 'NOT_FOUND' }
  if (status === 409) return { kind: 'conflict', code: code ?? 'CONFLICT' }
  if (status === 422 && code === 'IDEMPOTENCY_KEY_REUSED') return { kind: 'failed', code }
  if (status === 403) return { kind: 'failed', code: 'FORBIDDEN' }
  return { kind: 'failed', code: `HTTP_${status}` }
}

const STATES = new Set<QueueState>(['pending', 'syncing', 'synced', 'failed', 'conflict'])
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

function reviveOperation(raw: unknown, namespace: QueueNamespace['kind']): QueuedOperation | null {
  if (!isRecord(raw)) return null
  const { id, action, v, payload, createdAt, state, attempts, nextAttemptAt, lastError } = raw
  if (typeof id !== 'string' || !KEY_PATTERN.test(id)) return null
  if (!isQueueableAction(action)) return null
  const spec = specOf(action)
  if (spec.namespace !== namespace) return null
  if (v !== spec.version) return null
  const parsed = spec.parse(payload)
  if (!parsed) return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  if (typeof state !== 'string' || !STATES.has(state as QueueState) || state === 'synced') return null
  return {
    id,
    action,
    v: spec.version,
    target: spec.target(parsed),
    payload: parsed,
    createdAt,
    // A send that was in flight when the app died is retried with the same key.
    state: state === 'syncing' ? 'pending' : (state as QueueState),
    attempts: typeof attempts === 'number' && attempts >= 0 ? Math.floor(attempts) : 0,
    nextAttemptAt: typeof nextAttemptAt === 'number' && Number.isFinite(nextAttemptAt) ? nextAttemptAt : 0,
    lastError: typeof lastError === 'string' && /^[A-Z0-9_]{1,40}$/.test(lastError) ? lastError : undefined,
  }
}

/** Parse a stored container. Anything unreadable counts as dropped. */
export function parseStoredQueue(
  text: string | null,
  namespace: QueueNamespace['kind'] = 'person'
): { ops: QueuedOperation[]; dropped: number } {
  if (text === null) return { ops: [], dropped: 0 }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ops: [], dropped: 1 }
  }
  if (!isRecord(data) || !Array.isArray(data.ops)) return { ops: [], dropped: 1 }
  if (data.v !== QUEUE_SCHEMA_VERSION) return { ops: [], dropped: Math.max(1, data.ops.length) }
  const ops: QueuedOperation[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const raw of data.ops) {
    const op = reviveOperation(raw, namespace)
    if (!op || seen.has(op.id) || ops.length >= QUEUE_MAX_OPS) {
      dropped++
      continue
    }
    seen.add(op.id)
    ops.push(op)
  }
  return { ops, dropped }
}

export function serializeQueue(ops: QueuedOperation[]): string {
  return JSON.stringify({ v: QUEUE_SCHEMA_VERSION, ops })
}

// ---------------------------------------------------------------------------
// The queue.

export type OfflineQueue = ReturnType<typeof createOfflineQueue>

export function createOfflineQueue(deps: OfflineQueueDeps) {
  const namespace = deps.namespace ?? 'person'
  let ops: QueuedOperation[] = []
  let draining: Promise<void> | null = null
  let timer: unknown = null
  let disposed = false
  const listeners = new Set<(event: QueueEvent) => void>()
  let loadReport: LoadReport = { dropped: 0 }
  /** False while the last write to storage failed (see `persist`). */
  let durable = true
  let diagnosticGeneration = 0
  let counters = { attempts: 0, completed: 0, successes: 0, failures: 0, conflicts: 0, dropped: 0 }
  const increment = (key: keyof typeof counters, count = 1) => {
    if (disposed) return
    counters[key] = Math.min(Number.MAX_SAFE_INTEGER, counters[key] + count)
  }
  const resetDiagnostics = () => {
    diagnosticGeneration++
    counters = { attempts: 0, completed: 0, successes: 0, failures: 0, conflicts: 0, dropped: 0 }
  }
  function diagnostics(): QueueDiagnostics {
    const states = { pending: 0, syncing: 0, failed: 0, conflict: 0 }
    if (!disposed) for (const op of ops) if (op.state !== 'synced') states[op.state]++
    const { attempts, completed, successes, failures, conflicts, dropped } = counters
    return {
      version: 1,
      depth: Object.values(states).reduce((a, b) => a + b, 0),
      states,
      durable: disposed ? true : durable,
      dropped,
      replay: { attempts, completed, successes, failures, conflicts },
      rates: {
        success: completed ? successes / completed : null,
        failure: completed ? failures / completed : null,
        conflict: completed ? conflicts / completed : null,
      },
    }
  }

  const emit = (event: QueueEvent) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event)
      } catch {
        // A UI listener must never break the queue.
      }
    }
  }

  /**
   * Write the queue through. Returns false when storage refused the write
   * (quota, eviction, blocked WebView storage): the operations then live only
   * in this page's memory, `isDurable()` turns false and a `change` event lets
   * the UI say so. The next successful write makes it durable again.
   */
  async function persist(): Promise<boolean> {
    // A disposed queue never writes again: after a device purge its storage was
    // deleted on purpose, and writing would recreate it with the old ids (#274).
    if (disposed) return durable
    let ok = true
    try {
      if (ops.length === 0) await deps.store.remove()
      else await deps.store.write(serializeQueue(ops))
    } catch {
      ok = false
    }
    if (ok !== durable) {
      durable = ok
      emit({ type: 'change' })
    }
    return ok
  }

  /** Age rules (OFFLINE_SYNC.md). Returns how many operations were dropped. */
  function applyAgeRules(now: number): { changed: boolean; dropped: number } {
    let changed = false
    let dropped = 0
    const kept: QueuedOperation[] = []
    for (const op of ops) {
      const age = now - op.createdAt
      if ((op.state === 'failed' || op.state === 'conflict') && age > QUEUE_RETENTION_MS) {
        dropped++
        changed = true
        continue
      }
      if (op.state === 'pending' && age > QUEUE_MAX_AGE_MS) {
        op.state = 'failed'
        op.lastError = 'EXPIRED'
        changed = true
      }
      kept.push(op)
    }
    ops = kept
    return { changed, dropped }
  }

  const ready: Promise<void> = (async () => {
    let text: string | null = null
    try {
      text = await deps.store.read()
    } catch {
      text = null
    }
    const parsed = parseStoredQueue(text, namespace)
    ops = parsed.ops
    const aged = applyAgeRules(deps.now())
    loadReport = { dropped: parsed.dropped + aged.dropped }
    increment('dropped', loadReport.dropped)
    if (parsed.dropped > 0 || aged.changed || (text !== null && ops.some((o) => o.state === 'pending'))) {
      await persist()
    }
    if (loadReport.dropped > 0) emit({ type: 'dropped', count: loadReport.dropped })
    emit({ type: 'change' })
  })()

  function snapshot(): QueuedOperation[] {
    return ops.map((o) => ({ ...o, payload: { ...o.payload } }))
  }

  function schedule() {
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    // Offline: no timers at all. The `online` event (handleOnline) resumes the
    // drain, so an outage never spins a zero-delay retry loop.
    if (disposed || !deps.isOnline()) return
    const waiting = ops.filter((o) => o.state === 'pending')
    if (waiting.length === 0) return
    const next = Math.min(...waiting.map((o) => o.nextAttemptAt))
    timer = deps.setTimer(() => {
      timer = null
      void drain()
    }, Math.max(0, next - deps.now()))
  }

  /** Newest intent for a target wins: drop an older, not-in-flight operation for it. */
  function supersede(target: string, keep: QueuedOperation) {
    ops = ops.filter((o) => o === keep || o.target !== target || o.state === 'syncing')
  }

  function hasNewerForTarget(op: QueuedOperation): boolean {
    const idx = ops.indexOf(op)
    return ops.some((o, i) => i > idx && o.target === op.target)
  }

  /**
   * Queue a change. `durable: false` means storage refused the write: the
   * change is queued for this page only and is lost if the page closes.
   */
  async function enqueue<A extends QueueableAction>(
    action: A,
    payload: PayloadOf<A> | unknown
  ): Promise<QueuedOperation & { durable: boolean }> {
    await ready
    if (!isQueueableAction(action)) throw new QueueError('NOT_QUEUEABLE')
    const spec = specOf(action)
    if (spec.namespace !== namespace) throw new QueueError('NOT_QUEUEABLE')
    const parsed = spec.parse(payload)
    if (!parsed) throw new QueueError('INVALID_PAYLOAD')
    const target = spec.target(parsed)
    const replaceable = ops.filter((o) => o.target === target && o.state !== 'syncing').length
    if (ops.length - replaceable >= QUEUE_MAX_OPS) throw new QueueError('QUEUE_FULL')
    const now = deps.now()
    const op: QueuedOperation = {
      id: deps.newKey(),
      action,
      v: spec.version,
      target,
      payload: parsed,
      createdAt: now,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: now,
    }
    ops.push(op)
    supersede(target, op)
    const saved = await persist()
    emit({ type: 'change' })
    void drain()
    return { ...op, durable: saved }
  }

  async function finish(op: QueuedOperation, outcome: Outcome, body: unknown, sendGeneration: number): Promise<'continue' | 'stop'> {
    if (disposed) return 'stop' // abandoned (device purge) while this send was in flight
    if (sendGeneration === diagnosticGeneration) {
      increment('completed')
      if (outcome.kind === 'synced') increment('successes')
      else increment('failures')
      if (outcome.kind === 'conflict') increment('conflicts')
    }
    if (!ops.includes(op)) return outcome.kind === 'auth' ? 'stop' : 'continue' // discarded or cleared meanwhile
    if (outcome.kind === 'synced') {
      ops = ops.filter((o) => o !== op)
      await persist()
      emit({ type: 'synced', op: { ...op, state: 'synced' }, body })
      emit({ type: 'change' })
      return 'continue'
    }
    if (outcome.kind === 'auth') {
      // Terminal: a logged-out or revoked session never replays anything.
      ops = []
      resetDiagnostics()
      await persist()
      emit({ type: 'auth-lost' })
      emit({ type: 'change' })
      return 'stop'
    }
    if (hasNewerForTarget(op)) {
      // A newer intent for the same item is queued; it replaces this one.
      ops = ops.filter((o) => o !== op)
      await persist()
      emit({ type: 'change' })
      return 'continue'
    }
    if (outcome.kind === 'retry') {
      op.attempts += 1
      if (op.attempts >= RETRY_MAX_ATTEMPTS) {
        op.state = 'failed'
        op.lastError = 'MAX_ATTEMPTS'
      } else {
        op.state = 'pending'
        op.lastError = outcome.code
        op.nextAttemptAt = deps.now() + backoffDelay(op.attempts, deps.random())
      }
      await persist()
      emit({ type: 'change' })
      // The network is down: stop instead of failing every other operation too.
      return outcome.code === 'NETWORK' ? 'stop' : 'continue'
    }
    op.attempts += 1
    op.state = outcome.kind
    op.lastError = outcome.code
    await persist()
    emit({ type: 'change' })
    return 'continue'
  }

  function nextDue(now: number): QueuedOperation | undefined {
    const blocked = new Set<string>()
    for (const op of ops) {
      // Keep per-item order: never send a newer intent past an older one still queued.
      if (op.state === 'pending' && op.nextAttemptAt <= now && !blocked.has(op.target)) return op
      if (op.state === 'pending' || op.state === 'syncing') blocked.add(op.target)
    }
    return undefined
  }

  /** Send due operations one at a time. Concurrent callers share one run. */
  function drain(): Promise<void> {
    if (draining) return draining
    draining = (async () => {
      await ready
      try {
        while (!disposed && deps.isOnline()) {
          const now = deps.now()
          const aged = applyAgeRules(now)
          if (aged.changed) {
            increment('dropped', aged.dropped)
            await persist()
            emit({ type: 'change' })
          }
          const op = nextDue(now)
          if (!op) break
          op.state = 'syncing'
          await persist()
          emit({ type: 'change' })
          const spec = specOf(op.action)
          let outcome: Outcome
          let body: unknown = null
          const sendGeneration = diagnosticGeneration
          try {
            increment('attempts')
            const res = await deps.send({
              method: spec.method,
              path: typeof spec.path === 'function' ? spec.path(op.payload) : spec.path,
              body: spec.body(op.payload),
              idempotencyKey: op.id,
            })
            body = res.body
            outcome = classifyResponse(res.status, res.body)
          } catch {
            outcome = { kind: 'retry', code: 'NETWORK' }
          }
          if ((await finish(op, outcome, body, sendGeneration)) === 'stop') break
        }
      } finally {
        draining = null
        schedule()
      }
    })()
    return draining
  }

  async function retry(id: string): Promise<void> {
    await ready
    const op = ops.find((o) => o.id === id)
    if (!op || (op.state !== 'failed' && op.state !== 'conflict')) return
    const now = deps.now()
    // The same key is kept so a response lost earlier is still replayed; a key
    // the server rejected as reused needs a fresh one.
    if (op.lastError === 'IDEMPOTENCY_KEY_REUSED') op.id = deps.newKey()
    if (op.lastError === 'EXPIRED') op.createdAt = now
    op.state = 'pending'
    op.attempts = 0
    op.nextAttemptAt = now
    op.lastError = undefined
    await persist()
    emit({ type: 'change' })
    void drain()
  }

  async function discard(id: string): Promise<void> {
    await ready
    const before = ops.length
    ops = ops.filter((o) => o.id !== id || o.state === 'syncing')
    if (ops.length === before) return
    await persist()
    emit({ type: 'change' })
  }

  /** Drop everything (logout, terminal auth). Pending operations are never replayed. */
  async function clear(): Promise<void> {
    await ready
    ops = []
    resetDiagnostics()
    if (timer !== null) {
      deps.clearTimer(timer)
      timer = null
    }
    try {
      await deps.store.remove()
    } catch {
      // Nothing more to do; the store is gone or blocked.
    }
    emit({ type: 'change' })
  }

  /** Reconnect: operations waiting on backoff are tried now (attempt counts are kept). */
  function handleOnline(): Promise<void> {
    const now = deps.now()
    for (const op of ops) if (op.state === 'pending') op.nextAttemptAt = Math.min(op.nextAttemptAt, now)
    return drain()
  }

  return {
    ready,
    diagnostics,
    resetDiagnostics,
    loadReport: () => loadReport,
    /** False while queued changes exist only in memory because storage refused the last write. */
    isDurable: () => durable,
    list: snapshot,
    enqueue,
    drain,
    retry,
    discard,
    clear,
    handleOnline,
    subscribe(listener: (event: QueueEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * Drop everything in memory and stop for good, WITHOUT touching storage
     * (#274). For the shared-tablet purge: the purge has already deleted the
     * stored queue, and an operation still in flight must not write it back.
     */
    abandon() {
      disposed = true
      resetDiagnostics()
      ops = []
      if (timer !== null) deps.clearTimer(timer)
      timer = null
      listeners.clear()
    },
    dispose() {
      disposed = true
      resetDiagnostics()
      if (timer !== null) deps.clearTimer(timer)
      timer = null
      listeners.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Storage namespaces and adapters.

/** Person queues: one key per signed-in user; the whole namespace is cleared on logout. */
export const PERSON_QUEUE_PREFIX = 'fp-sync:v1:'
export const PERSON_QUEUE_IDB_NAME = 'fp-sync'
export const QUEUE_IDB_STORE = 'kv'

export type QueueNamespace = { kind: 'person'; userId: string } | { kind: 'device' }

/**
 * Where a queue lives. The device namespace is the reserved `fp-device:v1:queue`
 * key in the `fp-device` database, so the shared-device purge (SHARED_DEVICE.md
 * §8) deletes it. It holds only the shared tablet's grocery ticks (#274).
 */
export function queueLocation(ns: QueueNamespace): { dbName: string; key: string } {
  if (ns.kind === 'device') return { dbName: DEVICE_IDB_NAME, key: DEVICE_QUEUE_KEY }
  if (!ID_PATTERN.test(ns.userId)) throw new Error('Invalid user id for queue namespace')
  return { dbName: PERSON_QUEUE_IDB_NAME, key: `${PERSON_QUEUE_PREFIX}${ns.userId}:queue` }
}

export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function localStorageQueueStore(storage: StorageLike, key: string): QueueStore {
  return {
    read: async () => storage.getItem(key),
    write: async (value) => storage.setItem(key, value),
    remove: async () => storage.removeItem(key),
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function indexedDbQueueStore(idb: IDBFactory, dbName: string, key: string): QueueStore {
  let dbPromise: Promise<IDBDatabase> | null = null
  function open(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = idb.open(dbName, 1)
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(QUEUE_IDB_STORE)) req.result.createObjectStore(QUEUE_IDB_STORE)
        }
        req.onsuccess = () => {
          const db = req.result
          // Let logout / device purge delete the database without being blocked.
          db.onversionchange = () => {
            db.close()
            dbPromise = null
          }
          resolve(db)
        }
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
        req.onblocked = () => reject(new Error('IndexedDB open blocked'))
      }).catch((error) => {
        dbPromise = null
        throw error
      })
    }
    return dbPromise
  }
  async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    const tx = db.transaction(QUEUE_IDB_STORE, mode)
    const result = request(fn(tx.objectStore(QUEUE_IDB_STORE)))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
    return result
  }
  return {
    read: async () => {
      const value = await run('readonly', (s) => s.get(key))
      return typeof value === 'string' ? value : null
    },
    write: async (value) => {
      await run('readwrite', (s) => s.put(value, key))
    },
    remove: async () => {
      await run('readwrite', (s) => s.delete(key))
    },
  }
}

export class QueueStorageError extends Error {
  constructor() {
    super('No storage accepted the offline queue')
    this.name = 'QueueStorageError'
  }
}

/**
 * IndexedDB when it works, localStorage otherwise. The first store that can be
 * read is used. If a later write to it fails (quota, eviction, a WebView
 * storage error), the next store is tried with the whole queue and becomes the
 * current one; the failed store is cleared on a best-effort basis so a later
 * load does not read a stale copy. When no store accepts a write, `write`
 * throws, so the queue reports that it is not durable. There is deliberately
 * no silent in-memory store here: the queue itself holds operations in memory.
 */
export function preferredQueueStore(
  location: { dbName: string; key: string },
  env: { indexedDB?: IDBFactory | null; localStorage?: StorageLike | null }
): QueueStore {
  const candidates: QueueStore[] = []
  if (env.indexedDB) candidates.push(indexedDbQueueStore(env.indexedDB, location.dbName, location.key))
  if (env.localStorage) candidates.push(localStorageQueueStore(env.localStorage, location.key))
  return fallbackQueueStore(candidates)
}

/** The fallback chain behind `preferredQueueStore`, in preference order. */
export function fallbackQueueStore(candidates: QueueStore[]): QueueStore {
  let current = -1
  let chosen: Promise<void> | null = null

  function choose(): Promise<void> {
    if (!chosen) {
      chosen = (async () => {
        for (let i = 0; i < candidates.length; i++) {
          try {
            await candidates[i].read()
            current = i
            return
          } catch {
            // Blocked or unavailable (private mode, old WebView): try the next one.
          }
        }
      })()
    }
    return chosen
  }

  async function writeThrough(op: (store: QueueStore) => Promise<void>): Promise<void> {
    await choose()
    if (current < 0) throw new QueueStorageError()
    for (let i = current; i < candidates.length; i++) {
      try {
        await op(candidates[i])
        if (i !== current) {
          const failed = candidates[current]
          current = i
          await failed.remove().catch(() => {})
        }
        return
      } catch {
        // This store refused the write: fall through to the next one.
      }
    }
    throw new QueueStorageError()
  }

  return {
    read: async () => {
      await choose()
      return current < 0 ? null : candidates[current].read()
    },
    write: (v) => writeThrough((store) => store.write(v)),
    remove: () => writeThrough((store) => store.remove()),
  }
}

/**
 * Remove every person queue on this browser (logout). Drops the whole
 * `fp-sync:v1:` localStorage namespace and the `fp-sync` database.
 */
export async function clearPersonQueues(env: {
  storages: StorageLike[]
  deleteIndexedDb: (name: string) => Promise<void>
}): Promise<void> {
  for (const storage of env.storages) {
    try {
      const doomed: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key && key.startsWith(PERSON_QUEUE_PREFIX)) doomed.push(key)
      }
      for (const key of doomed) storage.removeItem(key)
    } catch {
      // Blocked storage: nothing to clear.
    }
  }
  try {
    await env.deleteIndexedDb(PERSON_QUEUE_IDB_NAME)
  } catch {
    // Nothing to delete.
  }
}
