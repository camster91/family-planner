'use client'

/**
 * "Scan fridge" (#265): take or choose a photo, let the vision model suggest
 * items (POST /api/inventory/scan, which writes nothing), review and edit the
 * suggestions, then add the ticked ones through the ordinary
 * POST /api/inventory, one at a time.
 *
 * Retries never duplicate: each row carries one `Idempotency-Key` for its
 * whole life, so a create that committed but lost its response is replayed on
 * retry instead of adding a second row, and rows that were added leave the
 * list, so "Add" after a partial failure only sends what is left.
 *
 * Built on the shared `Dialog` (aria-modal, focus moved in, Tab kept inside,
 * focus restored to the Scan button on close). Focus also moves to the new
 * content whenever the step changes. Escape, the Close button and "done" all
 * go through `close()`, which reports items already added (reload + notice).
 *
 * Suggestions are untrusted model text: they are only ever rendered as React
 * text and input values. Confidence is shown in words, never colour alone.
 */
import * as React from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toDateOnlyLocal } from '@/lib/dates'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import { INVENTORY_LOCATIONS, type InventoryLocation } from '@/lib/inventory'
import type { ScanSuggestion } from '@/lib/inventory-scan'
import { PRODUCT_BRAND } from '@/lib/brand'
import { inventoryFeedback as feedback, inventoryFeedbackEnglish, photoAddedFeedback, partialScanFeedback, type InventoryFeedback } from '@/i18n/inventory'
import { InventoryText, useInventoryCopy } from './inventory-copy'

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
  error: InventoryFeedback | null
  /** Sent with every create attempt of this row, so an in-doubt create is replayed, not repeated. */
  idempotencyKey: string
}

type Phase =
  | { step: 'pick' }
  | { step: 'scanning' }
  | { step: 'review' }
  | { step: 'error'; message: InventoryFeedback }

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
    idempotencyKey: newIdempotencyKey(),
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

async function scanError(res: Response): Promise<InventoryFeedback> {
  let message: string | null = null
  try {
    const body = await res.json()
    const err = body?.error
    if (typeof err === 'string') message = err
    else if (err && typeof err.message === 'string') message = err.message
  } catch {
    // fall through
  }
  if (res.status === 404) return feedback('scanUnavailable')
  if (res.status === 403) return message !== null ? { raw: message } : feedback('scanForbidden')
  if ([400, 413, 415, 429, 502].includes(res.status) && message) return { raw: message }
  return feedback('scanFailed')
}

const PROBABLY_ADDED = feedback('probablyAdded')

export function ScanFridgeDialog({ onClose, onDone, onFeedback }: {
  onClose: () => void
  onDone: (message: string) => void
  /** Opt-in semantic feedback; legacy consumers still receive their original English string. */
  onFeedback?: (message: InventoryFeedback) => void
}) {
  const copy = useInventoryCopy()
  const report = (message: InventoryFeedback) => onFeedback ? onFeedback(message) : onDone(inventoryFeedbackEnglish(message))
  const [phase, setPhase] = React.useState<Phase>({ step: 'pick' })
  const [rows, setRows] = React.useState<Row[]>([])
  const [adding, setAdding] = React.useState(false)
  const [addError, setAddError] = React.useState<InventoryFeedback | null>(null)
  const [addedCount, setAddedCount] = React.useState(0)
  const titleId = React.useId()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const pickButtonRef = React.useRef<HTMLButtonElement | null>(null)
  // Focus target of the current step. Dialog focuses the first one on open;
  // after that, focus follows every step change so it never falls to <body>.
  const stepFocusRef = React.useRef<HTMLElement | null>(null)
  const setStepFocus = React.useCallback((el: HTMLElement | null) => {
    if (el) stepFocusRef.current = el
  }, [])
  const opened = React.useRef(false)
  React.useEffect(() => {
    if (!opened.current) {
      opened.current = true
      return
    }
    stepFocusRef.current?.focus()
  }, [phase])

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
      setPhase({ step: 'error', message: feedback('photoLarge') })
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
      setPhase({ step: 'error', message: feedback('scanNetwork') })
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
        return { ...r, error: feedback('enterName') }
      }
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        invalid = true
        return { ...r, error: feedback('amountInvalid') }
      }
      return r
    })
    if (invalid) {
      setRows(checked)
      setAddError(feedback('fixRows'))
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
          headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: row.idempotencyKey },
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
          continue
        }
        failed++
        let message: InventoryFeedback = feedback('addFailed')
        let code: string | null = null
        try {
          const body = await res.json()
          if (body?.error && typeof body.error.message === 'string') message = { raw: body.error.message }
          else if (typeof body?.error === 'string') message = { raw: body.error }
          if (body?.error && typeof body.error.code === 'string') code = body.error.code
        } catch {
          // keep the default
        }
        if (code === 'IDEMPOTENCY_KEY_REUSED') {
          // An earlier, in-doubt try of this row reached the server and the row
          // was edited since, so it was probably added. Untick it and give it a
          // fresh key: adding it again is then a deliberate choice.
          setRows((prev) =>
            prev.map((r) =>
              r.key === row.key ? { ...r, include: false, idempotencyKey: newIdempotencyKey(), error: PROBABLY_ADDED } : r
            )
          )
        } else {
          setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, error: message } : r)))
        }
      } catch {
        // Unknown outcome: the row keeps its key, so a retry replays a create that did land.
        failed++
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, error: feedback('addNetwork') } : r))
        )
      }
    }
    setAdding(false)
    const total = addedCount + added
    setAddedCount(total)
    if (failed === 0) {
      report(photoAddedFeedback(total))
    } else {
      setAddError(partialScanFeedback(total, failed))
    }
  }

  /** The only way out (Escape or Close): report anything already added so the page reloads. */
  const close = () => {
    if (adding) return
    if (addedCount > 0) report(photoAddedFeedback(addedCount))
    else onClose()
  }

  return (
    <Dialog
      open
      onClose={close}
      title={copy('scanTitle')}
      closeLabel={copy('close')}
      testId="scan-dialog"
      className="sm:max-w-xl"
      initialFocusRef={pickButtonRef}
    >
      <div aria-busy={phase.step === 'scanning' || adding} className="space-y-4">
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
              {copy('scanIntro')}
            </p>
            <p className="text-footnote text-label-secondary" data-testid="scan-privacy-note">
              {copy('scanPrivacy', { provider: 'Anthropic', brand: PRODUCT_BRAND.name })}
            </p>
            <button
              ref={(el) => {
                pickButtonRef.current = el
                setStepFocus(el)
              }}
              type="button"
              className="btn-tinted w-full min-h-[44px]"
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span>{copy('pickPhoto')}</span>
            </button>
          </div>
        )}

        {phase.step === 'scanning' && (
          <div
            ref={setStepFocus}
            tabIndex={-1}
            role="status"
            data-testid="scan-loading"
            className="flex items-center gap-3 py-6 justify-center text-body text-label-primary outline-none"
          >
            <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span>{copy('scanning')}</span>
          </div>
        )}

        {phase.step === 'error' && (
          <div className="space-y-4">
            <p role="alert" className="text-body text-[var(--danger-text)]" data-testid="scan-error">
              <InventoryText feedback={phase.message} />
            </p>
            <button
              ref={setStepFocus}
              type="button"
              className="btn-tinted w-full min-h-[44px]"
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span>{copy('tryPhoto')}</span>
            </button>
          </div>
        )}

        {phase.step === 'review' &&
          (rows.length === 0 ? (
            <div className="space-y-4">
              <p ref={setStepFocus} tabIndex={-1} className="text-body text-label-primary outline-none" role="status">
                {copy(addedCount > 0 ? 'scanAllAdded' : 'scanEmpty')}
              </p>
              <button type="button" className="btn-tinted w-full min-h-[44px]" onClick={() => inputRef.current?.click()}>
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>{copy(addedCount > 0 ? 'anotherPhoto' : 'tryPhoto')}</span>
              </button>
            </div>
          ) : (
            <>
              <p
                ref={setStepFocus}
                tabIndex={-1}
                role="status"
                data-testid="scan-found"
                className="text-subhead text-label-secondary outline-none"
              >
                {copy(rows.length === 1 ? 'foundOne' : 'foundMany', { count: rows.length })}
              </p>
              <ul className="space-y-3" aria-label={copy('suggested')}>
                {rows.map((row, i) => (
                  <SuggestionRow key={row.key} row={row} index={i} idBase={titleId} disabled={adding} onChange={update} />
                ))}
              </ul>
              <div className="sticky -bottom-6 -mx-6 -mb-6 border-t border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-6 py-4 space-y-2">
                {addError && (
                  <p role="alert" className="text-subhead text-[var(--danger-text)]">
                    <InventoryText feedback={addError} />
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-plain min-h-[44px] flex-1 min-w-[10rem]"
                    onClick={pickAgain}
                    disabled={adding}
                  >
                    {copy('anotherPhoto')}
                  </button>
                  <button
                    type="button"
                    className="btn-filled min-h-[44px] flex-1 min-w-[10rem]"
                    onClick={addSelected}
                    disabled={adding || selected.length === 0}
                    data-testid="scan-add"
                  >
                    {adding ? copy('adding') : copy(selected.length === 1 ? 'addOne' : 'addMany', { count: selected.length })}
                  </button>
                </div>
              </div>
            </>
          ))}
      </div>
    </Dialog>
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
  const copy = useInventoryCopy()
  const id = `${idBase}-row${index}`
  const label = copy(({ Likely: 'likely', 'Check this': 'checkConfidence', Unsure: 'unsure' } as const)[confidenceLabel(row.confidence) as 'Likely' | 'Check this' | 'Unsure'])
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
            aria-label={copy('includeName', { name: row.name || copy('itemNumber', { count: index + 1 }) })}
          />
        </label>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${id}-name`} className="sr-only">
            {copy('name')}
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
            {copy('amount')}
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
            {copy('unit')}
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
            {copy('where')}
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
                {copy(loc)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-expires`} className="text-footnote text-label-secondary block mb-1">
            {copy('use_by')}
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
          <InventoryText feedback={row.error} />
        </p>
      )}
    </li>
  )
}
