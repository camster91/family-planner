import { NextResponse } from 'next/server'

/** Error codes of the event import routes (#270). Body: `{ error: { code, message, retryable } }`. */
export type EventImportErrorCode =
  | 'EVENT_IMPORT_DISABLED'
  | 'EVENT_IMPORT_FORBIDDEN'
  | 'INVALID_BODY'
  | 'INVALID_TODAY'
  | 'LENGTH_REQUIRED'
  | 'TEXT_TOO_LONG'
  | 'FILE_TOO_LARGE'
  | 'PDF_TOO_MANY_PAGES'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'RATE_LIMITED'
  | 'IMPORT_DAILY_LIMIT'
  | 'IMPORT_PROVIDER_UNAVAILABLE'
  | 'IMPORT_UNREADABLE'
  | 'UNDO_NOT_ALLOWED'
  | 'UNDO_WINDOW_EXPIRED'
  | 'INTERNAL_ERROR'

const RETRYABLE: ReadonlySet<EventImportErrorCode> = new Set([
  'INTERNAL_ERROR',
  'RATE_LIMITED',
  'IMPORT_DAILY_LIMIT',
  'IMPORT_PROVIDER_UNAVAILABLE',
  'IMPORT_UNREADABLE',
])

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export function importError(
  status: number,
  code: EventImportErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(
    { error: { code, message, retryable: RETRYABLE.has(code) } },
    { status, headers: { ...NO_STORE, ...extraHeaders } }
  )
}

export function importJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}
