// POST /api/chores/create: a repeating chore is created, linked to its own
// series and given its first window of copies in ONE transaction. Before,
// the link and the expansion were separate writes whose failures were only
// logged, so the client was told a "weekly" chore was created when it would
// never repeat. Rollback against real Postgres is covered in
// src/lib/__tests__/recurring-series.integration.test.ts.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)
jest.mock('@/lib/notifications-server', () => require('@/__tests__/helpers/two-household').notificationsMock)

import { POST as createChore } from '../route'
import * as recurring from '@/lib/recurringChores'
import { bodyOf, db, req } from '@/__tests__/helpers/two-household'

const body = (over: Record<string, unknown> = {}) => ({
  title: 'Take out bins',
  points: 10,
  assigned_to: 'child-a',
  due_date: '2099-10-05',
  difficulty: 'easy',
  frequency: 'weekly',
  ...over,
})

beforeEach(() => {
  db.reset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/chores/create', () => {
  it('a weekly chore comes back as its own series template, with its copies', async () => {
    const res = await createChore(req({ as: 'parentA', method: 'POST', body: body() }))
    expect(res.status).toBe(200)
    const { chore } = await bodyOf(res)
    expect(chore).toMatchObject({ frequency: 'weekly', is_template: true, recurrence_id: chore.id })
    expect(chore.assignee).toMatchObject({ id: 'child-a' })
    const series = db.rows('chore').filter((c) => c.recurrence_id === chore.id)
    expect(series).toHaveLength(4)
    expect(series.filter((c) => c.id !== chore.id).every((c) => c.frequency === 'once' && !c.is_template)).toBe(true)
  })

  it('a one-off chore is not a template and gets no copies', async () => {
    const res = await createChore(req({ as: 'parentA', method: 'POST', body: body({ frequency: 'once' }) }))
    expect(res.status).toBe(200)
    const { chore } = await bodyOf(res)
    expect(chore.is_template).toBeFalsy()
    expect(chore.recurrence_id ?? null).toBeNull()
    expect(db.rows('chore').filter((c) => c.title === 'Take out bins')).toHaveLength(1)
  })

  it('a failed expansion fails the request instead of reporting success', async () => {
    const expand = jest.spyOn(recurring, 'expandSeriesInTx').mockRejectedValueOnce(new Error('expansion failed'))
    const res = await createChore(req({ as: 'parentA', method: 'POST', body: body() }))
    // Never a false "created": the client sees the failure and can retry.
    expect(res.status).toBe(500)
    expect(expand).toHaveBeenCalledTimes(1)
  })
})
