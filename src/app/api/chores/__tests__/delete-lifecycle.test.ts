/**
 * @jest-environment node
 *
 * The lifecycle boundary is enforced in DELETE itself, not only by the
 * occurrence menu: anchors are protected, ordinary rows stay deletable, and
 * the transaction re-checks current membership under the required lock order.
 */
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/notifications-server', () => require('@/__tests__/helpers/two-household').notificationsMock)
jest.mock('@/lib/household-lock', () => ({
  lockUser: jest.fn(async () => undefined),
  lockHousehold: jest.fn(async () => undefined),
}))

import * as chores from '../route'
import { db, req, writesTo } from '@/__tests__/helpers/two-household'
import { lockHousehold, lockUser } from '@/lib/household-lock'

beforeEach(() => {
  db.reset()
  jest.clearAllMocks()
})

describe('DELETE /api/chores recurrence lifecycle', () => {
  it.each(['delete', 'stop'] as const)('refuses %s after session revocation while waiting for locks without changing the series', async (action) => {
    Object.assign(db.find('chore', 'chore-a')!, { recurrence_id: 'chore-a', is_template: true, frequency: 'weekly' })
    db.rows('chore').push({ id: 'pending-copy', family_id: 'family-A', assigned_to: 'child-a', recurrence_id: 'chore-a', frequency: 'once', status: 'pending' })
    const before = JSON.stringify(db.rows('chore'))
    jest.mocked(lockHousehold).mockImplementationOnce(async () => {
      db.find('user', 'parent-a')!.token_version += 1
    })
    const request = req({ as: 'parentA', body: action === 'delete'
      ? { choreId: 'chore-a' }
      : { choreId: 'chore-a', frequency: 'once' } })
    const response = await (action === 'delete' ? chores.DELETE(request) : chores.PATCH(request))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'Unauthorized' })
    expect(JSON.stringify(db.rows('chore'))).toBe(before)
    expect(writesTo('chore')).toHaveLength(0)
    expect(lockUser).toHaveBeenCalledWith(expect.anything(), 'parent-a')
  })

  it.each(['departed-assignee', 'erased-subject', 'profile-subject'] as const)('refuses legacy edit after locked subject state changes: %s', async (change) => {
    jest.mocked(lockHousehold).mockImplementationOnce(async () => {
      if (change === 'departed-assignee') db.find('user', 'teen-a')!.family_id = 'family-B'
      if (change === 'erased-subject') db.find('chore', 'chore-a')!.member_subject_erased = true
      if (change === 'profile-subject') Object.assign(db.find('chore', 'chore-a')!, { assigned_to: null, assigned_member_id: 'new-profile' })
    })
    const response = await chores.PATCH(req({ as: 'parentA', body: {
      choreId: 'chore-a', title: 'Must not save stale edit',
      ...(change !== 'profile-subject' ? { assigned_to: 'teen-a' } : {}),
    } }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'IDENTITY_CONFLICT' })
    expect(writesTo('chore')).toHaveLength(0)
  })

  it('deletes one ordinary occurrence and takes user before household lock', async () => {
    const response = await chores.DELETE(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
    expect(response.status).toBe(200)
    expect(db.find('chore', 'chore-a')).toBeUndefined()
    expect(writesTo('chore').map((write) => write.op)).toEqual(['delete'])

    expect(lockUser).toHaveBeenCalledWith(expect.anything(), 'parent-a')
    expect(lockHousehold).toHaveBeenCalledWith(expect.anything(), 'family-A')
    const userOrder = (lockUser as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]
    const householdOrder = (lockHousehold as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]
    expect(userOrder).toBeLessThan(
      householdOrder,
    )
  })

  it('refuses an active self-anchored template with 409 and no write', async () => {
    Object.assign(db.find('chore', 'chore-a')!, {
      recurrence_id: 'chore-a',
      is_template: true,
      frequency: 'weekly',
    })
    const response = await chores.DELETE(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'RECURRING_SERIES_REQUIRES_STOP' })
    expect(db.find('chore', 'chore-a')).toBeDefined()
    expect(writesTo('chore')).toHaveLength(0)
  })

  it('refuses a stopped self-anchored row while sibling history remains', async () => {
    Object.assign(db.find('chore', 'chore-a')!, {
      recurrence_id: 'chore-a',
      is_template: false,
      frequency: 'once',
    })
    db.rows('chore').push({
      id: 'copy-a',
      family_id: 'family-A',
      assigned_to: 'child-a',
      recurrence_id: 'chore-a',
      frequency: 'once',
      status: 'completed',
    })
    const response = await chores.DELETE(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'RECURRING_ANCHOR_RETAINS_HISTORY' })
    expect(db.find('chore', 'chore-a')).toBeDefined()
    expect(writesTo('chore')).toHaveLength(0)
  })

  it('keeps the assignee delete boundary while protecting an active anchor', async () => {
    Object.assign(db.find('chore', 'chore-a')!, {
      assigned_to: 'teen-a',
      recurrence_id: 'chore-a',
      is_template: true,
      frequency: 'monthly',
    })
    const response = await chores.DELETE(req({ as: 'teenA', body: { choreId: 'chore-a' } }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'RECURRING_SERIES_REQUIRES_STOP' })
    expect(writesTo('chore')).toHaveLength(0)
  })

  it('rejects a stale actor role and a foreign household without writing', async () => {
    db.find('user', 'parent-a')!.role = 'teen'
    const stale = await chores.DELETE(req({ as: 'parentA', body: { choreId: 'chore-a' } }))
    expect(stale.status).toBe(403)
    expect(writesTo('chore')).toHaveLength(0)

    db.reset()
    const foreign = await chores.DELETE(req({ as: 'parentA', body: { choreId: 'chore-b' } }))
    expect(foreign.status).toBe(403)
    expect(writesTo('chore')).toHaveLength(0)
  })
})
