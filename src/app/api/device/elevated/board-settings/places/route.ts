import { NextRequest } from 'next/server'
import { deviceError, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { authenticateDevice, requireElevation } from '@/lib/device-route'
import { runPlaceSearch } from '@/lib/weather/place-search'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

/**
 * GET /api/device/elevated/board-settings/places?q=Toronto (#274)
 *
 * The weather place search of the board settings, for a parent elevated on
 * the tablet. Same search as /api/family/board-settings/places (fixed
 * Open-Meteo host, rounded coordinates, nothing stored), rate limited per
 * tablet (`weather-places:device:<deviceId>`). Needs `X-Device-Elevation`.
 */
export async function GET(request: NextRequest) {
  const off = killSwitch()
  if (off) return off
  try {
    const auth = await authenticateDevice(request)
    if (!auth.ok) return auth.response
    const elevated = await requireElevation(request, auth)
    if (!elevated.ok) return elevated.response

    const result = await runPlaceSearch(
      request.nextUrl.searchParams.get('q'),
      `weather-places:device:${elevated.actor.deviceId}`
    )
    if (result.ok) return deviceJson({ places: result.places })
    if (result.status === 429) {
      return deviceError(429, 'RATE_LIMITED', {
        message: result.error,
        headers: { 'Retry-After': String(result.retryAfterSeconds ?? 60) },
      })
    }
    const code = result.status === 502 ? 'SERVICE_UNAVAILABLE' : result.status === 409 ? 'FEATURE_DISABLED' : 'VALIDATION_ERROR'
    return deviceError(result.status, code, { message: result.error })
  } catch (error) {
    return deviceInternalError('device.board_settings_places', error, getRequestId(request))
  }
}
