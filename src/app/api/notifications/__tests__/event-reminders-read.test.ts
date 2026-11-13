// The inbox read is what writes due event reminders (no scheduler); off, it never looks at the request for them.
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/api-auth', () => ({ authenticateRequest: jest.fn(async () => [{ userId: 'user-a', tv: 3 }, null]) }))
jest.mock('@/lib/prisma', () => ({ prisma: { notification: { findMany: jest.fn(async () => []) } } }))
jest.mock('@/lib/event-reminders-on-read', () => ({ writeEventRemindersOnRead: jest.fn(async () => undefined) }))
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { writeEventRemindersOnRead } from '@/lib/event-reminders-on-read'
import { EVENT_REMINDERS_READY_ENV, REMINDER_TIME_ZONE_HEADER } from '@/lib/event-reminders'
import { encodeNotificationCursor } from '@/lib/notification-paging'
import type { NextRequest } from 'next/server'
const request = (query: string, zone: string | null = 'America/Toronto') => ({
  url: `http://localhost/api/notifications${query}`,
  headers: { get: (name: string) => (name === REMINDER_TIME_ZONE_HEADER ? zone : null) },
}) as unknown as NextRequest
beforeEach(() => { jest.clearAllMocks(); process.env[EVENT_REMINDERS_READY_ENV] = '1' })
afterAll(() => { delete process.env[EVENT_REMINDERS_READY_ENV] })

it('off: reads the inbox without touching reminders or request headers', async () => {
  process.env[EVENT_REMINDERS_READY_ENV] = '0'
  const response = await GET({ url: 'http://localhost/api/notifications' } as NextRequest)
  expect(response.status).toBe(200)
  expect(writeEventRemindersOnRead).not.toHaveBeenCalled()
})
it('on: writes due reminders for the signed-in account before reading, with the browser zone', async () => {
  const order: string[] = []
  ;(writeEventRemindersOnRead as jest.Mock).mockImplementation(async () => { order.push('remind') })
  ;(prisma!.notification.findMany as jest.Mock).mockImplementation(async () => { order.push('read'); return [] })
  expect((await GET(request('?unread=true&limit=1'))).status).toBe(200)
  expect(writeEventRemindersOnRead).toHaveBeenCalledWith({ userId: 'user-a', generation: 3 }, 'America/Toronto')
  expect(order).toEqual(['remind', 'read'])
  await GET(request('', null))
  expect(writeEventRemindersOnRead).toHaveBeenLastCalledWith({ userId: 'user-a', generation: 3 }, null)
})
it('on: a later page of the same read does not write again', async () => {
  const scope = { userId: 'user-a', unreadOnly: false, includeSnoozed: false }
  const cursor = encodeNotificationCursor(scope, { id: 'n-1', created_at: new Date(1000) } as Parameters<typeof encodeNotificationCursor>[1])
  expect((await GET(request(`?limit=2&cursor=${cursor}`))).status).toBe(200)
  expect(writeEventRemindersOnRead).not.toHaveBeenCalled()
})
