'use client'

/**
 * App-wide "You're offline" banner (O-41). Mounted once in the dashboard
 * layout and once in the shared-tablet layout. It shows while the browser
 * reports no network, then says "Back online." for a few seconds.
 *
 * - The wrapper is always in the DOM and is a polite live region
 *   (`aria-live`, not `role="status"`, so page-level status queries are not
 *   affected), so both changes are announced once.
 * - Sticky under the top bar, never fixed to the bottom: it cannot cover the
 *   tab bar. Hidden, it has no height and changes nothing on screen.
 * - Fridge mode hides it (`data-offline-banner`, TodayBoard's chrome CSS): the
 *   board has its own offline notice with the time the data was loaded.
 * - Pages with their own offline wording (lists, inventory, calendar, the
 *   board) keep it; this banner only says the connection state.
 */
import * as React from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOnline } from '@/components/ui/use-online'

/** How long "Back online." stays before the banner goes. */
export const BACK_ONLINE_MS = 3000

export const OFFLINE_TEXT = "You're offline. Some things may not load or save until you're back online."
export const BACK_ONLINE_TEXT = 'Back online.'

export function OfflineBanner({ className }: { className?: string }) {
  const online = useOnline()
  const [backOnline, setBackOnline] = React.useState(false)
  const wasOffline = React.useRef(false)

  React.useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setBackOnline(false)
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    setBackOnline(true)
    const timer = window.setTimeout(() => setBackOnline(false), BACK_ONLINE_MS)
    return () => window.clearTimeout(timer)
  }, [online])

  const state = !online ? 'offline' : backOnline ? 'back' : 'hidden'

  return (
    <div
      data-offline-banner=""
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'pointer-events-none sticky z-40 flex justify-center px-4',
        state === 'hidden' ? 'h-0' : 'py-2',
        className
      )}
    >
      {state !== 'hidden' && (
        <p
          data-testid="app-offline-banner"
          data-state={state}
          className="pointer-events-auto flex max-w-xl items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-2.5 text-[15px] leading-snug text-label-primary shadow-[var(--shadow-md)]"
        >
          {state === 'offline' ? (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-label-secondary" aria-hidden="true" />
          ) : (
            <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success-text)]" aria-hidden="true" />
          )}
          <span>{state === 'offline' ? OFFLINE_TEXT : BACK_ONLINE_TEXT}</span>
        </p>
      )}
    </div>
  )
}
