import { NextRequest } from 'next/server'

// Shared kid-access rules.
//
// IMPORTANT: this is the single source of truth for which /dashboard routes a
// child or teen may reach. The edge middleware (src/middleware.ts) imports it,
// and the dashboard layout (src/app/dashboard/layout.tsx) uses it too. Keeping
// one list means the two gates can never disagree.
//
// History: the layout previously tried to gate this itself by reading
// `x-pathname` / `x-invoke-path` headers. Next.js never sends those to layouts,
// so the check always fell through and the gate never fired. It is now driven by
// this list instead.

export const KID_ALLOWED_PREFIXES = [
  // Their own wishlist — harmless, and how they engage with the app.
  '/dashboard/wishlist',
  // Emergency and medical info. Deliberately kid-accessible: a child home alone
  // in an emergency must be able to find the contacts and medical details.
  '/dashboard/emergency',
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
