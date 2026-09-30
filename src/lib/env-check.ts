/**
 * Production environment check, run once at server start
 * (src/instrumentation.ts).
 *
 * Errors stop the server: without them nobody can sign in, and before this
 * check a missing JWT_SECRET only surfaced as a 500 on the first request.
 * Warnings are logged loudly but do not stop the server, because the release
 * smoke test (`release.yml`) runs the production image without mail.
 *
 * Only variable names and fixed reasons are logged, never values.
 */

type Env = Record<string, string | undefined>

export interface EnvCheckResult {
  errors: string[]
  warnings: string[]
}

export function checkProductionEnv(env: Env): EnvCheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  const jwt = env.JWT_SECRET
  if (!jwt) errors.push('JWT_SECRET is not set: no one can sign in.')
  else if (jwt.length < 32) errors.push('JWT_SECRET is shorter than 32 characters.')

  if (!env.DATABASE_URL) errors.push('DATABASE_URL is not set.')

  if (!env.MAILGUN_API_KEY) {
    warnings.push(
      'MAILGUN_API_KEY is not set: verification, password-reset and invite emails cannot be sent, so a new parent cannot finish signing up.'
    )
  }

  // NEXT_PUBLIC_APP_URL is not checked here: Next.js inlines it at build time
  // (the Dockerfile defaults it), so the runtime environment says nothing
  // about the value the server actually uses.

  const hops = env.TRUSTED_PROXY_HOPS
  if (hops === undefined || hops === '') {
    warnings.push(
      'TRUSTED_PROXY_HOPS is not set: rate limits assume exactly one proxy in front of the app. Set it to the real proxy count.'
    )
  } else if (!/^\d+$/.test(hops.trim()) || Number(hops) < 1) {
    warnings.push('TRUSTED_PROXY_HOPS is not a whole number of at least 1: rate limits may read the wrong client address. Fix the value.')
  }

  return { errors, warnings }
}

function isBuildPhase(env: Env): boolean {
  return env.NEXT_PHASE === 'phase-production-build' || env.npm_lifecycle_event === 'build'
}

/**
 * Throws when a production server would start without what sign-in needs.
 * A no-op outside production and during `next build`.
 */
export function assertProductionEnv(env: Env = process.env, sink: Pick<Console, 'warn' | 'error'> = console): void {
  if (env.NODE_ENV !== 'production' || isBuildPhase(env)) return
  const { errors, warnings } = checkProductionEnv(env)
  // Fixed texts from checkProductionEnv (variable names only, never values).
  for (const warning of warnings) sink.warn('[env] WARNING:', warning)
  if (errors.length > 0) {
    for (const error of errors) sink.error('[env] FATAL:', error)
    throw new Error(`Refusing to start: ${errors.length} required environment variable problem(s). See the [env] lines above.`)
  }
}
