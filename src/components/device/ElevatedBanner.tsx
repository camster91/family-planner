'use client'

import * as React from 'react'
import { Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import { elevationDeadline, type DeviceClient, type ElevationSession } from '@/lib/device-client'
import { formatCountdown } from './use-device-client'
import { dangerButtonClass, neutralButtonClass, primaryButtonClass } from './styles'

/** The countdown appears in the last minute (SHARED_DEVICE.md §6.3). */
export const COUNTDOWN_VISIBLE_MS = 60 * 1000

/**
 * Parent-mode banner on the tablet. Shows who is in parent mode, the
 * remaining time in the last 60 seconds, and the elevated actions. When the
 * idle or absolute limit passes it calls `onExpire` (the server enforces the
 * same limits regardless).
 */
export default function ElevatedBanner({
  client,
  session,
  onExpire,
  onDone,
  onRename,
  onRemove,
}: {
  client: DeviceClient
  session: ElevationSession
  onExpire: () => void
  onDone: () => void
  onRename: () => void
  onRemove: () => void
}) {
  const [remaining, setRemaining] = React.useState(() => elevationDeadline(session) - Date.now())
  const onExpireRef = React.useRef(onExpire)
  onExpireRef.current = onExpire

  React.useEffect(() => {
    const tick = () => {
      // Read the live session: each elevated request moves the idle clock.
      const live = client.getElevation()
      if (!live) return
      const left = elevationDeadline(live) - Date.now()
      setRemaining(left)
      if (left <= 0) onExpireRef.current()
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [client])

  const endingSoon = remaining <= COUNTDOWN_VISIBLE_MS

  return (
    <section
      aria-label="Parent mode"
      data-testid="elevated-banner"
      className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[var(--radius-xl)] border-2 border-[var(--accent-text)] bg-[var(--surface-elevated)] px-5 py-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ShieldCheck className="h-7 w-7 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[19px] font-bold leading-tight text-label-primary md:text-[21px]">
            Parent mode: {session.member.name}
          </p>
          {endingSoon ? (
            <p data-testid="elevation-countdown" className="text-[17px] font-semibold text-[var(--warning-text)]">
              Ends in <span className="tabular-nums">{formatCountdown(remaining)}</span>
            </p>
          ) : (
            <p className="text-[16px] text-label-secondary">Ends after 5 minutes without activity.</p>
          )}
          {/* One announcement when the last minute starts, not one per second. */}
          <p className="sr-only" aria-live="polite">
            {endingSoon ? 'Parent mode ends in less than a minute.' : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRename} className={neutralButtonClass}>
          <Pencil className="h-5 w-5" aria-hidden="true" />
          Rename tablet
        </button>
        <button type="button" onClick={onRemove} className={dangerButtonClass}>
          <Trash2 className="h-5 w-5" aria-hidden="true" />
          Remove this tablet
        </button>
        <button type="button" onClick={onDone} className={primaryButtonClass}>
          Done
        </button>
      </div>
    </section>
  )
}
