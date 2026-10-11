/**
 * Route-level guards for the shared-device API (#240).
 *
 * - `authenticateDevice`: `/api/device/*` routes. Reads ONLY the device access
 *   cookie; a person `session_token` is ignored.
 * - `requireElevation`: elevated device routes (`X-Device-Elevation`).
 * - `refusePairedDevice`: person routes a paired tablet may not use yet.
 * - `requireDeviceManager`: parent-only person routes (`/api/family/devices/*`,
 *   `/api/users/elevation-pin`). Authenticates `session_token` only after checking paired-device context.
 *   Device-only requests retain 401; a live device plus a lingering person
 *   cookie is refused with 403, so a tablet can never manage devices.
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

// Kept here for existing route imports; the implementation lives in a lower
// level module so api-auth can use the same boundary without an import cycle.
export { refusePairedDevice } from '@/lib/device-refusal'

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
  // Preserve the paired-device refusal emitted before person auth. Flatten
  // ordinary authentication failures to the manager's stable 401 contract,
  // but do not turn a live tablet plus a lingering session into an apparently
  // unauthenticated request.
  if (authError) {
    if (authError.status === 403 && request.cookies.get('session_token')?.value) {
      return { ok: false, response: authError }
    }
    return { ok: false, response: deviceError(401, 'UNAUTHORIZED') }
  }
  if (!isParentRole(payload.role)) return { ok: false, response: deviceError(403, 'PARENT_REQUIRED') }
  if (!payload.family_id) return { ok: false, response: deviceError(403, 'FAMILY_REQUIRED') }
  return { ok: true, userId: payload.userId, familyId: payload.family_id }
}
