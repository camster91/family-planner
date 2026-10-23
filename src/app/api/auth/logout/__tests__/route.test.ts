// Logout revokes the session generation (token_version), not just the cookie.

const mockVerifySessionToken = jest.fn()
const mockUserUpdateMany = jest.fn()

jest.mock('next/server', () => {
  class MockNextResponse {
    body: unknown
    status: number
    cookieWrites: Array<{ name: string; value: string; options: Record<string, unknown> }> = []
    cookies = {
      set: (name: string, value: string, options: Record<string, unknown>) => {
        this.cookieWrites.push({ name, value, options })
      },
    }
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init)
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} }
})
jest.mock('@/lib/session', () => ({
  verifySessionToken: (token: string) => mockVerifySessionToken(token),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { updateMany: (args: unknown) => mockUserUpdateMany(args) } },
}))

import { POST } from '../route'

function request(token?: string): any {
  return {
    cookies: { get: (name: string) => (name === 'session_token' && token ? { value: token } : undefined) },
  }
}

function expectCookieCleared(res: any, retirement?: { mode: string; ownerId: string; throughGeneration: number }) {
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ success: true, ...(retirement ? { retirement } : {}) })
  expect(res.cookieWrites).toEqual([
    expect.objectContaining({ name: 'session_token', value: '', options: expect.objectContaining({ maxAge: 0, path: '/' }) }),
  ])
}

beforeEach(() => {
  mockVerifySessionToken.mockReset()
  mockUserUpdateMany.mockReset()
})

describe('POST /api/auth/logout', () => {
  it('bumps token_version for the signed-in user and clears the cookie', async () => {
    mockVerifySessionToken.mockResolvedValue({ userId: 'user-1', email: 'e', tv: 3 })
    mockUserUpdateMany.mockResolvedValue({ count: 1 })

    const res = await POST(request('live-token'))

    expect(mockVerifySessionToken).toHaveBeenCalledWith('live-token')
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', token_version: 3 },
      data: { token_version: { increment: 1 } },
    })
    expectCookieCleared(res, { mode: 'generation', ownerId: 'user-1', throughGeneration: 3 })
  })

  it('clears the old browser cookie without retiring a newer session generation', async () => {
    mockVerifySessionToken.mockResolvedValue({ userId: 'user-1', email: 'e', tv: 3 })
    // Another session rotated after verification. The conditional update loses.
    mockUserUpdateMany.mockResolvedValue({ count: 0 })
    const res = await POST(request('racing-token'))
    expect(mockUserUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', token_version: 3 },
      data: { token_version: { increment: 1 } },
    })
    expectCookieCleared(res)
  })

  it('returns 200 and clears the cookie when there is no session cookie', async () => {
    const res = await POST(request())
    expect(mockVerifySessionToken).not.toHaveBeenCalled()
    expect(mockUserUpdateMany).not.toHaveBeenCalled()
    expectCookieCleared(res)
  })

  it('does not bump the generation for an invalid or already-revoked token', async () => {
    mockVerifySessionToken.mockResolvedValue(null)
    const res = await POST(request('stale-token'))
    expect(mockUserUpdateMany).not.toHaveBeenCalled()
    expectCookieCleared(res)
  })

  it('still signs the browser out when revocation fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockVerifySessionToken.mockResolvedValue({ userId: 'user-1', email: 'e', tv: 0 })
    mockUserUpdateMany.mockRejectedValue(new Error('db down'))
    const res = await POST(request('live-token'))
    expectCookieCleared(res)
    spy.mockRestore()
  })
})
