import type { PrismaClient } from '@prisma/client'
import { allStepsDone, loadGetStarted } from '../get-started-data'

const NOW = new Date('2026-01-05T12:00:00.000Z')
const FAMILY = 'fam_new'

function mockDb(
  opts: { members?: number; invite?: boolean; chore?: boolean; event?: boolean } = {}
) {
  const db = {
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
    expect(steps).toEqual({ invited: false, hasChore: false, hasEvent: false })
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
  })

  it('invite is done with a second member or a pending invite', async () => {
    expect((await load(mockDb({ members: 2 })))!.invited).toBe(true)
    expect((await load(mockDb({ members: 1, invite: true })))!.invited).toBe(true)
  })

  it('chore and event steps follow any row for the household', async () => {
    const steps = await load(mockDb({ members: 3, chore: true, event: true }))
    expect(steps).toEqual({ invited: true, hasChore: true, hasEvent: true })
    expect(allStepsDone(steps!)).toBe(true)
  })

  it.each(['teen', 'child'])('returns null and reads nothing for a %s', async (role) => {
    const db = mockDb()
    expect(await load(db, role)).toBeNull()
    expect(db.user.count).not.toHaveBeenCalled()
    expect(db.chore.findFirst).not.toHaveBeenCalled()
  })
})
