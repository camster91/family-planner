// public/sw.js (O-41), run as written in a sandbox that stands in for the
// service worker global: install pre-caches only the offline page and its
// files, activate drops old versions and claims clients, navigations are
// network first with the offline page on a network failure, and nothing else
// (API, other pages, other origins, non-GET) is intercepted or cached.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const SCRIPT = readFileSync(path.join(__dirname, '../../../public/sw.js'), 'utf8')
const ORIGIN = 'https://family.example.test'

type Listener = (event: unknown) => void

interface FakeRequest {
  url: string
  method: string
  mode: string
  cache?: string
}

class FakeResponse {
  constructor(
    public body: string,
    public status = 200
  ) {}
}

function makeRequest(url: string, init: Partial<FakeRequest> = {}): FakeRequest {
  return { url: new URL(url, ORIGIN).toString(), method: 'GET', mode: 'cors', ...init }
}

function setup() {
  const listeners: Record<string, Listener> = {}
  const stores = new Map<string, Map<string, FakeResponse>>()
  const fetchMock = jest.fn<Promise<FakeResponse>, [FakeRequest]>()
  const skipWaiting = jest.fn(async () => undefined)
  const claim = jest.fn(async () => undefined)
  const enablePreload = jest.fn(async () => undefined)

  const pathOf = (key: string | FakeRequest) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).pathname

  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return {
        addAll: async (requests: FakeRequest[]) => {
          for (const request of requests) store.set(pathOf(request), await fetchMock(request))
        },
      }
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (key: string | FakeRequest, options?: { cacheName?: string }) => {
      const names = options?.cacheName ? [options.cacheName] : [...stores.keys()]
      for (const name of names) {
        const hit = stores.get(name)?.get(pathOf(key))
        if (hit) return hit
      }
      return undefined
    },
  }

  const self = {
    location: { origin: ORIGIN },
    registration: { navigationPreload: { enable: enablePreload } },
    clients: { claim },
    skipWaiting,
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener
    },
  }

  const fakeModule = { exports: {} as Record<string, unknown> }
  const sandbox = {
    self,
    caches,
    fetch: fetchMock,
    Request: function (url: string, init: { cache?: string }) {
      return makeRequest(url, init)
    },
    URL,
    module: fakeModule,
    Promise,
  }
  vm.runInNewContext(SCRIPT, sandbox, { filename: 'sw.js' })

  async function dispatchExtendable(type: 'install' | 'activate') {
    let pending: Promise<unknown> = Promise.resolve()
    listeners[type]({ waitUntil: (p: Promise<unknown>) => (pending = p) })
    await pending
  }

  /** Returns the response the worker answered with, or 'not-intercepted'. */
  async function dispatchFetch(request: FakeRequest, preloadResponse?: Promise<unknown>) {
    let responded: Promise<unknown> | null = null
    listeners.fetch({
      request,
      preloadResponse: preloadResponse ?? Promise.resolve(undefined),
      respondWith: (p: Promise<unknown>) => (responded = p),
    })
    return responded ? await responded : 'not-intercepted'
  }

  return {
    exports: fakeModule.exports as {
      CACHE_NAME: string
      PRECACHE_URLS: string[]
      OFFLINE_URL: string
    },
    stores,
    fetchMock,
    skipWaiting,
    claim,
    enablePreload,
    dispatchExtendable,
    dispatchFetch,
  }
}

const networkDown = () => Promise.reject(new TypeError('Failed to fetch'))

describe('public/sw.js', () => {
  it('install pre-caches exactly the offline page and its files, bypassing the HTTP cache, then skips waiting', async () => {
    const sw = setup()
    sw.fetchMock.mockImplementation(async (request) => new FakeResponse(`file ${request.url}`))
    await sw.dispatchExtendable('install')

    expect(sw.exports.PRECACHE_URLS).toEqual([
      '/offline.html',
      '/brand/illustrations/houses-banner.webp',
      '/favicon.svg',
    ])
    expect(sw.fetchMock.mock.calls.map(([r]) => [new URL(r.url).pathname, r.cache])).toEqual(
      sw.exports.PRECACHE_URLS.map((url) => [url, 'reload'])
    )
    expect([...sw.stores.keys()]).toEqual([sw.exports.CACHE_NAME])
    expect(sw.exports.CACHE_NAME).toMatch(/^fp-offline-v\d+$/)
    expect(sw.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('a failed pre-cache fails the install (the old worker stays)', async () => {
    const sw = setup()
    sw.fetchMock.mockImplementation(networkDown)
    await expect(sw.dispatchExtendable('install')).rejects.toThrow('Failed to fetch')
    expect(sw.skipWaiting).not.toHaveBeenCalled()
  })

  it('activate deletes older offline caches only, enables navigation preload and claims clients', async () => {
    const sw = setup()
    sw.stores.set('fp-offline-v0', new Map())
    sw.stores.set('someone-else', new Map())
    sw.stores.set(sw.exports.CACHE_NAME, new Map())
    await sw.dispatchExtendable('activate')
    expect([...sw.stores.keys()].sort()).toEqual([sw.exports.CACHE_NAME, 'someone-else'].sort())
    expect(sw.enablePreload).toHaveBeenCalledTimes(1)
    expect(sw.claim).toHaveBeenCalledTimes(1)
  })

  describe('navigations', () => {
    async function installed() {
      const sw = setup()
      sw.fetchMock.mockImplementation(async (request) => new FakeResponse(`cached ${new URL(request.url).pathname}`))
      await sw.dispatchExtendable('install')
      sw.fetchMock.mockReset()
      return sw
    }

    it('online: answers from the network and stores nothing', async () => {
      const sw = await installed()
      sw.fetchMock.mockResolvedValue(new FakeResponse('live dashboard'))
      const response = await sw.dispatchFetch(makeRequest('/dashboard/lists', { mode: 'navigate' }))
      expect(response).toEqual(new FakeResponse('live dashboard'))
      expect([...sw.stores.get(sw.exports.CACHE_NAME)!.keys()]).toEqual(sw.exports.PRECACHE_URLS)
    })

    it('uses the navigation preload response when there is one', async () => {
      const sw = await installed()
      const preloaded = new FakeResponse('preloaded')
      const response = await sw.dispatchFetch(
        makeRequest('/dashboard', { mode: 'navigate' }),
        Promise.resolve(preloaded)
      )
      expect(response).toBe(preloaded)
      expect(sw.fetchMock).not.toHaveBeenCalled()
    })

    it('a server error is passed through, not replaced by the offline page', async () => {
      const sw = await installed()
      sw.fetchMock.mockResolvedValue(new FakeResponse('oops', 500))
      const response = await sw.dispatchFetch(makeRequest('/dashboard', { mode: 'navigate' }))
      expect(response).toEqual(new FakeResponse('oops', 500))
    })

    it('offline: shows the pre-cached offline page', async () => {
      const sw = await installed()
      sw.fetchMock.mockImplementation(networkDown)
      const response = await sw.dispatchFetch(
        makeRequest('/dashboard/calendar', { mode: 'navigate' }),
        networkDown()
      )
      expect(response).toEqual(new FakeResponse('cached /offline.html'))
    })

    it('offline with nothing cached: the navigation fails as it would without a worker', async () => {
      const sw = setup()
      sw.fetchMock.mockImplementation(networkDown)
      await expect(sw.dispatchFetch(makeRequest('/dashboard', { mode: 'navigate' }))).rejects.toThrow(
        'Failed to fetch'
      )
    })

    it('the offline page files fall back to the cache when offline', async () => {
      const sw = await installed()
      sw.fetchMock.mockImplementation(networkDown)
      const response = await sw.dispatchFetch(makeRequest('/brand/illustrations/houses-banner.webp'))
      expect(response).toEqual(new FakeResponse('cached /brand/illustrations/houses-banner.webp'))
    })
  })

  it.each([
    ['an API GET', makeRequest('/api/lists')],
    ['an API POST navigation', makeRequest('/api/auth/logout', { method: 'POST', mode: 'navigate' })],
    ['a page script', makeRequest('/_next/static/chunks/app.js')],
    ['another illustration', makeRequest('/brand/illustrations/help.webp')],
    ['a pre-cached path with a query', makeRequest('/favicon.svg?v=2')],
    ['another origin', { url: 'https://app.posthog.com/decide', method: 'GET', mode: 'navigate' }],
  ])('does not intercept %s', async (_label, request) => {
    const sw = setup()
    expect(await sw.dispatchFetch(request)).toBe('not-intercepted')
    expect(sw.fetchMock).not.toHaveBeenCalled()
  })
})
