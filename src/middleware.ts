import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { resolveSession } from '@/lib/session'
import { generateCsrfToken, setCsrfCookie, validateCsrf } from '@/lib/csrf'
import { KID_ALLOWED_PREFIXES, isDashboardRoot, isKidAllowedPath, isKidRole } from '@/lib/kid-access'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import { clearDeviceCookies, DEVICE_ACCESS_COOKIE, DEVICE_REFRESH_COOKIE } from '@/lib/device-session'
import { REQUEST_ID_HEADER, resolveRequestId } from '@/lib/request-id'

// Shared-device pages that need no device cookie (SHARED_DEVICE.md §12).
const DEVICE_PUBLIC_PAGES = new Set(['/device/pair', '/device/removed'])

// Use Node.js runtime so JWT_SECRET is read from runtime env, not bundled at build time.
// Edge runtime (default) embeds env vars at build, causing token verification failures
// when CI builds without JWT_SECRET set.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
  runtime: 'nodejs',
}

// Methods that mutate state and need CSRF validation
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Auth endpoints that legitimately need to be hit without a CSRF token
// (no cookie has been set yet for the user, so the double-submit cookie is empty).
// These endpoints ARE auth-protected via password/credentials, which is the
// second factor — an attacker would need to know the user's password to forge
// these requests, defeating the CSRF threat model.
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification', // pre-auth like forgot-password; unauthenticated callers have no CSRF cookie
  '/api/auth/logout', // authenticated via cookie only, no body
  '/api/health',
  // Machine-called cron endpoint (#184). An external scheduler sends only
  // `x-cron-secret`; it has no browser session and therefore no CSRF cookie,
  // so the double-submit check rejected it with 403 and the job never ran.
  //
  // Safe to exempt because the route is NOT authenticated by cookie: it requires
  // `x-cron-secret` and fails closed otherwise. CSRF protects cookie-authenticated
  // requests from being forged by a third-party site; a request authenticated by a
  // header an attacker cannot set cross-origin is not the threat model this
  // check addresses.
  '/api/cron/recurring-chores',
])

// The pre-auth endpoints above skip the double-submit check because the caller
// has no csrf_token cookie yet. That leaves login CSRF: a cross-site
// `<form enctype="text/plain">` could sign the victim into the ATTACKER'S
// account (the route reads the body with request.json(), which ignores the
// Content-Type). Two cheap checks close it without a token:
//   1. The request must not come from another site. Browsers send
//      Sec-Fetch-Site (and Origin); non-browser clients send neither and are
//      allowed. The Capacitor app loads the real origin, so its requests are
//      same-origin.
//   2. A request with a body must be `application/json`. A cross-site page can
//      only send JSON after a CORS preflight, which this app never grants.
const PRE_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/logout',
])
// Endpoints that never read a body, so they need no Content-Type.
const BODYLESS_PRE_AUTH_PATHS = new Set(['/api/auth/logout'])

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim().toLowerCase()
  return first || null
}

/** True when an Origin header names a different host than this request's. */
function isForeignOrigin(request: NextRequest, origin: string): boolean {
  if (origin === 'null') return true // sandboxed iframes, data: URLs, some cross-site redirects
  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return true
  }
  // Behind a proxy the app may see an internal Host; the browser-visible host
  // is then in X-Forwarded-Host. A cross-site page cannot set either header.
  const ownHosts = [
    firstHeaderValue(request.headers.get('host')),
    firstHeaderValue(request.headers.get('x-forwarded-host')),
    request.nextUrl.host.toLowerCase(),
  ]
  return !ownHosts.includes(originHost)
}

/** Returns an error response for a cross-site or non-JSON pre-auth request, else null. */
function checkPreAuthRequest(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname
  if (!PRE_AUTH_PATHS.has(pathname) || !UNSAFE_METHODS.has(request.method)) return null

  const fetchSite = firstHeaderValue(request.headers.get('sec-fetch-site'))
  const origin = request.headers.get('origin')
  const crossSite = fetchSite
    ? fetchSite !== 'same-origin' && fetchSite !== 'none'
    : origin !== null && isForeignOrigin(request, origin)
  if (crossSite) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
  }

  if (!BODYLESS_PRE_AUTH_PATHS.has(pathname)) {
    const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 })
    }
  }
  return null
}

/**
 * Request identity (#161): every response leaving the middleware, including
 * early CSRF rejections and redirects, carries `X-Request-Id`.
 */
function withRequestId<T extends NextResponse>(response: T, requestId: string): T {
  response.headers.set('X-Request-Id', requestId)
  return response
}

export async function middleware(request: NextRequest) {
  // Accept a well-formed inbound id, otherwise generate one (src/lib/request-id.ts).
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER))
  const response = await handle(request, requestId)
  return withRequestId(response, requestId)
}

async function handle(request: NextRequest, requestId: string): Promise<NextResponse> {
  // CSRF check: reject all state-changing /api/* requests without a valid token,
  // except for the auth endpoints listed above (where credentials are the second factor).
  //
  // /api/analytics/event is exempt only while the caller is anonymous. A signed-in
  // caller's request still reaches the database (it prunes old legacy analytics rows),
  // so it keeps the CSRF check like every other state-changing request.
  // Anonymous callers are no-ops, and have no csrf_token cookie yet, so requiring one
  // there is what produced the console noise this exemption exists to remove.
  const isAnalyticsEvent = request.nextUrl.pathname === '/api/analytics/event'
  const hasSession = Boolean(request.cookies.get('session_token')?.value)
  const csrfExempt = CSRF_EXEMPT_PATHS.has(request.nextUrl.pathname) ||
    (isAnalyticsEvent && !hasSession)

  const isApiMutation = request.nextUrl.pathname.startsWith('/api/') &&
    UNSAFE_METHODS.has(request.method) &&
    !csrfExempt

  if (isApiMutation) {
    const csrfError = validateCsrf(request)
    if (csrfError) return csrfError
  }

  const preAuthError = checkPreAuthRequest(request)
  if (preAuthError) return preAuthError

  const token = request.cookies.get('session_token')?.value

  // Shared device (#157/#240). Presence checks only, no database call: the
  // /device pages and /api/device routes do the real validation. Off with the
  // kill switch, so device cookies are then ignored entirely.
  if (isSharedDeviceEnabled()) {
    const pathname = request.nextUrl.pathname
    const hasDeviceCookie = Boolean(
      request.cookies.get(DEVICE_ACCESS_COOKIE)?.value || request.cookies.get(DEVICE_REFRESH_COOKIE)?.value
    )
    const isDevicePage = pathname === '/device' || pathname.startsWith('/device/')
    if (isDevicePage && !DEVICE_PUBLIC_PAGES.has(pathname) && !hasDeviceCookie) {
      return NextResponse.redirect(new URL('/device/pair', request.url))
    }
    // Cold launch (Capacitor loads `/`) and stray navigation on a paired
    // tablet land on the board, never on a person sign-in, registration or
    // dashboard. The device cookie wins even if a session_token is present:
    // a paired tablet must never run a person dashboard (pairing clears
    // session_token, and login/registration refuse to issue one).
    const isPersonEntry =
      pathname === '/' || pathname === '/login' || pathname === '/register' || pathname.startsWith('/dashboard')
    if (isPersonEntry && hasDeviceCookie) {
      return NextResponse.redirect(new URL('/device/today', request.url))
    }
  }

  const payload = token ? verifyToken(token) : null

  // Protected routes
  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard')
  // Auth routes (login/register) - redirect to dashboard if already logged in.
  // `/join` is deliberately NOT one of them: a signed-in member without a
  // household must reach it to accept an email invite or enter a family code
  // (the login page sends them there after sign-in, and onboarding links to
  // it). The page itself handles both signed-in and signed-out visitors, and
  // POST /api/family/join refuses anyone already in a household.
  const isAuthRoute = ['/login', '/register'].includes(request.nextUrl.pathname)

  // A JWT stays cryptographically valid for its full 7 days, so signature and
  // expiry alone cannot express "this session was revoked" — `token_version` is
  // bumped on password reset and change. Without this check a revoked cookie
  // still walked straight through the /dashboard gate.
  //
  // Two things bound the added cost. The lookup is skipped entirely when no
  // cookie is present, and it runs only for /dashboard and the auth routes
  // (route handlers enforce the same check for /api/*). And both gates below
  // read this ONE value, so they cannot disagree and bounce a user between
  // /login and /dashboard.
  //
  // Fail-closed on error: a DB outage degrades a logged-in user to the login
  // page, where the app is unusable anyway, rather than admitting a session
  // that may have been revoked.
  //
  // The same lookup also returns the member's CURRENT role (D6, #102), and the
  // kid gate below uses that rather than the role claim inside the JWT.
  let isAuthenticated = false
  let currentRole: string | undefined = payload?.role
  if (payload) {
    if (isProtectedRoute || isAuthRoute) {
      try {
        const resolved = await resolveSession(payload)
        isAuthenticated = resolved !== null
        currentRole = resolved?.role
      } catch (error) {
        // Fail closed, but not silently: a database outage that logs every user
        // out with zero trace in the logs is far harder to diagnose than one
        // that says so.
        console.error('Session generation check failed; treating session as revoked', error)
        isAuthenticated = false
      }
    } else {
      // Neither gate below can fire; no reason to pay for a lookup.
      isAuthenticated = true
    }
  }

  if (isProtectedRoute && !isAuthenticated) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Role gate: kids and teens can only see the KidHome at /dashboard, plus the
  // few routes on the shared kid allowlist (src/lib/kid-access.ts).
  // The allowlist is the single source of truth — the dashboard layout uses the
  // same helper, so the two gates cannot disagree.
  if (isProtectedRoute && isAuthenticated && payload) {
    const isKid = isKidRole(currentRole)
    const pathname = request.nextUrl.pathname
    if (isKid && !isDashboardRoot(pathname) && !isKidAllowedPath(pathname)) {
      const redirectUrl = new URL('/dashboard', request.url)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Referenced here so an unused-import lint cannot silently drop the shared list
  // from the built middleware.
  void KID_ALLOWED_PREFIXES

  // Auth routes (login/register) - redirect to dashboard if already logged in
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Forward the request id to route handlers (`getRequestId(request)`) without
  // dropping any inbound header.
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId)
  // Expose the request pathname to server components/layouts. The dashboard
  // layout reads it for its kid-access check. Next.js does not provide the
  // pathname to layouts on its own, and only REQUEST headers reach headers()
  // in a layout, so this must be set on the forwarded request (a response
  // header never reaches it). Always overwrite: a client-sent x-pathname must
  // not be trusted.
  forwardedHeaders.set('x-pathname', request.nextUrl.pathname)
  const response = NextResponse.next({ request: { headers: forwardedHeaders } })

  // Kill switch off: device cookies are ignored above, and expired here so a
  // tablet that was paired re-pairs instead of silently resuming when the
  // switch is turned back on (SHARED_DEVICE.md §13). Cookie headers only; no
  // database access.
  if (
    !isSharedDeviceEnabled() &&
    (request.cookies.get(DEVICE_ACCESS_COOKIE)?.value || request.cookies.get(DEVICE_REFRESH_COOKIE)?.value)
  ) {
    clearDeviceCookies(response)
  }

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // HSTS — tell browsers to never load this site over HTTP. 1 year, subdomains included.
  // Only set in production to avoid breaking local dev over http://localhost.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  }

  // CSRF: ensure every response has a csrf_token cookie so the browser
  // can echo it back in X-CSRF-Token on state-changing requests.
  // This is the "double-submit cookie" pattern.
  let csrfToken = request.cookies.get('csrf_token')?.value
  if (!csrfToken) {
    csrfToken = generateCsrfToken()
  }
  setCsrfCookie(response, csrfToken)

  return response
}
