import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { MEMBER_COLOR_KEYS, isMemberColorKey, resolveMemberColors } from '@/lib/member-colors'
import { isWeatherEnabled, isWeatherUnit, type WeatherUnit } from '@/lib/weather/board-weather'
import { isValidLatitude, isValidLongitude, roundCoordinate } from '@/lib/weather/open-meteo'
import {
  AMBIENT_IDLE_CHOICES,
  MAX_AMBIENT_PHOTOS,
  idleMinutesFrom,
  isAmbientIdleChoice,
  isClockTime,
  nightHoursFrom,
} from '@/lib/ambient'
import { CHORE_PHOTO_FILENAME_RE, chorePhotoPath } from '@/lib/chore-photos'

export const dynamic = 'force-dynamic'

/**
 * Today board settings (#262): member colours and the opt-in weather place.
 * Parent only, own household only. Person sessions only: a paired tablet
 * cookie is not a person session, so it gets 401 like every other person
 * route (device route allowlist test).
 *
 * GET  -> { weather: { available, enabled, place, unit }, members: [{ id, name, color, custom }],
 *           display: { idleMinutes, idleChoices, night: { start, end } | null, photoIds,
 *                      uploads: [{ id, url, createdAt }] } }
 * PATCH { weather?: { enabled?, place?, unit? }, memberColors?: { [memberId]: key | null },
 *         display?: { idleMinutes?, night?: { start, end } | null, photoIds? } }
 *
 * Calm display (#271): `display.uploads` lists the household's own
 * displayable photo uploads (newest first) for the parent to choose from;
 * every `photoIds` entry must be one of them (a foreign and a missing id get
 * the same 400).
 */

/** Uploads offered in the photo picker, newest first. */
const MAX_UPLOADS_LISTED = 60
/** Photo types a browser can draw (HEIC is stored for chores but not displayable). */
const DISPLAYABLE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const clockSchema = z.string().refine(isClockTime, 'Use a 24-hour time like 21:30')

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
    display: z
      .object({
        idleMinutes: z
          .number()
          .int()
          .refine(isAmbientIdleChoice, `Choose one of ${AMBIENT_IDLE_CHOICES.join(', ')} minutes`)
          .optional(),
        night: z
          .object({ start: clockSchema, end: clockSchema })
          .strict()
          .refine((v) => v.start !== v.end, 'Night hours need different start and end times')
          .nullable()
          .optional(),
        photoIds: z
          .array(z.string().min(1).max(64))
          .max(MAX_AMBIENT_PHOTOS, `Choose at most ${MAX_AMBIENT_PHOTOS} photos`)
          .optional(),
      })
      .strict()
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
        ambient_idle_minutes: true,
        night_start: true,
        night_end: true,
        ambient_photo_ids: true,
      },
    }),
    prisma!.user.findMany({
      where: { family_id: familyId },
      select: { id: true, name: true, board_color: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
  ])
  const uploads = await prisma!.upload.findMany({
    where: { family_id: familyId, content_type: { in: DISPLAYABLE_PHOTO_TYPES } },
    select: { id: true, filename: true, created_at: true },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    take: MAX_UPLOADS_LISTED,
  })
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
    display: {
      idleMinutes: idleMinutesFrom(family?.ambient_idle_minutes),
      idleChoices: [...AMBIENT_IDLE_CHOICES],
      night: nightHoursFrom(family?.night_start, family?.night_end),
      photoIds: family?.ambient_photo_ids ?? [],
      uploads: uploads
        .filter((u) => CHORE_PHOTO_FILENAME_RE.test(u.filename))
        .map((u) => ({ id: u.id, url: chorePhotoPath(u.filename), createdAt: u.created_at.toISOString() })),
    },
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
    const { weather, memberColors, display } = parsed.data

    // Photos (#271): every id must be a displayable upload of this household.
    // A foreign and a missing id get the same answer.
    let photoIds: string[] | undefined
    if (display?.photoIds !== undefined) {
      photoIds = [...new Set(display.photoIds)]
      if (photoIds.length > 0) {
        const found = await prisma!.upload.findMany({
          where: { id: { in: photoIds }, family_id: familyId, content_type: { in: DISPLAYABLE_PHOTO_TYPES } },
          select: { id: true },
        })
        if (found.length !== photoIds.length) {
          return NextResponse.json({ error: 'Unknown photo' }, { status: 400 })
        }
      }
    }

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

    if (display) {
      const data: Record<string, unknown> = {}
      if (display.idleMinutes !== undefined) data.ambient_idle_minutes = display.idleMinutes
      if (display.night !== undefined) {
        data.night_start = display.night?.start ?? null
        data.night_end = display.night?.end ?? null
      }
      if (photoIds !== undefined) data.ambient_photo_ids = photoIds
      if (Object.keys(data).length > 0) {
        await prisma!.family.update({ where: { id: familyId }, data })
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
