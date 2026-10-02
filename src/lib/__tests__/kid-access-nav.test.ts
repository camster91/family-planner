import {
  KID_ALLOWED_PREFIXES,
  TEEN_EXACT_PATHS,
  TEEN_EXTRA_PREFIXES,
  canRoleAccessPath,
  filterNavForRole,
  isKidAllowedPath,
} from '../kid-access'

const NAV = [
  { href: '/dashboard', label: 'Today' },
  { href: '/dashboard/calendar', label: 'Calendar' },
  { href: '/dashboard/lists', label: 'Lists' },
  { href: '/dashboard/emergency', label: 'Emergency' },
  { href: '/dashboard/family', label: 'Family' },
  { href: '/dashboard/wishlist', label: 'Wishlist' },
  { href: '/dashboard/meals', label: 'Meals' },
  { href: '/dashboard/settings', label: 'Settings' },
  { href: '/dashboard/help', label: 'Help' },
  { href: '/dashboard/notifications', label: 'Notifications' },
  { href: '/dashboard/features', label: 'Features' },
]

describe('nav filtering by role (same allowlist as the middleware redirect)', () => {
  it('shows every link to a parent', () => {
    expect(filterNavForRole(NAV, 'parent')).toEqual(NAV)
  })

  it('shows a child only home and kid-allowlisted links', () => {
    expect(filterNavForRole(NAV, 'child').map((i) => i.label)).toEqual(['Today', 'Lists', 'Emergency', 'Wishlist'])
  })

  it('shows a teen the kid links plus calendar, meals, settings, help and notifications (O-37)', () => {
    expect(filterNavForRole(NAV, 'teen').map((i) => i.label)).toEqual([
      'Today',
      'Calendar',
      'Lists',
      'Emergency',
      'Wishlist',
      'Meals',
      'Settings',
      'Help',
      'Notifications',
    ])
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
    '/dashboard/inventory',
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
    '/dashboard/inventoryx',
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

describe('teen routes (owner decision O-37)', () => {
  it('the teen lists are exactly the decided routes, and the child list is unchanged', () => {
    expect([...TEEN_EXTRA_PREFIXES]).toEqual(['/dashboard/meals', '/dashboard/help', '/dashboard/notifications'])
    expect([...TEEN_EXACT_PATHS]).toEqual(['/dashboard/calendar', '/dashboard/calendar/create', '/dashboard/settings'])
    expect(KID_ALLOWED_PREFIXES).not.toContain('/dashboard/calendar')
    expect(KID_ALLOWED_PREFIXES).not.toContain('/dashboard/settings')
  })

  it.each([
    '/dashboard/calendar',
    '/dashboard/calendar/',
    '/dashboard/calendar/create',
    '/dashboard/meals',
    '/dashboard/meals/recipes/r1',
    '/dashboard/help',
    '/dashboard/notifications',
    '/dashboard/settings',
    '/dashboard/settings/',
  ])('lets a teen, not a child, open %s', (path) => {
    expect(canRoleAccessPath('teen', path)).toBe(true)
    expect(canRoleAccessPath('child', path)).toBe(false)
    expect(canRoleAccessPath('parent', path)).toBe(true)
  })

  // Family-level pages stay parent-only: every Settings sub-route that exists
  // under src/app/dashboard/settings, the Features page, Family (including its
  // Today board settings), event editing, search, chores and finance.
  it.each([
    '/dashboard/settings/devices',
    '/dashboard/settings/devices/x',
    '/dashboard/settings/activity',
    '/dashboard/settings/imports',
    '/dashboard/settings/anything-new',
    '/dashboard/settingsx',
    '/dashboard/features',
    '/dashboard/family',
    '/dashboard/family/settings',
    '/dashboard/family/invite',
    '/dashboard/family/more',
    '/dashboard/calendar/edit',
    '/dashboard/calendarx',
    '/dashboard/mealsx',
    '/dashboard/helpx',
    '/dashboard/search',
    '/dashboard/chores',
    '/dashboard/budget',
    '/dashboard/locations',
    '/dashboard/travel',
    '/dashboard/notes',
  ])('keeps teens and children out of %s', (path) => {
    expect(canRoleAccessPath('teen', path)).toBe(false)
    expect(canRoleAccessPath('child', path)).toBe(false)
    expect(canRoleAccessPath('parent', path)).toBe(true)
  })
})
