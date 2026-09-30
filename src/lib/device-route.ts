/**
 * Route-level guards for the shared-device API (#240).
 *
 * - `authenticateDevice`: `/api/device/*` routes. Reads ONLY the device access
 *   cookie; a person `session_token` is ignored.
 * - `requireElevation`: elevated device routes (`X-Device-Elevation`).
 * - `refusePairedDevice`: person routes a paired tablet may not use yet.
 * - `requireDeviceManager`: parent-only person routes (`/api/family/devices/*`,
 *   `/api/users/elevation-pin`). Reads ONLY `session_token`; device cookies are
 *   ignored, so a tablet can never manage devices.
 */
import type { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { isParentRole } from '@/lib/role-capabilities'
import { deviceClock, deviceError, isSharedDeviceEnabled } from '@/lib/device-http'
import {
  clearDeviceCookies,
  DEVICE_ELEVATION_HEADER,
  isPairedDeviceRequest,
  readDeviceCookies,
  resolveDeviceAccess,
  resolveElevation,
  type DeviceActor,
  type DeviceRow,
  type ElevatedParentActor,
} from '@/lib/device-session'

type Fail = { ok: false; response: NextResponse }

export type AuthenticatedDevice = { ok: true; actor: DeviceActor; device: DeviceRow }

export async function authenticateDevice(request: NextRequest): Promise<AuthenticatedDevice | Fail> {
  const result = await resolveDeviceAccess(prisma!, readDeviceCookies(request), deviceClock.now())
  if (result.ok) return result
  const response = deviceError(result.status, result.code)
  if (result.code === 'DEVICE_REVOKED' || result.code === 'DEVICE_SESSION_INVALID') clearDeviceCookies(response)
  return { ok: false, response }
}

export async function requireElevation(
  request: NextRequest,
  resolved: AuthenticatedDevice
): Promise<{ ok: true; actor: ElevatedParentActor } | Fail> {
  const result = await resolveElevation(
    prisma!,
    resolved,
    request.headers.get(DEVICE_ELEVATION_HEADER),
    deviceClock.now()
  )
  if (result.ok) return result
  return { ok: false, response: deviceError(result.status, result.code) }
}

export type DeviceManager = { ok: true; userId: string; familyId: string }

/** Person session, parent role and a household, all from the database (D6). */
export async function requireDeviceManager(request: NextRequest): Promise<DeviceManager | Fail> {
  const [payload, authError] = await authenticateRequest(request)
  if (authError) return { ok: false, response: deviceError(401, 'UNAUTHORIZED') }
  if (!isParentRole(payload.role)) return { ok: false, response: deviceError(403, 'PARENT_REQUIRED') }
  if (!payload.family_id) return { ok: false, response: deviceError(403, 'FAMILY_REQUIRED') }
  return { ok: true, userId: payload.userId, familyId: payload.family_id }
}

/**
 * Person write routes that stay closed to a paired shared device until #157
 * device writes exist (e.g. ADR-0007 `from-recipe`). Runs BEFORE person auth,
 * so the tablet gets 403 `DEVICE_WRITE_NOT_ALLOWED` rather than 401, and even a
 * stray `session_token` next to a live device credential does not open the
 * route. Returns null for every other request (and always while the kill
 * switch is off, when device cookies are ignored).
 */
export async function refusePairedDevice(request: NextRequest): Promise<NextResponse | null> {
  if (!(await isPairedDeviceRequest(prisma!, request, deviceClock.now(), isSharedDeviceEnabled()))) return null
  return deviceError(403, 'DEVICE_WRITE_NOT_ALLOWED')
}
