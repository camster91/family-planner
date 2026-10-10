// Beta usage counts (#287, PR101 D-6): the fixed metric list, what the
// recorder sends to the database (a household id, a day, a fixed name and
// nothing else), the opt-in guard in its statement, that it never throws into
// the caller, and a source scan that the table is written only here.
// Real Postgres behaviour (atomic increments, opt-out, cascade) is in
// beta-metrics.integration.test.ts.
import fs from 'fs'
import path from 'path'
import {
  BETA_METRICS,
  isBetaMetric,
  recordBetaMetric,
  recordChoreAssigned,
  retentionCutoffDay,
  setBetaMetricsEnabled,
  utcDay,
} from '@/lib/beta-metrics'

type Call = { sql: string; values: unknown[] }

function recorderDb(impl?: () => Promise<number>) {
  const calls: Call[] = []
  const db = {
    $executeRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values })
      return impl ? impl() : Promise.resolve(1)
    }),
  }
  return { db: db as any, calls }
}

const NOW = new Date('2026-10-05T23:30:00Z')

describe('BETA_METRICS allowlist', () => {
  it('is the fixed list the beta criteria need, and nothing that could carry content', () => {
    expect([...BETA_METRICS]).toEqual([
      'member_joined',
      'event_created',
      'meal_planned',
      'chore_assigned',
      'chore_completed',
      'chore_verified',
      'reward_claimed',
      'first_chore_within_10m',
      'first_chore_after_10m',
    ])
    for (const m of BETA_METRICS) expect(m).toMatch(/^[a-z0-9_]{1,40}$/)
    expect(new Set(BETA_METRICS).size).toBe(BETA_METRICS.length)
  })

  it('isBetaMetric accepts only listed names', () => {
    expect(isBetaMetric('chore_completed')).toBe(true)
    for (const bad of ['', 'Chore_completed', 'page_view', 'chore_completed ', null, 3, {}]) {
      expect(isBetaMetric(bad)).toBe(false)
    }
  })

  it('an unknown name is a compile-time error', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { db } = recorderDb()
    warn.mockClear()
    // @ts-expect-error not in BETA_METRICS
    void recordBetaMetric(db, 'fam', 'page_view')
    // @ts-expect-error the first-chore buckets are recorded by recordChoreAssigned only
    void recordBetaMetric(db, 'fam', 'first_chore_within_10m')
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('recordBetaMetric', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('sends one statement with the household id, the UTC day, the fixed name and the retention cutoff only', async () => {
    const { db, calls } = recorderDb()
    await recordBetaMetric(db, 'fam-1', 'chore_completed', { now: NOW })
    expect(calls).toHaveLength(1)
    expect(calls[0].values).toEqual(['fam-1', '2026-10-05', 'chore_completed', 'fam-1', '2025-09-05'])
  })

  it('is an atomic upsert increment guarded by the household opt-in, locking the household row', async () => {
    const { db, calls } = recorderDb()
    await recordBetaMetric(db, 'fam-1', 'event_created', { now: NOW })
    const sql = calls[0].sql.replace(/\s+/g, ' ')
    expect(sql).toContain('"beta_metrics_enabled" = true FOR SHARE')
    expect(sql).toContain('ON CONFLICT ("family_id", "day", "metric") DO UPDATE SET "count" = "BetaMetricDaily"."count" + 1')
    // Retention: the same statement prunes the household's rows older than 13 months.
    expect(sql).toContain('DELETE FROM "BetaMetricDaily" WHERE "family_id" = ? AND "day" < ?::date')
    // Nothing about a person or content.
    expect(sql).not.toMatch(/user_id|actor|title|name|content/i)
  })

  it('refuses an unknown name at run time without touching the database', async () => {
    const { db, calls } = recorderDb()
    await recordBetaMetric(db, 'fam-1', 'page_view' as any, { now: NOW })
    await recordBetaMetric(db, 'fam-1', 'first_chore_after_10m' as any, { now: NOW })
    await recordBetaMetric(db, '', 'chore_completed', { now: NOW })
    expect(calls).toHaveLength(0)
  })

  it('never throws into the caller, and logs without the household id', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { db } = recorderDb(() => Promise.reject(new Error('connection lost for fam-secret')))
    await expect(recordBetaMetric(db, 'fam-secret', 'reward_claimed', { now: NOW })).resolves.toBeUndefined()
    await expect(recordChoreAssigned(db, 'fam-secret', { id: 'c1' }, { now: NOW })).resolves.toBeUndefined()
    await expect(recordBetaMetric({} as any, 'fam-secret', 'reward_claimed')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('fam-secret')
  })
})

describe('recordChoreAssigned', () => {
  it('counts the assignment, then the first-chore bucket once, only for the first chore and only while opted in', async () => {
    const { db, calls } = recorderDb()
    await recordChoreAssigned(db, 'fam-1', { id: 'chore-9' }, { now: NOW })
    expect(calls).toHaveLength(2)
    expect(calls[0].values[2]).toBe('chore_assigned')
    expect(calls[1].values).toEqual(['2026-10-05', 'chore-9', 'fam-1'])
    const sql = calls[1].sql.replace(/\s+/g, ' ')
    expect(sql).toContain('f."beta_metrics_enabled" = true')
    expect(sql).toContain("THEN 'first_chore_within_10m' ELSE 'first_chore_after_10m'")
    expect(sql).toContain('e."created_at" <= c."created_at"')
    expect(sql).toContain("b.\"metric\" IN ('first_chore_within_10m', 'first_chore_after_10m')")
  })
})

describe('day and retention', () => {
  it('uses the UTC day and a 13-month cutoff', () => {
    expect(utcDay(new Date('2026-10-05T23:59:59Z'))).toBe('2026-10-05')
    expect(utcDay(new Date('2026-10-06T00:00:00+02:00'))).toBe('2026-10-05')
    expect(retentionCutoffDay(new Date('2026-10-05T12:00:00Z'))).toBe('2025-09-05')
    expect(retentionCutoffDay(new Date('2027-01-31T12:00:00Z'))).toBe('2025-12-31')
  })
})

describe('setBetaMetricsEnabled', () => {
  function switchDb(stored: boolean | null) {
    const ops: string[] = []
    const tx = {
      $queryRaw: jest.fn(async () => {
        ops.push('lock')
        return []
      }),
      family: {
        findUnique: jest.fn(async () => (stored === null ? null : { beta_metrics_enabled: stored })),
        update: jest.fn(async (args: any) => {
          ops.push(`update:${args.data.beta_metrics_enabled}`)
          return { id: 'fam-1' }
        }),
      },
      betaMetricDaily: {
        deleteMany: jest.fn(async (args: any) => {
          ops.push(`delete:${args.where.family_id}`)
          return { count: 3 }
        }),
      },
    }
    return { tx: tx as any, ops }
  }

  it('off: locks the household row, turns it off and deletes that household’s counts', async () => {
    const { tx, ops } = switchDb(true)
    expect(await setBetaMetricsEnabled(tx, 'fam-1', false)).toEqual({ before: true })
    expect(ops).toEqual(['lock', 'update:false', 'delete:fam-1'])
  })

  it('on: turns it on and deletes nothing', async () => {
    const { tx, ops } = switchDb(false)
    expect(await setBetaMetricsEnabled(tx, 'fam-1', true)).toEqual({ before: false })
    expect(ops).toEqual(['lock', 'update:true'])
  })

  it('a repeat writes no update (off still clears the counts); a missing household is null', async () => {
    const on = switchDb(true)
    expect(await setBetaMetricsEnabled(on.tx, 'fam-1', true)).toEqual({ before: true })
    expect(on.ops).toEqual(['lock'])
    const off = switchDb(false)
    await setBetaMetricsEnabled(off.tx, 'fam-1', false)
    expect(off.ops).toEqual(['lock', 'delete:fam-1'])
    expect(await setBetaMetricsEnabled(switchDb(null).tx, 'gone', false)).toBeNull()
  })
})

describe('source scan', () => {
  const SRC = path.join(process.cwd(), 'src')
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === '__tests__' ? [] : files(full)
      return /\.(ts|tsx)$/.test(e.name) ? [full] : []
    })
  }
  const all = files(SRC).map((f) => ({ rel: path.relative(process.cwd(), f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }))

  it('only src/lib/beta-metrics.ts writes BetaMetricDaily (raw SQL or the Prisma delegate)', () => {
    const rawWrite = /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"BetaMetricDaily"/
    const delegateWrite = /\.betaMetricDaily\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/
    const writers = all.filter((f) => rawWrite.test(f.text) || delegateWrite.test(f.text)).map((f) => f.rel)
    expect(writers).toEqual(['src/lib/beta-metrics.ts'])
  })

  it('the recorder is called from the few agreed success paths only', () => {
    const callers = all
      .filter((f) => f.rel !== 'src/lib/beta-metrics.ts' && /\brecord(BetaMetric|ChoreAssigned)\(/.test(f.text))
      .map((f) => f.rel)
      .sort()
    expect(callers).toEqual([
      'src/app/api/auth/register/route.ts',
      'src/app/api/chores/create/route.ts',
      'src/app/api/chores/verify/route.ts',
      'src/app/api/family/join/route.ts',
      'src/app/api/meals/route.ts',
      'src/app/api/rewards/claim/route.ts',
      'src/lib/chore-complete.ts',
      'src/lib/person-event-create.ts',
    ])
  })

  it('src/lib/analytics.ts is not used for the beta counts', () => {
    const text = fs.readFileSync(path.join(SRC, 'lib/beta-metrics.ts'), 'utf8')
    expect(text).not.toMatch(/from '@\/lib\/analytics'/)
  })
})
