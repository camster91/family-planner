// When the app registers its service worker (O-41, src/lib/service-worker.ts).
import {
  SERVICE_WORKER_URL,
  isNativeShell,
  serviceWorkerAction,
  unregisterAppServiceWorker,
  type ServiceWorkerEnvironment,
} from '../service-worker'

const prodHttps: ServiceWorkerEnvironment = {
  production: true,
  supported: true,
  protocol: 'https:',
  hostname: 'family.ashbi.ca',
  native: false,
}

describe('serviceWorkerAction', () => {
  it('registers in production on https', () => {
    expect(serviceWorkerAction(prodHttps)).toBe('register')
  })

  it.each(['localhost', '127.0.0.1', '[::1]'])('registers in production on http://%s', (hostname) => {
    expect(serviceWorkerAction({ ...prodHttps, protocol: 'http:', hostname })).toBe('register')
  })

  it('skips plain http on any other host', () => {
    expect(serviceWorkerAction({ ...prodHttps, protocol: 'http:', hostname: '192.168.1.20' })).toBe('skip')
  })

  it('skips in development', () => {
    expect(serviceWorkerAction({ ...prodHttps, production: false })).toBe('skip')
    expect(serviceWorkerAction({ ...prodHttps, production: false, protocol: 'http:', hostname: 'localhost' })).toBe(
      'skip'
    )
  })

  it('skips without service worker support', () => {
    expect(serviceWorkerAction({ ...prodHttps, supported: false })).toBe('skip')
    expect(serviceWorkerAction({ ...prodHttps, supported: false, native: true })).toBe('skip')
  })

  it('never registers in the Capacitor Android shell, and removes a leftover copy', () => {
    expect(serviceWorkerAction({ ...prodHttps, native: true })).toBe('unregister')
    expect(serviceWorkerAction({ ...prodHttps, native: true, production: false })).toBe('unregister')
  })
})

describe('isNativeShell', () => {
  it('is true only when the Capacitor bridge says it is native', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true)
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false)
    expect(isNativeShell({ Capacitor: {} })).toBe(false)
    expect(isNativeShell({})).toBe(false)
    expect(isNativeShell(null)).toBe(false)
  })
})

describe('unregisterAppServiceWorker', () => {
  function registration(scriptURL: string | null, unregisters = true) {
    const worker = scriptURL ? ({ scriptURL } as ServiceWorker) : null
    return {
      active: worker,
      waiting: null,
      installing: null,
      unregister: jest.fn(async () => unregisters),
    } as unknown as ServiceWorkerRegistration & { unregister: jest.Mock }
  }

  it('removes only the app worker', async () => {
    const ours = registration(`https://family.ashbi.ca${SERVICE_WORKER_URL}`)
    const other = registration('https://family.ashbi.ca/other-worker.js')
    const empty = registration(null)
    const removed = await unregisterAppServiceWorker({
      getRegistrations: async () => [ours, other, empty],
    })
    expect(removed).toBe(1)
    expect(ours.unregister).toHaveBeenCalledTimes(1)
    expect(other.unregister).not.toHaveBeenCalled()
    expect(empty.unregister).not.toHaveBeenCalled()
  })

  it('counts only successful removals', async () => {
    const ours = registration(`https://family.ashbi.ca${SERVICE_WORKER_URL}`, false)
    expect(await unregisterAppServiceWorker({ getRegistrations: async () => [ours] })).toBe(0)
  })
})
