'use client'

/**
 * Registers public/sw.js (O-41) after the page has loaded, so it never
 * competes with the first render. src/lib/service-worker.ts decides when it
 * registers, skips or unregisters. Failures are ignored on purpose: without
 * the worker the app behaves exactly as before, minus the offline page.
 */
import * as React from 'react'
import {
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  isNativeShell,
  serviceWorkerAction,
  unregisterAppServiceWorker,
} from '@/lib/service-worker'

export function ServiceWorkerRegistration() {
  React.useEffect(() => {
    const action = serviceWorkerAction({
      production: process.env.NODE_ENV === 'production',
      supported: 'serviceWorker' in navigator,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      native: isNativeShell(window),
    })
    if (action === 'skip') return

    const run = () => {
      if (action === 'register') {
        navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE }).catch(() => {})
      } else {
        unregisterAppServiceWorker(navigator.serviceWorker).catch(() => {})
      }
    }
    if (document.readyState === 'complete') {
      run()
      return
    }
    window.addEventListener('load', run, { once: true })
    return () => window.removeEventListener('load', run)
  }, [])
  return null
}
