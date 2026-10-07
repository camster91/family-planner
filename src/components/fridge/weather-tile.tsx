'use client'

import * as React from 'react'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import type { WeatherIconKind } from '@/lib/weather/codes'
import { shortWeekday, type WeatherView } from './board-model'

export function iconFor(kind: WeatherIconKind, isDay = true): LucideIcon {
  switch (kind) {
    case 'clear':
      return isDay ? Sun : Moon
    case 'partly':
      return isDay ? CloudSun : CloudMoon
    case 'fog':
      return CloudFog
    case 'drizzle':
      return CloudDrizzle
    case 'rain':
      return CloudRain
    case 'snow':
      return CloudSnow
    case 'storm':
      return CloudLightning
    default:
      return Cloud
  }
}

/** "40% chance of rain" style line, only when there is a meaningful chance. */
function precipitationText(chance: number | null): string | null {
  if (chance === null || chance < 20) return null
  return `${chance}% chance of rain or snow`
}

/**
 * Weather tile (#262), rendered in the board header when the household has
 * opted in and a forecast is available. Every value is text (temperature,
 * summary, high/low, chance of precipitation); the icon is decoration. The
 * next days appear only on wide screens (the 16:10 fridge hub), where there
 * is room to read them from across the kitchen.
 */
export function WeatherTile({ view }: { view: WeatherView }) {
  const { weather, today, next } = view
  const locale = useDisplayLocale()
  const CurrentIcon = iconFor(weather.current.icon, weather.current.isDay)
  const unit = `°${weather.unit}`
  const precip = today ? precipitationText(today.precipitationChance) : null
  return (
    <section
      aria-labelledby="board-weather-title"
      data-testid="board-weather"
      className="flex min-w-0 items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] px-3 py-2 md:px-4 md:py-3 2xl:gap-6 2xl:px-6 2xl:py-4"
    >
      <h2 id="board-weather-title" className="sr-only">
        Weather in {weather.label}
      </h2>
      <CurrentIcon className="h-8 w-8 shrink-0 text-label-primary md:h-10 md:w-10 2xl:h-14 2xl:w-14" aria-hidden="true" />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span
            data-testid="weather-now"
            className="text-[24px] font-semibold leading-none tabular-nums text-label-primary md:text-[32px] 2xl:text-[48px]"
          >
            {weather.current.temperature}
            {unit}
          </span>
          <span className="text-[15px] font-medium leading-tight text-label-primary md:text-[19px] 2xl:text-[22px]">
            {weather.current.summary}
          </span>
        </p>
        <p className="mt-1 text-[13px] leading-snug text-label-secondary md:text-[17px] 2xl:text-[19px]">
          {today && (
            <span className="tabular-nums">
              <span className="sr-only">Today: high </span>
              <span aria-hidden="true">H </span>
              {today.high}°<span className="sr-only">, low</span>
              <span aria-hidden="true"> · L </span>
              {today.low}°
            </span>
          )}
          {precip && <span> · {precip}</span>}
          <span className="block break-words text-[13px] md:text-[16px] 2xl:text-[17px]">{weather.label}</span>
        </p>
      </div>
      {next.length > 0 && (
        <ul
          aria-label="Next days"
          className="hidden shrink-0 gap-5 border-l border-[var(--surface-separator)] pl-6 2xl:flex"
        >
          {next.map((d) => {
            const Icon = iconFor(d.icon)
            return (
              <li key={d.day} data-testid="weather-day" className="flex flex-col items-center text-center">
                <span className="text-[17px] font-semibold text-label-primary">{shortWeekday(d.day, locale)}</span>
                <Icon className="my-1 h-7 w-7 text-label-secondary" aria-hidden="true" />
                <span className="sr-only">{d.summary}, high </span>
                <span className={cn('text-[17px] tabular-nums text-label-primary')}>
                  {d.high}°<span className="sr-only">, low</span>
                  <span aria-hidden="true"> / </span>
                  <span className="text-label-secondary">{d.low}°</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
