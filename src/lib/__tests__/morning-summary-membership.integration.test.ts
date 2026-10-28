// Fabricated households and intercepted transport only. No scheduler/provider.
jest.mock('@/lib/mail', () => ({
  ...jest.requireActual('@/lib/mail'),
  sendMail: jest.fn(async () => undefined),
  isMailConfigured: jest.fn(() => true),
}))

import { prisma as configuredPrisma } from '@/lib/prisma'
import { sendMail } from '@/lib/mail'
import { sendOptInMail } from '@/lib/notification-delivery'
import { runMorningSummary } from '@/lib/morning-summary-server'
import { removeHouseholdMember } from '@/lib/member-removal'
import { lockHousehold, lockUser, userLockKey, householdLockKey } from '@/lib/household-lock'

const describeWithDatabase = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip

describeWithDatabase('summary delivery membership boundary (#470)', () => {
  const db = configuredPrisma!
  const FAMILY = 'summary-binding-home'
  const OTHER = 'summary-binding-other'
  const ACTOR = 'summary-binding-owner'
  const RECIPIENT = 'summary-binding-recipient'
  const now = new Date('2026-10-27T12:00:00Z')
  const mail = {
    userId: RECIPIENT, familyId: FAMILY,
    recipientContext: { role: 'parent', tokenVersion: 0 },
    subject: 'Fabricated summary', html: '<p>Fixture only</p>', text: 'Fixture only',
  }

  async function cleanup() {
    await db.family.deleteMany({ where: { id: { in: [FAMILY, OTHER] } } })
    await db.user.deleteMany({ where: { id: { in: [ACTOR, RECIPIENT] } } })
  }

  async function removeAndRejoin(familyId = FAMILY) {
    await removeHouseholdMember({ actorId: ACTOR, familyId: FAMILY, targetId: RECIPIENT })
    await db.$transaction(async tx => {
      await lockUser(tx, RECIPIENT)
      await lockHousehold(tx, familyId)
      await tx.user.update({ where: { id: RECIPIENT }, data: { family_id: familyId } })
    })
  }

  beforeEach(async () => {
    jest.restoreAllMocks()
    ;(sendMail as jest.Mock).mockReset().mockResolvedValue(undefined)
    await cleanup()
    await db.family.createMany({ data: [
      { id: FAMILY, name: 'Fixture home', invite_code: 'summary-binding-invite' },
      { id: OTHER, name: 'Fixture other', invite_code: 'summary-binding-other-invite' },
    ] })
    await db.user.createMany({ data: [
      { id: ACTOR, email: 'summary-owner@example.test', name: 'Owner', role: 'parent', family_id: FAMILY },
      { id: RECIPIENT, email: 'summary-recipient@example.test', name: 'Recipient', role: 'parent', family_id: FAMILY,
        email_verified: true, morning_summary_enabled: true, morning_summary_time_zone: 'UTC' },
    ] })
    await db.chore.create({ data: {
      id: 'summary-binding-chore', family_id: FAMILY, title: 'Fixture chore', assigned_to: ACTOR,
      created_by: ACTOR, status: 'completed', due_date: now,
    } })
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await cleanup()
    await db.$disconnect()
  })

  it.each([FAMILY, OTHER])('rejects a captured summary after removal and rejoin to %s', async familyId => {
    await removeAndRejoin(familyId)
    expect(await sendOptInMail('morning_summary', mail, now)).toEqual({ sent: false, reason: 'membership_changed' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('rejects a parent summary after the recipient role changes', async () => {
    await db.user.update({ where: { id: RECIPIENT }, data: { role: 'child' } })
    expect(await sendOptInMail('morning_summary', mail, now)).toEqual({ sent: false, reason: 'membership_changed' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('does not claim a day for membership that changed after the initial snapshot', async () => {
    const read = db.user.findMany.bind(db.user)
    const readSpy = jest.spyOn(db.user, 'findMany') as jest.SpyInstance<Promise<Awaited<ReturnType<typeof read>>>, Parameters<typeof read>>
    readSpy.mockImplementationOnce(async args => {
      const rows = await read(args)
      await removeAndRejoin()
      return rows
    })
    const result = await runMorningSummary(db, { now })
    expect(result.sent).toEqual({ inApp: 0, email: 0 })
    expect((await db.user.findUniqueOrThrow({ where: { id: RECIPIENT } })).morning_summary_sent_on).toBeNull()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('rejects both channels after removal/rejoin following the daily claim', async () => {
    const claim = db.user.updateMany.bind(db.user)
    const claimSpy = jest.spyOn(db.user, 'updateMany') as jest.SpyInstance<Promise<Awaited<ReturnType<typeof claim>>>, Parameters<typeof claim>>
    claimSpy.mockImplementationOnce(async args => {
      const result = await claim(args)
      await removeAndRejoin()
      return result
    })
    const result = await runMorningSummary(db, { now })
    expect(result.sent).toEqual({ inApp: 0, email: 0 })
    expect(await db.notification.count({ where: { user_id: RECIPIENT } })).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
    expect((await runMorningSummary(db, { now })).sent).toEqual({ inApp: 0, email: 0 })
  })

  it('holds both membership locks until transport finishes, then permits removal', async () => {
    let started!: () => void
    let finish!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const transport = new Promise<void>(resolve => { finish = resolve })
    ;(sendMail as jest.Mock).mockImplementationOnce(async () => { started(); await transport })
    const sending = sendOptInMail('morning_summary', mail, now)
    await entered
    try {
      for (const key of [userLockKey(RECIPIENT), householdLockKey(FAMILY)]) {
        const rows = await db.$transaction(tx => tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked
        `)
        expect(rows).toEqual([{ locked: false }])
      }
    } finally {
      finish()
      await sending
    }
    await removeHouseholdMember({ actorId: ACTOR, familyId: FAMILY, targetId: RECIPIENT })
    expect((await db.user.findUniqueOrThrow({ where: { id: RECIPIENT } })).family_id).toBeNull()
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('keeps the daily claim when transport has an unknown outcome, preventing replay', async () => {
    ;(sendMail as jest.Mock).mockRejectedValueOnce(new Error('Fixture transport interrupted'))
    const logging = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = await runMorningSummary(db, { now })
    expect(first.failedRecipients).toBe(1)
    expect((await runMorningSummary(db, { now })).sent).toEqual({ inApp: 0, email: 0 })
    expect(sendMail).toHaveBeenCalledTimes(1)
    logging.mockRestore()
  })
})
