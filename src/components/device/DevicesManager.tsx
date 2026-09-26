'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Clock,
  Loader2,
  Plus,
  TabletSmartphone,
} from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import PairTabletDialog from './PairTabletDialog'
import {
  dangerButtonClass,
  errorTextClass,
  focusRing,
  inputClass,
  labelClass,
  neutralButtonClass,
  noticeTextClass,
  primaryButtonClass,
} from './styles'

export interface ManagedDevice {
  id: string
  label: string
  platform: string
  pairedAt: string
  lastSeenAt: string | null
  appVersion: string | null
  status: 'active' | 'removed' | 'expired'
  revokedAt: string | null
  revokeReason: string | null
}

interface DeviceEvent {
  type: string
  actorName: string | null
  createdAt: string
  metadata: Record<string, unknown>
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** SHARED_DEVICE.md §7: "Active now" under 10 minutes, a warning after 7 days. */
export function lastSeenText(lastSeenAt: string | null, now: number): { text: string; warn: boolean } {
  if (!lastSeenAt) return { text: 'Not seen yet', warn: false }
  const diff = Math.max(0, now - Date.parse(lastSeenAt))
  if (diff < 10 * MINUTE) return { text: 'Active now', warn: false }
  if (diff < HOUR) return { text: `Seen ${Math.floor(diff / MINUTE)} minutes ago`, warn: false }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    return { text: `Seen ${h} ${h === 1 ? 'hour' : 'hours'} ago`, warn: false }
  }
  const d = Math.floor(diff / DAY)
  if (d > 7) return { text: `Not seen for ${d} days`, warn: true }
  return { text: `Seen ${d} ${d === 1 ? 'day' : 'days'} ago`, warn: false }
}

const REVOKE_REASON_TEXT: Record<string, string> = {
  parent: 'removed by a parent',
  lost: 'lost',
  replaced: 'replaced',
  token_reuse: 'a copied sign-in was detected',
}

/** Fixed audit vocabulary (§10) in plain words. Unknown types get a neutral line. */
export function describeEvent(event: DeviceEvent): string {
  const by = event.actorName ? ` by ${event.actorName}` : ''
  const m = event.metadata ?? {}
  switch (event.type) {
    case 'device.paired':
      return `Paired${by}`
    case 'device.renamed':
      return `Renamed${by}`
    case 'device.revoked':
      return `Removed${by} (${REVOKE_REASON_TEXT[String(m.reason)] ?? 'removed'})`
    case 'device.token_reuse_detected':
      return 'A copied sign-in was detected, so the tablet was disconnected'
    case 'device.elevation_started':
      return `Parent mode started${by}${m.method === 'password' ? ' with a password' : m.method === 'pin' ? ' with a PIN' : ''}`
    case 'device.elevation_ended':
      return `Parent mode ended${by}`
    case 'device.elevation_locked':
      return `Parent mode locked after wrong attempts${by ? ` (${event.actorName})` : ''}`
    case 'device.elevated_action':
      if (m.action === 'rename_device') return `Renamed on the tablet${by}`
      if (m.action === 'revoke_device') return `Removed on the tablet${by}`
      return `Parent action on the tablet${by}`
    case 'device.member_action':
      return `Family member action${by}`
    case 'device.pairing_claimed':
      return 'Pairing code entered on the tablet'
    case 'device.pairing_confirmed':
      return `Pairing confirmed${by}`
    case 'device.pairing_cancelled':
      return 'Pairing cancelled'
    default:
      return 'Tablet activity'
  }
}

function StatusBadge({ device }: { device: ManagedDevice }) {
  // Text and icon, never colour alone.
  if (device.status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-tint)] px-3 py-1 text-[14px] font-semibold text-label-primary">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Active
      </span>
    )
  }
  if (device.status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warning-tint)] px-3 py-1 text-[14px] font-semibold text-label-primary">
        <Clock className="h-4 w-4" aria-hidden="true" />
        Expired
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-fill)] px-3 py-1 text-[14px] font-semibold text-label-primary">
      <CircleSlash className="h-4 w-4" aria-hidden="true" />
      Removed
    </span>
  )
}

function Activity({ deviceId }: { deviceId: string }) {
  const [events, setEvents] = React.useState<DeviceEvent[] | null>(null)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/family/devices/${encodeURIComponent(deviceId)}/events`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { events: DeviceEvent[] }) => {
        if (!cancelled) setEvents(body.events)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [deviceId])

  if (error) return <p className="text-[15px] text-label-secondary">Could not load recent activity.</p>
  if (!events) {
    return (
      <p role="status" className="flex items-center gap-2 text-[15px] text-label-secondary">
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        Loading activity
      </p>
    )
  }
  if (events.length === 0) return <p className="text-[15px] text-label-secondary">No activity yet.</p>
  return (
    <ol className="space-y-2" data-testid="device-activity">
      {events.map((event, i) => (
        <li key={`${event.createdAt}-${i}`} className="flex flex-wrap gap-x-3 text-[15px]">
          <span className="text-label-secondary tabular-nums">
            {new Date(event.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          <span className="text-label-primary">{describeEvent(event)}</span>
        </li>
      ))}
    </ol>
  )
}

function DeviceRow({
  device,
  now,
  onRename,
  onRemove,
  onReplace,
}: {
  device: ManagedDevice
  now: number
  onRename: () => void
  onRemove: () => void
  onReplace: () => void
}) {
  const [showActivity, setShowActivity] = React.useState(false)
  const seen = lastSeenText(device.lastSeenAt, now)
  const active = device.status === 'active'
  const activityId = `device-activity-${device.id}`

  return (
    <li
      data-testid="device-row"
      data-status={device.status}
      className={[
        'rounded-[var(--radius-xl)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-5 shadow-[var(--shadow-sm)]',
        device.status === 'removed' ? 'opacity-75' : '',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[19px] font-bold leading-tight text-label-primary">{device.label}</h2>
          <p className="mt-1 text-[15px] text-label-secondary">
            {device.platform === 'android' ? 'Android app' : 'Web browser'} · Paired {shortDate(device.pairedAt)}
            {device.appVersion && device.appVersion !== 'web' ? ` · Version ${device.appVersion}` : ''}
          </p>
          {device.status === 'removed' ? (
            <p className="mt-1 text-[15px] text-label-secondary">
              Removed {device.revokedAt ? shortDate(device.revokedAt) : ''}
              {device.revokeReason ? ` (${REVOKE_REASON_TEXT[device.revokeReason] ?? device.revokeReason})` : ''}
            </p>
          ) : (
            <p
              className={[
                'mt-1 flex items-center gap-1.5 text-[15px]',
                seen.warn ? 'font-semibold text-[var(--warning-text)]' : 'text-label-secondary',
              ].join(' ')}
            >
              {seen.warn && <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
              {seen.text}
            </p>
          )}
          {device.status === 'expired' && (
            <p className="mt-1 text-[15px] text-label-secondary">
              It has not connected for 30 days. Remove it and pair it again to use it.
            </p>
          )}
        </div>
        <StatusBadge device={device} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {active && (
          <>
            <button type="button" onClick={onRename} className={neutralButtonClass}>
              Rename
            </button>
            <button type="button" onClick={onReplace} className={neutralButtonClass}>
              Replace
            </button>
          </>
        )}
        {device.status !== 'removed' && (
          <button type="button" onClick={onRemove} className={neutralButtonClass}>
            Remove tablet
          </button>
        )}
        <button
          type="button"
          aria-expanded={showActivity}
          aria-controls={activityId}
          onClick={() => setShowActivity((v) => !v)}
          className={neutralButtonClass}
        >
          Recent activity
          <ChevronDown
            className={`h-4 w-4 motion-safe:transition-transform ${showActivity ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {showActivity && (
        <div id={activityId} className="mt-4 border-t border-[var(--surface-separator)] pt-4">
          <Activity deviceId={device.id} />
        </div>
      )}
    </li>
  )
}

/**
 * /dashboard/settings/devices (SHARED_DEVICE.md §7, #241): the household's
 * shared tablets for a parent. Rename, remove with a reason, pair or replace,
 * and recent activity per tablet.
 */
export default function DevicesManager() {
  const [devices, setDevices] = React.useState<ManagedDevice[] | null>(null)
  const [loadError, setLoadError] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const [pairOpen, setPairOpen] = React.useState(false)
  const [replaceTarget, setReplaceTarget] = React.useState<ManagedDevice | null>(null)
  const [renameTarget, setRenameTarget] = React.useState<ManagedDevice | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<ManagedDevice | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/family/devices', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { devices: ManagedDevice[] }
      setDevices(body.devices)
      setNow(Date.now())
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const replace = React.useMemo(
    () => (replaceTarget ? { id: replaceTarget.id, label: replaceTarget.label } : null),
    [replaceTarget]
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="devices-page">
      <Link
        href="/dashboard/settings"
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-full pr-3 text-[16px] font-semibold text-accent ${focusRing}`}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        Settings
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[32px] font-bold leading-tight text-label-primary">Devices</h1>
          <p className="mt-1 max-w-xl text-[16px] leading-snug text-label-secondary">
            Shared tablets show your family&apos;s Today board. They never hold anyone&apos;s account, and a parent
            unlocks parent mode on them with a tablet PIN.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage(null)
            setReplaceTarget(null)
            setPairOpen(true)
          }}
          className={primaryButtonClass}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          Pair a tablet
        </button>
      </div>

      {message && (
        <p role="status" className={noticeTextClass}>
          {message}
        </p>
      )}

      {loadError && (
        <div role="alert" className={errorTextClass}>
          Could not load your tablets.{' '}
          <button type="button" onClick={() => void load()} className={`underline ${focusRing}`}>
            Try again
          </button>
        </div>
      )}

      {!devices && !loadError && (
        <p role="status" className="flex items-center gap-2 text-[16px] text-label-secondary">
          <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
          Loading tablets
        </p>
      )}

      {devices && devices.length === 0 && (
        <div className="rounded-[var(--radius-xl)] border border-dashed border-[var(--surface-separator-opaque)] p-8 text-center">
          <TabletSmartphone className="mx-auto h-10 w-10 text-label-secondary" aria-hidden="true" />
          <p className="mt-3 text-[17px] text-label-primary">No tablets yet.</p>
          <p className="mt-1 text-[15px] text-label-secondary">Pair a tablet to show today&apos;s plan on the fridge.</p>
        </div>
      )}

      {devices && devices.length > 0 && (
        <ul className="space-y-4" aria-label="Tablets" data-testid="device-list">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              now={now}
              onRename={() => setRenameTarget(device)}
              onRemove={() => setRemoveTarget(device)}
              onReplace={() => {
                setMessage(null)
                setReplaceTarget(device)
                setPairOpen(true)
              }}
            />
          ))}
        </ul>
      )}

      <PairTabletDialog
        open={pairOpen}
        replace={replace}
        onClose={() => setPairOpen(false)}
        onPaired={() => void load()}
      />

      <RenameDeviceDialog
        device={renameTarget}
        onClose={() => setRenameTarget(null)}
        onDone={(label) => {
          setRenameTarget(null)
          setMessage(`Renamed to ${label}.`)
          void load()
        }}
      />

      <RemoveDeviceDialog
        device={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onDone={(label) => {
          setRemoveTarget(null)
          setMessage(`${label} was removed. It stops showing your family's information the next time it connects.`)
          void load()
        }}
      />
    </div>
  )
}

function RenameDeviceDialog({
  device,
  onClose,
  onDone,
}: {
  device: ManagedDevice | null
  onClose: () => void
  onDone: (label: string) => void
}) {
  const [label, setLabel] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (device) {
      setLabel(device.label)
      setError(null)
    }
  }, [device])

  return (
    <Dialog open={device !== null} onClose={onClose} title="Rename tablet" initialFocusRef={inputRef} testId="rename-device">
      <form
        className="space-y-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          if (!device) return
          const trimmed = label.trim()
          if (!trimmed || trimmed.length > 40) return setError('Use 1 to 40 characters.')
          setBusy(true)
          setError(null)
          try {
            const res = await fetch(`/api/family/devices/${encodeURIComponent(device.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ label: trimmed }),
            })
            if (res.ok) onDone(trimmed)
            else setError(res.status === 429 ? 'Too many changes. Try again later.' : 'Could not rename the tablet.')
          } catch {
            setError('Could not reach Family Planner. Try again.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <label htmlFor="rename-device-label" className={labelClass}>
            Tablet name
          </label>
          <input
            ref={inputRef}
            id="rename-device-label"
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </div>
        {error && (
          <p role="alert" className={errorTextClass}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            Save name
          </button>
          <button type="button" onClick={onClose} className={neutralButtonClass}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

const REASONS = [
  { value: 'lost', label: 'Lost or stolen' },
  { value: 'replaced', label: 'Replaced' },
  { value: 'other', label: 'Other' },
] as const

function RemoveDeviceDialog({
  device,
  onClose,
  onDone,
}: {
  device: ManagedDevice | null
  onClose: () => void
  onDone: (label: string) => void
}) {
  const [reason, setReason] = React.useState<string>('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (device) {
      setReason('')
      setError(null)
    }
  }, [device])

  return (
    <Dialog
      open={device !== null}
      onClose={onClose}
      title={device ? `Remove ${device.label}?` : 'Remove tablet?'}
      description="It stops showing your family's information the next time it connects. To use it again, pair it again."
      testId="remove-device"
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!device) return
          setBusy(true)
          setError(null)
          try {
            const res = await fetch(`/api/family/devices/${encodeURIComponent(device.id)}/revoke`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(reason ? { reason } : {}),
            })
            if (res.ok) onDone(device.label)
            else setError(res.status === 429 ? 'Too many changes. Try again later.' : 'Could not remove the tablet.')
          } catch {
            setError('Could not reach Family Planner. Try again.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <fieldset>
          <legend className={labelClass}>Reason (optional)</legend>
          <div className="space-y-1">
            {REASONS.map((r) => (
              <label key={r.value} className="flex min-h-[44px] items-center gap-3 text-[16px] text-label-primary">
                <input
                  type="radio"
                  name="remove-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="h-5 w-5"
                />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className={errorTextClass}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={dangerButtonClass}>
            Remove tablet
          </button>
          <button type="button" onClick={onClose} className={neutralButtonClass}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
