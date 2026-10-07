/**
 * When the app registers its service worker (O-41, public/sw.js). The worker
 * only shows a pre-cached offline page when a navigation fails for lack of a
 * network; see docs/architecture/OFFLINE_SYNC.md "Offline page".
 */

export const SERVICE_WORKER_URL = '/sw.js'
export const SERVICE_WORKER_SCOPE = '/'

export type ServiceWorkerAction = 'register' | 'unregister' | 'skip'

export interface ServiceWorkerEnvironment {
  /** `process.env.NODE_ENV === 'production'`. Dev never registers (no stale worker during HMR). */
  production: boolean
  /** `'serviceWorker' in navigator`. */
  supported: boolean
  /** `location.protocol`, e.g. 'https:'. */
  protocol: string
  /** `location.hostname`. */
  hostname: string
  /** Running inside the Capacitor Android shell. */
  native: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * - No service worker support: nothing to do.
 * - Capacitor Android shell: never register, and remove any copy left from an
 *   earlier build. The shell loads the live site through Capacitor's own
 *   request proxy (it injects the native bridge into HTML responses and routes
 *   service-worker requests through the same proxy), and that path has not
 *   been tested on a device with a worker in front of it.
 * - Development: skip, so `next dev` never runs a cached worker.
 * - Production: register on https, or on http only for localhost (the E2E server).
 */
export function serviceWorkerAction(env: ServiceWorkerEnvironment): ServiceWorkerAction {
  if (!env.supported) return 'skip'
  if (env.native) return 'unregister'
  if (!env.production) return 'skip'
  if (env.protocol === 'https:') return 'register'
  if (env.protocol === 'http:' && LOCAL_HOSTS.has(env.hostname)) return 'register'
  return 'skip'
}

/** True inside the Capacitor native shell (its injected bridge sets `window.Capacitor`). */
export function isNativeShell(win: unknown): boolean {
  const cap = (win as { Capacitor?: { isNativePlatform?: () => boolean } } | null)?.Capacitor
  return Boolean(cap?.isNativePlatform?.())
}

/** Removes only this app's worker (matched by script path), never anything else on the origin. */
export async function unregisterAppServiceWorker(
  container: Pick<ServiceWorkerContainer, 'getRegistrations'>
): Promise<number> {
  const registrations = await container.getRegistrations()
  let removed = 0
  for (const registration of registrations) {
    const worker = registration.active ?? registration.waiting ?? registration.installing
    if (!worker) continue
    if (new URL(worker.scriptURL).pathname !== SERVICE_WORKER_URL) continue
    if (await registration.unregister()) removed += 1
  }
  return removed
}
