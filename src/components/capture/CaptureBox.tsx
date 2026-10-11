'use client'

import * as React from 'react'
import { Sparkles, Loader2, Check, X, ListPlus, CalendarDays, ClipboardList, Camera } from 'lucide-react'
import { CAPTURE_CHILD_MESSAGE } from '@/lib/role-capabilities'
import { newIdempotencyKey } from '@/lib/idempotency-key'
import { localDateTimeToISO } from '@/lib/dates'
import { useTranslation } from '@/i18n'
import { captureMessages, type CaptureMessage } from '@/i18n/capture'
import { Dialog } from '@/components/ui/dialog'
import {
  activateCaptureRecoveryStorage,
  CAPTURE_RECOVERY_RETENTION_MS,
  hashCaptureRequest,
  loadCaptureRecovery,
  saveCaptureRecovery,
  type CaptureRecoveryAction,
  type CaptureRecoveryEnvelope,
} from '@/lib/capture-recovery'

// Capture returns local wall-clock times without an offset ("2026-10-06T15:00").
// Convert them in the browser to an instant so the server (UTC) stores the time
// the family meant, as the preview shows it. Times that already carry an
// offset parse the same way.
function toInstant(value: string | undefined): string | undefined {
  if (!value) return value
  return localDateTimeToISO(value) ?? value
}

// Small, focused capture box. One input. Type a phrase, confirm what it understood.
// Deliberately not a chat: there is no conversation, no history, one job.

type DraftKind = 'event' | 'task' | 'listitem'

interface Draft {
  kind: DraftKind
  title: string
  start_time?: string
  end_time?: string
  location?: string
  event_type?: string
  list_name?: string
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

// A proposed event extracted from a photo. Same shape as a draft minus the kind.
interface PhotoEvent {
  title: string
  start_time?: string
  end_time?: string
  location?: string
  event_type?: string
}

class CaptureClientError extends Error {
  constructor(readonly key: CaptureMessage) {
    super(key)
    this.name = 'CaptureClientError'
  }
}

// Shrink a photo before sending it to the model. A phone photo is several MB;
// the model only needs enough detail to read dates. This keeps upload and cost
// low, and always returns a JPEG data payload.
async function downscaleImage(file: File, maxEdge = 1600): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new CaptureClientError('fileReadFailed'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new CaptureClientError('imageReadFailed'))
    el.src = dataUrl
  })

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CaptureClientError('imageProcessFailed')
  ctx.drawImage(img, 0, 0, w, h)

  const out = canvas.toDataURL('image/jpeg', 0.82)
  return { base64: out.split(',')[1] || '', mimeType: 'image/jpeg' }
}

const KIND_MESSAGE: Record<DraftKind, CaptureMessage> = {
  event: 'event',
  task: 'task',
  listitem: 'listItem',
}

const KIND_ICON: Record<DraftKind, React.ElementType> = {
  event: CalendarDays,
  task: ClipboardList,
  listitem: ListPlus,
}

function friendlyTime(iso: string | undefined, locale: 'en' | 'es', noDate: string): string {
  if (!iso) return noDate
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type RecoveryIdentity = { userId: string; familyId: string }
type CaptureAvailability = 'available' | 'unavailable' | 'retry'

function eventPayload(value: Pick<Draft | PhotoEvent, 'title' | 'start_time' | 'end_time' | 'location' | 'event_type'>) {
  return {
    title: value.title.trim(),
    start_time: toInstant(value.start_time),
    ...(value.end_time ? { end_time: toInstant(value.end_time) } : {}),
    ...(value.location ? { location: value.location.trim() } : {}),
    event_type: value.event_type || 'other',
  }
}

function recoveryActionFor(action: CaptureRecoveryAction): string {
  return action === 'event.create' ? '/api/events' : '/api/capture/grocery'
}

function recoveryTitle(row: CaptureRecoveryEnvelope, calendarEvent: string, groceryItem: string): string {
  return row.title || (row.kind === 'event' ? calendarEvent : groceryItem)
}

export function CaptureBox({
  onSaved,
  presentation = 'inline',
  open = true,
  onClose,
  onAvailabilityChange,
}: {
  /** Called after anything is saved, so the host page can re-request its data. */
  onSaved?: () => void
  /** Keep the existing inline card available while allowing calendar to host it in a sheet. */
  presentation?: 'inline' | 'sheet'
  /** Sheet visibility is controlled by the host so drafts survive dismissal. */
  open?: boolean
  /** Called by the shared Dialog when the sheet can be dismissed. */
  onClose?: () => void
  /** Reports the server-side setup/role gate to a launcher host. */
  onAvailabilityChange?: (availability: CaptureAvailability) => void
} = {}) {
  const { locale, t } = useTranslation()
  const msg = (key: CaptureMessage, params?: Record<string, string | number>) =>
    t(key, params, captureMessages)
  const localizeError = (error: unknown, fallback: CaptureMessage) =>
    error instanceof CaptureClientError
      ? msg(error.key)
      : error instanceof Error
        ? error.message
        : msg(fallback)
  const titleFor = (row: CaptureRecoveryEnvelope) =>
    recoveryTitle(row, msg('calendarEvent'), msg('groceryItem'))
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  const [availability, setAvailability] = React.useState<'loading' | CaptureAvailability>('loading')
  const [checkingAvailability, setCheckingAvailability] = React.useState(false)
  // D4 (#102): children may not use capture; the API says so via `allowed`.
  const [childBlocked, setChildBlocked] = React.useState(false)
  const [photoBusy, setPhotoBusy] = React.useState(false)
  const [photoEvents, setPhotoEvents] = React.useState<PhotoEvent[] | null>(null)
  const [photoNote, setPhotoNote] = React.useState<string | null>(null)
  const [recoveryOperations, setRecoveryOperations] = React.useState<CaptureRecoveryEnvelope[]>([])
  const [recoveryBusyKey, setRecoveryBusyKey] = React.useState<string | null>(null)
  const [recoveryMessage, setRecoveryMessage] = React.useState<string | null>(null)
  const recoveryIdentity = React.useRef<RecoveryIdentity | null>(null)
  const recoveryRows = React.useRef(new Map<string, CaptureRecoveryEnvelope>())
  const textInputRef = React.useRef<HTMLInputElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const inSheet = presentation === 'sheet'
  // Proposal identity survives retries and partial batch filtering. Do not make
  // a fresh key after an uncertain response, or a repeated effect could result.
  const operations = React.useRef(new WeakMap<object, { key: string; at: number; body?: string }>())
  function operationFor(proposal: object) {
    let operation = operations.current.get(proposal)
    if (!operation) {
      operation = { key: newIdempotencyKey(), at: Date.now() }
      operations.current.set(proposal, operation)
    }
    // Server replay retention is seven days. Never silently replay an old
    // unknown operation after that window; ask the person to check the app.
    if (Date.now() - operation.at >= CAPTURE_RECOVERY_RETENTION_MS) throw new CaptureClientError('previewTooOld')
    return operation
  }
  const syncRecoveryRows = React.useCallback((rows: CaptureRecoveryEnvelope[]) => {
    recoveryRows.current = new Map(rows.map((row) => [row.key, row]))
    setRecoveryOperations(rows)
    const identity = recoveryIdentity.current
    if (identity) saveCaptureRecovery(window.localStorage, identity.userId, identity.familyId, rows)
  }, [])

  function rememberRecovery(row: CaptureRecoveryEnvelope) {
    const next = [...recoveryRows.current.values()].filter((current) => current.key !== row.key)
    next.unshift(row)
    syncRecoveryRows(next)
  }

  function forgetRecovery(key: string) {
    syncRecoveryRows([...recoveryRows.current.values()].filter((row) => row.key !== key))
  }

  async function rememberPayload(
    action: CaptureRecoveryAction,
    operation: { key: string; at: number; body?: string },
    payload: unknown,
    title: string,
    photo: boolean,
  ): Promise<string> {
    const body = JSON.stringify(payload)
    if (operation.body && operation.body !== body) throw new CaptureClientError('previewChanged')
    operation.body = body
    const requestHash = await hashCaptureRequest(action, payload)
    if (!requestHash) throw new CaptureClientError('couldNotPrepareRetry')
    const envelope: CaptureRecoveryEnvelope = {
      version: 1,
      key: operation.key,
      action,
      requestHash,
      body,
      title: title.trim().slice(0, 200),
      kind: action === 'event.create' ? 'event' : 'listitem',
      createdAt: operation.at,
      photo,
    }
    rememberRecovery(envelope)
    return body
  }

  async function postProposal(url: string, proposal: object, payload: unknown, title: string, photo = false) {
    const operation = operationFor(proposal)
    const action: CaptureRecoveryAction = url === '/api/events' ? 'event.create' : 'capture.grocery.add'
    const body = await rememberPayload(action, operation, payload, title, photo)
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.key }, body })
      if (response.ok) forgetRecovery(operation.key)
      return response
    } catch {
      throw new CaptureClientError('uncertainSave')
    }
  }

  // Is capture set up on this deployment? An explicit authenticated refusal or
  // an explicit disabled/configured-off response is final for this mount. A
  // network/5xx/malformed response is transient so the launcher can recover
  // without a full page reload.
  const checkAvailability = React.useCallback(async () => {
    setCheckingAvailability(true)
    try {
      const response = await fetch('/api/capture')
      if (response.status === 401 || response.status === 403) {
        setUnavailable(true)
        setAvailability('unavailable')
        onAvailabilityChange?.('unavailable')
        return
      }
      if (!response.ok) throw new Error('Capture availability check failed')
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object') throw new Error('Unreadable capture availability')
      const data = value as { allowed?: unknown; configured?: unknown; userId?: unknown; familyId?: unknown }
      if (typeof data.allowed !== 'boolean' || typeof data.configured !== 'boolean') {
        throw new Error('Incomplete capture availability')
      }
      if (!data.allowed) {
        setChildBlocked(true)
        setAvailability('unavailable')
        onAvailabilityChange?.('unavailable')
        return
      }
      if (!data.configured) {
        setUnavailable(true)
        setAvailability('unavailable')
        onAvailabilityChange?.('unavailable')
        return
      }
      setAvailability('available')
      onAvailabilityChange?.('available')
      if (data.userId && data.familyId) {
        const identity = { userId: String(data.userId), familyId: String(data.familyId) }
        const previousIdentity = recoveryIdentity.current
        const sameIdentity = previousIdentity?.userId === identity.userId && previousIdentity.familyId === identity.familyId
        const pending = sameIdentity ? [...recoveryRows.current.values()] : []
        recoveryIdentity.current = identity
        activateCaptureRecoveryStorage(window.localStorage, identity.userId, identity.familyId)
        const persisted = loadCaptureRecovery(window.localStorage, identity.userId, identity.familyId)
        syncRecoveryRows([...persisted, ...pending.filter((row) => !persisted.some((saved) => saved.key === row.key))])
      }
    } catch {
      setAvailability('retry')
      onAvailabilityChange?.('retry')
    } finally {
      setCheckingAvailability(false)
    }
  }, [onAvailabilityChange, syncRecoveryRows])

  React.useEffect(() => {
    void checkAvailability()
  }, [checkAvailability])

  async function checkRecovery(row: CaptureRecoveryEnvelope) {
    if (!row.requestHash) {
      forgetRecovery(row.key)
      setRecoveryMessage(msg('statusUnavailable'))
      return
    }
    setRecoveryBusyKey(row.key)
    setRecoveryMessage(null)
    try {
      const response = await fetch('/api/capture/receipt', {
        headers: {
          'Idempotency-Key': row.key,
          'X-Capture-Action': row.action,
          'X-Capture-Request-Hash': row.requestHash,
        },
      })
      const data = (await response.json().catch(() => ({}))) as { state?: string; current?: string }
      if (response.status === 409) {
        forgetRecovery(row.key)
        setRecoveryMessage(msg('captureChanged'))
      } else if (!response.ok) {
        setRecoveryMessage(msg('couldNotCheck'))
      } else if (data.state === 'committed' && data.current === 'present') {
        forgetRecovery(row.key)
        setSaved(msg('alreadyAdded', { title: titleFor(row) }))
        onSaved?.()
      } else if (data.state === 'committed' && data.current === 'removed') {
        forgetRecovery(row.key)
        setRecoveryMessage(msg('savedRemoved'))
      } else if (data.state === 'committed') {
        forgetRecovery(row.key)
        setRecoveryMessage(msg('savedEarlier'))
      } else if (data.state === 'pending') {
        setRecoveryMessage(msg('stillProcessing'))
      } else if (data.state === 'expired') {
        forgetRecovery(row.key)
        setRecoveryMessage(msg('captureTooOld'))
      } else if (data.state === 'absent') {
        // A missing receipt is terminal: the server can no longer prove that
        // this local envelope is the original write, so never keep offering a
        // same-key retry from an orphaned or pruned client row.
        forgetRecovery(row.key)
        setRecoveryMessage(msg('noSavedResult'))
      } else {
        setRecoveryMessage(msg('noSavedResult'))
      }
    } catch {
      setRecoveryMessage(msg('couldNotCheck'))
    } finally {
      setRecoveryBusyKey(null)
    }
  }

  async function retryRecovery(row: CaptureRecoveryEnvelope) {
    if (Date.now() - row.createdAt >= CAPTURE_RECOVERY_RETENTION_MS) {
      // A request may have started just before the client-side retry window
      // closed. Reconcile the authoritative receipt first so a committed
      // present/removed resource is reported truthfully instead of being
      // discarded merely because the local clock crossed the boundary.
      await checkRecovery(row)
      return
    }
    setRecoveryBusyKey(row.key)
    setRecoveryMessage(null)
    try {
      const response = await fetch(recoveryActionFor(row.action), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': row.key },
        body: row.body,
      })
      if (response.ok) {
        // A successful keyed replay only proves the receipt response. Read
        // the family-scoped resource state before claiming it is present; a
        // committed item may have been deleted since the original attempt.
        await checkRecovery(row)
      } else if (response.status === 422) {
        forgetRecovery(row.key)
        setRecoveryMessage(msg('captureChanged'))
      } else if (response.status === 404 && row.action === 'capture.grocery.add') {
        forgetRecovery(row.key)
        setRecoveryMessage(msg('groceryListChanged'))
      } else if (response.status === 409) {
        setRecoveryMessage(msg('originalProcessing'))
      } else {
        setRecoveryMessage(msg('couldNotSaveCapture'))
      }
    } catch {
      setRecoveryMessage(msg('couldNotSaveCapture'))
    } finally {
      setRecoveryBusyKey(null)
    }
  }

  async function interpret() {
    const phrase = text.trim()
    if (!phrase) return
    setBusy(true)
    setError(null)
    setSaved(null)
    setDraft(null)
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: phrase }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || msg('couldNotRead'))
      setDraft(data.draft)
    } catch (e) {
      setError(localizeError(e, 'couldNotRead'))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      if (draft.kind === 'listitem') {
        // Resolve the household default list and add the item in one keyed
        // server transaction so a lost list-resolution response cannot strand
        // a request without a durable receipt.
        const itemRes = await postProposal('/api/capture/grocery', draft, { content: draft.title.trim(), quantity: 1 }, draft.title)
        if (!itemRes.ok) {
          const d = await itemRes.json().catch(() => ({}))
          throw new Error(typeof d.error === 'string' ? d.error : d.error?.message || msg('groceryAddFailed'))
        }
      } else {
        const res = await postProposal('/api/events', draft, eventPayload(draft), draft.title)
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(typeof d.error === 'string' ? d.error : d.error?.message || msg('couldNotSave'))
        }
      }
      setSaved(msg('addedTitle', { title: draft.title }))
      setDraft(null)
      setText('')
      onSaved?.()
    } catch (e) {
      setError(localizeError(e, 'couldNotSave'))
    } finally {
      setBusy(false)
    }
  }

  // Read a photo/screenshot and propose the events it contains.
  async function interpretPhoto(file: File) {
    setPhotoBusy(true)
    setError(null)
    setSaved(null)
    setDraft(null)
    setPhotoEvents(null)
    setPhotoNote(null)
    try {
      // Downscale before sending: keeps the upload small and the cost low.
      // A phone photo is several MB; the model does not need that detail.
      const { base64, mimeType } = await downscaleImage(file)
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || msg('couldNotReadPhoto'))
      const events: PhotoEvent[] = data?.image?.events || []
      setPhotoEvents(events)
      setPhotoNote(data?.image?.note ?? null)
    } catch (e) {
      setError(localizeError(e, 'couldNotReadPhoto'))
    } finally {
      setPhotoBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Add every proposed event the user has not removed. Events that fail stay
  // in the list so the person can try again or remove them.
  async function confirmPhoto() {
    if (!photoEvents || photoEvents.length === 0) return
    setPhotoBusy(true)
    setError(null)
    setSaved(null)
    const total = photoEvents.length
    const failed: PhotoEvent[] = []
    let added = 0
    try {
      for (const ev of photoEvents) {
        const res = await postProposal('/api/events', ev, eventPayload(ev), ev.title, true)
        if (res.ok) added += 1
        else failed.push(ev)
      }
    } catch {
      // Network error: everything not yet saved counts as failed.
      failed.push(...photoEvents.slice(added + failed.length))
    }
    if (added > 0) onSaved?.()
    if (failed.length === 0) {
      setSaved(msg(added === 1 ? 'addedOne' : 'addedMany', { count: added }))
      setPhotoEvents(null)
      setPhotoNote(null)
    } else {
      setPhotoEvents(failed)
      if (added > 0) {
        setSaved(msg('addedOf', { added, total }))
        setError(msg(failed.length === 1 ? 'couldNotSaveOne' : 'couldNotSaveMany', { count: failed.length }))
      } else {
        setError(msg('couldNotSaveEvents'))
      }
    }
    setPhotoBusy(false)
  }

  const present = (children: React.ReactNode) => {
    if (!inSheet) return children
    const canDismiss = !busy && !photoBusy && recoveryBusyKey === null
    return (
      <Dialog
        open={open}
        title={msg('quickAdd')}
        description={msg('quickAddDescription')}
        onClose={canDismiss ? onClose : undefined}
        closeLabel={msg('closeQuickAdd')}
        initialFocusRef={textInputRef}
        variant="form"
        testId="capture-sheet"
      >
        {children}
      </Dialog>
    )
  }

  if (childBlocked) {
    return present(
      <div className="card-apple p-4 text-subhead text-label-secondary" role="note" data-testid="capture-child-blocked">
        {CAPTURE_CHILD_MESSAGE}
      </div>,
    )
  }

  if (availability === 'retry') {
    return present(
      <div className={inSheet ? 'p-1' : 'card-apple p-4'} data-testid="capture-availability-retry">
        <p role="alert" className="text-subhead text-[var(--danger-text)]">{msg('availabilityRetry')}</p>
        <button
          type="button"
          className="btn-tinted min-h-[44px] mt-3"
          onClick={() => void checkAvailability()}
          disabled={checkingAvailability}
        >
          {checkingAvailability ? msg('checking') : msg('retry')}
        </button>
      </div>,
    )
  }

  // No AI key on this deployment or household: show nothing rather than a
  // dead end. The calendar's own "Add Event" still works, and a parent can
  // add a key in Settings.
  if (unavailable) return null

  const KindIcon = draft ? KIND_ICON[draft.kind] : Sparkles
  return present(
    <div className={inSheet ? 'p-1' : 'card-apple p-4'} data-testid="capture-box">
      {!inSheet && <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-[var(--accent)]" />
        <h2 className="text-headline">{msg('quickAdd')}</h2>
      </div>}

      <div className="flex gap-2">
        <input
          ref={textInputRef}
          className="input-apple flex-1"
          placeholder={msg('quickAddPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) interpret()
          }}
          disabled={busy}
          aria-label={msg('captureInputLabel')}
        />
        <button
          className="btn-filled px-4"
          onClick={interpret}
          disabled={busy || !text.trim()}
        >
          {busy && !draft ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="sr-only">{msg('reading')}</span>
            </>
          ) : (
            msg('readIt')
          )}
        </button>
      </div>

      {/* Photo capture: a flyer, timetable or appointment card. */}
      <div className="mt-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) interpretPhoto(f)
          }}
          aria-label={msg('choosePhoto')}
        />
        <button
          className="btn-plain text-footnote inline-flex items-center gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || photoBusy}
        >
          {photoBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {photoBusy ? msg('readingPhoto') : msg('takePhoto')}
        </button>
      </div>

      {error && <p role="alert" className="text-subhead text-[var(--danger-text)] mt-3">{error}</p>}

      {saved && (
        <p role="status" className="text-subhead text-[var(--success,#059669)] mt-3 flex items-center gap-1">
          <Check className="w-4 h-4" aria-hidden="true" /> {saved}
        </p>
      )}

      {(recoveryOperations.length > 0 || recoveryMessage) && (
        <section
          className="mt-4 rounded-xl border border-[var(--separator)] p-3"
          aria-labelledby={recoveryOperations.length > 0 ? 'capture-recovery-title' : undefined}
          data-testid="capture-recovery"
        >
          {recoveryOperations.length > 0 && (
            <>
              <h3 id="capture-recovery-title" className="text-body font-medium">{msg('needsAttention')}</h3>
              <p className="text-footnote text-label-secondary mt-1">{msg('previousAddHint')}</p>
              <ul className="mt-2 space-y-2">
                {recoveryOperations.map((row) => {
                  const busyRecovery = recoveryBusyKey === row.key
                  return (
                    <li key={row.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-subhead min-w-0 truncate">{titleFor(row)}</span>
                      <span className="flex shrink-0 gap-2">
                        <button
                          className="btn-plain min-h-[44px] px-3"
                          onClick={() => checkRecovery(row)}
                          disabled={recoveryBusyKey !== null}
                          aria-label={msg('checkStatusFor', { title: titleFor(row) })}
                        >
                          {busyRecovery ? msg('checking') : msg('checkStatus')}
                        </button>
                        <button
                          className="btn-filled min-h-[44px] px-3"
                          onClick={() => retryRecovery(row)}
                          disabled={recoveryBusyKey !== null || !row.requestHash}
                          aria-label={msg('retryFor', { title: titleFor(row) })}
                        >
                          {msg('retry')}
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {recoveryMessage && <p role="alert" className="text-subhead text-[var(--danger-text)] mt-3">{recoveryMessage}</p>}
        </section>
      )}

      {draft && (
        <div className="mt-4 rounded-xl border border-[var(--separator)] p-3">
          <div className="flex items-center gap-2 text-label-secondary text-footnote mb-1">
            <KindIcon className="w-3.5 h-3.5" />
            {msg(KIND_MESSAGE[draft.kind])}
            {draft.confidence === 'low' && (
              <span className="text-[var(--danger-text)]">{msg('lowConfidence')}</span>
            )}
          </div>

          <p className="text-body font-medium">{draft.title}</p>

          {draft.kind !== 'listitem' && (
            <p className="text-subhead text-label-secondary">
              {friendlyTime(draft.start_time, locale, msg('noDate'))}
              {draft.location ? ` · ${draft.location}` : ''}
            </p>
          )}

          {draft.note && (
            <p className="text-footnote text-label-secondary mt-1">{draft.note}</p>
          )}

          <div className="flex gap-2 mt-3">
            <button className="btn-filled px-4" onClick={confirm} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span className="sr-only">{msg('adding')}</span>
                </>
              ) : (
                msg('addIt')
              )}
            </button>
            <button
              className="btn-plain min-h-[44px] min-w-[44px] px-4"
              onClick={() => setDraft(null)}
              disabled={busy}
              aria-label={msg('discard')}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {photoEvents && (
        <div className="mt-4 rounded-xl border border-[var(--separator)] p-3">
          <div className="flex items-center gap-2 text-label-secondary text-footnote mb-2">
            <Camera className="w-3.5 h-3.5" />
            {photoEvents.length === 0
              ? msg('noEventsFound')
              : msg(photoEvents.length === 1 ? 'foundOne' : 'foundMany', { count: photoEvents.length })}
          </div>

          {photoEvents.length > 0 && (
            <ul className="space-y-2">
              {photoEvents.map((ev, i) => (
                <li key={i} className="flex items-start gap-2">
                  <button
                    className="btn-plain -my-2 min-h-[44px] min-w-[44px] p-1 shrink-0"
                    aria-label={msg('removeEvent', { title: ev.title })}
                    onClick={() =>
                      setPhotoEvents((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))
                    }
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-body">{ev.title}</p>
                    <p className="text-footnote text-label-secondary">
                      {friendlyTime(ev.start_time, locale, msg('noDate'))}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {photoNote && (
            <p className="text-footnote text-label-secondary mt-2">{photoNote}</p>
          )}

          <div className="flex gap-2 mt-3">
            {photoEvents.length > 0 && (
              <button className="btn-filled px-4" onClick={confirmPhoto} disabled={photoBusy}>
                {photoBusy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span className="sr-only">{msg('adding')}</span>
                  </>
                ) : (
                  msg(photoEvents.length === 1 ? 'addOne' : 'addMany', { count: photoEvents.length })
                )}
              </button>
            )}
            <button
              className="btn-plain px-4"
              onClick={() => {
                setPhotoEvents(null)
                setPhotoNote(null)
              }}
              disabled={photoBusy}
            >
              {msg('cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
