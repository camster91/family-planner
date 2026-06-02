import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const CSRF_COOKIE = 'csrf_token'
const CSRF_HEADER = 'x-csrf-token'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Methods that mutate state and need CSRF validation
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Generate a CSRF token. Returns a 64-char hex string.
 * Stored in a non-httpOnly cookie (JS must be able to read it to send it back).
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Issue a CSRF token cookie on the response. Call this on every page render
 * (or at least on every response that may trigger a state-changing request).
 */
export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: false, // JS must read this to put it in the X-CSRF-Token header
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })
}

/**
 * Validate CSRF for state-changing requests.
 * Compares the token in the X-CSRF-Token header with the token in the csrf_token cookie.
 * Constant-time comparison to prevent timing attacks.
 *
 * Returns null on success (or for safe methods), or a NextResponse error.
 */
export function validateCsrf(request: NextRequest): NextResponse | null {
  // Only validate state-changing methods
  if (SAFE_METHODS.has(request.method)) return null

  const cookieToken = request.cookies.get(CSRF_COOKIE)?.value
  const headerToken = request.headers.get(CSRF_HEADER)

  if (!cookieToken || !headerToken) {
    return NextResponse.json(
      { error: 'CSRF token missing. Include the X-CSRF-Token header.' },
      { status: 403 }
    )
  }

  if (cookieToken.length !== headerToken.length) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  // Constant-time compare
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 })
  }

  return null
}

/**
 * Combined helper: authenticate + CSRF check for state-changing requests.
 * Returns [auth, csrf] — both should be null on success.
 */
export function requireCsrf(request: NextRequest): NextResponse | null {
  return validateCsrf(request)
}

export const CSRF_COOKIE_NAME = CSRF_COOKIE
export const CSRF_HEADER_NAME = CSRF_HEADER
