'use client'

import * as React from 'react'
import { watchNativeApp } from '@/lib/native-app-lazy'

/**
 * `navigator.onLine`, kept current by the `online` / `offline` events. Starts
 * true on the server and the first client render, so markup matches. Shared
 * by the Today board (#119) and the inventory page (#121).
 */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true)
  React.useEffect(() => {
    setOnline(navigator.onLine !== false)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const stopNative = watchNativeApp(native => native.watchNativeConnection(setOnline))
    return () => {
      stopNative()
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
