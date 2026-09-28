import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { MEMBER_COLOR_KEYS, isMemberColorKey, resolveMemberColors } from '@/lib/member-colors'
import { isWeatherEnabled, isWeatherUnit, type WeatherUnit } from '@/lib/weather/board-weather'
import { isValidLatitude, isValidLongitude, roundCoordinate } from '@/lib/weather/open-meteo'

export const dynamic = 'force-dynamic'

/**
 * Today board settings (#262): member colours and the opt-in weather place.
 * Parent only, own household only. Person sessions only: a paired tablet
 * cookie is not a person session, so it gets 401 like every other person
 * route (device route allowlist test).
 *
 * GET  -> { weather: { available, enabled, place, unit }, members: [{ id, name, color, custom }] }
 * PATCH { weather?: { enabled?, place?, unit? }, memberColors?: { [memberId]: key | null } }
 */

const placeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  latitude: z.number().refine(isValidLatitude, 'Latitude out of range'),
  longitude: z.number().refine(isValidLongitude, 'Longitude out of range'),
})

const patchSchema = z
  .object({
    weather: z
      .object({
        enabled: z.boolean().optional(),
        place: placeSchema.nullable().optional(),
        unit: z.enum(['celsius', 'fahrenheit']).optional(),
      })
      .strict()
      .optional(),
    memberColors: z
      .record(z.string().min(1).max(64), z.enum(MEMBER_COLOR_KEYS).nullable())
      .refine((v) => Object.keys(v).length <= 50, 'Too many members')
      .optional(),
  })
  .strict()

async function readSettings(familyId: string) {
  const [family, members] = await Promise.all([
    prisma!.family.findUnique({
      where: { id: familyId },
      select: {
        weather_enabled: true,
        weather_latitude: true,
        weather_longitude: true,
        weather_label: true,
        weather_unit: true,
      },
    }),
    prisma!.user.findMany({
      where: { family_id: familyId },
      select: { id: true, name: true, board_color: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
  ])
  const colors = resolveMemberColors(members)
  const hasPlace =
    !!family &&
    isValidLatitude(family.weather_latitude) &&
    isValidLongitude(family.weather_longitude) &&
    !!family.weather_label
  const unit: WeatherUnit = isWeatherUnit(family?.weather_unit) ? family!.weather_unit as WeatherUnit : 'celsius'
  return {
    weather: {
      available: isWeatherEnabled(),
      enabled: Boolean(family?.weather_enabled),
      place: hasPlace
        ? { label: family!.weather_label!, latitude: family!.weather_latitude!, longitude: family!.weather_longitude! }
        : null,
      unit,
    },
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      color: colors.get(m.id)!,
      custom: isMemberColorKey(m.board_color),
    })),
  }
}

export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError
    return NextResponse.json(await readSettings(auth.user.family_id))
  } catch (error) {
    console.error('Board settings read error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load board settings' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error
    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError
    const familyId = auth.user.family_id

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })
    }
    const { weather, memberColors } = parsed.data

    // Member colours: every id must be a member of this household. A foreign
    // and a missing id get the same answer, so nothing about other
    // households is revealed.
    if (memberColors && Object.keys(memberColors).length > 0) {
      const ids = Object.keys(memberColors)
      const found = await prisma!.user.findMany({
        where: { id: { in: ids }, family_id: familyId },
        select: { id: true },
      })
      if (found.length !== ids.length) {
        return NextResponse.json({ error: 'Unknown household member' }, { status: 400 })
      }
    }

    if (weather) {
      const current = await prisma!.family.findUnique({
        where: { id: familyId },
        select: { weather_latitude: true, weather_longitude: true, weather_label: true },
      })
      const data: Record<string, unknown> = {}
      let placeAfter =
        current && isValidLatitude(current.weather_latitude) && isValidLongitude(current.weather_longitude)
          ? { latitude: current.weather_latitude, longitude: current.weather_longitude }
          : null
      if (weather.place !== undefined) {
        if (weather.place === null) {
          data.weather_latitude = null
          data.weather_longitude = null
          data.weather_label = null
          placeAfter = null
        } else {
          // Only a coarse place is ever stored (about 1 km).
          const latitude = roundCoordinate(weather.place.latitude)
          const longitude = roundCoordinate(weather.place.longitude)
          data.weather_latitude = latitude
          data.weather_longitude = longitude
          data.weather_label = weather.place.label
          placeAfter = { latitude, longitude }
        }
      }
      if (weather.unit !== undefined) data.weather_unit = weather.unit
      if (weather.enabled !== undefined) {
        if (weather.enabled && !isWeatherEnabled()) {
          return NextResponse.json({ error: 'Weather is not available on this server' }, { status: 409 })
        }
        if (weather.enabled && !placeAfter) {
          return NextResponse.json({ error: 'Choose a place before turning on weather' }, { status: 400 })
        }
        data.weather_enabled = weather.enabled
      }
      // Removing the place turns weather off.
      if (weather.place === null) data.weather_enabled = false

      if (Object.keys(data).length > 0) {
        await prisma!.family.update({ where: { id: familyId }, data })
      }
      // A new place, or turning weather off, drops the cached forecast.
      if (weather.place !== undefined || weather.enabled === false) {
        await prisma!.weatherCache.deleteMany({ where: { family_id: familyId } })
      }
    }

    if (memberColors) {
      for (const [id, color] of Object.entries(memberColors)) {
        await prisma!.user.updateMany({ where: { id, family_id: familyId }, data: { board_color: color } })
      }
    }

    return NextResponse.json(await readSettings(familyId))
  } catch (error) {
    console.error('Board settings save error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not save board settings' }, { status: 500 })
  }
}
