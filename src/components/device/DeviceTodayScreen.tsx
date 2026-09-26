'use client'

import * as React from 'react'
import { Loader2, Lock } from 'lucide-react'
import TodayBoard from '@/components/fridge/TodayBoard'
import { Dialog } from '@/components/ui/dialog'
import type { TodayBoardData } from '@/app/dashboard/today/today-board-data'
import { DeviceApiError, type ElevationSession } from '@/lib/device-client'
import ElevatedBanner from './ElevatedBanner'
import ElevationSheet from './ElevationSheet'
import { genericErrorText, useDeviceClient, type DeviceMe } from './use-device-client'
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  primaryButtonClass,
  screenCardClass,
  secondaryButtonClass,
} from './styles'

const PROACTIVE_CHECK_MS = 60 * 1000

/**
 * Paired tablet home (/device/today, #241). Loads the device-audience Today
 * board DTO from GET /api/device/today (links all null) and renders the
 * existing TodayBoard in fridge mode. No person profile is loaded anywhere on
 * this page. Parent mode (elevation) is memory-only and ends on idle, max,
 * hide, page hide, reload and "Done".
 */
export default function DeviceTodayScreen({ hasAccessCookie }: { hasAccessCookie: boolean }) {
  const client = useDeviceClient()
  const [data, setData] = React.useState<TodayBoardData | null>(null)
  const [me, setMe] = React.useState<DeviceMe | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [elevation, setElevation] = React.useState<ElevationSession | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  const loadBoard = React.useCallback(async () => {
    if (!client || client.isPurged()) return
    try {
      const board = await client.request<TodayBoardData>('/api/device/today')
      setData(board)
      setLoadError(null)
    } catch (err) {
      if (err instanceof DeviceApiError && err.terminal) return
      setLoadError(genericErrorText(err))
    }
  }, [client])

  const loadMe = React.useCallback(async () => {
    if (!client || client.isPurged()) return
    try {
      const identity = await client.request<DeviceMe>('/api/device/me')
      if (!(await client.checkDeviceId(identity.device.id))) return
      setMe(identity)
    } catch {
      // Terminal errors already purged; anything else leaves the Parent button disabled until the next try.
    }
  }, [client])

  // Cold launch: refresh first when the access cookie is gone (§4), then load.
  React.useEffect(() => {
    if (!client) return
    let cancelled = false
    void (async () => {
      await client.bootstrap(hasAccessCookie)
      if (cancelled || client.isPurged()) return
      await Promise.all([loadBoard(), loadMe()])
    })()
    return () => {
      cancelled = true
    }
  }, [client, hasAccessCookie, loadBoard, loadMe])

  // Proactive refresh while visible (§4).
  React.useEffect(() => {
    if (!client) return
    const check = () => void client.maybeRefresh()
    const id = window.setInterval(check, PROACTIVE_CHECK_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [client])

  // Mirror the client's memory-only elevation.
  React.useEffect(() => {
    if (!client) return
    setElevation(client.getElevation())
    return client.subscribe(() => setElevation(client.getElevation()))
  }, [client])

  const elevated = elevation !== null

  // Auto-exit: backgrounding, page hide (navigation, reload, process death).
  // Installed for the page's whole life, not only while elevated: an
  // elevation that resolves after the tablet was hidden is refused by the
  // client (it checks visibility and page hide when the credential returns).
  React.useEffect(() => {
    if (!client) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void client.endElevation()
    }
    const onPageHide = () => client.notePageHide()
    const onPageShow = () => client.notePageShow()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [client])

  // Close the elevated dialogs when parent mode ends for any reason.
  React.useEffect(() => {
    if (!elevated) {
      setRenameOpen(false)
      setRemoveOpen(false)
    }
  }, [elevated])

  const exitParentMode = React.useCallback(
    (message: string) => {
      void client?.endElevation()
      setStatus(message)
    },
    [client]
  )

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--surface-grouped)] px-4 py-10">
        <div className={screenCardClass}>
          {loadError ? (
            <>
              <h1 className="font-display text-[32px] font-bold leading-tight text-label-primary">
                Today&apos;s board could not load
              </h1>
              <p role="alert" className={`mt-4 ${errorTextClass}`}>
                {loadError}
              </p>
              <div className="mt-6">
                <button type="button" onClick={() => void loadBoard()} className={primaryButtonClass}>
                  Try again
                </button>
              </div>
            </>
          ) : (
            <p role="status" className="flex items-center gap-3 text-[21px] text-label-primary">
              <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
              Loading today&apos;s board
            </p>
          )}
        </div>
      </main>
    )
  }

  const parentButton = !elevated ? (
    <button
      type="button"
      onClick={() => {
        setStatus(null)
        setSheetOpen(true)
        if (!me) void loadMe()
      }}
      className={secondaryButtonClass}
    >
      <Lock className="h-5 w-5" aria-hidden="true" />
      Parent
    </button>
  ) : null

  const banner = (
    <>
      {status && (
        <p
          role="status"
          data-testid="device-status"
          className="mb-5 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-3 text-[17px] text-label-primary"
        >
          {status}
        </p>
      )}
      {client && elevation && (
        <ElevatedBanner
          client={client}
          session={elevation}
          onExpire={() => exitParentMode('Parent mode ended.')}
          onDone={() => exitParentMode('Parent mode ended.')}
          onRename={() => setRenameOpen(true)}
          onRemove={() => setRemoveOpen(true)}
        />
      )}
    </>
  )

  return (
    <>
      <TodayBoard
        data={data}
        fridgeMode
        onRefresh={() => void loadBoard()}
        actions={parentButton ?? <span />}
        banner={banner}
      />

      <ElevationSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        client={client}
        parents={me?.parents ?? []}
        onElevated={() => {
          setSheetOpen(false)
          setStatus(null)
        }}
      />

      {client && elevation && (
        <RenameDialog
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
          currentLabel={me?.device.label ?? ''}
          onSave={async (label) => {
            const res = await client.request<{ device: { id: string; label: string } }>('/api/device/label', {
              method: 'PATCH',
              body: { label },
              elevated: true,
            })
            setMe((prev) => (prev ? { ...prev, device: res.device } : prev))
            setRenameOpen(false)
            setStatus(`Renamed to ${res.device.label}.`)
          }}
        />
      )}

      {client && elevation && (
        <RemoveDialog
          open={removeOpen}
          onClose={() => setRemoveOpen(false)}
          label={me?.device.label ?? 'this tablet'}
          onConfirm={async () => {
            await client.request('/api/device/revoke-self', { method: 'POST', elevated: true })
            // The server cleared the cookies; wipe this browser and show the removed screen.
            await client.purge()
          }}
        />
      )}
    </>
  )
}

function elevatedErrorText(err: unknown): string {
  if (err instanceof DeviceApiError && (err.code === 'ELEVATION_EXPIRED' || err.code === 'ELEVATION_REQUIRED')) {
    return 'Parent mode ended. Tap Parent to unlock again.'
  }
  if (err instanceof DeviceApiError && err.code === 'VALIDATION_ERROR') return 'Use 1 to 40 characters.'
  return genericErrorText(err)
}

function RenameDialog({
  open,
  onClose,
  currentLabel,
  onSave,
}: {
  open: boolean
  onClose: () => void
  currentLabel: string
  onSave: (label: string) => Promise<void>
}) {
  const [label, setLabel] = React.useState(currentLabel)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setLabel(currentLabel)
      setError(null)
    }
  }, [open, currentLabel])

  return (
    <Dialog open={open} onClose={onClose} title="Rename this tablet" initialFocusRef={inputRef} testId="device-rename">
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault()
          const trimmed = label.trim()
          if (!trimmed || trimmed.length > 40) {
            setError('Use 1 to 40 characters.')
            return
          }
          setBusy(true)
          setError(null)
          try {
            await onSave(trimmed)
          } catch (err) {
            setError(elevatedErrorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <label htmlFor="device-label" className={labelClass}>
            Tablet name
          </label>
          <input
            ref={inputRef}
            id="device-label"
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

function RemoveDialog({
  open,
  onClose,
  label,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  label: string
  onConfirm: () => Promise<void>
}) {
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setError(null)
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Remove ${label}?`}
      testId="device-remove"
      description="It stops showing your family's information right away. A parent can pair it again later."
    >
      {error && (
        <p role="alert" className={`mb-5 ${errorTextClass}`}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          className={dangerButtonClass}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onConfirm()
            } catch (err) {
              setError(elevatedErrorText(err))
              setBusy(false)
            }
          }}
        >
          Remove tablet
        </button>
        <button type="button" onClick={onClose} className={neutralButtonClass}>
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
