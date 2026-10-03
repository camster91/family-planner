// The one notification helper (#286, PR101 D-5): a muted category creates
// nothing, an unmuted one creates the row, ALWAYS types and account mail ignore
// every mute. Also the route-facing wrapper and POST /api/notifications, which
// both go through it.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/mail', () => ({ sendMail: jest.fn(async () => undefined), isMailConfigured: jest.fn(() => true) }))

import { deliverNotification, sendAccountMail, sendOptInMail } from '../notification-delivery'
import { notificationServiceServer } from '../notifications-server'
import { POST } from '@/app/api/notifications/route'
import { isMailConfigured, sendMail } from '@/lib/mail'
import { db, req, writesTo, USER_IDS } from '@/__tests__/helpers/two-household'
import { IN_APP_NOTIFICATION_TYPES } from '../notification-policy'

const CHILD = USER_IDS.childA

function mute(userId: string, cols: Partial<Record<'notify_chores' | 'notify_events' | 'notify_messages', boolean>>) {
  Object.assign(db.find('user', userId)!, cols)
}

const rowsFor = (userId: string) => db.rows('notification').filter((n) => n.user_id === userId)

const ALL_OFF = { notify_chores: false, notify_events: false, notify_messages: false }

describe('deliverNotification', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => {
    db.reset()
    ;(sendMail as jest.Mock).mockClear()
  })

  it('creates the row when the category is on (the default)', async () => {
    const result = await deliverNotification({ userId: CHILD, title: 'New chore', message: 'Dishes', type: 'chore' })
    expect(result.delivered).toBe(true)
    expect(rowsFor(CHILD)).toHaveLength(1)
    expect(rowsFor(CHILD)[0]).toMatchObject({ title: 'New chore', message: 'Dishes', type: 'chore', read: false })
  })

  it.each([
    ['chore', 'notify_chores'],
    ['reward', 'notify_chores'],
    ['event', 'notify_events'],
    ['message', 'notify_messages'],
  ] as const)('a muted category creates nothing: %s is muted by %s', async (type, column) => {
    mute(CHILD, { [column]: false })
    const result = await deliverNotification({ userId: CHILD, title: 't', message: 'm', type })
    expect(result).toEqual({ delivered: false, notification: null })
    expect(writesTo('notification')).toHaveLength(0)
  })

  it('muting one category leaves the others on', async () => {
    mute(CHILD, { notify_chores: false })
    expect((await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'event' })).delivered).toBe(true)
    expect((await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'message' })).delivered).toBe(true)
    expect((await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'chore' })).delivered).toBe(false)
    expect(rowsFor(CHILD).map((n) => n.type)).toEqual(['event', 'message'])
  })

  it("reads the recipient's switch, not anyone else's", async () => {
    mute(USER_IDS.parentA, ALL_OFF)
    const result = await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'chore' })
    expect(result.delivered).toBe(true)
  })

  it('ALWAYS types ignore every mute (system notices)', async () => {
    mute(CHILD, ALL_OFF)
    const result = await deliverNotification({ userId: CHILD, title: 'Notice', message: 'm', type: 'system' })
    expect(result.delivered).toBe(true)
    expect(rowsFor(CHILD)).toHaveLength(1)
  })

  it('with every default switch, every type is delivered except opt-in ones', async () => {
    for (const type of IN_APP_NOTIFICATION_TYPES) {
      expect((await deliverNotification({ userId: CHILD, title: 't', message: 'm', type })).delivered).toBe(
        type !== 'summary'
      )
    }
    expect(rowsFor(CHILD)).toHaveLength(IN_APP_NOTIFICATION_TYPES.length - 1)
  })

  it('the morning summary (opt-in, O-40) is stored only once the member turns it on', async () => {
    const input = { userId: CHILD, title: 'Your morning summary', message: 'Today: 1 chore (Dishes).', type: 'summary' as const }
    expect(await deliverNotification(input)).toEqual({ delivered: false, notification: null })
    // Muting every category does not matter; only its own switch does.
    mute(CHILD, ALL_OFF)
    Object.assign(db.find('user', CHILD)!, { morning_summary_enabled: true })
    expect((await deliverNotification(input)).delivered).toBe(true)
    expect(rowsFor(CHILD)).toHaveLength(1)
  })
})

describe('deliverNotification and quiet hours (#141, O-32)', () => {
  // 23:30 in Toronto (summer) is 03:30 UTC the next day.
  const NIGHT = new Date('2026-06-02T03:30:00Z')
  const NOON = new Date('2026-06-01T16:00:00Z')

  function setQuiet(userId: string, enabled = true) {
    Object.assign(db.find('user', userId)!, {
      quiet_hours_enabled: enabled,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      quiet_hours_time_zone: 'America/Toronto',
    })
  }

  beforeEach(() => db.reset())

  it('inside quiet hours the row is still stored (nothing lost) and marked quiet', async () => {
    setQuiet(CHILD)
    const result = await deliverNotification({ userId: CHILD, title: 'New chore', message: 'Dishes', type: 'chore' }, NIGHT)
    expect(result.delivered).toBe(true)
    expect(result.delivered && result.quiet).toBe(true)
    expect(rowsFor(CHILD)).toHaveLength(1)
    expect(rowsFor(CHILD)[0]).toMatchObject({ title: 'New chore', read: false })
  })

  it('outside quiet hours, or with quiet hours off (the default), it is not quiet', async () => {
    setQuiet(CHILD)
    const noon = await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'event' }, NOON)
    expect(noon.delivered && noon.quiet).toBe(false)
    const other = await deliverNotification({ userId: USER_IDS.teenA, title: 't', message: 'm', type: 'event' }, NIGHT)
    expect(other.delivered && other.quiet).toBe(false)
    setQuiet(CHILD, false)
    const off = await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'event' }, NIGHT)
    expect(off.delivered && off.quiet).toBe(false)
  })

  it("reads the recipient's quiet hours, not the sender's", async () => {
    setQuiet(USER_IDS.parentA)
    const result = await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'message' }, NIGHT)
    expect(result.delivered && result.quiet).toBe(false)
  })

  it('system notices are stored and marked quiet too; a muted category is still not stored', async () => {
    setQuiet(CHILD)
    mute(CHILD, ALL_OFF)
    const notice = await deliverNotification({ userId: CHILD, title: 'Notice', message: 'm', type: 'system' }, NIGHT)
    expect(notice.delivered && notice.quiet).toBe(true)
    expect(await deliverNotification({ userId: CHILD, title: 't', message: 'm', type: 'chore' }, NIGHT)).toEqual({
      delivered: false,
      notification: null,
    })
    expect(rowsFor(CHILD).map((n) => n.type)).toEqual(['system'])
  })

  it('POST /api/notifications answers quiet for a delivered notification', async () => {
    const res = await POST(
      req({
        as: 'parentA',
        path: '/api/notifications',
        method: 'POST',
        body: { userId: CHILD, title: 'Soon', message: 'Dentist', type: 'event' },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, delivered: true, quiet: false })
    expect(body.notification).toMatchObject({ title: 'Soon' })
  })
})

describe('sendOptInMail (morning summary, O-40)', () => {
  const mail = { userId: CHILD, subject: 'Your day', html: '<p>x</p>', text: 'x' }
  const optIn = (extra: Record<string, unknown> = {}) =>
    Object.assign(db.find('user', CHILD)!, { morning_summary_enabled: true, ...extra })

  beforeEach(() => {
    db.reset()
    ;(sendMail as jest.Mock).mockClear()
    ;(isMailConfigured as jest.Mock).mockReturnValue(true)
  })

  it('is not sent to a member who has not opted in (the default)', async () => {
    expect(await sendOptInMail('morning_summary', mail)).toEqual({ sent: false, reason: 'opted_out' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it("goes to the member's own verified address, never one the caller picks", async () => {
    optIn()
    expect(await sendOptInMail('morning_summary', mail)).toEqual({ sent: true })
    expect(sendMail).toHaveBeenCalledWith({ to: 'child-a@example.test', subject: 'Your day', html: '<p>x</p>', text: 'x' })
  })

  it('is not sent to an unverified address', async () => {
    optIn({ email_verified: false })
    expect(await sendOptInMail('morning_summary', mail)).toEqual({ sent: false, reason: 'unverified' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('is held inside quiet hours (O-32: email interrupts) and sent outside them', async () => {
    optIn({ quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '07:00', quiet_hours_time_zone: 'UTC' })
    expect(await sendOptInMail('morning_summary', mail, new Date('2026-10-03T06:30:00Z'))).toEqual({
      sent: false,
      reason: 'quiet_hours',
    })
    expect(await sendOptInMail('morning_summary', mail, new Date('2026-10-03T07:00:00Z'))).toEqual({ sent: true })
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('sends nothing (and logs nothing) when mail is not configured', async () => {
    optIn()
    ;(isMailConfigured as jest.Mock).mockReturnValue(false)
    expect(await sendOptInMail('morning_summary', mail)).toEqual({ sent: false, reason: 'mail_not_configured' })
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('sendAccountMail', () => {
  beforeEach(() => {
    db.reset()
    ;(sendMail as jest.Mock).mockClear()
  })

  it.each(['password_reset', 'email_verification', 'family_invite'] as const)(
    '%s is always sent, even when every category is muted',
    async (kind) => {
      for (const id of Object.values(USER_IDS)) mute(id, ALL_OFF)
      const mail = { to: 'someone@example.test', subject: 's', html: '<p>h</p>', text: 'h' }
      await sendAccountMail(kind, mail)
      expect(sendMail).toHaveBeenCalledTimes(1)
      expect(sendMail).toHaveBeenCalledWith(mail)
    }
  )
})

describe('notificationServiceServer (route wrapper)', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => db.reset())

  it('returns false and creates nothing for a muted recipient, true otherwise', async () => {
    mute(CHILD, { notify_chores: false })
    expect(await notificationServiceServer.sendNotification({ userId: CHILD, title: 't', message: 'm', type: 'reward' })).toBe(
      false
    )
    expect(await notificationServiceServer.sendNotification({ userId: CHILD, title: 't', message: 'm', type: 'event' })).toBe(
      true
    )
    expect(rowsFor(CHILD).map((n) => n.type)).toEqual(['event'])
  })

  it('a muted chore assignment creates nothing', async () => {
    mute(CHILD, { notify_chores: false })
    await notificationServiceServer.notifyChoreAssignment(
      { id: 'c1', title: 'Dishes', due_date: new Date() },
      { id: CHILD, name: 'Child A' },
      { id: USER_IDS.parentA, name: 'Parent A' }
    )
    expect(rowsFor(CHILD)).toHaveLength(0)
  })
})

describe('POST /api/notifications goes through the helper', () => {
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  beforeEach(() => db.reset())

  const post = (body: unknown) => POST(req({ as: 'parentA', path: '/api/notifications', method: 'POST', body }))

  it('a muted category answers delivered: false and creates nothing', async () => {
    mute(CHILD, { notify_events: false })
    const res = await post({ userId: CHILD, title: 'Soon', message: 'Dentist', type: 'event' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, delivered: false, notification: null })
    expect(writesTo('notification')).toHaveLength(0)
  })

  it('a system notice ignores the mute', async () => {
    mute(CHILD, ALL_OFF)
    const res = await post({ userId: CHILD, title: 'Notice', message: 'Home by six', type: 'system' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.delivered).toBe(true)
    expect(rowsFor(CHILD)).toHaveLength(1)
  })

  it('400 for a type that is not in the policy table', async () => {
    const res = await post({ userId: CHILD, title: 't', message: 'm', type: 'weekly_report' })
    expect(res.status).toBe(400)
    expect(writesTo('notification')).toHaveLength(0)
  })

  it('still refuses another household (403)', async () => {
    const res = await post({ userId: USER_IDS.childB, title: 't', message: 'm', type: 'system' })
    expect(res.status).toBe(403)
    expect(writesTo('notification')).toHaveLength(0)
  })
})
