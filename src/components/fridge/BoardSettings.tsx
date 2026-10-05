'use client'

import * as React from 'react'
import { CloudSun, Search } from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import {
  MEMBER_COLOR_CSS,
  MEMBER_COLOR_KEYS,
  MEMBER_COLOR_LABELS,
  type MemberColorKey,
} from '@/lib/member-colors'

/**
 * Parent settings for the Today board (#262): member colours and the opt-in
 * weather tile. Rendered on /dashboard/family/settings for parents only; the
 * API (/api/family/board-settings) enforces parent-only on its own.
 *
 * #274: the same component runs on a paired tablet under a parent's
 * elevation, with a transport that calls /api/device/elevated/board-settings.
 * The device audience has no photos (O-15) and no stored coordinates.
 */

export interface Place {
  label: string
  latitude: number
  longitude: number
}

interface DisplaySettings {
  idleMinutes: number
  idleChoices: number[]
  night: { start: string; end: string } | null
  /** Person audience only: a paired tablet never lists or picks photos. */
  photoIds?: string[]
  uploads?: Array<{ id: string; url: string; createdAt: string }>
}

export interface BoardSettingsData {
  weather: {
    available: boolean
    enabled: boolean
    /** The tablet gets the label only. */
    place: { label: string; latitude?: number; longitude?: number } | null
    unit: 'celsius' | 'fahrenheit'
  }
  members: Array<{ id: string; name: string; color: MemberColorKey; custom: boolean }>
  /** Calm display, night hours and photos (#271). Optional for older servers. */
  display?: DisplaySettings
  /** Shared-tablet writes (#274). Optional for older servers. */
  deviceWrites?: { available: boolean; enabled: boolean }
}

/** Where the settings are read and saved. Methods throw an Error whose message is shown. */
export interface BoardSettingsTransport {
  load(): Promise<BoardSettingsData>
  save(patch: object): Promise<BoardSettingsData>
  searchPlaces(query: string): Promise<Place[]>
  /** Photo upload for the calm screen; absent on a paired tablet. */
  uploadPhoto?: (file: File) => Promise<{ filename?: string }>
}

const DEFAULT_NIGHT = { start: '21:30', end: '06:30' }

function idleLabel(minutes: number): string {
  if (minutes === 0) return 'Never'
  return minutes === 1 ? 'After 1 minute' : `After ${minutes} minutes`
}

const buttonClass =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-[17px] font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50'

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch {
    // fall through
  }
  return 'Something went wrong. Try again.'
}

async function personRequest<T>(input: string, init: RequestInit | undefined, offline: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch {
    throw new Error(offline)
  }
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as T
}

/** The signed-in parent's routes (person session). */
export const personBoardSettingsTransport: BoardSettingsTransport = {
  load: () =>
    personRequest<BoardSettingsData>('/api/family/board-settings', undefined, 'Could not load board settings.'),
  save: (patch) =>
    personRequest<BoardSettingsData>(
      '/api/family/board-settings',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
      'Could not save. Check your connection and try again.'
    ),
  searchPlaces: async (q) =>
    (
      await personRequest<{ places: Place[] }>(
        `/api/family/board-settings/places?q=${encodeURIComponent(q)}`,
        undefined,
        'Place search is not reachable right now.'
      )
    ).places,
  uploadPhoto: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return personRequest<{ filename?: string }>(
      '/api/upload',
      { method: 'POST', body: fd },
      'Could not upload the photo. Check your connection and try again.'
    )
  },
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export default function BoardSettings({
  transport = personBoardSettingsTransport,
  headingLevel = 2,
}: {
  transport?: BoardSettingsTransport
  /** 2 on the settings page; the tablet's dialog already has its own title. */
  headingLevel?: 2 | 3
} = {}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const displayLocale = useDisplayLocale()
  const [data, setData] = React.useState<BoardSettingsData | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Place[] | null>(null)
  const [searching, setSearching] = React.useState(false)
  const [night, setNight] = React.useState(DEFAULT_NIGHT)
  const [uploading, setUploading] = React.useState(false)

  // Keep the night-hours inputs in step with what is saved.
  const savedNight = data?.display?.night
  React.useEffect(() => {
    if (savedNight) setNight(savedNight)
  }, [savedNight])

  const photosEnabled = Boolean(transport.uploadPhoto) && data?.display?.uploads !== undefined

  const togglePhoto = (id: string, on: boolean) => {
    const current = data?.display?.photoIds ?? []
    const next = on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)
    void save({ display: { photoIds: next } }, on ? 'Photo added to the calm screen.' : 'Photo removed from the calm screen.')
  }

  const uploadPhoto = async (file: File) => {
    if (!transport.uploadPhoto) return
    setUploading(true)
    setError(null)
    setStatus(null)
    try {
      const { filename } = await transport.uploadPhoto(file)
      // Re-read the household's uploads, then choose the new one.
      const fresh = await transport.load()
      setData(fresh)
      const added = fresh.display?.uploads?.find((u) => filename && u.url.endsWith(`/${filename}`))
      if (!added) {
        setError('That photo cannot be shown on the calm screen. Use a JPEG, PNG or WebP photo.')
        return
      }
      const ids = fresh.display?.photoIds ?? []
      if (!ids.includes(added.id)) {
        await save({ display: { photoIds: [...ids, added.id] } }, 'Photo uploaded and added to the calm screen.')
      } else {
        setStatus('That photo is already on the calm screen.')
      }
    } catch (err) {
      setError(messageOf(err, 'Could not upload the photo. Check your connection and try again.'))
    } finally {
      setUploading(false)
    }
  }

  React.useEffect(() => {
    let cancelled = false
    transport
      .load()
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err, 'Could not load board settings.'))
      })
    return () => {
      cancelled = true
    }
  }, [transport])

  const save = React.useCallback(async (patch: object, done: string) => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      setData(await transport.save(patch))
      setStatus(done)
      return true
    } catch (err) {
      setError(messageOf(err, 'Could not save. Check your connection and try again.'))
      return false
    } finally {
      setBusy(false)
    }
  }, [transport])

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q.length < 2) {
      setError('Type at least 2 characters to search.')
      return
    }
    setSearching(true)
    setError(null)
    setResults(null)
    try {
      setResults(await transport.searchPlaces(q))
    } catch (err) {
      setError(messageOf(err, 'Place search is not reachable right now.'))
    } finally {
      setSearching(false)
    }
  }

  return (
    <section aria-labelledby="board-settings-title" data-testid="board-settings" className="card-apple overflow-hidden">
      <div className="space-y-6 p-4">
        <div className="flex items-center gap-3">
          <Glyph color="calendar" size="md">
            <CloudSun className="h-4 w-4" aria-hidden="true" />
          </Glyph>
          <Heading id="board-settings-title" className="text-title-3 font-semibold text-label-primary">
            Today board
          </Heading>
        </div>

        {loadError && (
          <p role="alert" className="text-subhead text-[var(--danger-text)]">
            {loadError}
          </p>
        )}
        {!data && !loadError && (
          <p role="status" className="text-subhead text-label-secondary">
            Loading board settings…
          </p>
        )}

        {data && (
          <>
            <div role="status" aria-live="polite" className="min-h-0">
              {status && <p className="text-subhead text-label-primary">{status}</p>}
            </div>
            {error && (
              <p role="alert" className="text-subhead text-[var(--danger-text)]">
                {error}
              </p>
            )}

            <fieldset className="space-y-3">
              <legend className="text-headline font-semibold text-label-primary">Member colours</legend>
              <p className="text-subhead text-label-secondary">
                Each person&apos;s colour marks their chores and the events they add on the board, always next to
                their name.
              </p>
              <ul className="space-y-2">
                {data.members.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3" data-testid="board-member-color">
                    <span
                      aria-hidden="true"
                      className="h-6 w-6 shrink-0 rounded-full"
                      style={{ backgroundColor: MEMBER_COLOR_CSS[m.color] }}
                    />
                    <label htmlFor={`member-color-${m.id}`} className="min-w-0 flex-1 text-body text-label-primary">
                      {m.name}
                    </label>
                    <select
                      id={`member-color-${m.id}`}
                      value={m.custom ? m.color : ''}
                      disabled={busy}
                      onChange={(e) =>
                        void save(
                          { memberColors: { [m.id]: e.target.value || null } },
                          `${m.name}'s colour saved.`
                        )
                      }
                      className="input-apple min-h-[44px]"
                    >
                      <option value="">Automatic ({MEMBER_COLOR_LABELS[m.color]})</option>
                      {MEMBER_COLOR_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {MEMBER_COLOR_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-headline font-semibold text-label-primary">Weather</legend>
              {!data.weather.available ? (
                <p className="text-subhead text-label-secondary">Weather is turned off on this server.</p>
              ) : (
                <>
                  <p className="text-subhead text-label-secondary" data-testid="weather-privacy-note">
                    Off unless you turn it on. When it is on, the server sends the place you choose, rounded to about
                    1 km, to Open-Meteo (a free weather service) to get the forecast. No names or other household
                    information are sent. The board shows the place name you pick.
                  </p>

                  <p className="text-body text-label-primary">
                    Place: <strong>{data.weather.place ? data.weather.place.label : 'none chosen'}</strong>
                  </p>

                  <form onSubmit={search} className="flex flex-wrap items-end gap-3" role="search">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="weather-place" className="mb-2 block text-subhead font-medium text-label-primary">
                        Find a town or city
                      </label>
                      <input
                        id="weather-place"
                        type="search"
                        value={query}
                        maxLength={80}
                        onChange={(e) => setQuery(e.target.value)}
                        className="input-apple min-h-[44px] w-full"
                        autoComplete="off"
                      />
                    </div>
                    <button type="submit" disabled={searching} className={`${buttonClass} bg-accent-tint text-accent`}>
                      <Search className="h-5 w-5" aria-hidden="true" />
                      Search
                    </button>
                  </form>

                  {results && (
                    <div>
                      {results.length === 0 ? (
                        <p className="text-subhead text-label-secondary">No places found. Try another spelling.</p>
                      ) : (
                        <ul aria-label="Places found" className="space-y-2">
                          {results.map((p) => (
                            <li key={`${p.label}|${p.latitude}|${p.longitude}`}>
                              <button
                                type="button"
                                disabled={busy}
                                className={`${buttonClass} w-full justify-start rounded-[var(--radius-md)] bg-[var(--surface-fill)] text-left text-label-primary`}
                                onClick={async () => {
                                  if (await save({ weather: { place: p } }, `Place set to ${p.label}.`)) {
                                    setResults(null)
                                    setQuery('')
                                  }
                                }}
                              >
                                {p.label}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <label className="flex min-h-[44px] items-center gap-3 text-body text-label-primary">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={data.weather.enabled}
                      disabled={busy || !data.weather.place}
                      onChange={(e) =>
                        void save(
                          { weather: { enabled: e.target.checked } },
                          e.target.checked ? 'Weather is on for the board.' : 'Weather is off.'
                        )
                      }
                    />
                    Show weather on the Today board
                  </label>
                  {!data.weather.place && (
                    <p className="text-subhead text-label-secondary">Choose a place first.</p>
                  )}

                  <div role="radiogroup" aria-label="Temperature unit" className="flex flex-wrap gap-4">
                    {(['celsius', 'fahrenheit'] as const).map((u) => (
                      <label key={u} className="flex min-h-[44px] items-center gap-2 text-body text-label-primary">
                        <input
                          type="radio"
                          name="weather-unit"
                          className="h-5 w-5"
                          checked={data.weather.unit === u}
                          disabled={busy}
                          onChange={() => void save({ weather: { unit: u } }, 'Temperature unit saved.')}
                        />
                        {u === 'celsius' ? 'Celsius (°C)' : 'Fahrenheit (°F)'}
                      </label>
                    ))}
                  </div>

                  {data.weather.place && (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${buttonClass} bg-[var(--surface-fill)] text-label-primary`}
                      onClick={() => void save({ weather: { place: null } }, 'Place removed and weather turned off.')}
                    >
                      Remove place
                    </button>
                  )}
                </>
              )}
            </fieldset>

            {data.display && (
              <>
                <fieldset className="space-y-3" data-testid="calm-display-settings">
                  <legend className="text-headline font-semibold text-label-primary">Calm screen</legend>
                  <p className="text-subhead text-label-secondary">
                    In fridge mode, when nobody has touched the board for a while, it fades to a calm screen: the
                    time, the date, the weather (when it is on), the next event and tonight&apos;s dinner. A tap
                    brings the board back.
                  </p>
                  <label htmlFor="calm-idle" className="block text-subhead font-medium text-label-primary">
                    Fade to the calm screen
                  </label>
                  <select
                    id="calm-idle"
                    value={data.display.idleMinutes}
                    disabled={busy}
                    onChange={(e) => {
                      const minutes = Number(e.target.value)
                      void save(
                        { display: { idleMinutes: minutes } },
                        minutes === 0
                          ? 'The calm screen is off.'
                          : `The board fades after ${minutes} minute${minutes === 1 ? '' : 's'} without a touch.`
                      )
                    }}
                    className="input-apple min-h-[44px]"
                  >
                    {data.display.idleChoices.map((m) => (
                      <option key={m} value={m}>
                        {idleLabel(m)}
                      </option>
                    ))}
                  </select>
                </fieldset>

                <fieldset className="space-y-3" data-testid="night-hours-settings">
                  <legend className="text-headline font-semibold text-label-primary">Night hours</legend>
                  <p className="text-subhead text-label-secondary">
                    Dims the fridge screen between these times, on the tablet&apos;s own clock, once the board has been
                    left alone. The app can only darken what it shows; it cannot turn down the tablet&apos;s backlight,
                    so use the tablet&apos;s display settings for that.
                  </p>
                  <label className="flex min-h-[44px] items-center gap-3 text-body text-label-primary">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={data.display.night !== null}
                      disabled={busy}
                      onChange={(e) =>
                        void save(
                          { display: { night: e.target.checked ? night : null } },
                          e.target.checked ? 'Night hours are on.' : 'Night hours are off.'
                        )
                      }
                    />
                    Dim the screen at night
                  </label>
                  {data.display.night && (
                    <form
                      className="flex flex-wrap items-end gap-3"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void save({ display: { night } }, 'Night hours saved.')
                      }}
                    >
                      <div>
                        <label htmlFor="night-start" className="mb-2 block text-subhead font-medium text-label-primary">
                          From
                        </label>
                        <input
                          id="night-start"
                          type="time"
                          required
                          value={night.start}
                          onChange={(e) => setNight((n) => ({ ...n, start: e.target.value }))}
                          className="input-apple min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label htmlFor="night-end" className="mb-2 block text-subhead font-medium text-label-primary">
                          Until
                        </label>
                        <input
                          id="night-end"
                          type="time"
                          required
                          value={night.end}
                          onChange={(e) => setNight((n) => ({ ...n, end: e.target.value }))}
                          className="input-apple min-h-[44px]"
                        />
                      </div>
                      <button type="submit" disabled={busy} className={`${buttonClass} bg-accent-tint text-accent`}>
                        Save night hours
                      </button>
                    </form>
                  )}
                </fieldset>

                {photosEnabled && (
                <fieldset className="space-y-3" data-testid="calm-photos-settings">
                  <legend className="text-headline font-semibold text-label-primary">Family photos</legend>
                  <p className="text-subhead text-label-secondary">
                    Optional. Photos you choose from your household&apos;s own uploads show on the calm screen of a
                    signed-in fridge board. They are not shown on a paired shared tablet, and the calm screen never
                    shows ads.
                  </p>
                  {/* The file input is visually hidden, so the label shows its keyboard focus. */}
                  <label
                    className={`${buttonClass} w-fit cursor-pointer bg-[var(--surface-fill)] text-label-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent-text)]`}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={uploading || busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void uploadPhoto(file)
                      }}
                    />
                    {uploading ? 'Uploading…' : 'Upload a photo'}
                  </label>
                  {(data.display.uploads ?? []).length === 0 ? (
                    <p className="text-subhead text-label-secondary">No household photos uploaded yet.</p>
                  ) : (
                    <ul aria-label="Household photos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                      {(data.display.uploads ?? []).map((u, i) => {
                        const chosen = (data.display!.photoIds ?? []).includes(u.id)
                        return (
                          <li key={u.id}>
                            <label className="flex min-h-[44px] cursor-pointer flex-col gap-2 text-subhead text-label-primary">
                              {/* eslint-disable-next-line @next/next/no-img-element -- household-scoped file route */}
                              <img
                                src={u.url}
                                alt=""
                                loading="lazy"
                                className="aspect-[4/3] w-full rounded-[var(--radius-md)] object-cover"
                              />
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-6 w-6"
                                  checked={chosen}
                                  disabled={busy || (!chosen && (data.display!.photoIds ?? []).length >= 20)}
                                  onChange={(e) => togglePhoto(u.id, e.target.checked)}
                                />
                                Photo {i + 1}, uploaded{' '}
                                {new Date(u.createdAt).toLocaleDateString(displayLocale, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="text-subhead text-label-secondary">
                    {(data.display.photoIds ?? []).length === 0
                      ? 'No photos chosen: the calm screen is plain.'
                      : `${(data.display.photoIds ?? []).length} of up to 20 photos chosen.`}
                  </p>
                </fieldset>
                )}
              </>
            )}

            {data.deviceWrites?.available && (
              <fieldset className="space-y-3" data-testid="device-writes-settings">
                <legend className="text-headline font-semibold text-label-primary">Family tablet</legend>
                <p className="text-subhead text-label-secondary">
                  Off unless you turn it on. When it is on, a paired family tablet can tick off groceries, add to the
                  grocery list and mark today&apos;s chores done. It asks &ldquo;Who&apos;s this?&rdquo; and records the
                  name picked, but anyone at the tablet can pick any name. Chores ticked there still wait for a
                  parent&apos;s check, and the tablet never shows points.
                </p>
                <label className="flex min-h-[44px] items-center gap-3 text-body text-label-primary">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={data.deviceWrites.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      void save(
                        { deviceWrites: { enabled: e.target.checked } },
                        e.target.checked
                          ? 'The family tablet can tick things off.'
                          : 'The family tablet is read-only again.'
                      )
                    }
                  />
                  Let the family tablet tick things off
                </label>
              </fieldset>
            )}
          </>
        )}
      </div>
    </section>
  )
}
