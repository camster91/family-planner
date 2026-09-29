/**
 * Opt-in slow-query hook (#161, docs/architecture/OBSERVABILITY.md "Slow-query
 * audit"). Development and test only.
 *
 *   PRISMA_QUERY_TIMING=1 PRISMA_SLOW_QUERY_MS=50 npm run dev
 *
 * With it on, `src/lib/prisma.ts` subscribes to Prisma query events and writes
 * one JSON line per query at or above the threshold (default 100 ms; 0 logs
 * every query):
 *
 *   { ts, level: 'warn', event: 'db.slow_query', durationMs, statement }
 *
 * `statement` is the parameterised SQL shape with any string/number literal
 * replaced by `?`, cut to 300 characters. Query parameters (`params`) are never
 * read, so no household value reaches the log. Refused when
 * `NODE_ENV=production`, so a stray variable on the server does nothing.
 */

export type QueryTimingConfig = { thresholdMs: number }

export const DEFAULT_SLOW_QUERY_MS = 100

export function queryTimingConfig(env: Record<string, string | undefined> = process.env): QueryTimingConfig | null {
  if (env.PRISMA_QUERY_TIMING !== '1') return null
  if (env.NODE_ENV === 'production') return null
  const raw = env.PRISMA_SLOW_QUERY_MS
  const n = raw === undefined || raw === '' ? DEFAULT_SLOW_QUERY_MS : Number(raw)
  return { thresholdMs: Number.isFinite(n) && n >= 0 ? n : DEFAULT_SLOW_QUERY_MS }
}

/** The SQL text with literals masked and whitespace collapsed; never the bound parameters. */
export function queryShape(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

type QueryEvent = { duration: number | bigint; query: string }
type QueryEmitter = { $on(event: 'query', callback: (e: QueryEvent) => void): void }

export function attachQueryTiming(
  client: QueryEmitter,
  config: QueryTimingConfig,
  write: (line: string) => void = (line) => console.warn(line)
): void {
  client.$on('query', (e) => {
    const durationMs = Number(e.duration)
    if (!(durationMs >= config.thresholdMs)) return
    write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'db.slow_query',
        durationMs: Math.round(durationMs * 10) / 10,
        statement: queryShape(String(e.query ?? '')),
      })
    )
  })
}
