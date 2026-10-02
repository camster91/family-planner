// Household member controls (O-34): "Get a new family code"
// (POST /api/family/invite-code) and "Remove from household"
// (DELETE /api/family/members/[id]). Two households, every role: only a parent
// acts, only on their own household; the old code stops working; a removed
// member's sessions are revoked and household content stays.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)

import { POST as rotate } from '../invite-code/route'
import { DELETE as removeMember } from '../members/[id]/route'
import { POST as join } from '../join/route'
import { GET as lookup } from '../lookup/route'
import { GET as getFamily } from '../route'
import { removeHouseholdMember } from '@/lib/member-removal'
import {
  FAMILY_A,
  FAMILY_B,
  FOREIGN,
  USER_IDS,
  bodyOf,
  db,
  expectDenied,
  fakePrisma,
  params,
  req,
  writesTo,
  type UserKey,
} from '@/__tests__/helpers/two-household'

const { resolveSession } = jest.requireActual('@/lib/session') as typeof import('@/lib/session')

function codeOf(familyId: string): string {
  return db.find('family', familyId)!.invite_code
}

function auditRows(action?: string) {
  return db.rows('auditLog').filter((r) => !action || r.action === action)
}

function addMember(id: string, name: string, role: string, familyId: string | null = FAMILY_A) {
  const base = db.find('user', 'teen-a')!
  db.rows('user').push({ ...base, id, email: `${id}@example.test`, name, role, family_id: familyId, token_version: 0 })
}

function del(as: UserKey, targetId: string) {
  return removeMember(
    req({ as, method: 'DELETE', path: `/api/family/members/${targetId}` }),
    params({ id: targetId })
  )
}

beforeEach(() => {
  db.reset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('POST /api/family/invite-code', () => {
  it('a parent gets a new code for their own household only; the old code stops working at once', async () => {
    const res = await rotate(req({ as: 'parentA', method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(200)
    const { inviteCode } = await bodyOf(res)
    expect(inviteCode).toMatch(/^[a-hjkmnp-z2-9]{12}$/)
    expect(inviteCode).not.toBe('invitea1')
    expect(codeOf(FAMILY_A)).toBe(inviteCode)
    expect(codeOf(FAMILY_B)).toBe('inviteb1')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')

    // Old code: refused by join and lookup.
    expect((await join(req({ as: 'loner', method: 'POST', body: { inviteCode: 'INVITEA1' } }))).status).toBe(404)
    expect((await lookup(req({ as: 'loner', path: '/api/family/lookup', query: { code: 'INVITEA1' } }))).status).toBe(404)
    expect(db.find('user', 'loner')!.family_id).toBeNull()
    // New code works.
    expect((await join(req({ as: 'loner', method: 'POST', body: { inviteCode } }))).status).toBe(200)
    expect(db.find('user', 'loner')).toMatchObject({ family_id: FAMILY_A, role: 'child' })
  })

  it('records the change in the household audit history without the code', async () => {
    const res = await rotate(req({ as: 'parentA', method: 'POST', path: '/api/family/invite-code' }))
    const { inviteCode } = await bodyOf(res)
    const rows = auditRows('invite_code.rotated')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ family_id: FAMILY_A, actor_user_id: USER_IDS.parentA, target_type: 'family' })
    expect(JSON.stringify(rows[0])).not.toContain(inviteCode)
    expect(JSON.stringify(rows[0])).not.toContain('invitea1')
  })

  it.each(['teenA', 'childA', 'childB'] as UserKey[])('%s cannot get a new code (403, nothing written)', async (as) => {
    const res = await rotate(req({ as, method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(403)
    expect(writesTo('family')).toHaveLength(0)
    expect(codeOf(FAMILY_A)).toBe('invitea1')
    expect(codeOf(FAMILY_B)).toBe('inviteb1')
  })

  it('parent B changes only family B; unauthenticated is 401; no household is 400', async () => {
    const res = await rotate(req({ as: 'parentB', method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(200)
    expect(codeOf(FAMILY_A)).toBe('invitea1')
    expect(codeOf(FAMILY_B)).not.toBe('inviteb1')
    expect((await rotate(req({ as: null, method: 'POST' }))).status).toBe(401)
    expect((await rotate(req({ as: 'loner', method: 'POST' }))).status).toBe(400)
  })

  it('GET /api/family still shows the current code to parents only', async () => {
    const { inviteCode } = await bodyOf(await rotate(req({ as: 'parentA', method: 'POST' })))
    expect((await bodyOf(await getFamily(req({ as: 'parentA' })))).family.invite_code).toBe(inviteCode)
    expect((await bodyOf(await getFamily(req({ as: 'teenA' })))).family.invite_code).toBeNull()
  })
})

describe('DELETE /api/family/members/[id]', () => {
  it('a parent removes a child: detached, sessions revoked, household content kept', async () => {
    db.rows('notification').push({ id: 'notif-child', user_id: 'child-a', title: 'Home chore', message: 'x', type: 'chore', read: false, created_at: new Date() })
    db.rows('chore').push({ ...db.find('chore', 'chore-a')!, id: 'chore-a-done', status: 'verified' })
    const res = await del('parentA', 'child-a')
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toEqual({ success: true, removedId: 'child-a', tabletsRevoked: 0 })

    const child = db.find('user', 'child-a')!
    expect(child.family_id).toBeNull()
    expect(child.token_version).toBe(1)
    // The account is kept.
    expect(db.find('user', 'child-a')).toBeDefined()
    // Open chore handed to the removing parent; finished chore keeps its history.
    expect(db.find('chore', 'chore-a')).toMatchObject({ family_id: FAMILY_A, assigned_to: 'parent-a' })
    expect(db.find('chore', 'chore-a-done')).toMatchObject({ assigned_to: 'child-a', status: 'verified' })
    // Rows read by user id alone are gone; household rows about them stay.
    expect(db.find('notification', 'notif-child')).toBeUndefined()
    expect(db.find('sickDay', 'sick-a')).toBeDefined()
    expect(db.find('projectTask', 'task-a')!.assigned_to).toBeNull()
    // Family B untouched.
    expect(db.find('user', 'child-b')!.family_id).toBe(FAMILY_B)
    expect(db.find('chore', 'chore-b')!.assigned_to).toBe('child-b')

    const removed = auditRows('member.removed')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({
      family_id: FAMILY_A,
      actor_user_id: 'parent-a',
      target_id: 'child-a',
      summary: 'Removed Child A (a child) from the household',
    })
  })

  it("the removed member's existing session stops working, and they no longer reach the household", async () => {
    const before = await resolveSession({ userId: 'child-a', email: 'child-a@example.test', role: 'child', family_id: FAMILY_A, tv: 0 } as any)
    expect(before).not.toBeNull()
    expect((await del('parentA', 'child-a')).status).toBe(200)
    const after = await resolveSession({ userId: 'child-a', email: 'child-a@example.test', role: 'child', family_id: FAMILY_A, tv: 0 } as any)
    expect(after).toBeNull()
    // Even a fresh session (new tv) has no household.
    expect((await getFamily(req({ as: 'childA' }))).status).toBe(400)
  })

  it.each([
    ['teenA', 'child-a'],
    ['childA', 'teen-a'],
    ['teenA', 'parent-a'],
    ['childB', 'parent-b'],
  ] as Array<[UserKey, string]>)('%s cannot remove anyone (403, nothing written)', async (as, target) => {
    const res = await del(as, target)
    expect(res.status).toBe(403)
    expect(writesTo('user')).toHaveLength(0)
    expect(db.find('user', target)!.family_id).not.toBeNull()
  })

  it.each([
    ['parentA', 'parent-b'],
    ['parentA', 'child-b'],
    ['parentB', 'child-a'],
    ['parentB', 'parent-a'],
    ['parentA', 'no-such-user'],
    ['parentA', 'loner'],
  ] as Array<[UserKey, string]>)('%s cannot remove %s from another (or no) household: 404, no data', async (as, target) => {
    const res = await del(as, target)
    await expectDenied(res, [404])
    expect((await bodyOf(res)).code).toBe('MEMBER_NOT_FOUND')
    expect(writesTo('user')).toHaveLength(0)
    expect(auditRows('member.removed')).toHaveLength(0)
  })

  it('a parent cannot remove themselves (400 CANNOT_REMOVE_SELF)', async () => {
    const res = await del('parentA', 'parent-a')
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).code).toBe('CANNOT_REMOVE_SELF')
    expect(db.find('user', 'parent-a')!.family_id).toBe(FAMILY_A)
  })

  it('a parent may remove another parent; the removed parent then cannot act on the household', async () => {
    addMember('parent-a2', 'Parent Two', 'parent')
    expect((await del('parentA', 'parent-a2')).status).toBe(200)
    expect(db.find('user', 'parent-a2')).toMatchObject({ family_id: null, token_version: 1 })
    // Even signed in again, the removed co-parent cannot act on household A.
    await expect(
      removeHouseholdMember({ actorId: 'parent-a2', familyId: FAMILY_A, targetId: 'child-a' })
    ).rejects.toMatchObject({ code: 'NOT_A_PARENT', status: 403 })
  })

  it('never leaves a household without a parent (409 LAST_PARENT)', async () => {
    addMember('parent-a2', 'Parent Two', 'parent')
    // Simulate the race: by the time the locks are held, no other parent remains.
    jest.spyOn(fakePrisma.user, 'count').mockResolvedValueOnce(0)
    await expect(
      removeHouseholdMember({ actorId: 'parent-a', familyId: FAMILY_A, targetId: 'parent-a2' })
    ).rejects.toMatchObject({ code: 'LAST_PARENT', status: 409 })
    expect(db.find('user', 'parent-a2')!.family_id).toBe(FAMILY_A)
  })

  it('an actor who is no longer a parent of the household is refused under the lock', async () => {
    await expect(
      removeHouseholdMember({ actorId: 'teen-a', familyId: FAMILY_A, targetId: 'child-a' })
    ).rejects.toMatchObject({ code: 'NOT_A_PARENT', status: 403 })
    await expect(
      removeHouseholdMember({ actorId: 'parent-b', familyId: FAMILY_A, targetId: 'child-a' })
    ).rejects.toMatchObject({ code: 'NOT_A_PARENT', status: 403 })
    expect(db.find('user', 'child-a')!.family_id).toBe(FAMILY_A)
  })

  it("revokes tablets the removed parent paired, their elevation, PIN and pending invites", async () => {
    addMember('parent-a2', 'Parent Two', 'parent')
    db.rows('householdDevice').push(
      { id: 'dev-a2', family_id: FAMILY_A, label: 'Kitchen', platform: 'android', created_by: 'parent-a2', confirmed_by: 'parent-a2', revoked_at: null, elevated_user_id: null },
      { id: 'dev-a1', family_id: FAMILY_A, label: 'Hall', platform: 'android', created_by: 'parent-a', confirmed_by: 'parent-a', revoked_at: null, elevated_user_id: 'parent-a2', elevation_token_hash: 'h' },
      { id: 'dev-b', family_id: FAMILY_B, label: `${FOREIGN} tablet`, platform: 'android', created_by: 'parent-b', confirmed_by: 'parent-b', revoked_at: null }
    )
    db.rows('deviceSession').push(
      { id: 'ds-a2', device_id: 'dev-a2', revoked_at: null },
      { id: 'ds-a1', device_id: 'dev-a1', revoked_at: null }
    )
    db.rows('parentElevationPin').push({ id: 'pin-a2', user_id: 'parent-a2', family_id: FAMILY_A })
    db.rows('familyInvite').push({ ...db.find('familyInvite', 'invite-a')!, id: 'invite-a2', created_by: 'parent-a2' })

    const res = await del('parentA', 'parent-a2')
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).tabletsRevoked).toBe(1)

    expect(db.find('householdDevice', 'dev-a2')).toMatchObject({ revoke_reason: 'parent', revoked_by: 'parent-a', created_by: null })
    expect(db.find('householdDevice', 'dev-a2')!.revoked_at).toBeInstanceOf(Date)
    expect(db.find('deviceSession', 'ds-a2')!.revoked_at).toBeInstanceOf(Date)
    // The other parent's tablet stays paired, but the removed parent's elevation on it is gone.
    expect(db.find('householdDevice', 'dev-a1')).toMatchObject({ revoked_at: null, elevated_user_id: null, elevation_token_hash: null })
    expect(db.find('deviceSession', 'ds-a1')!.revoked_at).toBeNull()
    expect(db.find('householdDevice', 'dev-b')!.revoked_at).toBeNull()
    expect(db.find('parentElevationPin', 'pin-a2')).toBeUndefined()
    expect(db.find('familyInvite', 'invite-a2')).toBeUndefined()
    expect(db.find('familyInvite', 'invite-a')).toBeDefined()

    const tabletLines = auditRows('device.removed')
    expect(tabletLines).toHaveLength(1)
    expect(tabletLines[0]).toMatchObject({ target_id: 'dev-a2', actor_user_id: 'parent-a' })
  })

  it('hands household content the removed member created to the removing parent', async () => {
    addMember('parent-a2', 'Parent Two', 'parent')
    db.find('event', 'event-a')!.created_by = 'parent-a2'
    db.find('list', 'list-a')!.created_by = 'parent-a2'
    db.find('transaction', 'txn-a')!.user_id = 'parent-a2'
    expect((await del('parentA', 'parent-a2')).status).toBe(200)
    expect(db.find('event', 'event-a')).toMatchObject({ family_id: FAMILY_A, created_by: 'parent-a' })
    expect(db.find('list', 'list-a')).toMatchObject({ family_id: FAMILY_A, created_by: 'parent-a' })
    expect(db.find('transaction', 'txn-a')).toMatchObject({ family_id: FAMILY_A, user_id: 'parent-a' })
    expect(db.find('event', 'event-b')!.created_by).toBe('parent-b')
  })

  it('a removed member can join again only with the current code', async () => {
    const { inviteCode } = await bodyOf(await rotate(req({ as: 'parentA', method: 'POST' })))
    expect((await del('parentA', 'teen-a')).status).toBe(200)
    expect((await join(req({ as: 'teenA', method: 'POST', body: { inviteCode: 'INVITEA1' } }))).status).toBe(404)
    expect(db.find('user', 'teen-a')!.family_id).toBeNull()
    expect((await join(req({ as: 'teenA', method: 'POST', body: { inviteCode } }))).status).toBe(200)
  })
})
