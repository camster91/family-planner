// To-do owner and due date route: off refuses before reading the body; input is a closed shape; the actor is always the session.
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/api-auth', () => ({ authenticateWithFamily: jest.fn(async () => [{ user: { id: 'user-a', family_id: 'family-a', role: 'parent' }, payload: { tv: 2 } }, null]) }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn(async () => null) }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/list-tasks-db', () => ({ setListItemTask: jest.fn(async () => ({ status: 200, body: { task: { owner: null, due: '2026-01-09' } } })) }))
jest.mock('@/lib/cloudflare/list-tasks', () => ({ setD1ListItemTask: jest.fn() }))
import { PATCH } from '../route'
import { featureGate } from '@/lib/feature-gate-server'
import { setListItemTask } from '@/lib/list-tasks-db'
import { LIST_TASKS_READY_ENV } from '@/lib/list-tasks'
import type { NextRequest } from 'next/server'
const request = (body?: unknown) => ({ url: 'http://localhost/api/lists/items/task', headers: { get: () => null }, json: async () => { if (body === undefined) throw new Error('no body'); return body } }) as unknown as NextRequest
beforeEach(() => { jest.clearAllMocks(); process.env[LIST_TASKS_READY_ENV] = '1' })
afterAll(() => { delete process.env[LIST_TASKS_READY_ENV] })

it('off: refuses before any write', async () => {
  process.env[LIST_TASKS_READY_ENV] = '0'
  const response = await PATCH(request({ itemId: 'i1', due: '2026-01-09' }))
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('LIST_TASKS_UNSUPPORTED')
  expect(setListItemTask).not.toHaveBeenCalled()
})
it('on: passes the session as the actor and the parsed change', async () => {
  const response = await PATCH(request({ itemId: 'i1', owner: { kind: 'profile', id: 'm1' }, due: null }))
  expect(response.status).toBe(200)
  expect(setListItemTask).toHaveBeenCalledWith(expect.anything(), { familyId: 'family-a', addedBy: 'user-a', role: 'parent', generation: 2 }, { itemId: 'i1', owner: { kind: 'profile', id: 'm1' }, due: null })
})
it.each([
  [{ itemId: 'i1' }], [{ itemId: 'i1', due: '2026-02-30' }], [{ itemId: 'i1', due: 'tomorrow' }], [{ itemId: 'i1', owner: { kind: 'device', id: 'x' } }],
  [{ itemId: 'i1', due: null, familyId: 'family-b' }], [{ itemId: 'i1', owner: { kind: 'account', id: 'u', role: 'parent' } }], [{ due: '2026-01-09' }],
])('on: refuses %j', async (body) => {
  expect((await PATCH(request(body))).status).toBe(400)
  expect(setListItemTask).not.toHaveBeenCalled()
})
it('refuses invalid JSON and honours the family lists switch', async () => {
  expect((await PATCH(request())).status).toBe(400)
  ;(featureGate as jest.Mock).mockResolvedValueOnce({ status: 403 })
  expect((await PATCH(request({ itemId: 'i1', due: null }))).status).toBe(403)
  expect(setListItemTask).not.toHaveBeenCalled()
})
