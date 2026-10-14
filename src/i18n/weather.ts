import type { Locale } from './types'

type WeatherCopy = {
  weatherIn: (label: string) => string
  precipitation: (chance: number) => string
  todayHigh: string
  low: string
  nextDays: string
  dayHigh: string
  dayLow: string
}

const englishWeatherCopy: WeatherCopy = {
  weatherIn: (label) => `Weather in ${label}`,
  precipitation: (chance) => `${chance}% chance of rain or snow`,
  todayHigh: 'Today: high ',
  low: ', low',
  nextDays: 'Next days',
  dayHigh: ', high ',
  dayLow: ', low',
}

const spanishWeatherCopy: WeatherCopy = {
  weatherIn: (label) => `Tiempo en ${label}`,
  precipitation: (chance) => `${chance}% de probabilidad de lluvia o nieve`,
  todayHigh: 'Hoy: máxima ',
  low: ', mínima',
  nextDays: 'Próximos días',
  dayHigh: ', máxima ',
  dayLow: ', mínima',
}

/** Canonical summaries produced by src/lib/weather/codes.ts. */
const spanishWeatherSummaries: Record<string, string> = {
  Clear: 'Despejado',
  'Mostly clear': 'Mayormente despejado',
  'Partly cloudy': 'Parcialmente nublado',
  Cloudy: 'Nublado',
  Fog: 'Niebla',
  'Freezing fog': 'Niebla helada',
  'Light drizzle': 'Llovizna ligera',
  Drizzle: 'Llovizna',
  'Heavy drizzle': 'Llovizna intensa',
  'Freezing drizzle': 'Llovizna helada',
  'Light rain': 'Lluvia ligera',
  Rain: 'Lluvia',
  'Heavy rain': 'Lluvia intensa',
  'Freezing rain': 'Lluvia helada',
  'Light snow': 'Nieve ligera',
  Snow: 'Nieve',
  'Heavy snow': 'Nieve intensa',
  'Snow grains': 'Granizo de nieve',
  Showers: 'Chubascos',
  'Heavy showers': 'Chubascos intensos',
  'Snow showers': 'Chubascos de nieve',
  'Heavy snow showers': 'Chubascos de nieve intensos',
  Thunderstorms: 'Tormentas eléctricas',
  'Thunderstorms with hail': 'Tormentas eléctricas con granizo',
  'Mixed conditions': 'Condiciones variables',
}

export function getWeatherCopy(locale: Locale): WeatherCopy {
  return locale === 'es' ? spanishWeatherCopy : englishWeatherCopy
}

/** Unknown/future provider summaries remain visible instead of being dropped. */
export function localizeWeatherSummary(
  locale: Locale,
  summary: string,
): string {
  if (
    locale !== 'es' ||
    !Object.prototype.hasOwnProperty.call(spanishWeatherSummaries, summary)
  )
    return summary
  return spanishWeatherSummaries[summary]
}
