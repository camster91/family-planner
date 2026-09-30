import { loginNoticeFor, safeRedirectPath } from '@/lib/safe-redirect'

describe('safeRedirectPath', () => {
  it.each(['/dashboard', '/join?code=ABC', '/dashboard/lists?type=grocery#top'])('keeps the in-app path %p', (p) => {
    expect(safeRedirectPath(p)).toBe(p)
  })

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/',
    '//evil.example/path',
    '/\\evil.example',
    'javascript:alert(1)',
    '/dash\nboard',
    '/' + 'a'.repeat(3000),
  ])('refuses %p', (p) => {
    expect(safeRedirectPath(p as string | null | undefined)).toBeNull()
  })
})

describe('loginNoticeFor', () => {
  it('confirms a verified email', () => {
    expect(loginNoticeFor(new URLSearchParams('verified=1'))?.kind).toBe('success')
  })

  it.each(['invalid_token', 'missing_token', 'server'])('explains error=%s', (code) => {
    const notice = loginNoticeFor(new URLSearchParams(`error=${code}`))
    expect(notice?.kind).toBe('error')
    expect(notice?.text.length).toBeGreaterThan(10)
  })

  it('an already-used link tells the person they can just sign in', () => {
    expect(loginNoticeFor(new URLSearchParams('error=invalid_token'))?.text).toMatch(/already verified, just sign in/i)
  })

  it('says nothing otherwise', () => {
    expect(loginNoticeFor(new URLSearchParams(''))).toBeNull()
    expect(loginNoticeFor(new URLSearchParams('error=<script>'))).toBeNull()
  })
})
