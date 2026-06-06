import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { generateCsrfToken, setCsrfCookie, validateCsrf } from '@/lib/csrf'

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
  '/api/auth/logout', // authenticated via cookie only, no body
  '/api/health',
])

export function middleware(request: NextRequest) {
  // CSRF check: reject all state-changing /api/* requests without a valid token,
  // except for the auth endpoints listed above (where credentials are the second factor).
  const isApiMutation = request.nextUrl.pathname.startsWith('/api/') &&
    UNSAFE_METHODS.has(request.method) &&
    !CSRF_EXEMPT_PATHS.has(request.nextUrl.pathname)

  if (isApiMutation) {
    const csrfError = validateCsrf(request)
    if (csrfError) return csrfError
  }

  const token = request.cookies.get('session_token')?.value
  const payload = token ? verifyToken(token) : null
  const isAuthenticated = !!payload

  // Protected routes
  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard')

  if (isProtectedRoute && !isAuthenticated) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Role gate: kids and teens can only see the KidHome at /dashboard.
  // Any /dashboard/* sub-route (features, calendar, lists, etc) is parent-only.
  // Without this gate, a kid can type /dashboard/features directly and
  // bypass the KidHome routing that page.tsx does.
  // Family-only routes (e.g. /dashboard/family) and parent-only surfaces
  // are all blocked for kids/teen. The /dashboard root is allowed because
  // page.tsx renders KidHome for kids/teen and DashboardHome for parents.
  if (isProtectedRoute && isAuthenticated && payload) {
    const isKid = payload.role === 'child' || payload.role === 'teen'
    const pathname = request.nextUrl.pathname
    const isDashboardRoot = pathname === '/dashboard' || pathname === '/dashboard/'
    if (isKid && !isDashboardRoot) {
      const redirectUrl = new URL('/dashboard', request.url)
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Auth routes (login/register/join) - redirect to dashboard if already logged in
  const isAuthRoute = ['/login', '/register', '/join'].includes(request.nextUrl.pathname)

  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const response = NextResponse.next()

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
