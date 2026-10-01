'use client'

import * as React from 'react'
import { toDateOnlyLocal } from '@/lib/dates'

const noopSubscribe = () => () => {}

/**
 * False on the server and during hydration, true afterwards (O-31: the server
 * renders in UTC, the browser in the viewer's zone). Anything that depends on
 * the viewer's clock or time zone — "today", "Tomorrow", an event's time —
 * must render a neutral, zone-free form while this is false, so the server
 * HTML and the first client render match, then switch to local values.
 *
 * Unlike a `useState(false)` + `useEffect` flag, this is already true for a
 * component mounted after hydration (a client-side navigation), so those
 * screens never flash the neutral form.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
}

/** The viewer's clock once hydrated, else null (unknown on the server). */
export function useLocalNow(): Date | null {
  return useHydrated() ? new Date() : null
}

/** The viewer's local `YYYY-MM-DD` once hydrated, else null (unknown on the server). */
export function useTodayKey(): string | null {
  const now = useLocalNow()
  return now ? toDateOnlyLocal(now) : null
}
