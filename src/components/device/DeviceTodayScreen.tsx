'use client'

import * as React from 'react'
import { useDeviceText, englishDeviceText, type DeviceFeedback, type DeviceText } from '@/i18n/device-management'
import { Loader2, Lock, UserRound } from 'lucide-react'
import TodayBoard from '@/components/fridge/TodayBoard'
import { DeviceGroceryAdd } from './DeviceGroceryAdd'
import BoardSettings, { type BoardSettingsData, type BoardSettingsTransport, type Place } from '@/components/fridge/BoardSettings'
import { Dialog } from '@/components/ui/dialog'
import { DeviceApiError, type DeviceClient, type ElevationSession } from '@/lib/device-client'
import ElevatedBanner from './ElevatedBanner'
import ElevationSheet from './ElevationSheet'
import { genericDeviceFeedback, renderDeviceFeedback, useDeviceClient, type DeviceMe } from './use-device-client'
import { useDeviceBoardActions } from './use-device-board-actions'
import { useDeviceBoardSnapshot } from './use-device-board-snapshot'
import { useTodayBoardText } from '@/i18n/today-board'
import { clearRewardCreateIntents } from '@/lib/reward-create-intent-store'
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
 *
 * #274: when the household turned tablet writes on, chore and grocery tiles
 * act directly after "Who's this?" (SHARED_DEVICE.md §9.2), and parent mode
 * offers the board settings on the tablet itself (no photos, O-15).
 */
export default function DeviceTodayScreen({ hasAccessCookie, memberProtocol = 1 }: { hasAccessCookie: boolean; memberProtocol?: 1 | 2 }) {
  const text = useDeviceText()
  const client = useDeviceClient()
  const boardText = useTodayBoardText()
  const [me, setMe] = React.useState<DeviceMe | null>(null)
  const [elevation, setElevation] = React.useState<ElevationSession | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [status, setStatus] = React.useState<ElevatedFeedback | null>(null)

  const loadMe = React.useCallback(async (): Promise<string | null> => {
    if (!client || client.isPurged()) return null
    try {
      const identity = await client.request<DeviceMe>('/api/device/me')
      if (!(await client.checkDeviceId(identity.device.id)) || client.isPurged()) return null
      setMe(identity)
      return identity.device.id
    } catch {
      return null
    }
  }, [client])

  const { data, error: loadError, protocolError, cached, cacheUnavailable, load: loadBoard, checkVersion } = useDeviceBoardSnapshot({ client, hasAccessCookie, memberProtocol, loadIdentity: loadMe })

  const refreshBoard = React.useCallback(() => void loadBoard(), [loadBoard])
  const { actions, actor, forgetActor, picker } = useDeviceBoardActions({
    client,
    enabled: Boolean(data) && !cached && Boolean(me?.deviceWrites),
    features: me ? { chores: me.features.chores, lists: me.features.lists } : null,
    members: data?.members ?? [],
    memberProtocol,
    afterChange: refreshBoard,
  })
  const settingsTransport = React.useMemo(() => (client ? deviceSettingsTransport(client) : null), [client])

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
    return client.subscribe((event) => {
      setElevation(client.getElevation())
      if (event === 'purge') {
        clearRewardCreateIntents()
        setMe(null)
        setSheetOpen(false)
      }
    })
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
      setSettingsOpen(false)
    }
  }, [elevated])

  const exitParentMode = React.useCallback(
    (message: DeviceFeedback) => {
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
                {protocolError ? boardText('protocolCompatibilityTitle') : text('todayLoadFailed')}
              </h1>
              <p role="alert" className={`mt-4 ${errorTextClass}`}>
                {protocolError ? boardText('protocolCompatibilityBody') : loadError}
              </p>
              <div className="mt-6">
                <button type="button" onClick={() => void loadBoard()} className={primaryButtonClass}>
                  {protocolError ? boardText('refreshBoard') : text('retry')}
                </button>
              </div>
            </>
          ) : (
            <p role="status" className="flex items-center gap-3 text-[21px] text-label-primary">
              <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />{text("loadingTodayBoard")}</p>
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
      disabled={cached}
      className={secondaryButtonClass}
    >
      <Lock className="h-5 w-5" aria-hidden="true" />{text("parentButton")}</button>
  ) : null

  const banner = (
    <>
      {cacheUnavailable && data && (
        <p role="status" data-testid="device-cache-unavailable" className="mb-5 rounded-[var(--radius-lg)] bg-[var(--surface-elevated)] px-4 py-3 text-[17px] text-label-primary">{text("tabletCacheUnavailable")}</p>
      )}
      {cached && (
        <p role="status" data-testid="device-cached-plan" className="mb-5 rounded-[var(--radius-lg)] bg-[var(--surface-elevated)] px-4 py-3 text-[17px] text-label-primary">{text("tabletCachedPlan")}</p>
      )}
      {status && (
        <p
          role="status"
          data-testid="device-status"
          className="mb-5 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-3 text-[17px] text-label-primary"
        >
          {renderElevatedFeedback(status, text)}
        </p>
      )}
      {client && elevation && (
        <ElevatedBanner
          client={client}
          session={elevation}
          onExpire={() => exitParentMode({ key: 'parentModeEnded' })}
          onDone={() => exitParentMode({ key: 'parentModeEnded' })}
          onRename={() => setRenameOpen(true)}
          onRemove={() => setRemoveOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      {actor && (
        <div
          data-testid="device-actor"
          className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-4 py-2 text-[17px] text-label-primary"
        >
          <UserRound className="h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
          <span className="min-w-0 flex-1">{text('tickingAs', { name: actor.name })}</span>
          <button type="button" onClick={forgetActor} className={neutralButtonClass}>
            {text('notActor', { name: actor.name.trim().split(/\s+/)[0] ?? '' })}
          </button>
        </div>
      )}
    </>
  )

  return (
    <>
      <main>
        <TodayBoard
          data={data}
          cachedSnapshot={cached}
          fridgeMode
          onRefresh={() => void loadBoard()}
          checkVersion={checkVersion}
          actions={parentButton ?? <span />}
          banner={banner}
          tileActions={actions}
          groceryAction={!cached && client && me?.deviceWrites && me.features.lists && data.groceryLists && actions?.prepare ? (
            <DeviceGroceryAdd client={client} lists={data.groceryLists} actorId={actor?.id ?? null} prepare={actions.prepare} afterChange={refreshBoard} />
          ) : undefined}
        />
      </main>
      {picker}

      {client && elevation && settingsTransport && (
        <Dialog
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false)
            // The household may have changed colours, weather or tablet writes.
            void loadBoard()
            void loadMe()
          }}
          title={text('boardSettings')}
          testId="device-board-settings"
          className="sm:max-w-2xl"
        >
          <BoardSettings transport={settingsTransport} headingLevel={3} />
        </Dialog>
      )}

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
            setStatus({ key: 'renameDone', params: { label: res.device.label } })
          }}
        />
      )}

      {client && elevation && (
        <RemoveDialog
          open={removeOpen}
          onClose={() => setRemoveOpen(false)}
          label={me?.device.label ?? text('thisTablet')}
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

/**
 * Board settings through the elevated device routes (#274). Every call sends
 * the memory-only elevation token; an expired elevation drops parent mode.
 */
function deviceSettingsTransport(client: DeviceClient): BoardSettingsTransport {
  const call = async <T,>(path: string, init: { method?: 'GET' | 'PATCH'; body?: unknown } = {}): Promise<T> => {
    try {
      return await client.request<T>(path, { ...init, elevated: true })
    } catch (err) {
      throw new Error(elevatedErrorText(err))
    }
  }
  return {
    load: () => call<BoardSettingsData>('/api/device/elevated/board-settings'),
    save: (patch) => call<BoardSettingsData>('/api/device/elevated/board-settings', { method: 'PATCH', body: patch }),
    searchPlaces: async (q) =>
      (await call<{ places: Place[] }>(`/api/device/elevated/board-settings/places?q=${encodeURIComponent(q)}`))
        .places,
  }
}

type ElevatedFeedback = DeviceFeedback | { message: string }
function elevatedFeedback(err: unknown): ElevatedFeedback {
  if (err instanceof DeviceApiError && (err.code === 'ELEVATION_EXPIRED' || err.code === 'ELEVATION_REQUIRED'))
    return { key: 'parentUnlockAgain' }
  if (err instanceof DeviceApiError && err.code === 'VALIDATION_ERROR')
    return err.message ? { message: err.message } : { key: 'nameLength' }
  if (err instanceof DeviceApiError && err.status > 0 && err.status < 500 && err.status !== 429 && err.message)
    return { message: err.message }
  return genericDeviceFeedback(err)
}
function renderElevatedFeedback(feedback: ElevatedFeedback, text: DeviceText = englishDeviceText): string {
  return 'message' in feedback ? feedback.message : renderDeviceFeedback(feedback, text)
}
function elevatedErrorText(err: unknown): string {
  return renderElevatedFeedback(elevatedFeedback(err))
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
  const text = useDeviceText()
  const [label, setLabel] = React.useState(currentLabel)
  const [error, setError] = React.useState<ElevatedFeedback | null>(null)
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setLabel(currentLabel)
      setError(null)
    }
  }, [open, currentLabel])

  return (
    <Dialog open={open} onClose={onClose} title={text('renameThisTablet')} initialFocusRef={inputRef} testId="device-rename">
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault()
          const trimmed = label.trim()
          if (!trimmed || trimmed.length > 40) {
            setError({ key: 'nameLength' })
            return
          }
          setBusy(true)
          setError(null)
          try {
            await onSave(trimmed)
          } catch (err) {
            setError(elevatedFeedback(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <label htmlFor="device-label" className={labelClass}>{text("tabletName")}</label>
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
            {renderElevatedFeedback(error, text)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={primaryButtonClass}>{text("saveName")}</button>
          <button type="button" onClick={onClose} className={neutralButtonClass}>{text("cancel")}</button>
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
  const text = useDeviceText()
  const [error, setError] = React.useState<ElevatedFeedback | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setError(null)
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={text('removeTitle', { label })}
      testId="device-remove"
      description={text('removeNowDescription')}
    >
      {error && (
        <p role="alert" className={`mb-5 ${errorTextClass}`}>
          {renderElevatedFeedback(error, text)}
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
              setError(elevatedFeedback(err))
              setBusy(false)
            }
          }}
        >{text("removeTablet")}</button>
        <button type="button" onClick={onClose} className={neutralButtonClass}>{text("cancel")}</button>
      </div>
    </Dialog>
  )
}
