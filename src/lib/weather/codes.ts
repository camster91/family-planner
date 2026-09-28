/**
 * WMO weather interpretation codes (as returned by Open-Meteo) to a short,
 * plain-language summary and an icon family. The summary is always shown as
 * text; the icon is decoration.
 */

export type WeatherIconKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

export interface WeatherCodeInfo {
  summary: string
  icon: WeatherIconKind
}

const TABLE: Record<number, WeatherCodeInfo> = {
  0: { summary: 'Clear', icon: 'clear' },
  1: { summary: 'Mostly clear', icon: 'clear' },
  2: { summary: 'Partly cloudy', icon: 'partly' },
  3: { summary: 'Cloudy', icon: 'cloudy' },
  45: { summary: 'Fog', icon: 'fog' },
  48: { summary: 'Freezing fog', icon: 'fog' },
  51: { summary: 'Light drizzle', icon: 'drizzle' },
  53: { summary: 'Drizzle', icon: 'drizzle' },
  55: { summary: 'Heavy drizzle', icon: 'drizzle' },
  56: { summary: 'Freezing drizzle', icon: 'drizzle' },
  57: { summary: 'Freezing drizzle', icon: 'drizzle' },
  61: { summary: 'Light rain', icon: 'rain' },
  63: { summary: 'Rain', icon: 'rain' },
  65: { summary: 'Heavy rain', icon: 'rain' },
  66: { summary: 'Freezing rain', icon: 'rain' },
  67: { summary: 'Freezing rain', icon: 'rain' },
  71: { summary: 'Light snow', icon: 'snow' },
  73: { summary: 'Snow', icon: 'snow' },
  75: { summary: 'Heavy snow', icon: 'snow' },
  77: { summary: 'Snow grains', icon: 'snow' },
  80: { summary: 'Showers', icon: 'rain' },
  81: { summary: 'Showers', icon: 'rain' },
  82: { summary: 'Heavy showers', icon: 'rain' },
  85: { summary: 'Snow showers', icon: 'snow' },
  86: { summary: 'Heavy snow showers', icon: 'snow' },
  95: { summary: 'Thunderstorms', icon: 'storm' },
  96: { summary: 'Thunderstorms with hail', icon: 'storm' },
  99: { summary: 'Thunderstorms with hail', icon: 'storm' },
}

export function describeWeatherCode(code: number): WeatherCodeInfo {
  return TABLE[code] ?? { summary: 'Mixed conditions', icon: 'cloudy' }
}
