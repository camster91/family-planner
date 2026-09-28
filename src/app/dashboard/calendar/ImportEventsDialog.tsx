'use client'

/**
 * "Import from text or photo" (#270): paste the text of a flyer or email, or
 * choose a photo or PDF of it; the event reader suggests events
 * (POST /api/calendar/import-suggestions, which writes nothing); the person
 * reviews and edits them, then adds the ticked ones through the ordinary
 * POST /api/events, one at a time. That route has no idempotency key, so
 * cards that were added leave the list: "Add" after a partial failure only
 * sends what is still there, and a retry cannot add an event twice.
 *
 * Suggestions are untrusted model text: they are only ever rendered as React
 * text and input values. Confidence is shown in words, never colour alone.
 */
import * as React from 'react'
import { FileText, Loader2, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  IMPORT_IMAGE_MAX_BYTES,
  IMPORT_PDF_MAX_BYTES,
  IMPORT_TEXT_MAX_CHARS,
  confidenceLabel,
  deviceTimeZone,
  deviceToday,
  draftToEventBody,
  toDrafts,
  type ImportDraft,
  type ImportSuggestion,
} from '@/lib/event-import-client'

/** Longest edge sent to the provider; larger photos are downscaled in the browser when it can decode them. */
const MAX_EDGE = 1568

export const UNREADABLE_MESSAGE = "We couldn't find any dates in this. Try a clearer photo or paste the text."

type Mode = 'text' | 'file'
type Phase = { step: 'input' } | { step: 'reading' } | { step: 'review' } | { step: 'error'; message: string }

/** Downscale to MAX_EDGE as JPEG where the browser can decode the photo; otherwise send it unchanged. */
async function prepareImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= 4 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) {
      bitmap.close?.()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ?? file
  } catch {
    return file
  }
}

async function readError(res: Response): Promise<string> {
  let message: string | null = null
  try {
    const body = await res.json()
    const err = body?.error
    if (typeof err === 'string') message = err
    else if (err && typeof err.message === 'string') message = err.message
  } catch {
    // fall through
  }
  if (res.status === 404) return "Importing events isn't available right now. You can still add events by hand."
  if (res.status === 403) return message ?? "You can't import events. Ask a parent."
  if ([400, 411, 413, 415, 429, 502].includes(res.status) && message) return message
  return 'Something went wrong while reading this. Try again, or add the event by hand.'
}

export interface ImportEventsDialogProps {
  onClose: () => void
  /** Called with the ids of every event created in this dialog (at least one). */
  onDone: (createdIds: string[]) => void
}

export function ImportEventsDialog({ onClose, onDone }: ImportEventsDialogProps) {
  const [mode, setMode] = React.useState<Mode>('text')
  const [text, setText] = React.useState('')
  const [phase, setPhase] = React.useState<Phase>({ step: 'input' })
  const [drafts, setDrafts] = React.useState<ImportDraft[]>([])
  const [timeZone, setTimeZone] = React.useState<string>('America/Toronto')
  const [adding, setAdding] = React.useState(false)
  const [addError, setAddError] = React.useState<string | null>(null)
  const created = React.useRef<string[]>([])
  const [createdCount, setCreatedCount] = React.useState(0)
  const titleId = React.useId()
  const fileRef = React.useRef<HTMLInputElement>(null)

  const close = React.useCallback(() => {
    if (adding) return
    if (created.current.length > 0) onDone([...created.current])
    else onClose()
  }, [adding, onClose, onDone])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const startOver = () => {
    setPhase({ step: 'input' })
    setDrafts([])
    setAddError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const request = async (init: RequestInit) => {
    setPhase({ step: 'reading' })
    setAddError(null)
    try {
      const res = await fetch('/api/calendar/import-suggestions', { method: 'POST', ...init })
      if (!res.ok) {
        setPhase({ step: 'error', message: await readError(res) })
        return
      }
      const body = await res.json()
      const suggestions = Array.isArray(body?.suggestions) ? (body.suggestions as ImportSuggestion[]) : []
      if (typeof body?.timeZone === 'string') setTimeZone(body.timeZone)
      // `unreadable: true` always comes with no suggestions; both show UNREADABLE_MESSAGE.
      setDrafts(toDrafts(suggestions))
      setPhase({ step: 'review' })
    } catch {
      setPhase({ step: 'error', message: "Couldn't reach the event reader. Check your connection and try again." })
    }
  }

  const submitText = async () => {
    const value = text.trim()
    if (!value) return
    await request({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: value, today: deviceToday(), timeZone: deviceTimeZone() }),
    })
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    let upload: Blob = file
    if (isPdf) {
      if (file.size > IMPORT_PDF_MAX_BYTES) {
        setPhase({ step: 'error', message: 'That PDF is too large. The limit is 10 MB.' })
        return
      }
    } else {
      setPhase({ step: 'reading' })
      upload = await prepareImage(file)
      if (upload.size > IMPORT_IMAGE_MAX_BYTES) {
        setPhase({ step: 'error', message: 'That photo is too large. The limit is 8 MB.' })
        return
      }
    }
    const form = new FormData()
    form.append('file', upload, isPdf ? 'flyer.pdf' : 'flyer.jpg')
    form.append('today', deviceToday())
    const zone = deviceTimeZone()
    if (zone) form.append('timeZone', zone)
    await request({ body: form })
    if (fileRef.current) fileRef.current.value = ''
  }

  const update = (key: string, patch: Partial<ImportDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch, error: null } : d)))

  const selected = drafts.filter((d) => d.include)

  const addSelected = async () => {
    setAddError(null)
    // Validate first so nothing is half-sent because of a typo further down.
    const bodies = new Map<string, ReturnType<typeof draftToEventBody>>()
    let invalid = false
    const checked = drafts.map((d) => {
      if (!d.include) return d
      const result = draftToEventBody(d, timeZone)
      bodies.set(d.key, result)
      if (!result.ok) {
        invalid = true
        return { ...d, error: result.error }
      }
      return d
    })
    if (invalid) {
      setDrafts(checked)
      setAddError('Fix the highlighted events, then add again.')
      return
    }

    setAdding(true)
    let failed = 0
    for (const draft of selected) {
      const result = bodies.get(draft.key)
      if (!result || !result.ok) continue
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result.body),
        })
        const body = await res.json().catch(() => null)
        if (res.ok && body?.event?.id) {
          created.current.push(String(body.event.id))
          setCreatedCount(created.current.length)
          setDrafts((prev) => prev.filter((d) => d.key !== draft.key))
        } else {
          failed++
          const message =
            typeof body?.error === 'string'
              ? body.error
              : typeof body?.error?.message === 'string'
                ? body.error.message
                : 'Could not add this event.'
          setDrafts((prev) => prev.map((d) => (d.key === draft.key ? { ...d, error: message } : d)))
        }
      } catch {
        failed++
        setDrafts((prev) =>
          prev.map((d) => (d.key === draft.key ? { ...d, error: 'Could not add this event. Check your connection.' } : d))
        )
      }
    }
    setAdding(false)
    const total = created.current.length
    if (failed === 0 && total > 0) {
      onDone([...created.current])
    } else if (failed > 0) {
      setAddError(
        `Added ${total} event${total === 1 ? '' : 's'}. ${failed} couldn't be added; check ${failed === 1 ? 'it' : 'them'} and try again.`
      )
    }
  }

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        'flex-1 min-h-[44px] rounded-md px-3 text-subhead font-medium',
        mode === value ? 'bg-[var(--surface-elevated)] text-label-primary shadow-sm' : 'text-label-secondary'
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase.step === 'reading' || adding}
        data-testid="import-dialog"
        className="relative bg-[var(--surface-elevated)] rounded-2xl shadow-xl w-full max-w-xl max-h-[calc(100dvh-2rem)] flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 p-5 pb-3">
          <h2 id={titleId} className="min-w-0 break-words text-title-3 font-display text-label-primary">
            Import events
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            disabled={adding}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[var(--surface-fill)]"
          >
            <X className="w-5 h-5 text-label-tertiary" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 space-y-4">
          {/* Stays mounted (visually hidden) so "Choose a photo or PDF" works from every step. */}
          <input
            ref={fileRef}
            data-testid="import-file-input"
            type="file"
            accept="image/*,application/pdf"
            onChange={onFile}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />

          {phase.step === 'input' && (
            <div className="space-y-4">
              <p className="text-body text-label-primary">
                Paste a school email or flyer, or choose a photo or PDF of it. We&apos;ll suggest the events in it, and you
                choose what to add.
              </p>
              <div role="tablist" aria-label="Import from" className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1">
                {tab('text', 'Paste text')}
                {tab('file', 'Photo or PDF')}
              </div>
              {mode === 'text' ? (
                <div className="space-y-3">
                  <label htmlFor={`${titleId}-text`} className="label-apple">
                    Text of the email or flyer
                  </label>
                  <textarea
                    id={`${titleId}-text`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={IMPORT_TEXT_MAX_CHARS}
                    rows={8}
                    className="input-apple w-full min-h-[160px]"
                    placeholder="e.g. Picture day is next Friday. Bake sale Oct 9, 3:30–5pm in the gym."
                  />
                  <button
                    type="button"
                    className="btn-filled w-full min-h-[44px]"
                    onClick={submitText}
                    disabled={!text.trim()}
                  >
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                    <span>Find events</span>
                  </button>
                </div>
              ) : (
                <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={() => fileRef.current?.click()}>
                  <FileText className="w-4 h-4" aria-hidden="true" />
                  <span>Choose a photo or PDF</span>
                </button>
              )}
              <p className="text-footnote text-label-secondary" data-testid="import-privacy-note">
                What you paste or choose is sent to our AI provider (Anthropic) to read it. It isn&apos;t saved by Family
                Planner.
              </p>
            </div>
          )}

          {phase.step === 'reading' && (
            <div role="status" className="flex items-center gap-3 py-6 justify-center text-body text-label-primary">
              <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>Looking for events…</span>
            </div>
          )}

          {phase.step === 'error' && (
            <div className="space-y-4">
              <p role="alert" className="text-body text-[var(--danger-text)]" data-testid="import-error">
                {phase.message}
              </p>
              <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={startOver}>
                Try again
              </button>
            </div>
          )}

          {phase.step === 'review' &&
            (drafts.length === 0 ? (
              <div className="space-y-4">
                <p className="text-body text-label-primary" role="status" data-testid="import-empty">
                  {createdCount > 0 ? 'Everything was added.' : UNREADABLE_MESSAGE}
                </p>
                <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={startOver}>
                  {createdCount > 0 ? 'Import something else' : 'Try again'}
                </button>
              </div>
            ) : (
              <>
                <p className="text-subhead text-label-secondary" role="status">
                  Found {drafts.length} event{drafts.length === 1 ? '' : 's'}. Check them, untick anything that&apos;s wrong,
                  then add.
                </p>
                <ul className="space-y-3" aria-label="Suggested events">
                  {drafts.map((draft, i) => (
                    <SuggestionCard
                      key={draft.key}
                      draft={draft}
                      index={i}
                      idBase={titleId}
                      disabled={adding}
                      onChange={update}
                    />
                  ))}
                </ul>
              </>
            ))}
        </div>

        {phase.step === 'review' && drafts.length > 0 && (
          <div className="border-t border-[var(--surface-separator)] p-4 space-y-2">
            {addError && (
              <p role="alert" className="text-subhead text-[var(--danger-text)]">
                {addError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-plain min-h-[44px] flex-1 min-w-[10rem]"
                onClick={startOver}
                disabled={adding}
              >
                Start over
              </button>
              <button
                type="button"
                className="btn-filled min-h-[44px] flex-1 min-w-[10rem]"
                onClick={addSelected}
                disabled={adding || selected.length === 0}
                data-testid="import-add"
              >
                {adding ? 'Adding…' : `Add ${selected.length} event${selected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionCard({
  draft,
  index,
  idBase,
  disabled,
  onChange,
}: {
  draft: ImportDraft
  index: number
  idBase: string
  disabled: boolean
  onChange: (key: string, patch: Partial<ImportDraft>) => void
}) {
  const id = `${idBase}-card${index}`
  return (
    <li
      data-testid="import-suggestion"
      className={cn(
        'rounded-xl border p-3 space-y-3',
        draft.error ? 'border-[var(--danger-text)]' : 'border-[var(--surface-separator)]',
        !draft.include && 'opacity-70'
      )}
    >
      <div className="flex items-center gap-3">
        <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -m-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.include}
            onChange={(e) => onChange(draft.key, { include: e.target.checked })}
            disabled={disabled}
            className="h-5 w-5 accent-[var(--accent)]"
            aria-label={`Add ${draft.title || `event ${index + 1}`}`}
          />
        </label>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${id}-title`} className="sr-only">
            Title
          </label>
          <input
            id={`${id}-title`}
            type="text"
            value={draft.title}
            onChange={(e) => onChange(draft.key, { title: e.target.value })}
            maxLength={200}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <span
          className="shrink-0 rounded-full bg-[var(--surface-fill)] px-2 py-0.5 text-footnote font-semibold text-label-secondary"
          data-testid="import-confidence"
        >
          {confidenceLabel(draft.confidence)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${id}-date`} className="text-footnote text-label-secondary block mb-1">
            Date
          </label>
          <input
            id={`${id}-date`}
            type="date"
            value={draft.date}
            onChange={(e) => onChange(draft.key, { date: e.target.value })}
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
        <label className="flex min-h-[44px] items-end gap-2 pb-2 text-subhead text-label-primary cursor-pointer">
          <input
            type="checkbox"
            checked={draft.allDay}
            onChange={(e) => onChange(draft.key, { allDay: e.target.checked })}
            disabled={disabled}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          All day
        </label>
        {draft.allDay ? (
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor={`${id}-end-date`} className="text-footnote text-label-secondary block mb-1">
              Last day (optional)
            </label>
            <input
              id={`${id}-end-date`}
              type="date"
              value={draft.endDate}
              min={draft.date || undefined}
              onChange={(e) => onChange(draft.key, { endDate: e.target.value })}
              disabled={disabled}
              className="w-full input-apple min-h-[44px]"
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor={`${id}-start`} className="text-footnote text-label-secondary block mb-1">
                Starts
              </label>
              <input
                id={`${id}-start`}
                type="time"
                value={draft.startTime}
                onChange={(e) => onChange(draft.key, { startTime: e.target.value })}
                disabled={disabled}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
            <div>
              <label htmlFor={`${id}-end`} className="text-footnote text-label-secondary block mb-1">
                Ends (optional)
              </label>
              <input
                id={`${id}-end`}
                type="time"
                value={draft.endTime}
                onChange={(e) => onChange(draft.key, { endTime: e.target.value })}
                disabled={disabled}
                className="w-full input-apple min-h-[44px]"
              />
            </div>
          </>
        )}
      </div>

      <div>
        <label htmlFor={`${id}-location`} className="text-footnote text-label-secondary block mb-1">
          Location
        </label>
        <input
          id={`${id}-location`}
          type="text"
          value={draft.location}
          onChange={(e) => onChange(draft.key, { location: e.target.value })}
          maxLength={200}
          disabled={disabled}
          className="w-full input-apple"
        />
      </div>
      <div>
        <label htmlFor={`${id}-notes`} className="text-footnote text-label-secondary block mb-1">
          Notes
        </label>
        <textarea
          id={`${id}-notes`}
          value={draft.notes}
          onChange={(e) => onChange(draft.key, { notes: e.target.value })}
          maxLength={1000}
          rows={2}
          disabled={disabled}
          className="w-full input-apple resize-none"
        />
      </div>

      {draft.error && (
        <p className="text-footnote text-[var(--danger-text)]" data-testid="import-card-error">
          {draft.error}
        </p>
      )}
    </li>
  )
}
