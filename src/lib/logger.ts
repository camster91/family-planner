/**
 * Structured logger. Writes JSON lines to stdout in production
 * (collected from the container output by the host), human-readable in dev.
 *
 * Content-minimal by construction (docs/architecture/OBSERVABILITY.md,
 * "Logger field rules"):
 * - A thrown value is reduced to `errorName` (its class name when that is a
 *   plain identifier) plus, when present, `errorCode` (a short machine code
 *   such as Prisma `P2002` or Node `ECONNRESET`) and `errorStatus` (an HTTP
 *   status number). Its message, stack, `cause`, Prisma `meta`, response
 *   body and any other field are never written, in production or dev:
 *   database and provider messages can quote household content.
 * - Context values must be strings, numbers, booleans or null. Anything else
 *   (an Error, an object, an array) is reduced the same way. Fields named
 *   `message`, `stack` or `cause` are dropped.
 * - Callers pass fixed strings, enums, counts and codes as context: never
 *   request values, names, emails, labels, tokens or free text, and no
 *   user/household/device ids (OBSERVABILITY.md field table).
 *
 * Usage:
 *   import { log } from '@/lib/logger'
 *   log.info('upload.photo', { size, type })
 *   log.error('device.audit_write_failed', error, { type })
 *   log.warn('weather.board_failed', describeError(error))
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

type SafeValue = string | number | boolean | null | ErrorIdentity

export type ErrorIdentity = { errorName: string; errorCode?: string; errorStatus?: number }

const IS_PROD = process.env.NODE_ENV === 'production'

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
/** Prisma (`P2002`), Node (`ECONNREFUSED`) and HTTP-client (`ERR_BAD_RESPONSE`) style codes only. */
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/
/** Fields that, by convention, carry exception or free text. Never written. */
const DROPPED_KEYS = new Set(['message', 'stack', 'cause'])

function httpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
}

/**
 * The loggable identity of a thrown value: its class name, a short machine
 * code and an HTTP status number, nothing else. Message, stack, cause and
 * every other field are ignored.
 */
export function describeError(error: unknown): ErrorIdentity {
  if (!error || typeof error !== 'object') return { errorName: 'unknown' }
  const e = error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; response?: unknown }
  const name = e.name
  const code = e.code
  const response = e.response && typeof e.response === 'object' ? (e.response as { status?: unknown }) : undefined
  const status = httpStatus(e.status) ?? httpStatus(e.statusCode) ?? httpStatus(response?.status)
  return {
    errorName: typeof name === 'string' && NAME_RE.test(name) ? name : 'unknown',
    ...(typeof code === 'string' && ERROR_CODE_RE.test(code) ? { errorCode: code } : {}),
    ...(status === undefined ? {} : { errorStatus: status }),
  }
}

function safeValue(value: unknown): SafeValue | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  return describeError(value)
}

function safeContext(context: LogContext): Record<string, SafeValue> {
  const out: Record<string, SafeValue> = {}
  for (const [key, value] of Object.entries(context)) {
    if (DROPPED_KEYS.has(key)) continue
    const safe = safeValue(value)
    if (safe !== undefined) out[key] = safe
  }
  return out
}

function isPlainObject(value: unknown): value is LogContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function format(level: LogLevel, event: string, context: LogContext = {}, error?: ErrorIdentity): string {
  const fields = { ...safeContext(context), ...(error ?? {}) }
  if (IS_PROD) {
    // JSON for log aggregators
    return JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields })
  }

  // Human-readable for dev
  const ctxStr = Object.keys(fields).length ? ' ' + JSON.stringify(fields) : ''
  const ts = new Date().toISOString().slice(11, 23)
  return `[${ts}] ${level.toUpperCase()} ${event}${ctxStr}`
}

const logger = {
  debug(event: string, context: LogContext = {}) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(format('debug', event, context))
    }
  },
  info(event: string, context: LogContext = {}) {
    console.log(format('info', event, context))
  },
  warn(event: string, context: LogContext = {}) {
    console.warn(format('warn', event, context))
  },
  /**
   * `log.error(event, context)` or `log.error(event, thrown, context?)`. The
   * second argument is the thrown value unless it is a plain object and no
   * third argument is given; pass a context (even `{}`) when the thrown value
   * could be a plain object. Either way only its identity is written.
   */
  error(event: string, errorOrContext?: unknown, maybeContext?: LogContext) {
    if (maybeContext === undefined && (errorOrContext === undefined || isPlainObject(errorOrContext))) {
      console.error(format('error', event, (errorOrContext as LogContext | undefined) ?? {}))
    } else {
      console.error(format('error', event, maybeContext ?? {}, describeError(errorOrContext)))
    }
  },
}

export const log = logger
