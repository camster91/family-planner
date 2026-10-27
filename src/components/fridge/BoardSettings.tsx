'use client'

import * as React from 'react'
import { runOwnedForeground } from '@/lib/owned-request-http'
import { readBoundedJsonResponse } from '@/lib/bounded-json-response'
import { CloudSun, Search } from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { boardSettingsEnglish, useBoardSettingsText, type BoardSettingsTextKey } from '@/i18n/board-settings'
import {
  MEMBER_COLOR_CSS,
  MEMBER_COLOR_KEYS,
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

type BoardNotice =
  | { key: BoardSettingsTextKey; params?: Record<string, string | number> }
  | { message: string }
function notice(key: BoardSettingsTextKey, params?: Record<string, string | number>): BoardNotice {
  return { key, params }
}
// Only our known transport fallbacks are translated. Custom/server diagnostics
// remain literal; transport interfaces and caller error semantics stay compatible.
const transportErrorKeys = ['genericError', 'loadError', 'saveError', 'searchError', 'uploadError', 'unconfirmed'] as const

const buttonClass =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-[17px] font-semibold focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50'

async function personRequest<T>(input: string, init: RequestInit | undefined, offline: string): Promise<T> {
  const writing = (init?.method ?? 'GET').toUpperCase() !== 'GET'
  const result = await runOwnedForeground(async signal => {
    const response = await fetch(input, { ...init, signal, credentials: 'same-origin', cache: 'no-store' })
    const body = await readBoundedJsonResponse(response, signal, 2 * 1024 * 1024)
    return { kind: 'reply' as const, response, body }
  }, { signal: init?.signal, timeoutMs: writing ? (init?.body instanceof FormData ? 90000 : 45000) : 15000 })
  if (result.kind !== 'reply') throw new Error(writing ? boardSettingsEnglish.unconfirmed : offline)
  if (!result.response.ok) {
    const body = result.body as { error?: unknown } | null
    throw new Error(typeof body?.error === 'string' ? body.error : boardSettingsEnglish.genericError)
  }
  return result.body as T
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

function messageOf(err: unknown, fallback: BoardSettingsTextKey): BoardNotice {
  if (!(err instanceof Error) || !err.message) return notice(fallback)
  const key = transportErrorKeys.find((key) => boardSettingsEnglish[key] === err.message)
  return key ? notice(key) : { message: err.message }
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
  const text = useBoardSettingsText()
  const showNotice = (value: BoardNotice) => 'key' in value ? text(value.key, value.params) : value.message
  const [data, setData] = React.useState<BoardSettingsData | null>(null)
  const [loadError, setLoadError] = React.useState<BoardNotice | null>(null)
  const [loadRetry, setLoadRetry] = React.useState(0)
  const transportEpoch = React.useRef(0)
  const savePending = React.useRef<number | null>(null)
  const searchPending = React.useRef<number | null>(null)
  const uploadPending = React.useRef<number | null>(null)
  const [status, setStatus] = React.useState<BoardNotice | null>(null)
  const [error, setError] = React.useState<BoardNotice | null>(null)
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
    void save({ display: { photoIds: next } }, on ? notice('photoAdded') : notice('photoRemoved'))
  }

  const uploadPhoto = async (file: File) => {
    if (!transport.uploadPhoto || uploadPending.current !== null || savePending.current !== null) return
    const epoch = transportEpoch.current; uploadPending.current = epoch
    setUploading(true)
    setError(null)
    setStatus(null)
    try {
      const { filename } = await transport.uploadPhoto(file)
      if (epoch !== transportEpoch.current) return
      // Re-read the household's uploads, then choose the new one.
      const fresh = await transport.load()
      if (epoch !== transportEpoch.current) return
      setData(fresh)
      const added = fresh.display?.uploads?.find((u) => filename && u.url.endsWith(`/${filename}`))
      if (!added) {
        setError(notice('photoUnsupported'))
        return
      }
      const ids = fresh.display?.photoIds ?? []
      if (!ids.includes(added.id)) {
        await save({ display: { photoIds: [...ids, added.id] } }, notice('photoReady'))
      } else {
        setStatus(notice('photoAlready'))
      }
    } catch (err) {
      if (epoch === transportEpoch.current) setError(messageOf(err, 'uploadError'))
    } finally {
      if (epoch === transportEpoch.current && uploadPending.current === epoch) {
        uploadPending.current = null; setUploading(false)
      }
    }
  }

  React.useEffect(() => {
    let cancelled = false
    const epoch = ++transportEpoch.current
    savePending.current = null; searchPending.current = null; uploadPending.current = null
    setBusy(false); setSearching(false); setUploading(false); setError(null); setStatus(null); setResults(null)
    setData(null)
    setLoadError(null)
    transport
      .load()
      .then((body) => {
        if (!cancelled) setData(body)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err, 'loadError'))
      })
    return () => {
      cancelled = true
      if (transportEpoch.current === epoch) transportEpoch.current++
    }
  }, [transport, loadRetry])

  const save = React.useCallback(async (patch: object, done: BoardNotice) => {
    if (savePending.current !== null) return false
    const epoch = transportEpoch.current; savePending.current = epoch
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const fresh = await transport.save(patch)
      if (epoch !== transportEpoch.current) return false
      setData(fresh)
      setStatus(done)
      return true
    } catch (err) {
      if (epoch === transportEpoch.current) setError(messageOf(err, 'saveError'))
      return false
    } finally {
      if (epoch === transportEpoch.current && savePending.current === epoch) {
        savePending.current = null; setBusy(false)
      }
    }
  }, [transport])

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (searchPending.current !== null || savePending.current !== null) return
    const q = query.trim()
    if (q.length < 2) {
      setError(notice('shortQuery'))
      return
    }
    const epoch = transportEpoch.current; searchPending.current = epoch
    setSearching(true)
    setError(null)
    setResults(null)
    try {
      const places = await transport.searchPlaces(q)
      if (epoch === transportEpoch.current) setResults(places)
    } catch (err) {
      if (epoch === transportEpoch.current) setError(messageOf(err, 'searchError'))
    } finally {
      if (epoch === transportEpoch.current && searchPending.current === epoch) {
        searchPending.current = null; setSearching(false)
      }
    }
  }

  return (
    <section aria-labelledby="board-settings-title" data-testid="board-settings" className="card-apple overflow-hidden">
      <div className="space-y-6 p-4">
        <div className="flex items-center gap-3">
          <Glyph color="calendar" size="md">
            <CloudSun className="h-4 w-4" aria-hidden="true" />
          </Glyph>
          <Heading id="board-settings-title" className="text-title-3 font-semibold text-label-primary">{text("title")}</Heading>
        </div>

        {loadError && (
          <div className="space-y-2">
            <p role="alert" className="text-subhead text-[var(--danger-text)]">{showNotice(loadError)}</p>
            <button type="button" className={`${buttonClass} bg-[var(--surface-fill)] text-label-primary`}
              onClick={() => setLoadRetry(value => value + 1)}>{text('retryLoad')}</button>
          </div>
        )}
        {!data && !loadError && (
          <p role="status" className="text-subhead text-label-secondary">{text("loading")}</p>
        )}

        {data && (
          <>
            <div role="status" aria-live="polite" className="min-h-0">
              {status && <p className="text-subhead text-label-primary">{showNotice(status)}</p>}
            </div>
            {error && (
              <p role="alert" className="text-subhead text-[var(--danger-text)]">
                {showNotice(error)}
              </p>
            )}

            <fieldset className="space-y-3">
              <legend className="text-headline font-semibold text-label-primary">{text("memberColours")}</legend>
              <p className="text-subhead text-label-secondary">{text("colourHint")}</p>
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
                          notice('colourSaved', { name: m.name })
                        )
                      }
                      className="input-apple min-h-[44px]"
                    >
                      <option value="">{text('automatic', { colour: text(m.color) })}</option>
                      {MEMBER_COLOR_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {text(k)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-headline font-semibold text-label-primary">{text("weather")}</legend>
              {!data.weather.available ? (
                <p className="text-subhead text-label-secondary">{text("weatherUnavailable")}</p>
              ) : (
                <>
                  <p className="text-subhead text-label-secondary" data-testid="weather-privacy-note">{text("weatherPrivacy")}</p>

                  <p className="text-body text-label-primary">{text("place")}<strong>{data.weather.place ? data.weather.place.label : text('noPlace')}</strong>
                  </p>

                  <form onSubmit={search} className="flex flex-wrap items-end gap-3" role="search">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="weather-place" className="mb-2 block text-subhead font-medium text-label-primary">{text("findPlace")}</label>
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
                      {text("search")}
                    </button>
                  </form>

                  {results && (
                    <div>
                      {results.length === 0 ? (
                        <p className="text-subhead text-label-secondary">{text("noResults")}</p>
                      ) : (
                        <ul aria-label={text('placesFound')} className="space-y-2">
                          {results.map((p) => (
                            <li key={`${p.label}|${p.latitude}|${p.longitude}`}>
                              <button
                                type="button"
                                disabled={busy}
                                className={`${buttonClass} w-full justify-start rounded-[var(--radius-md)] bg-[var(--surface-fill)] text-left text-label-primary`}
                                onClick={async () => {
                                  if (await save({ weather: { place: p } }, notice('placeSaved', { name: p.label }))) {
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
                          e.target.checked ? notice('weatherOn') : notice('weatherOff')
                        )
                      }
                    />
                    {text("showWeather")}
                  </label>
                  {!data.weather.place && (
                    <p className="text-subhead text-label-secondary">{text("choosePlace")}</p>
                  )}

                  <div role="radiogroup" aria-label={text('temperatureUnit')} className="flex flex-wrap gap-4">
                    {(['celsius', 'fahrenheit'] as const).map((u) => (
                      <label key={u} className="flex min-h-[44px] items-center gap-2 text-body text-label-primary">
                        <input
                          type="radio"
                          name="weather-unit"
                          className="h-5 w-5"
                          checked={data.weather.unit === u}
                          disabled={busy}
                          onChange={() => void save({ weather: { unit: u } }, notice('unitSaved'))}
                        />
                        {text(u)}
                      </label>
                    ))}
                  </div>

                  {data.weather.place && (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${buttonClass} bg-[var(--surface-fill)] text-label-primary`}
                      onClick={() => void save({ weather: { place: null } }, notice('placeRemoved'))}
                    >{text("removePlace")}</button>
                  )}
                </>
              )}
            </fieldset>

            {data.display && (
              <>
                <fieldset className="space-y-3" data-testid="calm-display-settings">
                  <legend className="text-headline font-semibold text-label-primary">{text("calmScreen")}</legend>
                  <p className="text-subhead text-label-secondary">{text("calmHint")}</p>
                  <label htmlFor="calm-idle" className="block text-subhead font-medium text-label-primary">{text("fade")}</label>
                  <select
                    id="calm-idle"
                    value={data.display.idleMinutes}
                    disabled={busy}
                    onChange={(e) => {
                      const minutes = Number(e.target.value)
                      void save(
                        { display: { idleMinutes: minutes } },
                        minutes === 0
                          ? notice('calmOff')
                          : notice(minutes === 1 ? 'fadeOne' : 'fadeMany', { count: minutes })
                      )
                    }}
                    className="input-apple min-h-[44px]"
                  >
                    {data.display.idleChoices.map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? text('never') : m === 1 ? text('afterOne') : text('afterMany', { count: m })}
                      </option>
                    ))}
                  </select>
                </fieldset>

                <fieldset className="space-y-3" data-testid="night-hours-settings">
                  <legend className="text-headline font-semibold text-label-primary">{text("nightHours")}</legend>
                  <p className="text-subhead text-label-secondary">{text("nightHint")}</p>
                  <label className="flex min-h-[44px] items-center gap-3 text-body text-label-primary">
                    <input
                      type="checkbox"
                      className="h-6 w-6"
                      checked={data.display.night !== null}
                      disabled={busy}
                      onChange={(e) =>
                        void save(
                          { display: { night: e.target.checked ? night : null } },
                          e.target.checked ? notice('nightOn') : notice('nightOff')
                        )
                      }
                    />
                    {text("dimNight")}
                  </label>
                  {data.display.night && (
                    <form
                      className="flex flex-wrap items-end gap-3"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void save({ display: { night } }, notice('nightSaved'))
                      }}
                    >
                      <div>
                        <label htmlFor="night-start" className="mb-2 block text-subhead font-medium text-label-primary">{text("from")}</label>
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
                        <label htmlFor="night-end" className="mb-2 block text-subhead font-medium text-label-primary">{text("until")}</label>
                        <input
                          id="night-end"
                          type="time"
                          required
                          value={night.end}
                          onChange={(e) => setNight((n) => ({ ...n, end: e.target.value }))}
                          className="input-apple min-h-[44px]"
                        />
                      </div>
                      <button type="submit" disabled={busy} className={`${buttonClass} bg-accent-tint text-accent`}>{text("saveNight")}</button>
                    </form>
                  )}
                </fieldset>

                {photosEnabled && (
                <fieldset className="space-y-3" data-testid="calm-photos-settings">
                  <legend className="text-headline font-semibold text-label-primary">{text("familyPhotos")}</legend>
                  <p className="text-subhead text-label-secondary">{text("photosPrivacy")}</p>
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
                    {text(uploading ? 'uploading' : 'uploadPhoto')}
                  </label>
                  {(data.display.uploads ?? []).length === 0 ? (
                    <p className="text-subhead text-label-secondary">{text("noUploads")}</p>
                  ) : (
                    <ul aria-label={text('householdPhotos')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
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
                                {text('photoUploaded', { count: i + 1 })}{' '}
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
                      ? text('noChosenPhotos')
                      : text('chosenPhotos', { count: (data.display.photoIds ?? []).length })}
                  </p>
                </fieldset>
                )}
              </>
            )}

            {data.deviceWrites?.available && (
              <fieldset className="space-y-3" data-testid="device-writes-settings">
                <legend className="text-headline font-semibold text-label-primary">{text("familyTablet")}</legend>
                <p className="text-subhead text-label-secondary">{text("tabletPrivacy")}</p>
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
                          ? notice('tabletOn')
                          : notice('tabletOff')
                      )
                    }
                  />
                  {text("allowTablet")}
                </label>
              </fieldset>
            )}
          </>
        )}
      </div>
    </section>
  )
}
