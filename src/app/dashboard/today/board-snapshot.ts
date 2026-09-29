/**
 * Loads the Today board with its display settings and change version (#271).
 *
 * One function for every caller, so the board and its version can never
 * disagree:
 *
 * - the person page (/dashboard/today) and GET /api/device/today load the full
 *   board (`withWeather: true`);
 * - the version routes (GET /api/family/board-version, GET
 *   /api/device/today/version) load it without the forecast and return only
 *   `version`.
 *
 * `version` is a hash of exactly what the board shows (minus `generatedAt` and
 * the forecast itself) plus the display settings and the weather settings. The
 * board re-fetches only when it changes. Hashing the board's own bounded,
 * indexed, `select`-only reads is what makes the check exact: chores have no
 * `updated_at`, and a deleted row leaves no timestamp behind. A forecast that
 * ages out is picked up by the client's slower full refresh instead
 * (src/lib/board-sync.ts), so a weather fetch never changes the version.
 *
 * Audience rules (SHARED_DEVICE.md §9.1): the device audience gets the display
 * settings (idle minutes, night hours) but never photos; the photo ids column
 * is not even read for it.
 */
import { createHash } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { normalizeFeatures } from '@/lib/features'
import { getBoardWeather, isWeatherEnabled } from '@/lib/weather/board-weather'
import { CHORE_PHOTO_FILENAME_RE, chorePhotoPath } from '@/lib/chore-photos'
import { MAX_AMBIENT_PHOTOS, idleMinutesFrom, nightHoursFrom } from '@/lib/ambient'
import { buildTodayBoard, type BoardDisplayData, type BoardPhoto, type TodayBoardData } from './today-board-data'

type Db = Pick<
  PrismaClient,
  | 'user'
  | 'event'
  | 'chore'
  | 'familyMeal'
  | 'calendarSubscription'
  | 'listItem'
  | 'inventoryItem'
  | 'family'
  | 'weatherCache'
  | 'upload'
>

export type LoadTodayBoardOptions = {
  familyId: string
  now?: Date
  /** Include the forecast (full board). Version checks leave it out. */
  withWeather?: boolean
} & ({ audience?: 'person'; role: string | null | undefined } | { audience: 'device'; role?: never })

/** Photo types a browser can draw (HEIC is stored for chores but not displayable). */
const DISPLAYABLE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * The household's chosen calm-display photos, in the parent's order. Only
 * Upload rows of this household, with a stored-filename shape and a type the
 * browser can show; anything else (deleted, foreign, HEIC) is skipped.
 */
export async function loadAmbientPhotos(
  db: Pick<PrismaClient, 'upload'>,
  familyId: string,
  ids: readonly string[] | null | undefined
): Promise<BoardPhoto[]> {
  const wanted = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))].slice(
    0,
    MAX_AMBIENT_PHOTOS
  )
  if (wanted.length === 0) return []
  const rows = await db.upload.findMany({
    where: { id: { in: wanted }, family_id: familyId },
    select: { id: true, filename: true, content_type: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: BoardPhoto[] = []
  for (const id of wanted) {
    const row = byId.get(id)
    if (!row || !CHORE_PHOTO_FILENAME_RE.test(row.filename) || !DISPLAYABLE_PHOTO_TYPES.has(row.content_type)) continue
    out.push({ id: row.id, url: chorePhotoPath(row.filename) })
  }
  return out
}

/** Stable, opaque hash of what the board shows. */
export function boardVersion(board: TodayBoardData, weatherKey: unknown): string {
  // generatedAt changes every request; the forecast is refreshed separately.
  const { generatedAt: _generatedAt, weather: _weather, version: _version, ...shown } = board
  void _generatedAt
  void _weather
  void _version
  const hash = createHash('sha256').update(JSON.stringify([shown, weatherKey])).digest('hex')
  return `v1-${hash.slice(0, 24)}`
}

export async function loadTodayBoard(db: Db, options: LoadTodayBoardOptions): Promise<TodayBoardData> {
  const { familyId, withWeather = false } = options
  const isDevice = options.audience === 'device'
  const now = options.now ?? new Date()

  const family = await db.family.findUnique({
    where: { id: familyId },
    select: {
      features: true,
      weather_enabled: true,
      weather_label: true,
      weather_unit: true,
      weather_latitude: true,
      weather_longitude: true,
      ambient_idle_minutes: true,
      night_start: true,
      night_end: true,
      // Photos are for signed-in members only (§9.1): never read for a device.
      ...(isDevice ? {} : { ambient_photo_ids: true }),
    },
  })
  const features = normalizeFeatures(family?.features)

  const [board, weather, photos] = await Promise.all([
    isDevice
      ? buildTodayBoard(db, { familyId, audience: 'device', features, now })
      : buildTodayBoard(db, { familyId, role: options.role, features, now }),
    withWeather ? getBoardWeather(db, { familyId, now }) : Promise.resolve(null),
    isDevice
      ? Promise.resolve(null)
      : loadAmbientPhotos(db, familyId, (family as { ambient_photo_ids?: string[] } | null)?.ambient_photo_ids),
  ])

  const display: BoardDisplayData = {
    idleMinutes: idleMinutesFrom(family?.ambient_idle_minutes),
    night: nightHoursFrom(family?.night_start, family?.night_end),
    ...(photos ? { photos } : {}),
  }
  // Weather settings, not the forecast: turning weather on or moving the
  // place changes the version; a new forecast does not.
  const weatherKey =
    isWeatherEnabled() && family?.weather_enabled
      ? [family.weather_label, family.weather_unit, family.weather_latitude, family.weather_longitude]
      : null

  const data: TodayBoardData = { ...board, display }
  return { ...data, weather: withWeather ? weather : undefined, version: boardVersion(data, weatherKey) }
}
