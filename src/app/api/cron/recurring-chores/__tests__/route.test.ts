// POST /api/cron/recurring-chores: one family that fails to expand must not
// stop the others. Each family is tried, failures are logged and counted.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({
  prisma: { family: { findMany: jest.fn(async () => [{ id: 'fam-a' }, { id: 'fam-b' }, { id: 'fam-c' }]) } },
}))
jest.mock('@/lib/recurringChores', () => ({ expandAllRecurringChores: jest.fn() }))
jest.mock('@/lib/api-error', () => ({ logRouteError: jest.fn() }))

import { POST } from '../route'
import { expandAllRecurringChores } from '@/lib/recurringChores'
import { logRouteError } from '@/lib/api-error'

const expand = expandAllRecurringChores as jest.Mock
const logError = logRouteError as jest.Mock
const SAVED = process.env.CRON_SECRET

function post(secret = 'cron-secret-value'): any {
  return POST({
    method: 'POST',
    url: 'http://localhost/api/cron/recurring-chores',
    headers: new Headers({ 'x-cron-secret': secret }),
  } as any)
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret-value'
  expand.mockReset()
  logError.mockReset()
})

afterAll(() => {
  if (SAVED === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = SAVED
})

describe('POST /api/cron/recurring-chores', () => {
  it('keeps going after one family fails and reports the counts', async () => {
    expand.mockImplementation(async (familyId: string) => {
      if (familyId === 'fam-b') throw new Error('database hiccup')
      return familyId === 'fam-a' ? 3 : 0
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(expand.mock.calls.map((c) => c[0])).toEqual(['fam-a', 'fam-b', 'fam-c'])
    const body = await res.json()
    expect(body).toEqual({
      success: false,
      processed: 2,
      failed: 1,
      families: 1,
      details: [{ familyId: 'fam-a', inserted: 3 }],
    })
    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError.mock.calls[0][1]).toBeInstanceOf(Error)
  })

  it('reports success when every family expands', async () => {
    expand.mockResolvedValue(0)
    const body = await (await post()).json()
    expect(body).toMatchObject({ success: true, processed: 3, failed: 0 })
    expect(logError).not.toHaveBeenCalled()
  })

  it('still rejects a wrong secret without expanding anything', async () => {
    const res = await post('wrong-secret-value')
    expect(res.status).toBe(401)
    expect(expand).not.toHaveBeenCalled()
  })
})
