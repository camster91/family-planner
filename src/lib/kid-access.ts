// Shared kid-access rules.
//
// IMPORTANT: this is the single source of truth for which /dashboard routes a
// child or teen may reach. Children get KID_ALLOWED_PREFIXES; teens get that
// list plus the teen-only routes below (owner decision O-37, 2026-10-02). The
// edge middleware (src/middleware.ts) imports it, and the dashboard layout (src/app/dashboard/layout.tsx) uses it too. Keeping
// one list means the two gates can never disagree. The nav (DashboardNav,
// TabBar, CommandPalette) filters its links with canRoleAccessPath so a kid is
// never shown a link that would only bounce them home.
//
// History: the layout previously tried to gate this itself by reading
// `x-pathname` / `x-invoke-path` headers. Next.js never sends those to layouts,
// so the check always fell through and the gate never fired. It is now driven by
// this list instead.

// Deliberately absent: /dashboard/settings and everything under it, including
// shared-tablet management at /dashboard/settings/devices and the Tablet PIN
// (#241, SHARED_DEVICE.md §7). Children never open Settings; teens open only
// the Settings page itself (TEEN_EXACT_PATHS below), never a sub-route.
export const KID_ALLOWED_PREFIXES = [
  // Their own wishlist — harmless, and how they engage with the app.
  '/dashboard/wishlist',
  // Emergency and medical info. Deliberately kid-accessible: a child home alone
  // in an emergency must be able to find the contacts and medical details.
  // Read-only for teens and children (D1, #102).
  '/dashboard/emergency',
  // Shared lists (D9, #102): every member may add and tick items. Parents and
  // teens may create a list; deleting a list or an item is parent-only. The
  // API enforces each rule; the pages hide the controls a role cannot use.
  '/dashboard/lists',
  // Their own allowance, read-only (D5, #102). The API returns only rows paid
  // to the caller and refuses POST/PATCH.
  '/dashboard/allowance',
  // Sitter handoff, read-only (D2, #102). Teens see the full handoff; children
  // see only the sitter's name and arrival/departure times.
  '/dashboard/handoff',
  // Their own sick days and medications (D1, #102): report themselves sick and
  // log a dose of their own medication. Everything else stays with parents.
  '/dashboard/sick-days',
  // Today board (#119 / #159): the shared household view for the fridge
  // tablet. It reads only shared-surface fields every member may already read
  // (schedule, chores, dinner, groceries); see
  // src/app/dashboard/today/today-board-data.ts.
  '/dashboard/today',
  // Food inventory (#263): teens add, edit and remove items; children read
  // (what's in the fridge, what to use soon, what we can cook). The API
  // enforces the roles and the page hides the controls a child cannot use.
  // Gated by the `inventory` feature like every other gated page.
  '/dashboard/inventory',
] as const

// Teen-only routes (owner decision O-37, 2026-10-02): teens may see the family
// calendar and meals, read Help, see their own notifications and use their own
// Settings. Children are unchanged. Family-level settings stay parent-only.
//
// Prefixes: the route and everything under it.
export const TEEN_EXTRA_PREFIXES = [
  // Meals and recipe pages. The meals API lets every role read, add, edit and
  // delete a meal; the recipes API lets teens add and edit (not delete) a
  // recipe. The recipe page is read-only apart from "Add to groceries".
  '/dashboard/meals',
  // Static help text and links, no household data (#146).
  '/dashboard/help',
  // Their own notifications; the API only ever returns the caller's rows.
  '/dashboard/notifications',
] as const

// Exact paths only: nothing below them.
export const TEEN_EXACT_PATHS = [
  // The calendar month view and "Add event" (POST /api/events is open to every
  // member). /dashboard/calendar/edit is NOT here: editing and deleting an
  // event are parent-only in the API, so the page would only fail.
  '/dashboard/calendar',
  '/dashboard/calendar/create',
  // The Settings page itself, which shows a teen only their personal sections
  // (src/app/dashboard/settings/page.tsx). Every sub-route (devices, activity,
  // imports, ...) and /dashboard/features stay parent-only.
  '/dashboard/settings',
] as const

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))
}

/** Whether a teen may open `pathname` beyond the shared kid allowlist. */
export function isTeenExtraPath(pathname: string): boolean {
  return (
    matchesPrefix(pathname, TEEN_EXTRA_PREFIXES) ||
    (TEEN_EXACT_PATHS as readonly string[]).includes(stripTrailingSlash(pathname))
  )
}

export function isKidAllowedPath(pathname: string): boolean {
  return KID_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  )
}

export function isDashboardRoot(pathname: string): boolean {
  return pathname === '/dashboard' || pathname === '/dashboard/'
}

export function isKidRole(role: string | undefined | null): boolean {
  return role === 'child' || role === 'teen'
}

/**
 * Whether a user with `role` may reach `pathname`. The middleware redirect,
 * the dashboard layout gate and every nav filter call this one function.
 */
export function canRoleAccessPath(role: string | undefined | null, pathname: string): boolean {
  if (!isKidRole(role)) return true
  if (isDashboardRoot(pathname) || isKidAllowedPath(pathname)) return true
  return role === 'teen' && isTeenExtraPath(pathname)
}

/** Drop nav links the role would be redirected away from. */
export function filterNavForRole<T extends { href: string }>(
  items: readonly T[],
  role: string | undefined | null
): T[] {
  return items.filter((item) => canRoleAccessPath(role, item.href))
}
