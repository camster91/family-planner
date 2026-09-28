import { NextRequest } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { sniffImageType } from '@/lib/image-sniff'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { log } from '@/lib/logger'
import { importError, importJson } from '@/lib/event-import-http'
import {
  EVENT_IMPORT_FAMILY_PER_HOUR,
  EVENT_IMPORT_FORBIDDEN_MESSAGE,
  EVENT_IMPORT_FORM_OVERHEAD,
  EVENT_IMPORT_IMAGE_MAX_BYTES,
  EVENT_IMPORT_IMAGE_TYPES,
  EVENT_IMPORT_JSON_MAX_BYTES,
  EVENT_IMPORT_PDF_MAX_BYTES,
  EVENT_IMPORT_PDF_MAX_PAGES,
  EVENT_IMPORT_TEXT_MAX_CHARS,
  EVENT_IMPORT_USER_PER_HOUR,
  EventImportError,
  canImportEvents,
  countPdfPages,
  isPdf,
  resolveEventImportConfig,
  resolveImportTimeZone,
  resolveImportToday,
  suggestEvents,
  type EventImportImageMime,
  type EventImportInput,
} from '@/lib/event-import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MB = 1024 * 1024
const MAX_FILE_BYTES = Math.max(EVENT_IMPORT_IMAGE_MAX_BYTES, EVENT_IMPORT_PDF_MAX_BYTES)

function retryAfter(ms: number): Record<string, string> {
  return { 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) }
}

type Parsed =
  | { ok: true; input: EventImportInput; today: unknown; timeZone: unknown; size: number }
  | { ok: false; response: ReturnType<typeof importError> }

const fail = (...args: Parameters<typeof importError>): Parsed => ({ ok: false, response: importError(...args) })

async function readJson(request: NextRequest, declared: number): Promise<Parsed> {
  if (declared > EVENT_IMPORT_JSON_MAX_BYTES) {
    return fail(413, 'TEXT_TOO_LONG', `That text is too long. Paste at most ${EVENT_IMPORT_TEXT_MAX_CHARS.toLocaleString('en-US')} characters.`)
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'INVALID_BODY', 'Send JSON with a "text" field.')
  }
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.text !== 'string') {
    return fail(400, 'INVALID_BODY', 'Paste the text of the flyer or email.')
  }
  const unknownKeys = Object.keys(b).filter((k) => !['text', 'today', 'timeZone'].includes(k))
  if (unknownKeys.length > 0) return fail(400, 'INVALID_BODY', 'Unexpected field in the request.')
  const text = b.text.trim()
  if (!text) return fail(400, 'INVALID_BODY', 'Paste the text of the flyer or email.')
  if (text.length > EVENT_IMPORT_TEXT_MAX_CHARS) {
    return fail(413, 'TEXT_TOO_LONG', `That text is too long. Paste at most ${EVENT_IMPORT_TEXT_MAX_CHARS.toLocaleString('en-US')} characters.`)
  }
  return { ok: true, input: { kind: 'text', text }, today: b.today, timeZone: b.timeZone, size: text.length }
}

async function readForm(request: NextRequest, declared: number): Promise<Parsed> {
  if (declared > MAX_FILE_BYTES + EVENT_IMPORT_FORM_OVERHEAD) {
    return fail(413, 'FILE_TOO_LARGE', `That file is too large. Photos can be up to ${EVENT_IMPORT_IMAGE_MAX_BYTES / MB} MB and PDFs up to ${EVENT_IMPORT_PDF_MAX_BYTES / MB} MB.`)
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, 'INVALID_BODY', 'Send the file as multipart/form-data with a "file" field.')
  }
  const file = form.get('file')
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return fail(400, 'INVALID_BODY', 'Choose a photo or PDF to import.')
  }
  const blob = file as Blob
  if (blob.size === 0) return fail(400, 'INVALID_BODY', 'That file is empty.')
  if (blob.size > MAX_FILE_BYTES) {
    return fail(413, 'FILE_TOO_LARGE', `That file is too large. PDFs can be up to ${EVENT_IMPORT_PDF_MAX_BYTES / MB} MB.`)
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : undefined)
  const today = str(form.get('today'))
  const timeZone = str(form.get('timeZone'))

  // Type from magic bytes, never the client-declared MIME.
  if (isPdf(bytes)) {
    if (bytes.length > EVENT_IMPORT_PDF_MAX_BYTES) {
      return fail(413, 'FILE_TOO_LARGE', `That PDF is too large. The limit is ${EVENT_IMPORT_PDF_MAX_BYTES / MB} MB.`)
    }
    if (countPdfPages(bytes) > EVENT_IMPORT_PDF_MAX_PAGES) {
      return fail(413, 'PDF_TOO_MANY_PAGES', `That PDF has too many pages. Import at most ${EVENT_IMPORT_PDF_MAX_PAGES} pages at a time.`)
    }
    return { ok: true, input: { kind: 'pdf', bytes }, today, timeZone, size: bytes.length }
  }
  const sniffed = sniffImageType(bytes)
  if (!sniffed || !(EVENT_IMPORT_IMAGE_TYPES as readonly string[]).includes(sniffed.mime)) {
    return fail(415, 'UNSUPPORTED_FILE_TYPE', 'Use a JPEG, PNG or WebP photo, or a PDF.')
  }
  if (bytes.length > EVENT_IMPORT_IMAGE_MAX_BYTES) {
    return fail(413, 'FILE_TOO_LARGE', `That photo is too large. The limit is ${EVENT_IMPORT_IMAGE_MAX_BYTES / MB} MB.`)
  }
  return {
    ok: true,
    input: { kind: 'image', bytes, mime: sniffed.mime as EventImportImageMime },
    today,
    timeZone,
    size: bytes.length,
  }
}

/**
 * POST /api/calendar/import-suggestions (#270). Either JSON
 * `{ text, today?, timeZone? }` (pasted flyer or email text, at most 20,000
 * characters) or `multipart/form-data` with a `file` (JPEG/PNG/WebP photo up
 * to 8 MB or PDF up to 10 MB, by magic bytes) plus optional `today` and
 * `timeZone` fields. Returns suggestions only:
 * `{ suggestions: [{ title, start, end, allDay, location, notes, confidence }], unreadable, dropped, timeZone }`.
 * Nothing is written; the calendar adds the reviewed events with
 * `POST /api/events`.
 *
 * Order: paired device refused (403) → person auth (401) → kill switch (404
 * when no provider key is configured) → `featureGate('calendar')` (403) →
 * parent or teen (403) → size/type/body checks (411/413/415/400) → `today`
 * (400) → rate limits (429: per user and per household per hour, household
 * per UTC day) → provider. Validation runs before the limits so a wrong file
 * does not use up quota.
 *
 * Privacy: the text or file stays in memory for this request only. Logs carry
 * the user id, input kind and size, suggestion count, duration and upstream
 * status, never the content or any model text.
 */
export async function POST(request: NextRequest) {
  const started = Date.now()
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const config = resolveEventImportConfig()
    if (!config) return importError(404, 'EVENT_IMPORT_DISABLED', 'Importing events is not available.')

    const gate = await featureGate(auth.user.family_id, 'calendar')
    if (gate) return gate

    if (!canImportEvents(auth.user.role)) {
      return importError(403, 'EVENT_IMPORT_FORBIDDEN', EVENT_IMPORT_FORBIDDEN_MESSAGE)
    }

    // Bound the body before reading it: json() and formData() buffer the whole request.
    const lengthHeader = request.headers.get('content-length')
    const declared = lengthHeader === null ? NaN : Number(lengthHeader)
    if (!Number.isFinite(declared) || declared < 0) {
      return importError(411, 'LENGTH_REQUIRED', 'Send the text or file as a normal upload.')
    }
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
    let parsed: Parsed
    if (contentType.startsWith('application/json')) parsed = await readJson(request, declared)
    else if (contentType.startsWith('multipart/form-data')) parsed = await readForm(request, declared)
    else parsed = fail(415, 'UNSUPPORTED_FILE_TYPE', 'Paste text, or choose a photo or PDF.')
    if (!parsed.ok) return parsed.response

    const today = resolveImportToday(parsed.today)
    if (!today) return importError(400, 'INVALID_TODAY', 'Send today as YYYY-MM-DD (your calendar day).')
    const timeZone = resolveImportTimeZone(parsed.timeZone)

    const userId = auth.user.id
    const familyId = auth.user.family_id
    const perUser = await checkRateLimit(`event-import:user:${userId}`, EVENT_IMPORT_USER_PER_HOUR, HOUR_MS)
    if (!perUser.allowed) {
      return importError(429, 'RATE_LIMITED', 'Too many imports this hour. Try again later.', retryAfter(perUser.retryAfterMs))
    }
    const perFamily = await checkRateLimit(`event-import:family:${familyId}`, EVENT_IMPORT_FAMILY_PER_HOUR, HOUR_MS)
    if (!perFamily.allowed) {
      return importError(
        429,
        'RATE_LIMITED',
        'Your household has imported a lot this hour. Try again later.',
        retryAfter(perFamily.retryAfterMs)
      )
    }
    // Spend guard: per household per UTC calendar day, from EVENT_IMPORT_DAILY_LIMIT.
    const day = new Date().toISOString().slice(0, 10)
    const endOfDay = Date.parse(`${day}T00:00:00Z`) + DAY_MS
    const daily =
      config.dailyLimit === 0
        ? { allowed: false, retryAfterMs: endOfDay - Date.now() }
        : await checkRateLimit(`event-import:day:${familyId}:${day}`, config.dailyLimit, DAY_MS)
    if (!daily.allowed) {
      return importError(
        429,
        'IMPORT_DAILY_LIMIT',
        "Your household has used today's imports. Add events by hand, or import again tomorrow.",
        retryAfter(Math.max(endOfDay - Date.now(), 1000))
      )
    }

    const kind = parsed.input.kind
    try {
      const result = await suggestEvents(parsed.input, { today, timeZone }, config)
      log.info('event.import', {
        userId,
        kind,
        size: parsed.size,
        suggestions: result.suggestions.length,
        dropped: result.dropped,
        unreadable: result.unreadable,
        refused: result.refused,
        ms: Date.now() - started,
      })
      return importJson({
        suggestions: result.suggestions,
        unreadable: result.unreadable,
        dropped: result.dropped,
        timeZone,
      })
    } catch (err) {
      if (err instanceof EventImportError) {
        log.warn('event.import.failed', {
          userId,
          kind,
          code: err.code,
          upstreamStatus: err.upstreamStatus,
          size: parsed.size,
          ms: Date.now() - started,
        })
        return importError(502, err.code, err.message)
      }
      throw err
    }
  } catch (err) {
    // Name only: an error message could carry request details.
    log.warn('event.import.error', { name: err instanceof Error ? err.name : 'unknown' })
    return importError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
