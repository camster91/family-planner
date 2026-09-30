// /dashboard/calendar?month=…&year=… with a hand-edited or truncated URL used
// to build an Invalid Date and fail the whole page. It now falls back to the
// current month.
const mockFindMany = jest.fn(async (_args: unknown) => [] as unknown[])
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(async () => ({ family_id: 'family-A', role: 'parent' })) },
    event: { findMany: (args: unknown) => mockFindMany(args) },
  },
}))
jest.mock('@/lib/supabase/server', () => ({ getServerUser: async () => ({ id: 'parent-a' }) }))
jest.mock('@/lib/calendar-import/source', () => ({ attachEventSources: async (_p: unknown, _f: string, e: unknown[]) => e }))
jest.mock('@/lib/calendar-sync/config', () => ({ isCalendarSyncEnabled: () => false }))
jest.mock('@/lib/calendar-sync/sync', () => ({ refreshStaleConnections: jest.fn() }))
jest.mock('@/lib/event-import', () => ({ canImportEvents: () => false, isEventImportConfigured: () => false }))
jest.mock('next/server', () => ({ after: jest.fn() }))
jest.mock('../CalendarPageClient', () => ({ __esModule: true, default: () => null }))

import CalendarPage from '../page'

function queriedRange(): { gte: Date; lte: Date } {
  const args = mockFindMany.mock.calls[0][0] as { where: { start_time: { gte: Date; lte: Date } } }
  return args.where.start_time
}

beforeEach(() => mockFindMany.mockClear())

describe('calendar month/year parameters', () => {
  it.each([
    [{ month: 'abc', year: '2026' }],
    [{ month: '13', year: '2026' }],
    [{ month: '0' }],
    [{ month: '5', year: 'x' }],
  ])('%p queries a valid month', async (params) => {
    const element = (await CalendarPage({ searchParams: Promise.resolve(params) })) as { props: { currentMonth: number; currentYear: number } }
    const { gte, lte } = queriedRange()
    expect(Number.isNaN(gte.getTime())).toBe(false)
    expect(Number.isNaN(lte.getTime())).toBe(false)
    expect(element.props.currentMonth).toBeGreaterThanOrEqual(1)
    expect(element.props.currentMonth).toBeLessThanOrEqual(12)
    expect(Number.isInteger(element.props.currentYear)).toBe(true)
  })

  it('keeps a valid month', async () => {
    const element = (await CalendarPage({ searchParams: Promise.resolve({ month: '2', year: '2027' }) })) as {
      props: { currentMonth: number; currentYear: number }
    }
    expect(element.props).toMatchObject({ currentMonth: 2, currentYear: 2027 })
    expect(queriedRange().gte.getMonth()).toBe(1)
  })
})
