/**
 * Browser-side client for a paired shared tablet (#241; contract
 * docs/architecture/SHARED_DEVICE.md §4, §5, §6.3, §8).
 *
 * - Every `/api/device/*` call goes through `request`. On
 *   `401 DEVICE_ACCESS_EXPIRED` it refreshes once (a single in-flight refresh
 *   shared by all callers) and retries the original request once.
 * - `DEVICE_REVOKED` / `DEVICE_SESSION_INVALID` from anything, and a 404 from
 *   any `/api/device/*` endpoint of a paired tablet (the kill-switch answer;
 *   those routes have no other 404), run the §8 purge:
 *   drop memory state, delete `fp-device:v1:*` storage, IndexedDB `fp-device`
 *   and device Cache Storage entries, drop the queue, then replace-navigate to
 *   `/device/removed`.
 * - `503 SERVICE_UNAVAILABLE`, rate limits and network errors are retryable
 *   and never purge: a database blip must not unpair a tablet.
 * - The elevation token and the pairing claim token live in this module's
 *   memory only. Nothing here ever writes either to storage, so a reload or
 *   process death drops them.
 *
 * Dependencies are injected so the module is unit-testable without a DOM
 * (src/lib/__tests__/device-client.test.ts); `getDeviceClient()` wires the
 * browser defaults.
 */

export const DEVICE_STORAGE_PREFIX = 'fp-device:v1:'
export const DEVICE_IDB_NAME = 'fp-device'
export const DEVICE_CACHE_PREFIX = 'fp-device'
/** Stored device id, so a different device id on the same browser triggers a purge (§8). */
export const DEVICE_ID_KEY = `${DEVICE_STORAGE_PREFIX}device-id`
/** Reserved for the offline mutation queue (#162); dropped, never replayed, by the purge. */
export const DEVICE_QUEUE_KEY = `${DEVICE_STORAGE_PREFIX}queue`

/** Refresh proactively when the access token has less than this left and the page is visible (§4). */
export const PROACTIVE_REFRESH_WINDOW_MS = 5 * 60 * 1000
/** Pairing status poll interval, tablet and parent (§5.1). */
export const PAIRING_POLL_MS = 3000
export const ELEVATION_HEADER = 'X-Device-Elevation'
export const REMOVED_PATH = '/device/removed'

const TERMINAL_CODES = new Set(['DEVICE_REVOKED', 'DEVICE_SESSION_INVALID'])

/**
 * A 404 from a paired tablet's device endpoint means shared-device mode is
 * off (kill switch, SHARED_DEVICE.md §8, §13): terminal, like a revoke.
 */
function isKillSwitchResponse(path: string, status: number): boolean {
  return status === 404 && path.startsWith('/api/device/')
}
const ELEVATION_ENDED_CODES = new Set(['ELEVATION_EXPIRED', 'ELEVATION_REQUIRED'])
const SAFE_METHODS = new Set(['GET', 'HEAD'])

export class DeviceApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  /** Seconds from `Retry-After`, when the server sent one. */
  readonly retryAfterSeconds: number | null
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    options: { retryable?: boolean; retryAfterSeconds?: number | null; details?: Record<string, unknown> } = {}
  ) {
    super(message)
    this.name = 'DeviceApiError'
    this.status = status
    this.code = code
    this.retryable = options.retryable ?? false
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
    this.details = options.details ?? {}
  }

  /** The device was disconnected; the client has purged (or is purging). */
  get terminal(): boolean {
    return TERMINAL_CODES.has(this.code)
  }
}

export interface ElevationSession {
  token: string
  member: { id: string; name: string }
  /** Absolute end (epoch ms), from the server. */
  expiresAt: number
  idleTimeoutMs: number
  /** Last successful elevated request (epoch ms), mirrors the server's idle clock. */
  lastUsedAt: number
}

/** When the elevation ends at the latest: the earlier of the idle and the absolute limit. */
export function elevationDeadline(session: ElevationSession): number {
  return Math.min(session.expiresAt, session.lastUsedAt + session.idleTimeoutMs)
}

export type PairingPollResult =
  | { status: 'pending' }
  | { status: 'paired'; device: { id: string; label: string } }
  | { status: 'expired' }
  | { status: 'cancelled' }
  | { status: 'device_limit' }
  | { status: 'rate_limited'; retryAfterSeconds: number | null }

export type RefreshOutcome =
  | { ok: true; accessExpiresAt: number | null }
  | { ok: false; terminal: boolean; error: DeviceApiError }

export type DeviceClientEvent = 'elevation' | 'purge'

type Listener = (event: DeviceClientEvent) => void

interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DeviceClientDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
  /** Replace-navigate (never push), so back never returns to device data. */
  navigate: (path: string) => void
  csrfToken: () => string | null
  isVisible: () => boolean
  /** localStorage and sessionStorage in the browser. */
  storages: () => StorageLike[]
  deleteIndexedDb: (name: string) => Promise<void>
  clearCaches: (prefix: string) => Promise<void>
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Send the in-memory elevation token as `X-Device-Elevation`. */
  elevated?: boolean
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get('Retry-After')
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

async function toError(res: Response): Promise<DeviceApiError> {
  const body = (await readBody(res)) as { error?: unknown } | null
  const envelope =
    body && typeof body.error === 'object' && body.error !== null
      ? (body.error as { code?: unknown; message?: unknown; retryable?: unknown } & Record<string, unknown>)
      : null
  const code = typeof envelope?.code === 'string' ? envelope.code : res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`
  const message =
    typeof envelope?.message === 'string'
      ? envelope.message
      : typeof body?.error === 'string'
        ? (body.error as string)
        : 'Something went wrong.'
  const retryable =
    typeof envelope?.retryable === 'boolean' ? envelope.retryable : res.status === 429 || res.status >= 500
  const details: Record<string, unknown> = {}
  if (envelope) {
    for (const [key, value] of Object.entries(envelope)) {
      if (key !== 'code' && key !== 'message' && key !== 'retryable') details[key] = value
    }
  }
  return new DeviceApiError(res.status, code, message, { retryable, retryAfterSeconds: retryAfter(res), details })
}

function networkError(): DeviceApiError {
  return new DeviceApiError(0, 'NETWORK_ERROR', 'Could not reach the server.', { retryable: true })
}

/** Uppercase, strip everything but letters/digits, O→0, I/L→1, at most 8 characters (§5.2). */
export function normaliseCodeInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, 8)
}

/** `ABCD-EFGH` display form of a (partial) code. */
export function formatCodeInput(input: string): string {
  const code = normaliseCodeInput(input)
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/

/** True when the normalised input is a complete, well-formed Crockford code (U is not in the alphabet). */
export function isCompleteCode(input: string): boolean {
  return CODE_PATTERN.test(normaliseCodeInput(input))
}

export function createDeviceClient(deps: DeviceClientDeps) {
  let accessExpiresAt: number | null = null
  let inflightRefresh: Promise<RefreshOutcome> | null = null
  let elevation: ElevationSession | null = null
  let claimToken: string | null = null
  let purging: Promise<void> | null = null
  let purged = false
  let pageHidden = false
  const listeners = new Set<Listener>()

  const emit = (event: DeviceClientEvent) => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(event)
      } catch {
        // A UI listener must never break the client.
      }
    }
  }

  async function send(path: string, options: RequestOptions, keepalive = false): Promise<Response> {
    const method = options.method ?? 'GET'
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (!SAFE_METHODS.has(method)) {
      const csrf = deps.csrfToken()
      if (csrf) headers['X-CSRF-Token'] = csrf
    }
    if (options.elevated && elevation) headers[ELEVATION_HEADER] = elevation.token
    try {
      return await deps.fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch {
      throw networkError()
    }
  }

  function removeStorageNamespace() {
    for (const storage of safeStorages()) {
      try {
        const doomed: string[] = []
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i)
          if (key && key.startsWith(DEVICE_STORAGE_PREFIX)) doomed.push(key)
        }
        for (const key of doomed) storage.removeItem(key)
      } catch {
        // Storage can throw (private mode, blocked site data); nothing to purge then.
      }
    }
  }

  function safeStorages(): StorageLike[] {
    try {
      return deps.storages()
    } catch {
      return []
    }
  }

  /** Delete every client trace of the device (§8 steps 1–3). Does not navigate. */
  async function wipe(): Promise<void> {
    elevation = null
    claimToken = null
    accessExpiresAt = null
    removeStorageNamespace()
    await Promise.all([
      deps.deleteIndexedDb(DEVICE_IDB_NAME).catch(() => {}),
      deps.clearCaches(DEVICE_CACHE_PREFIX).catch(() => {}),
    ])
  }

  /** §8 purge: wipe, then replace-navigate to the removed screen. Idempotent. */
  function purge(): Promise<void> {
    if (purging) return purging
    purging = (async () => {
      await wipe()
      purged = true
      emit('elevation')
      emit('purge')
      deps.navigate(REMOVED_PATH)
    })().finally(() => {
      purging = null
    })
    return purging
  }

  function refresh(): Promise<RefreshOutcome> {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async (): Promise<RefreshOutcome> => {
      let res: Response
      try {
        res = await send('/api/device/session/refresh', { method: 'POST' })
      } catch (error) {
        return { ok: false, terminal: false, error: error as DeviceApiError }
      }
      if (res.ok) {
        const body = (await readBody(res)) as { accessExpiresAt?: unknown } | null
        const parsed = typeof body?.accessExpiresAt === 'string' ? Date.parse(body.accessExpiresAt) : NaN
        accessExpiresAt = Number.isFinite(parsed) ? parsed : null
        return { ok: true, accessExpiresAt }
      }
      const error = await toError(res)
      if (error.terminal || isKillSwitchResponse('/api/device/session/refresh', res.status)) {
        await purge()
        return { ok: false, terminal: true, error }
      }
      return { ok: false, terminal: false, error }
    })().finally(() => {
      inflightRefresh = null
    })
    return inflightRefresh
  }

  async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    let res = await send(path, options)
    if (!res.ok) {
      let error = await toError(res)
      if (error.code === 'DEVICE_ACCESS_EXPIRED') {
        const refreshed = await refresh()
        // Terminal: already purged. Otherwise (503, 429, offline) the refresh
        // error says why and is retryable; nothing is purged.
        if (!refreshed.ok) throw refreshed.error
        // Retry exactly once.
        res = await send(path, options)
        if (!res.ok) error = await toError(res)
      }
      if (!res.ok) {
        if (error.terminal || isKillSwitchResponse(path, res.status)) {
          await purge()
        } else if (options.elevated && ELEVATION_ENDED_CODES.has(error.code)) {
          dropElevation()
        }
        throw error
      }
    }
    if (options.elevated && elevation) elevation = { ...elevation, lastUsedAt: deps.now() }
    return (await readBody(res)) as T
  }

  function dropElevation(): ElevationSession | null {
    const previous = elevation
    elevation = null
    if (previous) emit('elevation')
    return previous
  }

  /**
   * Return to shared mode now; tell the server best effort (§6.3). The
   * token is dropped before the request, so nothing can reuse it.
   */
  async function endElevation(): Promise<void> {
    const previous = dropElevation()
    if (!previous) return
    try {
      await deps.fetch('/api/device/elevation', {
        method: 'DELETE',
        headers: {
          [ELEVATION_HEADER]: previous.token,
          ...(deps.csrfToken() ? { 'X-CSRF-Token': deps.csrfToken() as string } : {}),
        },
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
      })
    } catch {
      // Best effort: the server's idle/absolute limits apply regardless.
    }
  }

  return {
    request,
    refresh,
    purge,
    /** Wipe device storage without navigating (removed/unavailable screens). */
    wipe,

    /** Cold launch: refresh first when the page reports the access cookie missing (§4). */
    async bootstrap(hasAccessCookie: boolean): Promise<RefreshOutcome | null> {
      if (hasAccessCookie) return null
      return refresh()
    },

    /** Proactive refresh (§4): visible page and under 5 minutes left on a known access token. */
    async maybeRefresh(): Promise<RefreshOutcome | null> {
      if (accessExpiresAt === null || !deps.isVisible()) return null
      if (accessExpiresAt - deps.now() >= PROACTIVE_REFRESH_WINDOW_MS) return null
      return refresh()
    },

    accessExpiresAt: () => accessExpiresAt,
    isPurged: () => purged,

    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Checks the device id against the one this browser last saw; a different one purges (§8). */
    async checkDeviceId(deviceId: string): Promise<boolean> {
      for (const storage of safeStorages()) {
        try {
          const known = storage.getItem(DEVICE_ID_KEY)
          if (known && known !== deviceId) {
            await purge()
            return false
          }
          storage.setItem(DEVICE_ID_KEY, deviceId)
        } catch {
          // Storage unavailable: nothing cached, nothing to compare.
        }
        break
      }
      return true
    },

    // -- Elevation (§6), memory only ----------------------------------------

    getElevation: (): ElevationSession | null => elevation,

    async elevate(userId: string, method: 'pin' | 'password', secret: string): Promise<ElevationSession> {
      const body = await request<{
        elevationToken: string
        expiresAt: string
        idleTimeoutSeconds: number
        member: { id: string; name: string }
      }>('/api/device/elevation', { method: 'POST', body: { userId, method, secret } })
      const now = deps.now()
      const expires = Date.parse(body.expiresAt)
      elevation = {
        token: body.elevationToken,
        member: { id: body.member.id, name: body.member.name },
        expiresAt: Number.isFinite(expires) ? expires : now,
        idleTimeoutMs: Math.max(0, body.idleTimeoutSeconds) * 1000,
        lastUsedAt: now,
      }
      // Backgrounded (or unloading) while the credential was being checked:
      // the hide listeners already ran with nothing to end, so end it here and
      // never show parent mode on a tablet nobody is looking at (§6.3).
      if (pageHidden || !deps.isVisible()) {
        await endElevation()
        throw new DeviceApiError(0, 'ELEVATION_BACKGROUNDED', 'Parent mode ended because the tablet was put away.')
      }
      emit('elevation')
      return elevation
    },

    endElevation,

    /** `pagehide` (navigation, reload, process death): end parent mode; refuse one that lands later. */
    notePageHide(): void {
      pageHidden = true
      void endElevation()
    },
    /** `pageshow` (including a back/forward-cache restore). */
    notePageShow(): void {
      pageHidden = false
    },

    // -- Pairing (§5), claim token memory only --------------------------------

    hasClaim: () => claimToken !== null,
    clearClaim: () => {
      claimToken = null
    },

    async claim(code: string, platform: 'android' | 'web', appVersion: string) {
      const res = await send('/api/device/pair/claim', {
        method: 'POST',
        body: { code: normaliseCodeInput(code), platform, appVersion },
      })
      if (!res.ok) throw await toError(res)
      const body = (await readBody(res)) as { claimToken: string; confirmDigits: string; expiresAt: string }
      claimToken = body.claimToken
      return { confirmDigits: body.confirmDigits, expiresAt: Date.parse(body.expiresAt) }
    },

    async pollPairing(): Promise<PairingPollResult> {
      if (!claimToken) return { status: 'expired' }
      const res = await send('/api/device/pair/status', { method: 'POST', body: { claimToken } })
      if (res.ok) {
        const body = (await readBody(res)) as { status?: string; device?: { id: string; label: string } } | null
        if (body?.status === 'paired' && body.device) {
          claimToken = null
          // A fresh pairing starts from a clean namespace on this browser.
          removeStorageNamespace()
          for (const storage of safeStorages()) {
            try {
              storage.setItem(DEVICE_ID_KEY, body.device.id)
            } catch {
              // ignore
            }
            break
          }
          purged = false
          accessExpiresAt = null
          return { status: 'paired', device: body.device }
        }
        return { status: 'pending' }
      }
      const error = await toError(res)
      if (error.code === 'PAIRING_EXPIRED') {
        claimToken = null
        return { status: 'expired' }
      }
      if (error.code === 'PAIRING_CANCELLED') {
        claimToken = null
        return { status: 'cancelled' }
      }
      if (error.code === 'DEVICE_LIMIT_REACHED') {
        claimToken = null
        return { status: 'device_limit' }
      }
      if (error.status === 429) return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds }
      throw error
    },
  }
}

export type DeviceClient = ReturnType<typeof createDeviceClient>

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[2]) : null
}

let browserClient: DeviceClient | null = null

/** The page-wide client (one per browser tab), with the real browser dependencies. */
export function getDeviceClient(): DeviceClient {
  if (browserClient) return browserClient
  browserClient = createDeviceClient({
    fetch: (input, init) => window.fetch(input, init),
    now: () => Date.now(),
    navigate: (path) => window.location.replace(path),
    csrfToken: () => readCookie('csrf_token'),
    isVisible: () => document.visibilityState === 'visible',
    storages: () => [window.localStorage, window.sessionStorage],
    deleteIndexedDb: (name) =>
      new Promise<void>((resolve) => {
        try {
          if (!('indexedDB' in window)) return resolve()
          const req = window.indexedDB.deleteDatabase(name)
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => resolve()
        } catch {
          resolve()
        }
      }),
    clearCaches: async (prefix) => {
      if (!('caches' in window)) return
      const keys = await window.caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => window.caches.delete(k)))
    },
  })
  return browserClient
}
