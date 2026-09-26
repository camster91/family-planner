/**
 * Route-level guards for the shared-device API (#240).
 *
 * - `authenticateDevice`: `/api/device/*` routes. Reads ONLY the device access
 *   cookie; a person `session_token` is ignored.
 * - `requireElevation`: elevated device routes (`X-Device-Elevation`).
 * - `requireDeviceManager`: parent-only person routes (`/api/family/devices/*`,
 *   `/api/users/elevation-pin`). Reads ONLY `session_token`; device cookies are
 *   ignored, so a tablet can never manage devices.
 */
import type { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { isParentRole } from '@/lib/role-capabilities'
import { deviceClock, deviceError } from '@/lib/device-http'
import {
  clearDeviceCookies,
  DEVICE_ELEVATION_HEADER,
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
