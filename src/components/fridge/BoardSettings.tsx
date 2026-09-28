'use client'

import * as React from 'react'
import { CloudSun, Search } from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
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
 */

interface Place {
  label: string
  latitude: number
  longitude: number
}

interface BoardSettingsData {
  weather: { available: boolean; enabled: boolean; place: Place | null; unit: 'celsius' | 'fahrenheit' }
  members: Array<{ id: string; name: string; color: MemberColorKey; custom: boolean }>
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

export default function BoardSettings() {
  const [data, setData] = React.useState<BoardSettingsData | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<Place[] | null>(null)
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch('/api/family/board-settings')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res))
        return res.json()
      })
      .then((body: BoardSettingsData) => {
        if (!cancelled) setData(body)
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = React.useCallback(async (patch: object, done: string) => {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const res = await fetch('/api/family/board-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setError(await readError(res))
        return false
      }
      setData(await res.json())
      setStatus(done)
      return true
    } catch {
      setError('Could not save. Check your connection and try again.')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

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
      const res = await fetch(`/api/family/board-settings/places?q=${encodeURIComponent(q)}`)
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const body = (await res.json()) as { places: Place[] }
      setResults(body.places)
    } catch {
      setError('Place search is not reachable right now.')
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
          <h2 id="board-settings-title" className="text-title-3 font-semibold text-label-primary">
            Today board
          </h2>
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
          </>
        )}
      </div>
    </section>
  )
}
