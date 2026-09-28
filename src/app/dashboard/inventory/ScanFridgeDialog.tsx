'use client'

/**
 * "Scan fridge" (#265): take or choose a photo, let the vision model suggest
 * items (POST /api/inventory/scan, which writes nothing), review and edit the
 * suggestions, then add the ticked ones through the ordinary
 * POST /api/inventory, one at a time. Rows that were added leave the list, so
 * "Add" after a partial failure only sends what is still there (the create
 * route has no idempotency key; this is what prevents duplicates on retry).
 *
 * Suggestions are untrusted model text: they are only ever rendered as React
 * text and input values. Confidence is shown in words, never colour alone.
 */
import * as React from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toDateOnlyLocal } from '@/lib/dates'
import { INVENTORY_LOCATIONS, LOCATION_LABELS, type InventoryLocation } from '@/lib/inventory'
import type { ScanSuggestion } from '@/lib/inventory-scan'

/** Must match INVENTORY_SCAN_MAX_BYTES in src/lib/inventory-scan.ts (kept literal to stay out of the server module). */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** Longest edge sent to the provider; larger photos are downscaled in the browser when it can decode them. */
const MAX_EDGE = 1568

interface Row {
  key: string
  include: boolean
  name: string
  amount: string
  unit: string
  location: InventoryLocation
  expiresOn: string
  confidence: number
  error: string | null
}

type Phase =
  | { step: 'pick' }
  | { step: 'scanning' }
  | { step: 'review' }
  | { step: 'error'; message: string }

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'Likely'
  if (confidence >= 0.5) return 'Check this'
  return 'Unsure'
}

function toRows(items: ScanSuggestion[]): Row[] {
  return items.map((item, i) => ({
    key: `s${i}`,
    include: item.confidence >= 0.5,
    name: item.name,
    amount: item.amount === null ? '' : String(item.amount),
    unit: item.unit ?? '',
    location: item.location ?? 'fridge',
    expiresOn: '',
    confidence: item.confidence,
    error: null,
  }))
}

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

async function scanError(res: Response): Promise<string> {
  let message: string | null = null
  try {
    const body = await res.json()
    const err = body?.error
    if (typeof err === 'string') message = err
    else if (err && typeof err.message === 'string') message = err.message
  } catch {
    // fall through
  }
  if (res.status === 404) return "Fridge scan isn't available right now. You can still add items by hand."
  if (res.status === 403) return message ?? "You can't scan the fridge. Ask a parent."
  if ([400, 413, 415, 429, 502].includes(res.status) && message) return message
  return 'Something went wrong while scanning. Try again, or add items by hand.'
}

export function ScanFridgeDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [phase, setPhase] = React.useState<Phase>({ step: 'pick' })
  const [rows, setRows] = React.useState<Row[]>([])
  const [adding, setAdding] = React.useState(false)
  const [addError, setAddError] = React.useState<string | null>(null)
  const [addedCount, setAddedCount] = React.useState(0)
  const titleId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !adding) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, adding])

  const pickAgain = () => {
    setPhase({ step: 'pick' })
    setRows([])
    setAddError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhase({ step: 'scanning' })
    setAddError(null)
    const image = await prepareImage(file)
    if (image.size > MAX_UPLOAD_BYTES) {
      setPhase({ step: 'error', message: 'That photo is too large. The limit is 8 MB.' })
      return
    }
    const form = new FormData()
    form.append('image', image, 'fridge.jpg')
    try {
      const res = await fetch('/api/inventory/scan', { method: 'POST', body: form })
      if (!res.ok) {
        setPhase({ step: 'error', message: await scanError(res) })
        return
      }
      const body = await res.json()
      setRows(toRows(Array.isArray(body?.items) ? (body.items as ScanSuggestion[]) : []))
      setPhase({ step: 'review' })
    } catch {
      setPhase({ step: 'error', message: "Couldn't reach the scanner. Check your connection and try again." })
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch, error: null } : r)))

  const selected = rows.filter((r) => r.include)

  const addSelected = async () => {
    setAddError(null)
    // Validate first so nothing is half-sent because of a typo further down.
    let invalid = false
    const checked = rows.map((r) => {
      if (!r.include) return r
      const amount = r.amount.trim() === '' ? null : Number(r.amount)
      if (!r.name.trim()) {
        invalid = true
        return { ...r, error: 'Enter a name.' }
      }
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        invalid = true
        return { ...r, error: 'Amount must be a number of 0 or more.' }
      }
      return r
    })
    if (invalid) {
      setRows(checked)
      setAddError('Fix the highlighted items, then add again.')
      return
    }

    setAdding(true)
    const today = encodeURIComponent(toDateOnlyLocal(new Date()))
    let added = 0
    let failed = 0
    for (const row of selected) {
      try {
        const res = await fetch(`/api/inventory?today=${today}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: row.name.trim(),
            location: row.location,
            amount: row.amount.trim() === '' ? null : Number(row.amount),
            unit: row.unit.trim() || null,
            expires_on: row.expiresOn || null,
          }),
        })
        if (res.ok) {
          added++
          setRows((prev) => prev.filter((r) => r.key !== row.key))
        } else {
          failed++
          let message = 'Could not add this item.'
          try {
            const body = await res.json()
            if (body?.error && typeof body.error.message === 'string') message = body.error.message
            else if (typeof body?.error === 'string') message = body.error
          } catch {
            // keep the default
          }
          setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, error: message } : r)))
        }
      } catch {
        failed++
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, error: 'Could not add this item. Check your connection.' } : r))
        )
      }
    }
    setAdding(false)
    const total = addedCount + added
    setAddedCount(total)
    if (failed === 0) {
      onDone(`Added ${total} item${total === 1 ? '' : 's'} from your photo.`)
    } else {
      setAddError(
        `Added ${total} item${total === 1 ? '' : 's'}. ${failed} couldn't be added; check ${failed === 1 ? 'it' : 'them'} and try again.`
      )
    }
  }

  const close = () => {
    if (adding) return
    if (addedCount > 0) onDone(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} from your photo.`)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase.step === 'scanning' || adding}
        data-testid="scan-dialog"
        className="relative bg-[var(--surface-elevated)] rounded-2xl shadow-xl w-full max-w-xl max-h-[calc(100dvh-2rem)] flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 p-5 pb-3">
          <h2 id={titleId} className="min-w-0 break-words text-title-3 font-display text-label-primary">
            Scan the fridge
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
          {/* The file input stays mounted (visually hidden) so "Take or choose a photo" works from every step. */}
          <input
            ref={inputRef}
            id={`${titleId}-photo`}
            data-testid="scan-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFile}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />

          {phase.step === 'pick' && (
            <div className="space-y-4">
              <p className="text-body text-label-primary">
                Take a photo of your open fridge, freezer or pantry. We&apos;ll suggest what&apos;s in it, and you choose what to
                add.
              </p>
              <p className="text-footnote text-label-secondary" data-testid="scan-privacy-note">
                The photo is sent to our AI provider (Anthropic) to read it. It isn&apos;t saved by Family Planner.
              </p>
              <button
                type="button"
                autoFocus
                className="btn-tinted w-full min-h-[44px]"
                onClick={() => inputRef.current?.click()}
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Take or choose a photo</span>
              </button>
            </div>
          )}

          {phase.step === 'scanning' && (
            <div role="status" className="flex items-center gap-3 py-6 justify-center text-body text-label-primary">
              <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>Looking for food in your photo…</span>
            </div>
          )}

          {phase.step === 'error' && (
            <div className="space-y-4">
              <p role="alert" className="text-body text-[var(--danger-text)]" data-testid="scan-error">
                {phase.message}
              </p>
              <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={() => inputRef.current?.click()}>
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Try another photo</span>
              </button>
            </div>
          )}

          {phase.step === 'review' &&
            (rows.length === 0 ? (
              <div className="space-y-4">
                <p className="text-body text-label-primary" role="status">
                  {addedCount > 0 ? 'Everything from this photo was added.' : 'No food found in that photo.'}
                </p>
                <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={() => inputRef.current?.click()}>
                  <Camera className="w-4 h-4" aria-hidden="true" />
                  <span>{addedCount > 0 ? 'Scan another photo' : 'Try another photo'}</span>
                </button>
              </div>
            ) : (
              <>
                <p className="text-subhead text-label-secondary" role="status">
                  Found {rows.length} item{rows.length === 1 ? '' : 's'}. Check them, untick anything that&apos;s wrong, then add.
                </p>
                <ul className="space-y-3" aria-label="Suggested items">
                  {rows.map((row, i) => (
                    <SuggestionRow key={row.key} row={row} index={i} idBase={titleId} disabled={adding} onChange={update} />
                  ))}
                </ul>
              </>
            ))}
        </div>

        {phase.step === 'review' && rows.length > 0 && (
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
                onClick={pickAgain}
                disabled={adding}
              >
                Scan another photo
              </button>
              <button
                type="button"
                className="btn-filled min-h-[44px] flex-1 min-w-[10rem]"
                onClick={addSelected}
                disabled={adding || selected.length === 0}
                data-testid="scan-add"
              >
                {adding ? 'Adding…' : `Add ${selected.length} item${selected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionRow({
  row,
  index,
  idBase,
  disabled,
  onChange,
}: {
  row: Row
  index: number
  idBase: string
  disabled: boolean
  onChange: (key: string, patch: Partial<Row>) => void
}) {
  const id = `${idBase}-row${index}`
  const label = confidenceLabel(row.confidence)
  return (
    <li
      data-testid="scan-suggestion"
      className={cn(
        'rounded-xl border p-3 space-y-3',
        row.error ? 'border-[var(--danger-text)]' : 'border-[var(--surface-separator)]',
        !row.include && 'opacity-70'
      )}
    >
      <div className="flex items-center gap-3">
        <label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -m-2 cursor-pointer">
          <input
            type="checkbox"
            checked={row.include}
            onChange={(e) => onChange(row.key, { include: e.target.checked })}
            disabled={disabled}
            className="h-5 w-5 accent-[var(--accent)]"
            aria-label={`Add ${row.name || `item ${index + 1}`}`}
          />
        </label>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${id}-name`} className="sr-only">
            Name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            value={row.name}
            onChange={(e) => onChange(row.key, { name: e.target.value })}
            maxLength={200}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <span
          className="shrink-0 rounded-full bg-[var(--surface-fill)] px-2 py-0.5 text-footnote font-semibold text-label-secondary"
          data-testid="scan-confidence"
        >
          {label}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label htmlFor={`${id}-amount`} className="text-footnote text-label-secondary block mb-1">
            Amount
          </label>
          <input
            id={`${id}-amount`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={row.amount}
            onChange={(e) => onChange(row.key, { amount: e.target.value })}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <div>
          <label htmlFor={`${id}-unit`} className="text-footnote text-label-secondary block mb-1">
            Unit
          </label>
          <input
            id={`${id}-unit`}
            type="text"
            value={row.unit}
            onChange={(e) => onChange(row.key, { unit: e.target.value })}
            maxLength={32}
            disabled={disabled}
            className="w-full input-apple"
          />
        </div>
        <div>
          <label htmlFor={`${id}-location`} className="text-footnote text-label-secondary block mb-1">
            Where
          </label>
          <select
            id={`${id}-location`}
            value={row.location}
            onChange={(e) => onChange(row.key, { location: e.target.value as InventoryLocation })}
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          >
            {INVENTORY_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {LOCATION_LABELS[loc]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-expires`} className="text-footnote text-label-secondary block mb-1">
            Use by
          </label>
          <input
            id={`${id}-expires`}
            type="date"
            value={row.expiresOn}
            onChange={(e) => onChange(row.key, { expiresOn: e.target.value })}
            disabled={disabled}
            className="w-full input-apple min-h-[44px]"
          />
        </div>
      </div>

      {row.error && (
        <p className="text-footnote text-[var(--danger-text)]" data-testid="scan-row-error">
          {row.error}
        </p>
      )}
    </li>
  )
}
