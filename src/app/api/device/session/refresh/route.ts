import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { getClientIp } from '@/lib/client-ip'
import { deviceClock, deviceError, deviceInternalError, deviceJson, killSwitch, rateLimited } from '@/lib/device-http'
import {
  clearDeviceCookies,
  findRefreshDeviceId,
  readDeviceCookies,
  refreshDeviceSession,
  setDeviceCookies,
} from '@/lib/device-session'

/**
 * POST /api/device/session/refresh (SHARED_DEVICE.md §4). Rotates the
 * refresh cookie on every call; replay of a rotated token revokes the device
 * unless it is a lost response (60 s grace, successor never used).
 * CSRF-protected like every other unsafe /api route.
 */
export async function POST(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const ipLimit = await checkRateLimit(`device-refresh-ip:${getClientIp(request)}`, 60, 15 * 60 * 1000)
    if (!ipLimit.allowed) return rateLimited(ipLimit)

    const { refresh } = readDeviceCookies(request)
    if (!refresh) {
      const res = deviceError(401, 'DEVICE_SESSION_INVALID')
      clearDeviceCookies(res)
      return res
    }

    const deviceId = await findRefreshDeviceId(prisma!, refresh)
    if (deviceId) {
      const deviceLimit = await checkRateLimit(`device-refresh:${deviceId}`, 30, 60 * 60 * 1000)
      if (!deviceLimit.allowed) return rateLimited(deviceLimit)
    }

    const result = await refreshDeviceSession(prisma!, refresh, deviceClock.now())
    if (!result.ok) {
      const res = deviceError(401, result.code)
      clearDeviceCookies(res)
      return res
    }

    const res = deviceJson({ accessExpiresAt: result.tokens.accessExpiresAt.toISOString() })
    setDeviceCookies(res, result.tokens)
    return res
  } catch (error) {
    return deviceInternalError('device.refresh', error)
  }
}
