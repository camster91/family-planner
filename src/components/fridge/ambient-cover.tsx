'use client'

import * as React from 'react'
import type { BoardPhoto } from '@/app/dashboard/today/today-board-data'
import { AMBIENT_PHOTO_MS, type AmbientState } from '@/lib/ambient'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import {
  formatLongDate,
  formatTime,
  type NextEventView,
  type WeatherView,
} from './board-model'
import { iconFor } from './weather-tile'

/**
 * The calm frame (clock, date, weather when on, the next event and tonight's
 * dinner in a corner, optional household photos) and/or the night dimming
 * layer. Covers the whole screen; the first tap or key only returns to the
 * board. Fades in unless the viewer prefers reduced motion. The page cannot
 * change the tablet's backlight: dimming is a dark layer.
 */
export function AmbientCover({
  state,
  now,
  weather,
  next,
  dinner,
  photos,
  onWake,
}: {
  state: AmbientState
  now: Date
  weather: WeatherView | null
  next: NextEventView | null
  dinner: string | null
  photos: BoardPhoto[]
  onWake: () => void
}) {
  const [shown, setShown] = React.useState(false)
  const locale = useDisplayLocale()
  const [broken, setBroken] = React.useState<Set<string>>(() => new Set())
  const buttonRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(true))
    // Move focus off the (now inert) board, onto the cover's own control.
    buttonRef.current?.focus({ preventScroll: true })
    return () => window.cancelAnimationFrame(id)
  }, [])

  const usable = photos.filter((p) => !broken.has(p.id))
  const photo =
    state.ambient && usable.length > 0
      ? usable[Math.floor(now.getTime() / AMBIENT_PHOTO_MS) % usable.length]
      : null
  const current = weather?.weather.current
  const WeatherIcon = current ? iconFor(current.icon, current.isDay) : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={state.ambient ? 'Calm display' : 'Night dimming'}
      data-testid="ambient-cover"
      data-ambient={state.ambient ? 'true' : 'false'}
      data-dim={state.dim ? 'true' : 'false'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onWake()
      }}
      className={[
        'fixed inset-0 z-[80] cursor-pointer select-none overflow-hidden',
        state.ambient ? 'bg-[#0d1117] text-white' : 'bg-transparent',
        shown ? 'opacity-100' : 'opacity-0 motion-reduce:opacity-100',
        'motion-safe:transition-opacity motion-safe:duration-1000',
      ].join(' ')}
    >
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- household-scoped, same-origin file route; no optimiser
        <img
          key={photo.id}
          src={photo.url}
          alt=""
          data-testid="ambient-photo"
          onError={() => setBroken((prev) => new Set(prev).add(photo.id))}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {photo && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/60"
        />
      )}
      <div className="relative flex h-full flex-col justify-between p-8 lg:p-12 2xl:p-16">
        <div>
          {state.ambient && (
            <>
              <p
                data-testid="ambient-clock"
                className="text-[88px] font-semibold leading-none tabular-nums md:text-[120px] 2xl:text-[160px]"
              >
                <span className="sr-only">Time: </span>
                {formatTime(now, locale)}
              </p>
              <p
                data-testid="ambient-date"
                className="mt-3 text-[28px] font-medium md:text-[36px] 2xl:text-[44px]"
              >
                {formatLongDate(now, locale)}
              </p>
              {current && WeatherIcon && (
                <p
                  data-testid="ambient-weather"
                  className="mt-4 flex items-center gap-3 text-[26px] md:text-[30px] 2xl:text-[36px]"
                >
                  <WeatherIcon
                    className="h-9 w-9 shrink-0 2xl:h-11 2xl:w-11"
                    aria-hidden="true"
                  />
                  <span className="tabular-nums">
                    {current.temperature}°{weather!.weather.unit}
                  </span>
                  <span>{current.summary}</span>
                </p>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6">
          {state.ambient && (
            <div className="min-w-0 max-w-[40rem] space-y-3 text-[22px] md:text-[24px] 2xl:text-[28px]">
              {next && (
                <p data-testid="ambient-next" className="break-words">
                  <span className="font-semibold">Next · {next.when}</span>
                  <span className="block">{next.title}</span>
                </p>
              )}
              {dinner && (
                <p data-testid="ambient-dinner" className="break-words">
                  <span className="font-semibold">Tonight</span>
                  <span className="block">{dinner}</span>
                </p>
              )}
            </div>
          )}
          <div className="relative z-10 ml-auto flex flex-col items-end gap-3">
            {state.ambient && (
              <p className="text-[18px] text-white/80 md:text-[20px]">
                Tap anywhere to show the board
              </p>
            )}
            <button
              ref={buttonRef}
              type="button"
              className="btn-primary min-h-11"
            >
              Show the board
            </button>
          </div>
        </div>
      </div>
      {state.dim && (
        <div
          aria-hidden="true"
          data-testid="night-dim"
          className="pointer-events-none absolute inset-0 bg-black/70"
        />
      )}
    </div>
  )
}

export default AmbientCover
