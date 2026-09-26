/**
 * Shared-device credentials (#157 contract, #240): tokens, per-request
 * resolution, refresh rotation with reuse detection, elevation and cookies.
 * Contract: docs/architecture/SHARED_DEVICE.md §4, §6, §8; ADR-0006.
 *
 * A device is never a person. Nothing here produces a `TokenPayload` or reads
 * `session_token`, and the person auth helpers (`authenticateRequest`,
 * `getServerUser`, `verifySessionToken`) never read the device cookies, so
 * every existing route refuses a device by construction. The actor types below
 * are the only identities a device request can resolve to.
 *
 * Every token is 256 random bits behind a versioned `fpd1_` prefix and is
 * stored only as `sha256` hex (`hashToken`). Plaintext exists only in the
 * Set-Cookie header or JSON body that hands it to the tablet.
 */
import crypto from 'crypto'
import type { NextResponse } from 'next/server'
import type { Prisma, PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/tokens'
import { timingSafeEqualStr } from '@/lib/constant-time'
import { writeDeviceAudit, type ElevationEndReason, type RevokeReason } from '@/lib/device-audit'
import { log } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Constants (§4, §6.3; O-2 and O-8 confirmed/defaulted)

export const DEVICE_ACCESS_COOKIE = 'fp_device'
export const DEVICE_REFRESH_COOKIE = 'fp_device_refresh'
export const DEVICE_ELEVATION_HEADER = 'x-device-elevation'
export const PERSON_SESSION_COOKIE = 'session_token'

export const ACCESS_TTL_MS = 60 * 60 * 1000
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** Rule 3: a rotated refresh token replayed this soon, with an unused successor, is a lost response. */
export const REFRESH_REUSE_GRACE_MS = 60 * 1000
/** Rotated generations older than this are deleted on the device's next refresh (§3 notes). */
export const ROTATED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000
export const ELEVATION_IDLE_MS = 5 * 60 * 1000
export const ELEVATION_MAX_MS = 15 * 60 * 1000

// ---------------------------------------------------------------------------
// Tokens

export type DeviceTokenKind = 'a' | 'r' | 'e' | 'p'

/** `fpd1_<kind>_` + base64url(32 random bytes). a=access, r=refresh, e=elevation, p=pairing claim. */
export function generateDeviceToken(kind: DeviceTokenKind): string {
  return `fpd1_${kind}_${crypto.randomBytes(32).toString('base64url')}`
}

export { hashToken as hashDeviceToken }

// ---------------------------------------------------------------------------
// Actors

interface DeviceIdentity {
  deviceId: string
  familyId: string
  sessionId: string
  label: string
}

/** The shared surface itself, no person. */
export interface DeviceActor extends DeviceIdentity {
  kind: 'device'
}

/** A parent who proved identity on this tablet (§6). Never a person session. */
export interface ElevatedParentActor extends DeviceIdentity {
  kind: 'device_elevated_parent'
  parentId: string
  parentName: string
}

export type SharedDeviceActor = DeviceActor | ElevatedParentActor

// ---------------------------------------------------------------------------
// Database shapes

type Db = PrismaClient
type Tx = Prisma.TransactionClient

export const DEVICE_ROW_SELECT = {
  id: true,
  family_id: true,
  label: true,
  revoked_at: true,
  last_seen_at: true,
  elevation_token_hash: true,
  elevated_user_id: true,
  elevated_token_version: true,
  elevation_method: true,
  elevation_started_at: true,
  elevation_last_used_at: true,
  elevation_expires_at: true,
} as const

export interface DeviceRow {
  id: string
  family_id: string
  label: string
  revoked_at: Date | null
  last_seen_at: Date | null
  elevation_token_hash: string | null
  elevated_user_id: string | null
  elevated_token_version: number | null
  elevation_method: string | null
  elevation_started_at: Date | null
  elevation_last_used_at: Date | null
  elevation_expires_at: Date | null
}

export const CLEARED_ELEVATION = {
  elevation_token_hash: null,
  elevated_user_id: null,
  elevated_token_version: null,
  elevation_method: null,
  elevation_started_at: null,
  elevation_last_used_at: null,
  elevation_expires_at: null,
} as const

// ---------------------------------------------------------------------------
// Session issue

export interface IssuedDeviceTokens {
  sessionId: string
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
}

/** Create one session generation for a device. Call inside the caller's transaction. */
export async function createDeviceSession(
  tx: Tx | Db,
  deviceId: string,
  familyId: string,
  now: Date
): Promise<IssuedDeviceTokens> {
  const accessToken = generateDeviceToken('a')
  const refreshToken = generateDeviceToken('r')
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TTL_MS)
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS)
  const created = await tx.deviceSession.create({
    data: {
      device_id: deviceId,
      family_id: familyId,
      access_token_hash: hashToken(accessToken),
      access_expires_at: accessExpiresAt,
      refresh_token_hash: hashToken(refreshToken),
      refresh_expires_at: refreshExpiresAt,
      first_used_at: null,
      rotated_at: null,
      replaced_by_id: null,
      revoked_at: null,
      created_at: now,
    },
    select: { id: true },
  })
  return { sessionId: created.id, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }
}

// ---------------------------------------------------------------------------
// Per-request resolution (§4)

export type DeviceAuthErrorCode = 'DEVICE_ACCESS_EXPIRED' | 'DEVICE_REVOKED' | 'DEVICE_SESSION_INVALID' | 'SERVICE_UNAVAILABLE'

export type DeviceAuthResult =
  | { ok: true; actor: DeviceActor; device: DeviceRow }
  | { ok: false; status: 401 | 503; code: DeviceAuthErrorCode }

export interface DeviceCookieValues {
  access?: string
  refresh?: string
}

type CookieSource = { cookies: { get: (name: string) => { value: string } | undefined } }

export function readDeviceCookies(request: CookieSource): DeviceCookieValues {
  return {
    access: request.cookies.get(DEVICE_ACCESS_COOKIE)?.value || undefined,
    refresh: request.cookies.get(DEVICE_REFRESH_COOKIE)?.value || undefined,
  }
}

const invalid = { ok: false, status: 401, code: 'DEVICE_SESSION_INVALID' } as const
const revoked = { ok: false, status: 401, code: 'DEVICE_REVOKED' } as const
const accessExpired = { ok: false, status: 401, code: 'DEVICE_ACCESS_EXPIRED' } as const
const unavailable = { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' } as const

/**
 * Resolve the device access cookie. One indexed lookup, then two throttled
 * writes (`first_used_at` once per generation, which the refresh grace rule
 * depends on, and `last_seen_at` at most every 5 minutes).
 *
 * Fails closed on a database error with 503 (not a terminal code), so a
 * database blip denies access without making the tablet purge itself.
 */
export async function resolveDeviceAccess(db: Db, cookies: DeviceCookieValues, now: Date): Promise<DeviceAuthResult> {
  // No access cookie but a refresh cookie: the 1-hour cookie expired in the
  // browser; tell the client to refresh rather than purge.
  if (!cookies.access) return cookies.refresh ? accessExpired : invalid

  try {
    const row = await db.deviceSession.findUnique({
      where: { access_token_hash: hashToken(cookies.access) },
      select: {
        id: true,
        family_id: true,
        access_expires_at: true,
        revoked_at: true,
        rotated_at: true,
        first_used_at: true,
        device: { select: DEVICE_ROW_SELECT },
      },
    })
    if (!row || !row.device) return invalid
    if (row.device.revoked_at) return revoked
    if (row.revoked_at || row.family_id !== row.device.family_id) return invalid
    // A rotated generation's access token is dead; the client refreshes with
    // the refresh cookie it received alongside the successor.
    if (row.rotated_at || row.access_expires_at.getTime() <= now.getTime()) return accessExpired

    if (!row.first_used_at) {
      await db.deviceSession.updateMany({ where: { id: row.id, first_used_at: null }, data: { first_used_at: now } })
    }
    const lastSeen = row.device.last_seen_at?.getTime() ?? 0
    if (now.getTime() - lastSeen >= LAST_SEEN_THROTTLE_MS) {
      await db.householdDevice.updateMany({ where: { id: row.device.id, revoked_at: null }, data: { last_seen_at: now } })
    }

    return {
      ok: true,
      device: row.device,
      actor: {
        kind: 'device',
        deviceId: row.device.id,
        familyId: row.device.family_id,
        sessionId: row.id,
        label: row.device.label,
      },
    }
  } catch (error) {
    log.error('device.resolve_failed', error instanceof Error ? error : new Error(String(error)))
    return unavailable
  }
}

// ---------------------------------------------------------------------------
// Refresh rotation with reuse detection (§4 rules 1–4)

export type RefreshResult =
  | { ok: true; tokens: IssuedDeviceTokens; deviceId: string; familyId: string; path: 'rotated' | 'grace_reissued' }
  | { ok: false; code: 'DEVICE_REVOKED' | 'DEVICE_SESSION_INVALID'; deviceId?: string; reuseDetected?: boolean }

const REFRESH_ROW_SELECT = {
  id: true,
  device_id: true,
  family_id: true,
  refresh_expires_at: true,
  revoked_at: true,
  rotated_at: true,
  replaced_by_id: true,
  first_used_at: true,
  device: { select: { id: true, family_id: true, revoked_at: true } },
} as const

/** Look up a refresh cookie's row without changing anything (used for rate-limit keys). */
export async function findRefreshDeviceId(db: Db, refreshToken: string): Promise<string | null> {
  const row = await db.deviceSession.findUnique({
    where: { refresh_token_hash: hashToken(refreshToken) },
    select: { device_id: true },
  })
  return row?.device_id ?? null
}

export async function refreshDeviceSession(db: Db, refreshToken: string, now: Date): Promise<RefreshResult> {
  return refreshOnce(db, refreshToken, now, 0)
}

async function refreshOnce(db: Db, refreshToken: string, now: Date, depth: number): Promise<RefreshResult> {
  const row = await db.deviceSession.findUnique({
    where: { refresh_token_hash: hashToken(refreshToken) },
    select: REFRESH_ROW_SELECT,
  })

  // Rule 1: unknown, expired, revoked session or device.
  if (!row || !row.device) return { ok: false, code: 'DEVICE_SESSION_INVALID' }
  if (row.device.revoked_at) return { ok: false, code: 'DEVICE_REVOKED', deviceId: row.device_id }
  if (row.revoked_at || row.family_id !== row.device.family_id || row.refresh_expires_at.getTime() <= now.getTime()) {
    return { ok: false, code: 'DEVICE_SESSION_INVALID', deviceId: row.device_id }
  }

  // Rule 2: live and unrotated → rotate.
  if (!row.rotated_at) {
    const tokens = await db.$transaction(async (tx) => {
      // Conditional claim: two concurrent refreshes with the same token cannot
      // both rotate it; the loser re-classifies below (grace or reuse).
      const claimed = await tx.deviceSession.updateMany({
        where: { id: row.id, rotated_at: null, revoked_at: null },
        data: { rotated_at: now, first_used_at: row.first_used_at ?? now },
      })
      if (claimed.count !== 1) return null
      const issued = await createDeviceSession(tx, row.device_id, row.family_id, now)
      await tx.deviceSession.update({ where: { id: row.id }, data: { replaced_by_id: issued.sessionId } })
      return issued
    })
    if (!tokens) {
      if (depth > 0) return { ok: false, code: 'DEVICE_SESSION_INVALID', deviceId: row.device_id }
      return refreshOnce(db, refreshToken, now, depth + 1)
    }
    await afterRefresh(db, row.device_id, now)
    return { ok: true, tokens, deviceId: row.device_id, familyId: row.family_id, path: 'rotated' }
  }

  // Already rotated. Rule 3 (grace) or rule 4 (reuse).
  const successor = row.replaced_by_id
    ? await db.deviceSession.findUnique({
        where: { id: row.replaced_by_id },
        select: { id: true, first_used_at: true, revoked_at: true },
      })
    : null
  const withinGrace = now.getTime() - row.rotated_at.getTime() < REFRESH_REUSE_GRACE_MS

  if (withinGrace && successor && !successor.first_used_at && !successor.revoked_at) {
    const tokens = await db.$transaction(async (tx) => {
      // Only an untouched successor may be replaced. If it was used in the
      // meantime this is reuse after all.
      const killed = await tx.deviceSession.updateMany({
        where: { id: successor.id, first_used_at: null, revoked_at: null },
        data: { revoked_at: now },
      })
      if (killed.count !== 1) return null
      const issued = await createDeviceSession(tx, row.device_id, row.family_id, now)
      // `rotated_at` is deliberately left at the first rotation, so the grace
      // window never extends past 60 seconds from it.
      await tx.deviceSession.update({ where: { id: row.id }, data: { replaced_by_id: issued.sessionId } })
      return issued
    })
    if (tokens) {
      await afterRefresh(db, row.device_id, now)
      return { ok: true, tokens, deviceId: row.device_id, familyId: row.family_id, path: 'grace_reissued' }
    }
  }

  // Rule 4: token reuse. Revoke the device; this also kills a thief who
  // refreshed first.
  await revokeDevice(db, {
    deviceId: row.device_id,
    familyId: row.family_id,
    revokedBy: null,
    reason: 'token_reuse',
    now,
  })
  await writeDeviceAudit(db, {
    familyId: row.family_id,
    deviceId: row.device_id,
    type: 'device.token_reuse_detected',
    metadata: { sessionId: row.id },
  })
  log.warn('device.token_reuse_detected', { deviceId: row.device_id })
  return { ok: false, code: 'DEVICE_REVOKED', deviceId: row.device_id, reuseDetected: true }
}

async function afterRefresh(db: Db, deviceId: string, now: Date): Promise<void> {
  try {
    await db.householdDevice.updateMany({ where: { id: deviceId, revoked_at: null }, data: { last_seen_at: now } })
    // Opportunistic retention (§3 notes): no scheduler.
    await db.deviceSession.deleteMany({
      where: { device_id: deviceId, rotated_at: { lt: new Date(now.getTime() - ROTATED_SESSION_RETENTION_MS) } },
    })
  } catch (error) {
    log.warn('device.refresh_housekeeping_failed', { message: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Login guard (§4 "Coexistence", O-13): does this request carry a device
 * credential that still works? A valid access cookie, or a refresh cookie
 * whose session is live (looked up, never rotated here).
 */
export async function hasLiveDeviceCredential(db: Db, cookies: DeviceCookieValues, now: Date): Promise<boolean> {
  if (cookies.access) {
    const row = await db.deviceSession.findUnique({
      where: { access_token_hash: hashToken(cookies.access) },
      select: {
        family_id: true,
        access_expires_at: true,
        revoked_at: true,
        rotated_at: true,
        device: { select: { family_id: true, revoked_at: true } },
      },
    })
    if (
      row?.device &&
      !row.device.revoked_at &&
      !row.revoked_at &&
      !row.rotated_at &&
      row.family_id === row.device.family_id &&
      row.access_expires_at.getTime() > now.getTime()
    ) {
      return true
    }
  }
  if (cookies.refresh) {
    const row = await db.deviceSession.findUnique({
      where: { refresh_token_hash: hashToken(cookies.refresh) },
      select: {
        family_id: true,
        refresh_expires_at: true,
        revoked_at: true,
        rotated_at: true,
        device: { select: { family_id: true, revoked_at: true } },
      },
    })
    if (
      row?.device &&
      !row.device.revoked_at &&
      !row.revoked_at &&
      row.family_id === row.device.family_id &&
      row.refresh_expires_at.getTime() > now.getTime() &&
      // An unrotated token, or one still inside the lost-response grace window.
      (!row.rotated_at || now.getTime() - row.rotated_at.getTime() < REFRESH_REUSE_GRACE_MS)
    ) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Revocation (§8)

/**
 * Revoke a device: mark it, revoke every session generation and clear any
 * elevation in one transaction, then audit. Idempotent: returns false (and
 * writes nothing) when the device is already revoked or not in `familyId`.
 */
export async function revokeDevice(
  db: Db,
  args: { deviceId: string; familyId: string; revokedBy: string | null; reason: RevokeReason; now: Date }
): Promise<boolean> {
  const { deviceId, familyId, revokedBy, reason, now } = args
  const changed = await db.$transaction(async (tx) => {
    const { count } = await tx.householdDevice.updateMany({
      where: { id: deviceId, family_id: familyId, revoked_at: null },
      data: { revoked_at: now, revoked_by: revokedBy, revoke_reason: reason, ...CLEARED_ELEVATION },
    })
    if (count !== 1) return false
    await tx.deviceSession.updateMany({ where: { device_id: deviceId, revoked_at: null }, data: { revoked_at: now } })
    return true
  })
  if (changed) {
    await writeDeviceAudit(db, {
      familyId,
      deviceId,
      actorUserId: revokedBy,
      type: 'device.revoked',
      metadata: { reason },
    })
  }
  return changed
}

// ---------------------------------------------------------------------------
// Elevation (§6)

export interface ElevationState {
  active: boolean
  memberId: string | null
  expiresAt: string | null
}

type ElevationClock = Pick<DeviceRow, 'elevation_token_hash' | 'elevation_expires_at' | 'elevation_last_used_at'>

/** Why an elevation is no longer usable at `now`, or null while it is. */
export function elevationEndReason(device: ElevationClock, now: Date): 'idle' | 'max' | null {
  if (!device.elevation_expires_at || now.getTime() >= device.elevation_expires_at.getTime()) return 'max'
  if (!device.elevation_last_used_at || now.getTime() - device.elevation_last_used_at.getTime() >= ELEVATION_IDLE_MS) {
    return 'idle'
  }
  return null
}

/** What `/api/device/me` reports; never the token. */
export function elevationState(device: DeviceRow, now: Date): ElevationState {
  const active = Boolean(device.elevation_token_hash) && elevationEndReason(device, now) === null
  return {
    active,
    memberId: active ? device.elevated_user_id : null,
    expiresAt: active && device.elevation_expires_at ? device.elevation_expires_at.toISOString() : null,
  }
}

/** Clear the elevation columns, only if they still hold `expectedHash` (a newer elevation is left alone). */
export async function clearElevation(db: Db, deviceId: string, expectedHash: string): Promise<boolean> {
  const { count } = await db.householdDevice.updateMany({
    where: { id: deviceId, elevation_token_hash: expectedHash },
    data: { ...CLEARED_ELEVATION },
  })
  return count === 1
}

export async function endElevation(
  db: Db,
  device: DeviceRow,
  reason: ElevationEndReason
): Promise<void> {
  if (!device.elevation_token_hash) return
  const cleared = await clearElevation(db, device.id, device.elevation_token_hash)
  if (cleared) {
    await writeDeviceAudit(db, {
      familyId: device.family_id,
      deviceId: device.id,
      actorUserId: device.elevated_user_id,
      type: 'device.elevation_ended',
      metadata: { reason },
    })
  }
}

/** Does the presented header match this device's live elevation hash? (Bound to the device.) */
export function elevationHeaderMatches(device: DeviceRow, header: string | null | undefined): boolean {
  if (!header || !device.elevation_token_hash) return false
  return timingSafeEqualStr(hashToken(header), device.elevation_token_hash)
}

export type ElevationResult =
  | { ok: true; actor: ElevatedParentActor }
  | { ok: false; status: 403; code: 'ELEVATION_REQUIRED' | 'ELEVATION_EXPIRED' }

/**
 * Check `X-Device-Elevation` for an already-resolved device (§6.3). Re-reads
 * the parent's `role`, `family_id` and `token_version` in one query; any change
 * voids the elevation. A successful check moves the idle timer.
 */
export async function resolveElevation(
  db: Db,
  resolved: { actor: DeviceActor; device: DeviceRow },
  header: string | null | undefined,
  now: Date
): Promise<ElevationResult> {
  const { actor, device } = resolved
  if (!elevationHeaderMatches(device, header)) return { ok: false, status: 403, code: 'ELEVATION_REQUIRED' }

  const timedOut = elevationEndReason(device, now)
  if (timedOut) {
    await endElevation(db, device, timedOut)
    return { ok: false, status: 403, code: 'ELEVATION_EXPIRED' }
  }

  const parent = device.elevated_user_id
    ? await db.user.findUnique({
        where: { id: device.elevated_user_id },
        select: { id: true, name: true, role: true, family_id: true, token_version: true },
      })
    : null
  if (
    !parent ||
    parent.role !== 'parent' ||
    parent.family_id !== device.family_id ||
    parent.token_version !== device.elevated_token_version
  ) {
    await endElevation(db, device, 'credential_changed')
    return { ok: false, status: 403, code: 'ELEVATION_EXPIRED' }
  }

  await db.householdDevice.updateMany({
    where: { id: device.id, elevation_token_hash: device.elevation_token_hash },
    data: { elevation_last_used_at: now },
  })

  return {
    ok: true,
    actor: { ...actor, kind: 'device_elevated_parent', parentId: parent.id, parentName: parent.name },
  }
}

/** Start (or replace) the device's elevation. Returns the plaintext token for the JSON body only. */
export async function startElevation(
  db: Db,
  args: { deviceId: string; parentId: string; tokenVersion: number; method: 'pin' | 'password'; now: Date }
): Promise<{ token: string; expiresAt: Date } | null> {
  const token = generateDeviceToken('e')
  const expiresAt = new Date(args.now.getTime() + ELEVATION_MAX_MS)
  const { count } = await db.householdDevice.updateMany({
    where: { id: args.deviceId, revoked_at: null },
    data: {
      elevation_token_hash: hashToken(token),
      elevated_user_id: args.parentId,
      elevated_token_version: args.tokenVersion,
      elevation_method: args.method,
      elevation_started_at: args.now,
      elevation_last_used_at: args.now,
      elevation_expires_at: expiresAt,
    },
  })
  return count === 1 ? { token, expiresAt } : null
}

// ---------------------------------------------------------------------------
// Cookies (§4 table)

function secureCookie(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function setDeviceCookies(response: NextResponse, tokens: Pick<IssuedDeviceTokens, 'accessToken' | 'refreshToken'>) {
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

/**
 * True when the request comes from a paired shared device: the kill switch is
 * on and it carries a working device access cookie or a live refresh cookie.
 * Every route that issues a person `session_token` without an existing person
 * session (login, invite registration) refuses such requests (O-13).
 */
export async function isPairedDeviceRequest(
  db: Db,
  request: CookieSource,
  now: Date,
  enabled: boolean
): Promise<boolean> {
  if (!enabled) return false
  const cookies = readDeviceCookies(request)
  if (!cookies.access && !cookies.refresh) return false
  return hasLiveDeviceCredential(db, cookies, now)
}
