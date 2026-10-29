/** Cookie policy only: no database, token storage or credential resolution. */
import type { NextResponse } from 'next/server'

export const DEVICE_ACCESS_COOKIE = 'fp_device'
export const DEVICE_REFRESH_COOKIE = 'fp_device_refresh'
export const DEVICE_ELEVATION_HEADER = 'x-device-elevation'
export const PERSON_SESSION_COOKIE = 'session_token'

export const ACCESS_TTL_MS = 60 * 60 * 1000
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Read at call time (Node runtime), so flipping the env needs no rebuild. */
export function isSharedDeviceEnabled(): boolean {
  const raw = (process.env.SHARED_DEVICE_ENABLED ?? '').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

function secureCookie(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function setDeviceCookies(response: NextResponse, tokens: { accessToken: string; refreshToken: string }) {
  response.cookies.set(DEVICE_ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_MS / 1000,
  })
  // Path=/ so cold launch at `/` and the login guard can see it; it is only
  // rotated by POST /api/device/session/refresh.
  response.cookies.set(DEVICE_REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict',
    path: '/',
    maxAge: REFRESH_TTL_MS / 1000,
  })
}

export function clearDeviceCookies(response: NextResponse) {
  response.cookies.set(DEVICE_ACCESS_COOKIE, '', {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  response.cookies.set(DEVICE_REFRESH_COOKIE, '', {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
}

/** Pairing completion drops the person cookie on the tablet (no token_version bump). */
export function clearPersonSessionCookie(response: NextResponse) {
  response.cookies.set(PERSON_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

