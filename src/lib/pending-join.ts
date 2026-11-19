/**
 * Keeps a family code through sign-up (register -> verify email -> sign in).
 *
 * A signed-out person who enters a code on /join and chooses "Create an
 * account" carries `?redirect=/join?code=...` through the auth pages, using
 * the same same-origin redirect the sign-in page already honours
 * (src/lib/safe-redirect.ts). The emailed verification link may open in a new
 * tab, so the return path is also kept in this browser's own storage for a
 * short time. It never goes into the email, a URL on another origin, or the
 * server: only a same-origin `/join?code=...` path is accepted and stored.
 */
import { safeRedirectPath } from './safe-redirect'

const STORAGE_KEY = 'fp:pending-join'
/** Verification links last 24 hours; keep the code a little longer, no more. */
const MAX_AGE_MS = 48 * 60 * 60 * 1000

/** `/join?code=...` for a typed family code (trimmed, URL-encoded). */
export function joinReturnPath(code: string): string {
  return `/join?code=${encodeURIComponent(code.trim())}`
}

/**
 * The join return path in `raw`, or null. Only an in-app `/join?code=...`
 * path qualifies, so nothing else is ever stored or carried by this module.
 */
export function pendingJoinPath(raw: string | null | undefined): string | null {
  const safe = safeRedirectPath(raw)
  if (!safe) return null
  let url: URL
  try {
    url = new URL(safe, 'https://herewoven.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://herewoven.invalid' || url.pathname !== '/join') return null
  const code = url.searchParams.get('code')?.trim()
  if (!code || code.length > 64) return null
  return joinReturnPath(code)
}

/** `/login?...&redirect=<join path>` when a join path is pending. */
export function withJoinRedirect(href: string, joinPath: string | null): string {
  if (!joinPath) return href
  return `${href}${href.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(joinPath)}`
}

export function rememberPendingJoin(path: string, now = Date.now()): void {
  const valid = pendingJoinPath(path)
  if (!valid) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ path: valid, at: now }))
  } catch {
    // Not remembered; the redirect in the URL still carries it in this tab.
  }
}

export function readPendingJoin(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown }
    const path = typeof parsed.path === 'string' ? pendingJoinPath(parsed.path) : null
    const at = typeof parsed.at === 'number' ? parsed.at : NaN
    if (!path || !Number.isFinite(at) || now - at > MAX_AGE_MS || at - now > 60_000) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return path
  } catch {
    return null
  }
}

export function clearPendingJoin(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored, or storage is blocked.
  }
}
