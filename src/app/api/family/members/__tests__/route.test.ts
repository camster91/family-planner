jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/supabase/server', () => ({ getServerUser: jest.fn() }))

import { GET } from '../route'
import { getServerUser } from '@/lib/supabase/server'
import { db, expectNoForeignData } from '@/__tests__/helpers/two-household'

const mockGetServerUser = getServerUser as jest.Mock

beforeEach(() => {
  db.reset()
  jest.clearAllMocks()
})

describe('GET /api/family/members', () => {
  it('returns same-household email addresses to a parent for the Family page', async () => {
    mockGetServerUser.mockResolvedValue({ id: 'parent-a', role: 'parent', family_id: 'family-A' })

    const body = await expectNoForeignData(await GET())

    expect(body.members).toHaveLength(3)
    expect(body.members.every((member: any) => typeof member.email === 'string')).toBe(true)
    expect(body.members.map((member: any) => member.email).sort()).toEqual([
      'child-a@example.test',
      'parent-a@example.test',
      'teen-a@example.test',
    ])
  })

  it.each([
    ['teen', 'teen-a'],
    ['child', 'child-a'],
  ])('does not expose member email addresses to a %s caller', async (_role, id) => {
    mockGetServerUser.mockResolvedValue({ id, role: _role, family_id: 'family-A' })

    const body = await expectNoForeignData(await GET())

    expect(body.members).toHaveLength(3)
    expect(body.members.every((member: any) => !('email' in member))).toBe(true)
  })

  it('returns 401 without a current session', async () => {
    mockGetServerUser.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(db.writes).toHaveLength(0)
  })
})
