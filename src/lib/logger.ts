/**
 * Structured logger. Writes JSON lines to stdout in production
 * (consumed by Coolify/Docker log aggregation), human-readable in dev.
 *
 * Why not Sentry? Costs $26/mo at minimal scale, requires source map
 * upload config, and for an app at <1000 users console.log aggregation
 * is sufficient. When you hit real scale, swap the sink to Sentry.
 *
 * Usage:
 *   import { log } from '@/lib/logger'
 *   log.info('user.login', { userId, ip })
 *   log.error('chore.verify', err, { choreId })
 *   log.warn('rate.limit', { ip, count, remaining })
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

const IS_PROD = process.env.NODE_ENV === 'production'

function format(level: LogLevel, event: string, context: LogContext = {}, error?: Error): string {
  if (IS_PROD) {
    // JSON for log aggregators
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      event,
      ...context,
    }
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }
    return JSON.stringify(entry)
  }

  // Human-readable for dev
  const ctxStr = Object.keys(context).length ? ' ' + JSON.stringify(context) : ''
  const errStr = error ? `\n  ${error.stack || error.message}` : ''
  const ts = new Date().toISOString().slice(11, 23)
  return `[${ts}] ${level.toUpperCase()} ${event}${ctxStr}${errStr}`
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
  error(event: string, errorOrContext?: Error | LogContext, maybeContext?: LogContext) {
    if (errorOrContext instanceof Error) {
      console.error(format('error', event, maybeContext || {}, errorOrContext))
    } else {
      console.error(format('error', event, errorOrContext || {}))
    }
  },
}

export const log = logger
