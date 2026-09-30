/**
 * Fridge calm display and night hours (#271): pure rules shared by the board,
 * the settings API and their tests.
 *
 * - After `idleMinutes` without a touch or key press, the fridge board fades
 *   to a calm frame (clock, date, weather when enabled, next event, tonight's
 *   dinner). `0` turns the calm frame off.
 * - Night hours ("HH:MM" to "HH:MM" on the tablet's own clock, may cross
 *   midnight) dim the screen once the board has been left alone. The page can
 *   only draw a dark layer; it cannot change the hardware backlight.
 */

/** Idle timeouts a parent can choose, in minutes (0 = never). */
export const AMBIENT_IDLE_CHOICES = [0, 1, 2, 5, 10, 15, 30] as const
export const DEFAULT_AMBIENT_IDLE_MINUTES = 5
/** With the calm frame off, night dimming still waits this long after the last touch. */
export const NIGHT_IDLE_FALLBACK_MS = 60 * 1000
/** Most photos a parent can pick for the calm frame. */
export const MAX_AMBIENT_PHOTOS = 20
/** How long each photo stays before the next one. */
export const AMBIENT_PHOTO_MS = 60 * 1000

export interface NightHours {
  /** "HH:MM", 24-hour, local to the tablet. */
  start: string
  end: string
}

export interface BoardDisplay {
  /** Minutes without interaction before the calm frame (0 = never). */
  idleMinutes: number
  /** Night dimming window, or null when off. */
  night: NightHours | null
}

export const DEFAULT_BOARD_DISPLAY: BoardDisplay = { idleMinutes: DEFAULT_AMBIENT_IDLE_MINUTES, night: null }

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && CLOCK_RE.test(value)
}

/** Minutes after local midnight for "HH:MM", or null when malformed. */
export function clockMinutes(value: string): number | null {
  const m = CLOCK_RE.exec(value)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function isAmbientIdleChoice(value: unknown): value is number {
  return typeof value === 'number' && (AMBIENT_IDLE_CHOICES as readonly number[]).includes(value)
}

/** Night hours from stored columns: both valid and different, else off. */
export function nightHoursFrom(start: string | null | undefined, end: string | null | undefined): NightHours | null {
  if (!isClockTime(start) || !isClockTime(end) || start === end) return null
  return { start, end }
}

/** Idle minutes from the stored column, falling back to the default when out of range. */
export function idleMinutesFrom(value: number | null | undefined): number {
  return isAmbientIdleChoice(value) ? value : DEFAULT_AMBIENT_IDLE_MINUTES
}

/**
 * Whether `now` (the tablet's local wall clock) is inside the night window.
 * Start is inclusive, end exclusive. A window that crosses midnight
 * ("21:30" to "06:30") covers both sides of it.
 */
export function isNightTime(now: Date, night: NightHours | null | undefined): boolean {
  if (!night) return false
  const start = clockMinutes(night.start)
  const end = clockMinutes(night.end)
  if (start === null || end === null || start === end) return false
  const t = now.getHours() * 60 + now.getMinutes()
  return start < end ? t >= start && t < end : t >= start || t < end
}

export interface AmbientState {
  /** Show the calm frame instead of the board. */
  ambient: boolean
  /** Draw the night dimming layer. */
  dim: boolean
}

/**
 * What the fridge screen shows after `idleMs` without interaction.
 * Anything that is not the plain board (calm frame or dimming) covers it, and
 * the first tap or key only uncovers it.
 */
export function ambientState({
  idleMs,
  now,
  display,
}: {
  idleMs: number
  now: Date
  display: BoardDisplay
}): AmbientState {
  const timeout = display.idleMinutes > 0 ? display.idleMinutes * 60 * 1000 : 0
  const ambient = timeout > 0 && idleMs >= timeout
  const dim = isNightTime(now, display.night) && idleMs >= (timeout > 0 ? timeout : NIGHT_IDLE_FALLBACK_MS)
  return { ambient, dim }
}

/** "9:30 PM" for a stored "21:30" (settings summary text). */
export function formatClockTime(value: string): string {
  const minutes = clockMinutes(value)
  if (minutes === null) return value
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}
