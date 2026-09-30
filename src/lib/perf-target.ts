/**
 * Target guard and statistics for the local performance baseline (#161,
 * `scripts/perf-baseline.mjs`, docs/testing/PERFORMANCE_BASELINE.md).
 *
 * The script signs in with the PUBLIC fake fixture password and fires repeated
 * requests, so it must only ever talk to a server on this machine. Loaded by
 * Node's type stripping as well as by Jest: no path aliases, no imports.
 */

export class PerfTargetRefusedError extends Error {
  constructor(reason: string) {
    super(`perf:baseline refused: ${reason}`)
    this.name = 'PerfTargetRefusedError'
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (LOOPBACK_HOSTS.has(h)) return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

/**
 * The normalised origin to measure, or a thrown `PerfTargetRefusedError`.
 * Refuses anything that is not plain http(s) on a loopback host, URLs with
 * credentials, and `NODE_ENV=production`.
 */
export function assertLocalPerfTarget(raw: string | undefined, env: Record<string, string | undefined> = {}): string {
  if (env.NODE_ENV === 'production') throw new PerfTargetRefusedError('NODE_ENV is production')
  let url: URL
  try {
    url = new URL(raw && raw.trim() ? raw.trim() : 'http://localhost:3000')
  } catch {
    throw new PerfTargetRefusedError('PERF_BASE_URL is not a URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PerfTargetRefusedError(`protocol ${url.protocol} is not http(s)`)
  }
  if (url.username || url.password) throw new PerfTargetRefusedError('credentials in the URL')
  if (!isLoopback(url.hostname)) {
    throw new PerfTargetRefusedError(`host ${url.hostname} is not loopback (localhost, 127.x.x.x, ::1)`)
  }
  return url.origin
}

/** Nearest-rank percentile of already-measured durations (ms). */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return NaN
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}
