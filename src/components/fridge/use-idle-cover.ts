'use client'

import * as React from 'react'
import { ambientState, type AmbientState, type BoardDisplay } from '@/lib/ambient'

/** Only this much time between two recorded touches (keeps renders rare). */
const ACTIVITY_THROTTLE_MS = 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/**
 * Idle tracking for the fridge calm display and night hours (#271).
 *
 * Any touch, key or wheel counts as activity. While the board is covered (calm
 * frame or night dimming) a key press only uncovers it: it is swallowed in the
 * capture phase so it cannot also activate the focused control underneath.
 * Explicit controls in the lazy fallback are allowed to handle their own
 * keyboard activation while the board remains inert.
 */
export function useIdleCover({
  enabled,
  now,
  display,
}: {
  enabled: boolean
  /** The board's ticking clock (ms), or null before mount. */
  now: number | null
  display: BoardDisplay
}): { state: AmbientState; covered: boolean; wake: () => void } {
  const [lastActive, setLastActive] = React.useState(() => Date.now())
  const lastRef = React.useRef(lastActive)
  const coveredRef = React.useRef(false)

  const wake = React.useCallback(() => {
    const t = Date.now()
    lastRef.current = t
    coveredRef.current = false
    setLastActive(t)
  }, [])

  const state: AmbientState =
    enabled && now !== null
      ? ambientState({ idleMs: Math.max(0, now - lastActive), now: new Date(now), display })
      : { ambient: false, dim: false }
  const covered = state.ambient || state.dim
  coveredRef.current = covered

  React.useEffect(() => {
    if (!enabled) return
    const onActivity = (event: Event) => {
      if (coveredRef.current) {
        if (event.type === 'keydown') {
          // The lazy fallback has an explicit retry control. Let its Enter or
          // Space activation reach React; the board itself remains inert.
          const target = event.target
          if (target instanceof Element && target.closest('[data-ambient-cover-controls]')) return
          event.preventDefault()
          event.stopPropagation()
          wake()
        }
        return
      }
      const t = Date.now()
      if (t - lastRef.current < ACTIVITY_THROTTLE_MS) return
      lastRef.current = t
      setLastActive(t)
    }
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: type !== 'keydown' })
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true })
    }
  }, [enabled, wake])

  return { state, covered, wake }
}
