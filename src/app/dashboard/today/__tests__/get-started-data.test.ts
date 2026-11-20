import type { PrismaClient } from '@prisma/client'
import { allStepsDone, loadGetStarted, loadTodayStarts } from '../get-started-data'

const NOW = new Date('2026-01-05T12:00:00.000Z')
const FAMILY = 'fam_new'

function mockDb(
  opts: {
    members?: number
    invite?: boolean
    chore?: boolean
    event?: boolean
    connection?: boolean
    subscription?: boolean
  } = {}
) {
  const db = {
    calendarConnection: { findFirst: jest.fn().mockResolvedValue(opts.connection ? { id: 'cc' } : null) },
    calendarSubscription: { findFirst: jest.fn().mockResolvedValue(opts.subscription ? { id: 'cs' } : null) },
    user: { count: jest.fn().mockResolvedValue(opts.members ?? 1) },
    familyInvite: { findFirst: jest.fn().mockResolvedValue(opts.invite ? { id: 'inv' } : null) },
    chore: { findFirst: jest.fn().mockResolvedValue(opts.chore ? { id: 'c' } : null) },
    event: { findFirst: jest.fn().mockResolvedValue(opts.event ? { id: 'e' } : null) },
  }
  return db
}

const load = (db: ReturnType<typeof mockDb>, role = 'parent') =>
  loadGetStarted(db as unknown as PrismaClient, { familyId: FAMILY, role, now: NOW })

describe('loadGetStarted', () => {
  it('a brand-new household has nothing done', async () => {
    const steps = await load(mockDb())
    expect(steps).toEqual({ invited: false, hasChore: false, hasEvent: false, hasCalendar: false })
    expect(allStepsDone(steps!)).toBe(false)
  })

  it('every query is scoped to the household, and invites must be open', async () => {
    const db = mockDb()
    await load(db)
    expect(db.user.count).toHaveBeenCalledWith({ where: { family_id: FAMILY } })
    expect(db.familyInvite.findFirst).toHaveBeenCalledWith({
      where: { family_id: FAMILY, accepted_at: null, expires_at: { gt: NOW } },
      select: { id: true },
    })
    expect(db.chore.findFirst).toHaveBeenCalledWith({ where: { family_id: FAMILY }, select: { id: true } })
    expect(db.event.findFirst).toHaveBeenCalledWith({ where: { family_id: FAMILY }, select: { id: true } })
    expect(db.calendarConnection.findFirst).toHaveBeenCalledWith({ where: { family_id: FAMILY }, select: { id: true } })
    expect(db.calendarSubscription.findFirst).toHaveBeenCalledWith({ where: { family_id: FAMILY }, select: { id: true } })
  })

  it.each([
    ['a two-way calendar connection', { connection: true }],
    ['a subscribed calendar', { subscription: true }],
  ])('the calendar step is done with %s', async (_label, opts) => {
    const steps = await load(mockDb({ members: 2, chore: true, event: true, ...opts }))
    expect(steps!.hasCalendar).toBe(true)
    expect(allStepsDone(steps!)).toBe(true)
  })

  it('stays open until a calendar is connected, even with the other three done', async () => {
    const steps = await load(mockDb({ members: 2, chore: true, event: true }))
    expect(steps!.hasCalendar).toBe(false)
    expect(allStepsDone(steps!)).toBe(false)
  })

  it('invite is done with a second member or a pending invite', async () => {
    expect((await load(mockDb({ members: 2 })))!.invited).toBe(true)
    expect((await load(mockDb({ members: 1, invite: true })))!.invited).toBe(true)
  })

  it('chore and event steps follow any row for the household', async () => {
    const steps = await load(mockDb({ members: 3, chore: true, event: true, subscription: true }))
    expect(steps).toEqual({ invited: true, hasChore: true, hasEvent: true, hasCalendar: true })
    expect(allStepsDone(steps!)).toBe(true)
  })

  it.each(['teen', 'child'])('returns null and reads nothing for a %s', async (role) => {
    const db = mockDb()
    expect(await load(db, role)).toBeNull()
    expect(db.user.count).not.toHaveBeenCalled()
    expect(db.chore.findFirst).not.toHaveBeenCalled()
  })
})

describe('loadTodayStarts', () => {
  const startsDb = (opts: { chore?: boolean; list?: boolean } = {}) => ({
    chore: { findFirst: jest.fn().mockResolvedValue(opts.chore ? { id: 'c' } : null) },
    list: { findFirst: jest.fn().mockResolvedValue(opts.list ? { id: 'l' } : null) },
  })

  it('reports a household that never added a chore and has no grocery list', async () => {
    const db = startsDb()
    expect(await loadTodayStarts(db as unknown as PrismaClient, { familyId: FAMILY })).toEqual({
      hasChore: false,
      hasGroceryList: false,
    })
    expect(db.chore.findFirst).toHaveBeenCalledWith({ where: { family_id: FAMILY }, select: { id: true } })
    // Both grocery list kinds count (ADR-0007), and only this household's.
    expect(db.list.findFirst).toHaveBeenCalledWith({
      where: { family_id: FAMILY, type: { in: ['grocery', 'shopping'] } },
      select: { id: true },
    })
  })

  it('reports existing chores and grocery lists', async () => {
    const db = startsDb({ chore: true, list: true })
    expect(await loadTodayStarts(db as unknown as PrismaClient, { familyId: FAMILY })).toEqual({
      hasChore: true,
      hasGroceryList: true,
    })
  })
})
