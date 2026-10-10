/**
 * Recurring chore date math is UTC-only (due dates are stored at UTC
 * midnight). Previously `nextDueDate` and the expander used local
 * `setHours`/`setDate`/`setMonth`, so on a server whose zone is not UTC a
 * UTC-midnight due date moved to the previous local day and every generated
 * date landed on local midnight (04:00 or 05:00 UTC in Toronto).
 *
 * Jest ignores `process.env.TZ` set inside a test file, so the last test runs
 * this file and the main recurring-chores suite again in a child Jest with
 * TZ=America/Toronto.
 */
import { spawnSync } from 'child_process'
import path from 'path'

jest.mock('@/lib/prisma', () => ({ prisma: null }))
jest.mock('@/lib/beta-metrics', () => ({ recordBetaMetric: async () => undefined }))

import { expandSeriesInTx, nextDueDate, startOfDay } from '@/lib/recurringChores'

const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h))
const isUtcMidnight = (d: Date) =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0

describe('nextDueDate (UTC)', () => {
  it.each([
    ['daily', utc(2026, 9, 1), utc(2026, 9, 2)],
    ['weekly', utc(2026, 9, 1), utc(2026, 9, 8)],
    ['monthly', utc(2026, 9, 1), utc(2026, 10, 1)],
    // Across the Toronto DST changes (Mar 8 and Nov 1 2026).
    ['daily', utc(2026, 3, 7), utc(2026, 3, 8)],
    ['weekly', utc(2026, 3, 5), utc(2026, 3, 12)],
    ['weekly', utc(2026, 10, 29), utc(2026, 11, 5)],
    ['monthly', utc(2026, 10, 15), utc(2026, 11, 15)],
    // A time later in the UTC day still gives the next UTC calendar day.
    ['daily', utc(2026, 9, 1, 23), utc(2026, 9, 2)],
    ['daily', utc(2026, 9, 1, 1), utc(2026, 9, 2)],
    // Year end and short months never skip February.
    ['daily', utc(2026, 12, 31), utc(2027, 1, 1)],
    ['monthly', utc(2026, 1, 29), utc(2026, 2, 28)],
    ['monthly', utc(2026, 1, 30), utc(2026, 2, 28)],
    ['monthly', utc(2026, 1, 31), utc(2026, 2, 28)],
    ['monthly', utc(2028, 1, 29), utc(2028, 2, 29)],
    ['monthly', utc(2028, 1, 30), utc(2028, 2, 29)],
    ['monthly', utc(2028, 1, 31), utc(2028, 2, 29)],
    ['monthly', utc(2026, 12, 31), utc(2027, 1, 31)],
  ])('%s after %s is %s at UTC midnight', (frequency, from, expected) => {
    const next = nextDueDate(from as Date, frequency as string)!
    expect(next.toISOString()).toBe((expected as Date).toISOString())
    expect(isUtcMidnight(next)).toBe(true)
  })

  it.each([29, 30, 31])('restores day %s after February and clamps April independently', (anchor) => {
    const feb = nextDueDate(utc(2026, 1, anchor), 'monthly', [], anchor)!
    const mar = nextDueDate(feb, 'monthly', [], anchor)!
    const apr = nextDueDate(mar, 'monthly', [], anchor)!
    const may = nextDueDate(apr, 'monthly', [], anchor)!
    expect([feb, mar, apr, may].map(d => d.toISOString().slice(0, 10))).toEqual([
      '2026-02-28', `2026-03-${anchor}`, `2026-04-${Math.min(anchor, 30)}`, `2026-05-${anchor}`,
    ])
  })

  it('once and unknown frequencies have no next date', () => {
    expect(nextDueDate(utc(2026, 9, 1), 'once')).toBeNull()
    expect(nextDueDate(utc(2026, 9, 1), 'yearly')).toBeNull()
  })

  it('startOfDay is midnight UTC of the same UTC day', () => {
    expect(startOfDay(utc(2026, 9, 1, 23)).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(startOfDay(utc(2026, 9, 1, 1)).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('expandSeriesInTx (UTC)', () => {
  it('creates occurrences at consecutive UTC midnights', async () => {
    const template = {
      id: 't1',
      title: 'Feed cat',
      description: null,
      points: 5,
      difficulty: 'easy',
      frequency: 'daily',
      family_id: 'fam',
      assigned_to: 'kid',
      created_by: 'parent',
      due_date: utc(2026, 9, 1),
      icon: null,
      routine: null,
      routine_order: null,
    }
    const created: Array<{ due_date: Date }> = []
    const tx = {
      chore: {
        findUnique: async () => template,
        findMany: async () => [{ due_date: template.due_date }],
        findFirst: async () => ({ due_date: template.due_date }),
        createMany: async ({ data }: { data: Array<{ due_date: Date }> }) => {
          created.push(...data)
          return { count: data.length }
        },
      },
    }
    // 23:30 UTC on Sep 1: still Sep 1 in UTC (the evening before in Toronto).
    const count = await expandSeriesInTx(tx as never, 't1', 'fam', utc(2026, 9, 1, 23))
    expect(count).toBe(6)
    expect(created.map((c) => c.due_date.toISOString())).toEqual([
      '2026-09-02T00:00:00.000Z',
      '2026-09-03T00:00:00.000Z',
      '2026-09-04T00:00:00.000Z',
      '2026-09-05T00:00:00.000Z',
      '2026-09-06T00:00:00.000Z',
      '2026-09-07T00:00:00.000Z',
    ])
  })
})

const IN_CHILD = process.env.FP_RECURRING_TZ_CHILD === '1'

describe('under a non-UTC server zone', () => {
  if (IN_CHILD) {
    it('the child really runs in a zone with a UTC offset', () => {
      expect(new Date(Date.UTC(2026, 8, 1)).getTimezoneOffset()).not.toBe(0)
    })
    return
  }

  it('the recurring date suites pass with TZ=America/Toronto', () => {
    const root = path.resolve(__dirname, '../../..')
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('jest/bin/jest'),
        '--ci',
        '--runInBand',
        '--rootDir',
        root,
        'src/lib/__tests__/recurring-dates-utc.test.ts',
        'src/__tests__/recurring-chores.test.ts',
      ],
      {
        cwd: root,
        env: { ...process.env, TZ: 'America/Toronto', FP_RECURRING_TZ_CHILD: '1' },
        encoding: 'utf8',
        timeout: 120_000,
      }
    )
    if (result.status !== 0) {
      throw new Error(`child jest failed (status ${result.status}):\n${result.stderr}\n${result.stdout}`)
    }
    expect(result.status).toBe(0)
  }, 150_000)
})
