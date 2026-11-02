import { isNativeShell } from './service-worker'

/** Web pages do not need native plugins. Each native subscriber still owns its cleanup. */
export function watchNativeApp(
  subscribe: (native: typeof import('./native-app')) => () => void,
): () => void {
  if (typeof window === 'undefined' || !isNativeShell(window)) return () => undefined
  let stopped = false
  let unsubscribe: (() => void) | undefined
  void import('./native-app').then(native => {
    if (!stopped) unsubscribe = subscribe(native)
  }).catch(() => undefined) // Browser focus and connectivity events remain available.
  return () => { stopped = true; unsubscribe?.() }
}
