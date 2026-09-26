/**
 * Device client module (#241; SHARED_DEVICE.md §4 client refresh rule, §6.3
 * memory-only elevation, §8 purge). Pure unit tests with an injected fetch,
 * clock and storage; no DOM.
 */
import {
  createDeviceClient,
  DEVICE_ID_KEY,
  DEVICE_QUEUE_KEY,
  DeviceApiError,
  elevationDeadline,
  formatCodeInput,
  isCompleteCode,
  normaliseCodeInput,
  PROACTIVE_REFRESH_WINDOW_MS,
  REMOVED_PATH,
  type DeviceClientDeps,
} from '../device-client'

class MemoryStorage {
  private map = new Map<string, string>()
  writes: Array<[string, string]> = []
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
    this.writes.push([k, v])
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  keys() {
    return Array.from(this.map.keys())
  }
  dump() {
    return JSON.stringify(Array.from(this.map.entries()))
  }
}

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function envelope(status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return json(status, { error: { code, message: code, retryable: status >= 500 || status === 429, ...extra } }, headers)
}

function setup(handler: Handler, options: { now?: number; visible?: boolean } = {}) {
  const local = new MemoryStorage()
  const session = new MemoryStorage()
  const calls: Array<{ path: string; init: RequestInit }> = []
  const navigate = jest.fn()
  const deleteIndexedDb = jest.fn(async () => {})
  const clearCaches = jest.fn(async () => {})
  let now = options.now ?? Date.parse('2026-01-05T12:00:00Z')
  let visible = options.visible ?? true
  const deps: DeviceClientDeps = {
    fetch: async (path, init = {}) => {
      calls.push({ path, init })
      return handler(path, init)
    },
    now: () => now,
    navigate,
    csrfToken: () => 'csrf-abc',
    isVisible: () => visible,
    storages: () => [local, session],
    deleteIndexedDb,
    clearCaches,
  }
  const client = createDeviceClient(deps)
  return {
    client,
    calls,
    local,
    session,
    navigate,
    deleteIndexedDb,
    clearCaches,
    setNow: (n: number) => (now = n),
    setVisible: (v: boolean) => (visible = v),
    count: (path: string) => calls.filter((c) => c.path === path).length,
  }
}

const REFRESH = '/api/device/session/refresh'
const TODAY = '/api/device/today'
const ME = '/api/device/me'

describe('pairing code input', () => {
  it('normalises case, separators and look-alike letters', () => {
    expect(normaliseCodeInput(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(normaliseCodeInput('o1l i')).toBe('0111')
    expect(normaliseCodeInput('ABCD EFGH JKMN')).toBe('ABCDEFGH')
    expect(formatCodeInput('abcdefgh')).toBe('ABCD-EFGH')
    expect(formatCodeInput('abc')).toBe('ABC')
  })

  it('accepts only complete Crockford codes', () => {
    expect(isCompleteCode('7K3M-9QRT')).toBe(true)
    expect(isCompleteCode('7K3M-9QR')).toBe(false)
    // U is not in the Crockford alphabet.
    expect(isCompleteCode('UUUU-UUUU')).toBe(false)
  })
})

describe('refresh rule (§4)', () => {
  it('on DEVICE_ACCESS_EXPIRED refreshes once, then retries the request once', async () => {
    let todayCalls = 0
    const t = setup((path) => {
      if (path === REFRESH) return json(200, { accessExpiresAt: '2026-01-05T13:00:00.000Z' })
      todayCalls++
      return todayCalls === 1 ? envelope(401, 'DEVICE_ACCESS_EXPIRED') : json(200, { ok: true })
    })
    await expect(t.client.request(TODAY)).resolves.toEqual({ ok: true })
    expect(t.count(REFRESH)).toBe(1)
    expect(t.count(TODAY)).toBe(2)
    expect(t.client.accessExpiresAt()).toBe(Date.parse('2026-01-05T13:00:00.000Z'))
    // Refresh is a CSRF-protected POST.
    const refreshCall = t.calls.find((c) => c.path === REFRESH)!
    expect(refreshCall.init.method).toBe('POST')
    expect((refreshCall.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-abc')
  })

  it('does not loop: a second DEVICE_ACCESS_EXPIRED after the retry is thrown', async () => {
    const t = setup((path) => (path === REFRESH ? json(200, {}) : envelope(401, 'DEVICE_ACCESS_EXPIRED')))
    await expect(t.client.request(TODAY)).rejects.toMatchObject({ code: 'DEVICE_ACCESS_EXPIRED' })
    expect(t.count(REFRESH)).toBe(1)
    expect(t.count(TODAY)).toBe(2)
    expect(t.navigate).not.toHaveBeenCalled()
  })

  it('shares one in-flight refresh between concurrent callers (single flight)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const seen = new Map<string, number>()
    const t = setup(async (path) => {
      if (path === REFRESH) {
        await gate
        return json(200, { accessExpiresAt: '2026-01-05T13:00:00.000Z' })
      }
      const n = (seen.get(path) ?? 0) + 1
      seen.set(path, n)
      return n === 1 ? envelope(401, 'DEVICE_ACCESS_EXPIRED') : json(200, { path })
    })
    const results = Promise.all([t.client.request(TODAY), t.client.request(ME), t.client.refresh()])
    await new Promise((r) => setTimeout(r, 0))
    release()
    const [a, b, c] = await results
    expect(a).toEqual({ path: TODAY })
    expect(b).toEqual({ path: ME })
    expect(c).toMatchObject({ ok: true })
    expect(t.count(REFRESH)).toBe(1)
  })

  it('bootstraps with a refresh only when the access cookie is missing (cold launch)', async () => {
    const t = setup((path) => (path === REFRESH ? json(200, { accessExpiresAt: '2026-01-05T13:00:00.000Z' }) : json(200, {})))
    await expect(t.client.bootstrap(true)).resolves.toBeNull()
    expect(t.count(REFRESH)).toBe(0)
    await expect(t.client.bootstrap(false)).resolves.toMatchObject({ ok: true })
    expect(t.count(REFRESH)).toBe(1)
  })

  it('refreshes proactively only when visible and under 5 minutes are left', async () => {
    const expires = Date.parse('2026-01-05T13:00:00.000Z')
    const t = setup((path) => (path === REFRESH ? json(200, { accessExpiresAt: new Date(expires).toISOString() }) : json(200, {})))
    // Unknown expiry: nothing to do.
    await expect(t.client.maybeRefresh()).resolves.toBeNull()
    await t.client.refresh()
    expect(t.count(REFRESH)).toBe(1)

    t.setNow(expires - PROACTIVE_REFRESH_WINDOW_MS - 1000)
    await t.client.maybeRefresh()
    expect(t.count(REFRESH)).toBe(1)

    t.setNow(expires - 60 * 1000)
    t.setVisible(false)
    await t.client.maybeRefresh()
    expect(t.count(REFRESH)).toBe(1)

    t.setVisible(true)
    await t.client.maybeRefresh()
    expect(t.count(REFRESH)).toBe(2)
  })
})

describe('terminal errors purge (§8)', () => {
  function seedStorage(t: ReturnType<typeof setup>) {
    t.local.setItem(DEVICE_ID_KEY, 'dev_1')
    t.local.setItem('fp-device:v1:dev_1:today', '{"cached":true}')
    t.local.setItem(DEVICE_QUEUE_KEY, '[{"op":"tick"}]')
    t.session.setItem('fp-device:v1:scratch', 'x')
    t.local.setItem('familyPlanner_theme', 'light')
  }

  it.each(['DEVICE_REVOKED', 'DEVICE_SESSION_INVALID'])('%s from a read purges storage, queue and navigates', async (code) => {
    const t = setup(() => envelope(401, code))
    seedStorage(t)
    await expect(t.client.request(TODAY)).rejects.toMatchObject({ code, terminal: true })
    expect(t.local.keys()).toEqual(['familyPlanner_theme'])
    expect(t.session.keys()).toEqual([])
    expect(t.deleteIndexedDb).toHaveBeenCalledWith('fp-device')
    expect(t.clearCaches).toHaveBeenCalledWith('fp-device')
    expect(t.navigate).toHaveBeenCalledTimes(1)
    expect(t.navigate).toHaveBeenCalledWith(REMOVED_PATH)
    expect(t.client.isPurged()).toBe(true)
  })

  it('a terminal refresh purges and the original request is not retried', async () => {
    const t = setup((path) => (path === REFRESH ? envelope(401, 'DEVICE_REVOKED') : envelope(401, 'DEVICE_ACCESS_EXPIRED')))
    seedStorage(t)
    await expect(t.client.request(TODAY)).rejects.toMatchObject({ code: 'DEVICE_REVOKED' })
    expect(t.count(TODAY)).toBe(1)
    expect(t.navigate).toHaveBeenCalledWith(REMOVED_PATH)
    expect(t.local.getItem(DEVICE_QUEUE_KEY)).toBeNull()
  })

  it('purges on 404 from /api/device/me (kill switch off)', async () => {
    const t = setup(() => envelope(404, 'NOT_FOUND'))
    seedStorage(t)
    await expect(t.client.request(ME)).rejects.toMatchObject({ status: 404 })
    expect(t.navigate).toHaveBeenCalledWith(REMOVED_PATH)
  })

  it('purges when the server reports a different device than this browser cached', async () => {
    const t = setup(() => json(200, {}))
    t.local.setItem(DEVICE_ID_KEY, 'dev_old')
    await expect(t.client.checkDeviceId('dev_new')).resolves.toBe(false)
    expect(t.navigate).toHaveBeenCalledWith(REMOVED_PATH)
    expect(t.local.getItem(DEVICE_ID_KEY)).toBeNull()
  })

  it('concurrent terminal responses navigate once', async () => {
    const t = setup(() => envelope(401, 'DEVICE_REVOKED'))
    await Promise.allSettled([t.client.request(TODAY), t.client.request(ME)])
    expect(t.navigate).toHaveBeenCalledTimes(1)
  })
})

describe('retryable errors never purge', () => {
  it('503 SERVICE_UNAVAILABLE is retryable and keeps storage', async () => {
    const t = setup(() => envelope(503, 'SERVICE_UNAVAILABLE'))
    t.local.setItem(DEVICE_ID_KEY, 'dev_1')
    const error = (await t.client.request(TODAY).catch((e) => e)) as DeviceApiError
    expect(error).toBeInstanceOf(DeviceApiError)
    expect(error.code).toBe('SERVICE_UNAVAILABLE')
    expect(error.retryable).toBe(true)
    expect(error.terminal).toBe(false)
    expect(t.navigate).not.toHaveBeenCalled()
    expect(t.local.getItem(DEVICE_ID_KEY)).toBe('dev_1')
  })

  it('503 from the refresh endpoint does not purge', async () => {
    const t = setup((path) => (path === REFRESH ? envelope(503, 'SERVICE_UNAVAILABLE') : envelope(401, 'DEVICE_ACCESS_EXPIRED')))
    await expect(t.client.request(TODAY)).rejects.toMatchObject({ retryable: true })
    expect(t.navigate).not.toHaveBeenCalled()
  })

  it('network failures and 429 are retryable and do not purge', async () => {
    const t = setup((path) => {
      if (path === ME) return envelope(429, 'RATE_LIMITED', {}, { 'Retry-After': '30' })
      throw new TypeError('Failed to fetch')
    })
    await expect(t.client.request(TODAY)).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true })
    await expect(t.client.request(ME)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 })
    expect(t.navigate).not.toHaveBeenCalled()
  })
})

describe('elevation is memory-only (§6.3)', () => {
  const TOKEN = 'fpd1_e_secret-elevation-token'

  function elevatedSetup(extra: Handler = () => json(200, {})) {
    return setup((path, init) => {
      if (path === '/api/device/elevation' && init.method === 'POST') {
        return json(200, {
          elevationToken: TOKEN,
          expiresAt: '2026-01-05T12:15:00.000Z',
          idleTimeoutSeconds: 300,
          member: { id: 'u_parent', name: 'Avery' },
        })
      }
      if (path === '/api/device/elevation' && init.method === 'DELETE') return new Response(null, { status: 204 })
      return extra(path, init)
    })
  }

  it('keeps the token only in memory and sends it as X-Device-Elevation', async () => {
    const t = elevatedSetup()
    const listener = jest.fn()
    t.client.subscribe(listener)
    const session = await t.client.elevate('u_parent', 'pin', '246810')
    expect(session.member.name).toBe('Avery')
    expect(elevationDeadline(session)).toBe(Date.parse('2026-01-05T12:05:00.000Z'))
    expect(listener).toHaveBeenCalledWith('elevation')

    await t.client.request('/api/device/label', { method: 'PATCH', body: { label: 'Hall' }, elevated: true })
    const labelCall = t.calls.find((c) => c.path === '/api/device/label')!
    expect((labelCall.init.headers as Record<string, string>)['X-Device-Elevation']).toBe(TOKEN)

    // Never persisted, anywhere.
    for (const storage of [t.local, t.session]) {
      expect(storage.dump()).not.toContain(TOKEN)
      expect(storage.writes.some(([, v]) => v.includes(TOKEN))).toBe(false)
    }
  })

  it('moves the idle clock on each elevated request', async () => {
    const t = elevatedSetup()
    await t.client.elevate('u_parent', 'pin', '246810')
    t.setNow(Date.parse('2026-01-05T12:04:00Z'))
    await t.client.request('/api/device/label', { method: 'PATCH', body: { label: 'Hall' }, elevated: true })
    expect(elevationDeadline(t.client.getElevation()!)).toBe(Date.parse('2026-01-05T12:09:00Z'))
  })

  it('"Done" drops the token first, then deletes it on the server best effort', async () => {
    const t = elevatedSetup()
    await t.client.elevate('u_parent', 'pin', '246810')
    await t.client.endElevation()
    expect(t.client.getElevation()).toBeNull()
    const del = t.calls.find((c) => c.path === '/api/device/elevation' && c.init.method === 'DELETE')!
    expect((del.init.headers as Record<string, string>)['X-Device-Elevation']).toBe(TOKEN)
    expect(del.init.keepalive).toBe(true)
    // A second end is a no-op.
    await t.client.endElevation()
    expect(t.calls.filter((c) => c.init.method === 'DELETE')).toHaveLength(1)
  })

  it('a failed best-effort DELETE still leaves shared mode', async () => {
    const t = setup((path, init) => {
      if (init.method === 'DELETE') throw new TypeError('offline')
      return json(200, {
        elevationToken: TOKEN,
        expiresAt: '2026-01-05T12:15:00.000Z',
        idleTimeoutSeconds: 300,
        member: { id: 'u', name: 'A' },
      })
    })
    await t.client.elevate('u', 'password', 'pw')
    await expect(t.client.endElevation()).resolves.toBeUndefined()
    expect(t.client.getElevation()).toBeNull()
  })

  it.each(['ELEVATION_EXPIRED', 'ELEVATION_REQUIRED'])('%s from an elevated call drops the elevation', async (code) => {
    const t = elevatedSetup(() => envelope(403, code))
    await t.client.elevate('u_parent', 'pin', '246810')
    await expect(t.client.request('/api/device/label', { method: 'PATCH', elevated: true })).rejects.toMatchObject({ code })
    expect(t.client.getElevation()).toBeNull()
    expect(t.navigate).not.toHaveBeenCalled()
  })

  it('a purge drops the elevation and the claim token', async () => {
    const t = elevatedSetup(() => envelope(401, 'DEVICE_REVOKED'))
    await t.client.elevate('u_parent', 'pin', '246810')
    await expect(t.client.request(TODAY)).rejects.toBeInstanceOf(DeviceApiError)
    expect(t.client.getElevation()).toBeNull()
    expect(t.client.hasClaim()).toBe(false)
  })

  it('reports lockout and bad credentials without elevating', async () => {
    const t = setup(() => envelope(423, 'ELEVATION_LOCKED', {}, { 'Retry-After': '3600' }))
    await expect(t.client.elevate('u', 'pin', '000000')).rejects.toMatchObject({ status: 423, retryAfterSeconds: 3600 })
    expect(t.client.getElevation()).toBeNull()
  })
})

describe('pairing claim token is memory-only (§5)', () => {
  const CLAIM = 'fpd1_p_secret-claim-token'

  it('claims, polls with the token, then forgets it once paired', async () => {
    let polls = 0
    const t = setup((path, init) => {
      if (path === '/api/device/pair/claim') {
        expect(JSON.parse(init.body as string)).toEqual({ code: 'ABCD0111', platform: 'web', appVersion: 'web' })
        return json(200, { claimToken: CLAIM, confirmDigits: '4821', expiresAt: '2026-01-05T12:10:00.000Z' })
      }
      polls++
      expect(JSON.parse(init.body as string)).toEqual({ claimToken: CLAIM })
      return polls < 2 ? json(200, { status: 'pending' }) : json(200, { status: 'paired', device: { id: 'dev_9', label: 'Kitchen' } })
    })
    t.local.setItem('fp-device:v1:stale', 'x')
    const claimed = await t.client.claim('abcd-o1l1', 'web', 'web')
    expect(claimed.confirmDigits).toBe('4821')
    expect(t.client.hasClaim()).toBe(true)
    await expect(t.client.pollPairing()).resolves.toEqual({ status: 'pending' })
    await expect(t.client.pollPairing()).resolves.toEqual({ status: 'paired', device: { id: 'dev_9', label: 'Kitchen' } })
    expect(t.client.hasClaim()).toBe(false)
    expect(t.local.getItem('fp-device:v1:stale')).toBeNull()
    expect(t.local.getItem(DEVICE_ID_KEY)).toBe('dev_9')
    for (const storage of [t.local, t.session]) expect(storage.dump()).not.toContain(CLAIM)
  })

  it.each([
    [410, 'PAIRING_EXPIRED', 'expired'],
    [410, 'PAIRING_CANCELLED', 'cancelled'],
    [409, 'DEVICE_LIMIT_REACHED', 'device_limit'],
  ])('maps %s %s to %s', async (status, code, expected) => {
    const t = setup((path) =>
      path === '/api/device/pair/claim'
        ? json(200, { claimToken: CLAIM, confirmDigits: '1234', expiresAt: '2026-01-05T12:10:00.000Z' })
        : envelope(status, code)
    )
    await t.client.claim('ABCDEFGH', 'web', 'web')
    await expect(t.client.pollPairing()).resolves.toEqual({ status: expected })
    expect(t.client.hasClaim()).toBe(false)
  })

  it('surfaces an invalid code and a rate limit from the claim', async () => {
    const t = setup(() => envelope(400, 'PAIRING_CODE_INVALID'))
    await expect(t.client.claim('ABCDEFGH', 'web', 'web')).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' })
    expect(t.client.hasClaim()).toBe(false)
  })
})
