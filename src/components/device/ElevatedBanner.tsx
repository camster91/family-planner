'use client'

import * as React from 'react'
import { useDeviceText } from '@/i18n/device-management'
import { Pencil, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
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
  onSettings,
}: {
  client: DeviceClient
  session: ElevationSession
  onExpire: () => void
  onDone: () => void
  onRename: () => void
  onRemove: () => void
  /** Board setup on the tablet (#274): weather, colours, calm display, tablet writes. */
  onSettings?: () => void
}) {
  const text = useDeviceText()
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
      aria-label={text('parentMode')}
      data-testid="elevated-banner"
      className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[var(--radius-xl)] border-2 border-[var(--accent-text)] bg-[var(--surface-elevated)] px-5 py-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ShieldCheck className="h-7 w-7 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[19px] font-bold leading-tight text-label-primary md:text-[21px]">
            {text('parentModeName', { name: session.member.name })}
          </p>
          {endingSoon ? (
            <p data-testid="elevation-countdown" className="text-[17px] font-semibold text-[var(--warning-text)]">{text("endsIn")}<span className="tabular-nums">{formatCountdown(remaining)}</span>
            </p>
          ) : (
            <p className="text-[16px] text-label-secondary">{text("parentIdleLimit")}</p>
          )}
          {/* One announcement when the last minute starts, not one per second. */}
          <p className="sr-only" aria-live="polite">
            {endingSoon ? text('parentEndingSoon') : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {onSettings && (
          <button type="button" onClick={onSettings} className={neutralButtonClass}>
            <Settings2 className="h-5 w-5" aria-hidden="true" />{text("boardSettings")}</button>
        )}
        <button type="button" onClick={onRename} className={neutralButtonClass}>
          <Pencil className="h-5 w-5" aria-hidden="true" />{text("renameTablet")}</button>
        <button type="button" onClick={onRemove} className={dangerButtonClass}>
          <Trash2 className="h-5 w-5" aria-hidden="true" />{text("removeThisTablet")}</button>
        <button type="button" onClick={onDone} className={primaryButtonClass}>{text("parentDone")}</button>
      </div>
    </section>
  )
}
