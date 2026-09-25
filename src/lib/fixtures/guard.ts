/**
 * Fail-closed target guard for the fixture seed/reset commands (#154).
 *
 * Pure: takes an env-like record, returns a verdict. No I/O, so it is unit
 * tested directly and imported by `scripts/fixtures.mjs` before any database
 * connection is opened.
 *
 * A target is allowed only when ALL of these hold:
 *   1. FIXTURES_ALLOW is exactly "1" (explicit opt-in).
 *   2. NODE_ENV is not "production".
 *   3. DATABASE_URL parses as a postgres:// or postgresql:// URL with a
 *      host and a database name.
 *   4. Neither the host nor the database name contains a denylisted
 *      production marker (e.g. "ashbi", "prod").
 *   5. The host is loopback (localhost, 127.x.x.x, ::1), OR the host is a
 *      single-label docker-style service name (e.g. "postgres", "db") AND the
 *      database name carries a test/dev token (e.g. "family_planner_test").
 *      Any other host (FQDN, non-loopback IP) is refused.
 *
 * Rule 5 is stricter than "docker service name is fine" on purpose: the
 * production compose file uses host `postgres` and database `family_planner`,
 * so a bare service name alone cannot distinguish dev from production.
 */

export const FIXTURES_ALLOW_ENV = 'FIXTURES_ALLOW'

/** Case-insensitive substrings that always refuse, in host or database name. */
export const PRODUCTION_MARKERS = ['ashbi', 'prod'] as const

/** Database-name tokens that mark a non-loopback docker target as disposable. */
export const DISPOSABLE_DB_TOKENS = [
  'test',
  'tests',
  'dev',
  'development',
  'ci',
  'e2e',
  'fixture',
  'fixtures',
  'scratch',
] as const

export interface FixtureTargetVerdict {
  allowed: boolean
  /** Why the target was refused. Empty when allowed. Never contains credentials. */
  reasons: string[]
  /** Host and database name, for logging. Never contains credentials. */
  host?: string
  database?: string
}

type EnvLike = Record<string, string | undefined>

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  return /^127(\.\d{1,3}){3}$/.test(h)
}

function isDockerServiceHost(host: string): boolean {
  // Single DNS label, not an IP literal. Docker compose service names look
  // like `postgres`, `db`, `postgres-test`.
  return /^[a-z][a-z0-9_-]*$/i.test(host) && !isLoopbackHost(host)
}

function hasDisposableToken(database: string): boolean {
  const tokens = database.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return tokens.some((t) => (DISPOSABLE_DB_TOKENS as readonly string[]).includes(t))
}

export function evaluateFixtureTarget(env: EnvLike): FixtureTargetVerdict {
  const reasons: string[] = []

  if (env[FIXTURES_ALLOW_ENV] !== '1') {
    reasons.push(`${FIXTURES_ALLOW_ENV}=1 is required to write fixtures`)
  }
  if ((env.NODE_ENV ?? '').trim().toLowerCase() === 'production') {
    reasons.push('NODE_ENV is "production"')
  }

  const raw = (env.DATABASE_URL ?? '').trim()
  let host = ''
  let database = ''
  if (!raw) {
    reasons.push('DATABASE_URL is not set')
  } else {
    let url: URL | null = null
    try {
      url = new URL(raw)
    } catch {
      reasons.push('DATABASE_URL is not a valid URL')
    }
    if (url) {
      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        reasons.push('DATABASE_URL must use postgres:// or postgresql://')
      }
      host = url.hostname.replace(/^\[|\]$/g, '')
      try {
        database = decodeURIComponent(url.pathname.replace(/^\//, ''))
      } catch {
        database = url.pathname.replace(/^\//, '')
      }
      if (!host) reasons.push('DATABASE_URL has no host')
      if (!database) reasons.push('DATABASE_URL has no database name')

      // A `host=` query parameter would redirect pg away from the URL host.
      if (url.searchParams.has('host')) {
        reasons.push('DATABASE_URL must not override the host via a query parameter')
      }

      const lowered = `${host} ${database}`.toLowerCase()
      for (const marker of PRODUCTION_MARKERS) {
        if (lowered.includes(marker)) {
          reasons.push(`DATABASE_URL host or database contains production marker "${marker}"`)
        }
      }

      if (host && database) {
        if (isLoopbackHost(host)) {
          // allowed
        } else if (isDockerServiceHost(host)) {
          if (!hasDisposableToken(database)) {
            reasons.push(
              `host "${host}" is a service name; its database name must contain a test/dev token (${DISPOSABLE_DB_TOKENS.join(', ')})`
            )
          }
        } else {
          reasons.push(`host "${host}" is not loopback or a single-label docker service name`)
        }
      }
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    host: host || undefined,
    database: database || undefined,
  }
}

export class FixtureTargetRefusedError extends Error {
  readonly reasons: string[]
  constructor(reasons: string[]) {
    super(`Refusing to touch this database with fixtures:\n  - ${reasons.join('\n  - ')}`)
    this.name = 'FixtureTargetRefusedError'
    this.reasons = reasons
  }
}

/** Throws unless the env describes an allowed fixture target. */
export function assertFixtureTargetAllowed(env: EnvLike): FixtureTargetVerdict {
  const verdict = evaluateFixtureTarget(env)
  if (!verdict.allowed) throw new FixtureTargetRefusedError(verdict.reasons)
  return verdict
}
