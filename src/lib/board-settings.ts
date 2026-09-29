/**
 * Today board settings (#262, #271, #274): member colours, the opt-in weather
 * place, the calm display and the shared-tablet writes switch.
 *
 * One implementation for both doors so validation and writes cannot drift:
 *
 * - `/api/family/board-settings` (parent person session, audience `person`);
 * - `/api/device/elevated/board-settings` (a paired tablet with a parent's
 *   elevation, audience `device`, SHARED_DEVICE.md §6.4).
 *
 * The device audience never sees or sets photos (O-15: photos stay off paired
 * tablets; `display.photoIds` is refused by its schema and `uploads` is not
 * read) and never receives the stored coordinates of the weather place, only
 * its label (§9.1: no coordinates on the device).
 */
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
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
import { isSharedDeviceEnabled } from '@/lib/device-http'

export type BoardSettingsAudience = 'person' | 'device'

// A client or a transaction: the routes apply a patch and its audit row in one transaction (#285).
type Db = Pick<Prisma.TransactionClient, 'family' | 'user' | 'upload' | 'weatherCache'>

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

const weatherSchema = z
  .object({
    enabled: z.boolean().optional(),
    place: placeSchema.nullable().optional(),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  })
  .strict()

const memberColorsSchema = z
  .record(z.string().min(1).max(64), z.enum(MEMBER_COLOR_KEYS).nullable())
  .refine((v) => Object.keys(v).length <= 50, 'Too many members')

const idleMinutesSchema = z
  .number()
  .int()
  .refine(isAmbientIdleChoice, `Choose one of ${AMBIENT_IDLE_CHOICES.join(', ')} minutes`)

const nightSchema = z
  .object({ start: clockSchema, end: clockSchema })
  .strict()
  .refine((v) => v.start !== v.end, 'Night hours need different start and end times')
  .nullable()

const deviceWritesSchema = z.object({ enabled: z.boolean() }).strict()

const personPatchSchema = z
  .object({
    weather: weatherSchema.optional(),
    memberColors: memberColorsSchema.optional(),
    display: z
      .object({
        idleMinutes: idleMinutesSchema.optional(),
        night: nightSchema.optional(),
        photoIds: z
          .array(z.string().min(1).max(64))
          .max(MAX_AMBIENT_PHOTOS, `Choose at most ${MAX_AMBIENT_PHOTOS} photos`)
          .optional(),
      })
      .strict()
      .optional(),
    deviceWrites: deviceWritesSchema.optional(),
  })
  .strict()

/** Same as the person schema without photos: a tablet can never choose photos (O-15). */
const devicePatchSchema = z
  .object({
    weather: weatherSchema.optional(),
    memberColors: memberColorsSchema.optional(),
    display: z
      .object({
        idleMinutes: idleMinutesSchema.optional(),
        night: nightSchema.optional(),
      })
      .strict()
      .optional(),
    deviceWrites: deviceWritesSchema.optional(),
  })
  .strict()

export type BoardSettingsPatch = z.infer<typeof personPatchSchema>

/** Top-level sections a patch touched, for the fixed-vocabulary audit (no values). */
export type BoardSettingsSection = 'weather' | 'memberColors' | 'display' | 'deviceWrites'

export function parseBoardSettingsPatch(
  body: unknown,
  audience: BoardSettingsAudience
): { ok: true; patch: BoardSettingsPatch; sections: BoardSettingsSection[] } | { ok: false; error: string } {
  const parsed = (audience === 'device' ? devicePatchSchema : personPatchSchema).safeParse(body)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid settings' }
  const patch = parsed.data as BoardSettingsPatch
  const sections = (['weather', 'memberColors', 'display', 'deviceWrites'] as const).filter((k) => patch[k] !== undefined)
  return { ok: true, patch, sections }
}

async function listPickerUploads(db: Db, familyId: string, selectedIds: string[]) {
  const [recent, selected] = await Promise.all([
    db.upload.findMany({
      where: { family_id: familyId, content_type: { in: DISPLAYABLE_PHOTO_TYPES } },
      select: { id: true, filename: true, created_at: true },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: MAX_UPLOADS_LISTED,
    }),
    selectedIds.length > 0
      ? db.upload.findMany({
          where: { family_id: familyId, id: { in: selectedIds }, content_type: { in: DISPLAYABLE_PHOTO_TYPES } },
          select: { id: true, filename: true, created_at: true },
        })
      : Promise.resolve([]),
  ])
  const recentIds = new Set(recent.map((u) => u.id))
  return [...recent, ...selected.filter((u) => !recentIds.has(u.id))]
}

export async function readBoardSettings(db: Db, familyId: string, audience: BoardSettingsAudience) {
  const isDevice = audience === 'device'
  const [family, members] = await Promise.all([
    db.family.findUnique({
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
        device_writes_enabled: true,
        // Photos are for signed-in members only (O-15): never read for a device.
        ...(isDevice ? {} : { ambient_photo_ids: true }),
      },
    }),
    db.user.findMany({
      where: { family_id: familyId },
      select: { id: true, name: true, board_color: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
  ])
  // The newest uploads to pick from, plus every photo already chosen (even an
  // older one past the cap), so a parent can always see and untick it (#281).
  const uploads = isDevice ? [] : await listPickerUploads(db, familyId, family?.ambient_photo_ids ?? [])
  const colors = resolveMemberColors(members)
  const hasPlace =
    !!family &&
    isValidLatitude(family.weather_latitude) &&
    isValidLongitude(family.weather_longitude) &&
    !!family.weather_label
  const unit: WeatherUnit = isWeatherUnit(family?.weather_unit) ? (family!.weather_unit as WeatherUnit) : 'celsius'
  const place = hasPlace
    ? isDevice
      ? { label: family!.weather_label! }
      : { label: family!.weather_label!, latitude: family!.weather_latitude!, longitude: family!.weather_longitude! }
    : null
  const displayBase = {
    idleMinutes: idleMinutesFrom(family?.ambient_idle_minutes),
    idleChoices: [...AMBIENT_IDLE_CHOICES],
    night: nightHoursFrom(family?.night_start, family?.night_end),
  }
  return {
    weather: {
      available: isWeatherEnabled(),
      enabled: Boolean(family?.weather_enabled),
      place,
      unit,
    },
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      color: colors.get(m.id)!,
      custom: isMemberColorKey(m.board_color),
    })),
    display: isDevice
      ? displayBase
      : {
          ...displayBase,
          photoIds: (family as { ambient_photo_ids?: string[] } | null)?.ambient_photo_ids ?? [],
          uploads: uploads
            .filter((u) => CHORE_PHOTO_FILENAME_RE.test(u.filename))
            .map((u) => ({ id: u.id, url: chorePhotoPath(u.filename), createdAt: u.created_at.toISOString() })),
        },
    // Shared-tablet writes (#274, SHARED_DEVICE.md §9.2): default off, the
    // household's own choice. `available` is the server kill switch.
    deviceWrites: {
      available: isSharedDeviceEnabled(),
      enabled: Boolean(family?.device_writes_enabled),
    },
  }
}

export type BoardSettingsError = { status: 400 | 409; error: string }

/**
 * Apply a validated patch to `familyId`. Every id in it must belong to that
 * household: a foreign and a missing id get the same 400, so nothing about
 * other households is revealed. Returns null on success.
 */
export async function applyBoardSettingsPatch(
  db: Db,
  familyId: string,
  patch: BoardSettingsPatch
): Promise<BoardSettingsError | null> {
  const { weather, memberColors, display, deviceWrites } = patch

  // Photos (#271): every id must be a displayable upload of this household.
  let photoIds: string[] | undefined
  if (display?.photoIds !== undefined) {
    photoIds = [...new Set(display.photoIds)]
    if (photoIds.length > 0) {
      const found = await db.upload.findMany({
        where: { id: { in: photoIds }, family_id: familyId, content_type: { in: DISPLAYABLE_PHOTO_TYPES } },
        select: { id: true },
      })
      if (found.length !== photoIds.length) return { status: 400, error: 'Unknown photo' }
    }
  }

  if (memberColors && Object.keys(memberColors).length > 0) {
    const ids = Object.keys(memberColors)
    const found = await db.user.findMany({
      where: { id: { in: ids }, family_id: familyId },
      select: { id: true },
    })
    if (found.length !== ids.length) return { status: 400, error: 'Unknown household member' }
  }

  if (weather) {
    const current = await db.family.findUnique({
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
      if (weather.enabled && !isWeatherEnabled()) return { status: 409, error: 'Weather is not available on this server' }
      if (weather.enabled && !placeAfter) return { status: 400, error: 'Choose a place before turning on weather' }
      data.weather_enabled = weather.enabled
    }
    // Removing the place turns weather off.
    if (weather.place === null) data.weather_enabled = false

    if (Object.keys(data).length > 0) {
      await db.family.update({ where: { id: familyId }, data })
    }
    // A new place, or turning weather off, drops the cached forecast.
    if (weather.place !== undefined || weather.enabled === false) {
      await db.weatherCache.deleteMany({ where: { family_id: familyId } })
    }
  }

  const familyData: Record<string, unknown> = {}
  if (display) {
    if (display.idleMinutes !== undefined) familyData.ambient_idle_minutes = display.idleMinutes
    if (display.night !== undefined) {
      familyData.night_start = display.night?.start ?? null
      familyData.night_end = display.night?.end ?? null
    }
    if (photoIds !== undefined) familyData.ambient_photo_ids = photoIds
  }
  if (deviceWrites) familyData.device_writes_enabled = deviceWrites.enabled
  if (Object.keys(familyData).length > 0) {
    await db.family.update({ where: { id: familyId }, data: familyData })
  }

  if (memberColors) {
    for (const [id, color] of Object.entries(memberColors)) {
      await db.user.updateMany({ where: { id, family_id: familyId }, data: { board_color: color } })
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// What a patch actually changed (#285 review): the household audit history
// records only sections whose persisted values differ before and after the
// patch, both read inside the same transaction. A no-op section
// (`{ weather: {} }`), a resubmitted value or a retry changes nothing and is
// not recorded.

const SECTION_COLUMNS = {
  weather: ['weather_enabled', 'weather_latitude', 'weather_longitude', 'weather_label', 'weather_unit'],
  display: ['ambient_idle_minutes', 'night_start', 'night_end', 'ambient_photo_ids'],
  deviceWrites: ['device_writes_enabled'],
} as const

export type BoardSettingsSnapshot = {
  family: Record<string, unknown> | null
  colors: Array<{ id: string; board_color: string | null }>
}

/** The persisted values every section is made of, for `changedBoardSections`. */
export async function boardSettingsSnapshot(db: Db, familyId: string): Promise<BoardSettingsSnapshot> {
  const select: Record<string, true> = {}
  for (const cols of Object.values(SECTION_COLUMNS)) for (const c of cols) select[c] = true
  const family = await db.family.findUnique({ where: { id: familyId }, select: select as never })
  const colors = await db.user.findMany({
    where: { family_id: familyId },
    select: { id: true, board_color: true },
    orderBy: { id: 'asc' },
  })
  return { family: (family as Record<string, unknown> | null) ?? null, colors }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** Sections whose persisted values differ between two snapshots, in a fixed order. */
export function changedBoardSections(
  before: BoardSettingsSnapshot,
  after: BoardSettingsSnapshot
): BoardSettingsSection[] {
  const differs = (cols: readonly string[]) => cols.some((c) => !sameValue(before.family?.[c], after.family?.[c]))
  const out: BoardSettingsSection[] = []
  if (differs(SECTION_COLUMNS.weather)) out.push('weather')
  if (!sameValue(before.colors, after.colors)) out.push('memberColors')
  if (differs(SECTION_COLUMNS.display)) out.push('display')
  if (differs(SECTION_COLUMNS.deviceWrites)) out.push('deviceWrites')
  return out
}
