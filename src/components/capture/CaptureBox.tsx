'use client'

import * as React from 'react'
import { Sparkles, Loader2, Check, X, ListPlus, CalendarDays, ClipboardList, Camera } from 'lucide-react'
import { CAPTURE_CHILD_MESSAGE } from '@/lib/role-capabilities'
import { localDateTimeToISO } from '@/lib/dates'

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

// Shrink a photo before sending it to the model. A phone photo is several MB;
// the model only needs enough detail to read dates. This keeps upload and cost
// low, and always returns a JPEG data payload.
async function downscaleImage(file: File, maxEdge = 1600): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('That file is not a readable image'))
    el.src = dataUrl
  })

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process that image')
  ctx.drawImage(img, 0, 0, w, h)

  const out = canvas.toDataURL('image/jpeg', 0.82)
  return { base64: out.split(',')[1] || '', mimeType: 'image/jpeg' }
}

const KIND_LABEL: Record<DraftKind, string> = {
  event: 'Event',
  task: 'Task',
  listitem: 'List item',
}

const KIND_ICON: Record<DraftKind, React.ElementType> = {
  event: CalendarDays,
  task: ClipboardList,
  listitem: ListPlus,
}

function friendlyTime(iso?: string): string {
  if (!iso) return 'no date set'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function CaptureBox({
  onSaved,
}: {
  /** Called after anything is saved, so the host page can re-request its data. */
  onSaved?: () => void
} = {}) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  // D4 (#102): children may not use capture; the API says so via `allowed`.
  const [childBlocked, setChildBlocked] = React.useState(false)
  const [photoBusy, setPhotoBusy] = React.useState(false)
  const [photoEvents, setPhotoEvents] = React.useState<PhotoEvent[] | null>(null)
  const [photoNote, setPhotoNote] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Is capture set up on this deployment?
  React.useEffect(() => {
    fetch('/api/capture')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.allowed === false) setChildBlocked(true)
        else if (d && d.configured === false) setUnavailable(true)
      })
      .catch(() => {})
  }, [])

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
      if (!res.ok) throw new Error(data.error || 'Could not read that')
      setDraft(data.draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that')
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
        // The household's default grocery list, found or created by the one
        // server rule recipe adds use too (ADR-0007 O-4), then add the item.
        const listRes = await fetch('/api/lists/default-grocery', { method: 'POST' })
        const listData = await listRes.json().catch(() => ({}))
        if (!listRes.ok || !listData.list) {
          throw new Error(listData.error || 'Could not find a grocery list')
        }
        const list: { id: string } = listData.list

        const itemRes = await fetch('/api/lists/items/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listId: list.id, content: draft.title, quantity: 1 }),
        })
        if (!itemRes.ok) {
          const d = await itemRes.json().catch(() => ({}))
          throw new Error(d.error || 'Could not add to the list')
        }
      } else {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            start_time: toInstant(draft.start_time),
            end_time: toInstant(draft.end_time),
            location: draft.location,
            event_type: draft.event_type || 'other',
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || 'Could not save')
        }
      }
      setSaved(`Added “${draft.title}”`)
      setDraft(null)
      setText('')
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
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
      if (!res.ok) throw new Error(data.error || 'Could not read that photo')
      const events: PhotoEvent[] = data?.image?.events || []
      setPhotoEvents(events)
      setPhotoNote(data?.image?.note ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that photo')
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
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: ev.title,
            start_time: toInstant(ev.start_time),
            end_time: toInstant(ev.end_time),
            location: ev.location,
            event_type: ev.event_type || 'other',
          }),
        })
        if (res.ok) added += 1
        else failed.push(ev)
      }
    } catch {
      // Network error: everything not yet saved counts as failed.
      failed.push(...photoEvents.slice(added + failed.length))
    }
    if (added > 0) onSaved?.()
    if (failed.length === 0) {
      setSaved(`Added ${added} event${added === 1 ? '' : 's'}`)
      setPhotoEvents(null)
      setPhotoNote(null)
    } else {
      setPhotoEvents(failed)
      if (added > 0) {
        setSaved(`Added ${added} of ${total} events`)
        setError(
          `${failed.length} event${failed.length === 1 ? '' : 's'} could not be saved. Try again, or remove ${failed.length === 1 ? 'it' : 'them'}.`
        )
      } else {
        setError('Could not save those events')
      }
    }
    setPhotoBusy(false)
  }

  if (childBlocked) {
    return (
      <div className="card-apple p-4 text-subhead text-label-secondary" role="note" data-testid="capture-child-blocked">
        {CAPTURE_CHILD_MESSAGE}
      </div>
    )
  }

  // No AI key on this deployment or household: show nothing rather than a
  // dead end. The calendar's own "Add Event" still works, and a parent can
  // add a key in Settings.
  if (unavailable) return null

  const KindIcon = draft ? KIND_ICON[draft.kind] : Sparkles
  return (
    <div className="card-apple p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-[var(--accent)]" />
        <h2 className="text-headline">Quick add</h2>
      </div>

      <div className="flex gap-2">
        <input
          className="input-apple flex-1"
          placeholder="dentist Tuesday 3pm, or milk"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) interpret()
          }}
          disabled={busy}
          aria-label="What would you like to add?"
        />
        <button
          className="btn-filled px-4"
          onClick={interpret}
          disabled={busy || !text.trim()}
        >
          {busy && !draft ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="sr-only">Reading…</span>
            </>
          ) : (
            'Read it'
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
          aria-label="Choose a photo of a flyer or timetable"
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
          {photoBusy ? 'Reading the photo…' : 'Or take a photo of a flyer'}
        </button>
      </div>

      {error && <p role="alert" className="text-subhead text-[var(--danger-text)] mt-3">{error}</p>}

      {saved && (
        <p role="status" className="text-subhead text-[var(--success,#059669)] mt-3 flex items-center gap-1">
          <Check className="w-4 h-4" aria-hidden="true" /> {saved}
        </p>
      )}

      {draft && (
        <div className="mt-4 rounded-xl border border-[var(--separator)] p-3">
          <div className="flex items-center gap-2 text-label-secondary text-footnote mb-1">
            <KindIcon className="w-3.5 h-3.5" />
            {KIND_LABEL[draft.kind]}
            {draft.confidence === 'low' && (
              <span className="text-[var(--danger-text)]">· not sure, please check</span>
            )}
          </div>

          <p className="text-body font-medium">{draft.title}</p>

          {draft.kind !== 'listitem' && (
            <p className="text-subhead text-label-secondary">
              {friendlyTime(draft.start_time)}
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
                  <span className="sr-only">Adding…</span>
                </>
              ) : (
                'Add it'
              )}
            </button>
            <button
              className="btn-plain min-h-[44px] min-w-[44px] px-4"
              onClick={() => setDraft(null)}
              disabled={busy}
              aria-label="Discard"
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
              ? 'No events found in that photo'
              : `Found ${photoEvents.length} event${photoEvents.length === 1 ? '' : 's'}`}
          </div>

          {photoEvents.length > 0 && (
            <ul className="space-y-2">
              {photoEvents.map((ev, i) => (
                <li key={i} className="flex items-start gap-2">
                  <button
                    className="btn-plain -my-2 min-h-[44px] min-w-[44px] p-1 shrink-0"
                    aria-label={`Remove ${ev.title}`}
                    onClick={() =>
                      setPhotoEvents((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))
                    }
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-body">{ev.title}</p>
                    <p className="text-footnote text-label-secondary">
                      {friendlyTime(ev.start_time)}
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
                    <span className="sr-only">Adding…</span>
                  </>
                ) : (
                  `Add ${photoEvents.length}`
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
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
