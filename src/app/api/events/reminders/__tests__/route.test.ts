// Own reminder lead time: off answers "unsupported", values are a closed set, and only the signed-in account is ever named.
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/api-auth', () => ({ authenticateRequest: jest.fn(async () => [{ userId: 'user-a', tv: 2 }, null]) }))
jest.mock('@/lib/device-route', () => ({ refusePairedDevice: jest.fn(async () => null) }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/event-reminders-db', () => ({ readReminderLeadHours: jest.fn(async () => 48), writeReminderLeadHours: jest.fn(async () => true) }))
jest.mock('@/lib/cloudflare/event-reminders', () => ({ readD1ReminderLeadHours: jest.fn(), writeD1ReminderLeadHours: jest.fn() }))
import { GET, PATCH } from '../route'
import { refusePairedDevice } from '@/lib/device-route'
import { readReminderLeadHours, writeReminderLeadHours } from '@/lib/event-reminders-db'
import { EVENT_REMINDERS_READY_ENV } from '@/lib/event-reminders'
import type { NextRequest } from 'next/server'
const request = (body?: unknown) => ({ url: 'http://localhost/api/events/reminders', headers: { get: () => null }, json: async () => { if (body === undefined) throw new Error('no body'); return body } }) as unknown as NextRequest
beforeEach(() => { jest.clearAllMocks(); process.env[EVENT_REMINDERS_READY_ENV] = '1' })
afterAll(() => { delete process.env[EVENT_REMINDERS_READY_ENV] })

it('off: GET says unsupported and PATCH refuses before any write', async () => {
  process.env[EVENT_REMINDERS_READY_ENV] = '0'
  expect(await (await GET(request())).json()).toEqual({ supported: false, hours: 24, options: [] })
  const refused = await PATCH(request({ hours: 48 }))
  expect(refused.status).toBe(409)
  expect(readReminderLeadHours).not.toHaveBeenCalled()
  expect(writeReminderLeadHours).not.toHaveBeenCalled()
})
it('on: GET returns the signed-in account\'s own choice and the offered set', async () => {
  expect(await (await GET(request())).json()).toEqual({ supported: true, hours: 48, options: [2, 12, 24, 48, 168] })
  expect(readReminderLeadHours).toHaveBeenCalledWith(expect.anything(), 'user-a')
})
it('on: PATCH saves an offered value for the signed-in account only', async () => {
  const saved = await PATCH(request({ hours: 168 }))
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ supported: true, hours: 168 })
  expect(writeReminderLeadHours).toHaveBeenCalledWith(expect.anything(), { userId: 'user-a', generation: 2 }, 168)
})
it.each([[{ hours: 5 }], [{ hours: '24' }], [{ hours: 24, userId: 'user-b' }], [{}]])('on: PATCH refuses %j', async (body) => {
  expect((await PATCH(request(body))).status).toBe(400)
  expect(writeReminderLeadHours).not.toHaveBeenCalled()
})
it('refuses invalid JSON, a stale session and a paired device', async () => {
  expect((await PATCH(request())).status).toBe(400)
  ;(writeReminderLeadHours as jest.Mock).mockResolvedValueOnce(false)
  expect((await PATCH(request({ hours: 24 }))).status).toBe(401)
  ;(refusePairedDevice as jest.Mock).mockResolvedValue({ status: 403 })
  expect((await GET(request())).status).toBe(403)
  expect((await PATCH(request({ hours: 24 }))).status).toBe(403)
})
