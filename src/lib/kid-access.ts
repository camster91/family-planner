// Shared kid-access rules.
//
// IMPORTANT: this is the single source of truth for which /dashboard routes a
// child or teen may reach. The edge middleware (src/middleware.ts) imports it,
// and the dashboard layout (src/app/dashboard/layout.tsx) uses it too. Keeping
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
// (#241, SHARED_DEVICE.md §7). Teens and children must never see those.
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
] as const

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

/** Whether a user with `role` may reach `pathname` (same rule as the middleware redirect). */
export function canRoleAccessPath(role: string | undefined | null, pathname: string): boolean {
  if (!isKidRole(role)) return true
  return isDashboardRoot(pathname) || isKidAllowedPath(pathname)
}

/** Drop nav links the role would be redirected away from. */
export function filterNavForRole<T extends { href: string }>(
  items: readonly T[],
  role: string | undefined | null
): T[] {
  return items.filter((item) => canRoleAccessPath(role, item.href))
}
