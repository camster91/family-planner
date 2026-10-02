// Short family codes: a new 12-character code typed the way it is shown
// (XXXX-XXXX-XXXX, any case, spaces) joins and looks up; every older stored
// code (24-character O-34 codes, pre-O-34 cuids) keeps working; creating or
// rotating a code retries on a unique collision.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/rate-limit-db', () => require('@/__tests__/helpers/two-household').rateLimitMock)

import { POST as rotate } from '../invite-code/route'
import { POST as join } from '../join/route'
import { GET as lookup } from '../lookup/route'
import { POST as createFamily } from '../route'
import { FAMILY_CODE_LENGTH, formatFamilyCode } from '@/lib/family-invite'
import { FAMILY_A, bodyOf, db, fakePrisma, req } from '@/__tests__/helpers/two-household'

const OLD_O34_CODE = 'usm7ghmbcypks2c29m9mdeha'
const OLD_CUID_CODE = 'clx0o1l9abcdefghijk012345'

function codeOf(familyId: string): string {
  return db.find('family', familyId)!.invite_code
}

function setCode(familyId: string, code: string) {
  db.find('family', familyId)!.invite_code = code
}

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`invite_code`)'), { code: 'P2002' })
}

beforeEach(() => {
  db.reset()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('joining with a new 12-character code', () => {
  async function newCode(): Promise<string> {
    const res = await rotate(req({ as: 'parentA', method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(200)
    const { inviteCode } = await bodyOf(res)
    expect(inviteCode).toHaveLength(FAMILY_CODE_LENGTH)
    expect(codeOf(FAMILY_A)).toBe(inviteCode)
    return inviteCode
  }

  it('the displayed XXXX-XXXX-XXXX form looks up and joins', async () => {
    const shown = formatFamilyCode(await newCode())
    expect(shown).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    const found = await lookup(req({ as: 'loner', path: '/api/family/lookup', query: { code: shown } }))
    expect(found.status).toBe(200)
    expect((await bodyOf(found)).family).toMatchObject({ id: FAMILY_A })

    const res = await join(req({ as: 'loner', method: 'POST', body: { inviteCode: shown } }))
    expect(res.status).toBe(200)
    expect(db.find('user', 'loner')).toMatchObject({ family_id: FAMILY_A, role: 'child' })
  })

  it('lowercase with spaces, and stray outer whitespace, also join', async () => {
    const code = await newCode()
    const typed = `  ${code.slice(0, 4)} ${code.slice(4, 8)}  ${code.slice(8)} `
    const res = await join(req({ as: 'loner', method: 'POST', body: { inviteCode: typed } }))
    expect(res.status).toBe(200)
  })

  it('a wrong code is still 404 and joins nothing', async () => {
    await newCode()
    const res = await join(req({ as: 'loner', method: 'POST', body: { inviteCode: 'ZZZZ-ZZZZ-ZZZZ' } }))
    expect(res.status).toBe(404)
    expect(db.find('user', 'loner')!.family_id).toBeNull()
  })
})

describe('older stored codes keep working (never rewritten)', () => {
  it.each([
    ['24-character O-34 code', OLD_O34_CODE],
    ['pre-O-34 cuid', OLD_CUID_CODE],
  ])('%s joins as stored, grouped as shown, and in capitals', async (_label, stored) => {
    setCode(FAMILY_A, stored)
    for (const typed of [stored, formatFamilyCode(stored), stored.toUpperCase()]) {
      const found = await lookup(req({ as: 'loner', path: '/api/family/lookup', query: { code: typed } }))
      expect(found.status).toBe(200)
    }
    const res = await join(req({ as: 'loner', method: 'POST', body: { inviteCode: formatFamilyCode(stored) } }))
    expect(res.status).toBe(200)
    expect(db.find('user', 'loner')!.family_id).toBe(FAMILY_A)
    // Joining reads the code; it never changes it.
    expect(codeOf(FAMILY_A)).toBe(stored)
  })

  it('a cuid look-alike is not remapped: o for 0 does not match', async () => {
    setCode(FAMILY_A, OLD_CUID_CODE)
    const wrong = OLD_CUID_CODE.replace('0', 'o')
    const res = await join(req({ as: 'loner', method: 'POST', body: { inviteCode: wrong } }))
    expect(res.status).toBe(404)
  })
})

describe('unique collisions on a new code', () => {
  it('"Get a new family code" retries with a fresh code after a collision', async () => {
    const real = fakePrisma.family.updateMany
    const spy = jest.spyOn(fakePrisma.family, 'updateMany').mockImplementationOnce(async () => {
      throw p2002()
    })
    spy.mockImplementation(real)
    const res = await rotate(req({ as: 'parentA', method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
    const { inviteCode } = await bodyOf(res)
    expect(codeOf(FAMILY_A)).toBe(inviteCode)
    expect(db.rows('auditLog').filter((r) => r.action === 'invite_code.rotated')).toHaveLength(1)
  })

  it('"Get a new family code" gives up with a clear 503 after repeated collisions', async () => {
    const spy = jest.spyOn(fakePrisma.family, 'updateMany').mockImplementation(async () => {
      throw p2002()
    })
    const res = await rotate(req({ as: 'parentA', method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(503)
    expect(await bodyOf(res)).toEqual({ error: 'Could not make a new code. Try again.' })
    expect(spy).toHaveBeenCalledTimes(5)
    expect(codeOf(FAMILY_A)).toBe('invitea1')
  })

  it('a non-collision error is not retried', async () => {
    const spy = jest.spyOn(fakePrisma.family, 'updateMany').mockImplementation(async () => {
      throw new Error('connection lost')
    })
    const res = await rotate(req({ as: 'parentA', method: 'POST', path: '/api/family/invite-code' }))
    expect(res.status).toBe(500)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('creating a household retries with a fresh code after a collision', async () => {
    const real = fakePrisma.family.create
    const spy = jest.spyOn(fakePrisma.family, 'create').mockImplementationOnce(async () => {
      throw p2002()
    })
    spy.mockImplementation(real)
    const res = await createFamily(req({ as: 'loner', method: 'POST', path: '/api/family', body: { name: 'New Home' } }))
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalledTimes(2)
    const { family } = await bodyOf(res)
    expect(family.invite_code).toMatch(/^[a-hjkmnp-z2-9]{12}$/)
    expect(db.find('user', 'loner')).toMatchObject({ family_id: family.id, role: 'parent' })
  })

  it('creating a household gives up with a clear 503 after repeated collisions', async () => {
    const spy = jest.spyOn(fakePrisma.family, 'create').mockImplementation(async () => {
      throw p2002()
    })
    const res = await createFamily(req({ as: 'loner', method: 'POST', path: '/api/family', body: { name: 'New Home' } }))
    expect(res.status).toBe(503)
    expect(await bodyOf(res)).toEqual({ error: 'Could not make a family code. Please try again.' })
    expect(spy).toHaveBeenCalledTimes(5)
    expect(db.find('user', 'loner')!.family_id).toBeNull()
  })
})
