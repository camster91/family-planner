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
    expect(filterNavForRole(NAV, role).map((i) => i.label)).toEqual(['Today', 'Lists', 'Emergency', 'Wishlist'])
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

describe('kid allowlist after the #102 decisions', () => {
  it.each([
    '/dashboard/lists',
    '/dashboard/lists/fx_list_a_grocery',
    '/dashboard/lists/type/grocery',
    '/dashboard/allowance',
    '/dashboard/handoff',
    '/dashboard/sick-days',
    '/dashboard/emergency',
    '/dashboard/wishlist',
    '/dashboard/today',
  ])('lets a kid open %s', (path) => {
    expect(canRoleAccessPath('child', path)).toBe(true)
    expect(canRoleAccessPath('teen', path)).toBe(true)
  })

  it.each([
    '/dashboard/budget',
    '/dashboard/locations',
    '/dashboard/travel',
    '/dashboard/settings',
    '/dashboard/calendar',
    '/dashboard/chores',
    '/dashboard/family',
    '/dashboard/listsx',
    '/dashboard/todayx',
  ])('still sends a kid away from %s', (path) => {
    expect(canRoleAccessPath('child', path)).toBe(false)
  })

  // Shared-tablet management and the tablet PIN are parent-only (#241,
  // SHARED_DEVICE.md §7): no kid prefix may ever cover them.
  it.each(['/dashboard/settings/devices', '/dashboard/settings/devices/x'])(
    'keeps teens and children out of %s',
    (path) => {
      expect(canRoleAccessPath('child', path)).toBe(false)
      expect(canRoleAccessPath('teen', path)).toBe(false)
      expect(canRoleAccessPath('parent', path)).toBe(true)
    }
  )
})
