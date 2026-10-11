// A member removed while their chore waited for a parent's check (O-34).
//
// - Removal hands a `completed` (still checkable) chore to the removing
//   parent, like an open one; checked chores keep the member's name.
// - Verify never pays XP or sends a notification to an assignee who is no
//   longer in the chore's household (rows left over from before this fix).

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)
jest.mock('@/lib/notifications-server', () => {
  const sendNotification = jest.fn(async () => undefined)
  return { notificationServiceServer: { sendNotification, notifyChoreAssignment: async () => undefined } }
})

import { POST as verifyChore } from '../route'
import { removeHouseholdMember } from '@/lib/member-removal'
import { notificationServiceServer } from '@/lib/notifications-server'
import { FAMILY_A, db, fakePrisma, req } from '@/__tests__/helpers/two-household'

const send = notificationServiceServer.sendNotification as jest.Mock

beforeEach(() => {
  db.reset()
  send.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('member removal and chores waiting for a check', () => {
  it('hands open chores to the removing parent; done chores (even unchecked) keep the name', async () => {
    const base = db.find('chore', 'chore-a')!
    db.rows('chore').push({ ...base, id: 'chore-a-waiting', status: 'completed', completed_at: new Date() })
    db.rows('chore').push({ ...base, id: 'chore-a-checked', status: 'verified' })
    db.rows('chore').push({ ...base, id: 'chore-a-approved', status: 'approved' })

    await removeHouseholdMember({ actorId: 'parent-a', familyId: FAMILY_A, targetId: 'child-a' })

    expect(db.find('chore', 'chore-a')!.assigned_to).toBe('parent-a')
    expect(db.find('chore', 'chore-a-waiting')).toMatchObject({ assigned_to: 'child-a', status: 'completed' })
    expect(db.find('chore', 'chore-a-checked')).toMatchObject({ assigned_to: 'child-a', status: 'verified' })
    expect(db.find('chore', 'chore-a-approved')).toMatchObject({ assigned_to: 'child-a', status: 'approved' })
  })
})

describe('POST /api/chores/verify with an assignee outside the household', () => {
  function leaveHousehold() {
    // A chore left assigned to someone no longer in the household.
    db.find('chore', 'chore-a')!.status = 'completed'
    db.find('user', 'child-a')!.family_id = null
  }

  it('approve verifies the chore but pays no XP and sends no notification', async () => {
    leaveHousehold()
    const xpBefore = db.find('user', 'child-a')!.xp
    const res = await verifyChore(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
    expect(res.status).toBe(200)
    expect(db.find('chore', 'chore-a')!.status).toBe('verified')
    expect(db.find('user', 'child-a')!.xp).toBe(xpBefore)
    expect(send.mock.calls.filter((c: any[]) => c[0].userId === 'child-a')).toHaveLength(0)
  })

  it('reject sends the chore back but no notification to the ex-member', async () => {
    leaveHousehold()
    const res = await verifyChore(req({ as: 'parentA', body: { choreId: 'chore-a', decision: 'reject' } }))
    expect(res.status).toBe(200)
    expect(db.find('chore', 'chore-a')!.status).toBe('pending')
    // Reopened work goes to the parent who sent it back.
    expect(db.find('chore', 'chore-a')!.assigned_to).toBe('parent-a')
    expect(send).not.toHaveBeenCalled()
  })

  it('a member still in the household gets XP and the notification as before', async () => {
    db.find('chore', 'chore-a')!.status = 'completed'
    const xpBefore = db.find('user', 'child-a')!.xp
    expect((await verifyChore(req({ as: 'parentA', body: { choreId: 'chore-a' } }))).status).toBe(200)
    expect(db.find('user', 'child-a')!.xp).toBeGreaterThan(xpBefore)
    expect(send.mock.calls.some((c: any[]) => c[0].userId === 'child-a')).toBe(true)
  })

  it('does not relink an erased canonical subject to its retained legacy account', async () => {
    const chore = db.find('chore', 'chore-a')!
    chore.status = 'completed'
    chore.member_subject_erased = true
    chore.assigned_member_id = null
    const xpBefore = db.find('user', 'child-a')!.xp

    const res = await verifyChore(req({ as: 'parentA', body: { choreId: chore.id } }))

    expect(res.status).toBe(200)
    expect(chore.status).toBe('verified')
    expect(db.find('user', 'child-a')!.xp).toBe(xpBefore)
    expect(send.mock.calls.filter((c: any[]) => c[0].userId === 'child-a')).toHaveLength(0)
  })

  it('approval rechecks membership after the preflight read before awarding or notifying', async () => {
    db.find('chore', 'chore-a')!.status = 'completed'
    const original = fakePrisma.chore.findUnique
    let calls = 0
    const spy = jest.spyOn(fakePrisma.chore, 'findUnique').mockImplementation(async (args: any) => {
      const row = await original(args)
      if (++calls === 1) db.find('user', 'child-a')!.family_id = null
      return row
    })

    try {
      const res = await verifyChore(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
      expect(res.status).toBe(200)
      expect(db.find('chore', 'chore-a')!.status).toBe('verified')
      expect(send.mock.calls.filter((c: any[]) => c[0].userId === 'child-a')).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('rejection rechecks membership and hands off without notifying a member removed after preflight', async () => {
    db.find('chore', 'chore-a')!.status = 'completed'
    const original = fakePrisma.chore.findUnique
    let calls = 0
    const spy = jest.spyOn(fakePrisma.chore, 'findUnique').mockImplementation(async (args: any) => {
      const row = await original(args)
      if (++calls === 1) db.find('user', 'child-a')!.family_id = null
      return row
    })

    try {
      const res = await verifyChore(req({ as: 'parentA', body: { choreId: 'chore-a', decision: 'reject' } }))
      expect(res.status).toBe(200)
      expect(db.find('chore', 'chore-a')).toMatchObject({ status: 'pending', assigned_to: 'parent-a' })
      expect(send.mock.calls.filter((c: any[]) => c[0].userId === 'child-a')).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('rechecks the parent role after preflight before changing the chore', async () => {
    db.find('chore', 'chore-a')!.status = 'completed'
    const original = fakePrisma.chore.findUnique
    let calls = 0
    const spy = jest.spyOn(fakePrisma.chore, 'findUnique').mockImplementation(async (args: any) => {
      const row = await original(args)
      if (++calls === 1) db.find('user', 'parent-a')!.role = 'child'
      return row
    })

    try {
      const res = await verifyChore(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
      expect(res.status).toBe(403)
      expect(db.find('chore', 'chore-a')!.status).toBe('completed')
      expect(send).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
