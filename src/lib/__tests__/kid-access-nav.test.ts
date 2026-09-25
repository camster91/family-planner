import { canRoleAccessPath, filterNavForRole, isKidAllowedPath } from '../kid-access'

const NAV = [
  { href: '/dashboard', label: 'Today' },
  { href: '/dashboard/calendar', label: 'Calendar' },
  { href: '/dashboard/lists', label: 'Lists' },
  { href: '/dashboard/emergency', label: 'Emergency' },
  { href: '/dashboard/family', label: 'Family' },
  { href: '/dashboard/wishlist', label: 'Wishlist' },
]

describe('nav filtering by role (same allowlist as the middleware redirect)', () => {
  it('shows every link to a parent', () => {
    expect(filterNavForRole(NAV, 'parent')).toEqual(NAV)
  })

  it.each(['child', 'teen'])('shows a %s only home and kid-allowlisted links', (role) => {
    expect(filterNavForRole(NAV, role).map((i) => i.label)).toEqual(['Today', 'Emergency', 'Wishlist'])
  })

  it('agrees with the redirect rule for every link', () => {
    for (const item of NAV) {
      const expected = item.href === '/dashboard' || isKidAllowedPath(item.href)
      expect(canRoleAccessPath('child', item.href)).toBe(expected)
    }
  })

  it('does not restrict an unknown/missing role (the server gate still applies)', () => {
    expect(canRoleAccessPath(undefined, '/dashboard/calendar')).toBe(true)
  })
})
