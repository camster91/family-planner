/**
 * @jest-environment jsdom
 */
// Theme follows the device by default (O-43): with nothing saved the app is
// Auto (prefers-color-scheme), a saved Light/Dark/Auto is respected and never
// rewritten, the pre-paint script agrees with the provider, and opening
// Settings does not save a choice nobody made.
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
  LEGACY_THEME_STORAGE_KEY,
  resolveStoredPreference,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveIsDark,
} from '../theme'
import { ThemeProvider } from '@/components/providers/theme-provider'
import SettingsClient from '@/app/dashboard/settings/SettingsClient'
import { I18nProvider } from '@/i18n'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}))

type Listener = () => void
let systemDark = false
let listeners: Listener[] = []

function mockMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? systemDark : false,
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => {
      listeners = listeners.filter((x) => x !== l)
    },
  })) as unknown as typeof window.matchMedia
}

function setSystemDark(dark: boolean) {
  systemDark = dark
  act(() => listeners.forEach((l) => l()))
}

function isDark() {
  return document.documentElement.classList.contains('dark')
}

function runInitScript() {
  new Function(THEME_INIT_SCRIPT)()
}

beforeEach(() => {
  systemDark = false
  listeners = []
  mockMatchMedia()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as unknown as typeof fetch
})

describe('theme preference rules', () => {
  it('defaults to Auto when nothing (or something unknown) is saved', () => {
    expect(DEFAULT_THEME).toBe('auto')
    expect(parseThemePreference(null)).toBe('auto')
    expect(parseThemePreference('sepia')).toBe('auto')
  })

  it('keeps a saved explicit choice', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('auto')).toBe('auto')
  })

  it('resolves dark only for Dark, or Auto on a dark device', () => {
    expect(resolveIsDark('light', true)).toBe(false)
    expect(resolveIsDark('dark', false)).toBe(true)
    expect(resolveIsDark('auto', true)).toBe(true)
    expect(resolveIsDark('auto', false)).toBe(false)
  })
})

describe('pre-paint script (root layout <head>)', () => {
  it.each([
    [null, true, true],
    [null, false, false],
    ['auto', true, true],
    ['light', true, false],
    ['dark', false, true],
    ['junk', true, true],
  ])('saved %s, device dark %s -> dark %s, same as resolveIsDark', (saved, device, expected) => {
    if (saved) window.localStorage.setItem(THEME_STORAGE_KEY, saved)
    systemDark = device
    runInitScript()
    expect(isDark()).toBe(expected)
    expect(resolveIsDark(parseThemePreference(saved), device)).toBe(expected)
  })

  it.each([
    // [old key, new key, device dark, expected dark]
    ['light', null, true, true], // old "light" was saved just by opening Settings: Auto
    ['dark', null, false, true], // old "dark" was a real choice: kept
    ['dark', 'light', true, false], // the new key always wins
    ['light', 'dark', false, true],
  ])('old key %s, new key %s, device dark %s -> dark %s', (legacy, saved, device, expected) => {
    if (legacy) window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, legacy)
    if (saved) window.localStorage.setItem(THEME_STORAGE_KEY, saved)
    systemDark = device
    runInitScript()
    expect(isDark()).toBe(expected)
    expect(resolveIsDark(resolveStoredPreference(saved, legacy), device)).toBe(expected)
  })

  it('does not throw when storage is blocked, and falls back to Auto', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      systemDark = true
      expect(() => runInitScript()).not.toThrow()
      expect(isDark()).toBe(true)
    } finally {
      get.mockRestore()
    }
  })
})

describe('ThemeProvider', () => {
  it('follows the device with nothing saved, live, and saves nothing', () => {
    systemDark = true
    render(<ThemeProvider>x</ThemeProvider>)
    expect(isDark()).toBe(true)
    setSystemDark(false)
    expect(isDark()).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('respects a saved Light on a dark device and leaves it saved', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    systemDark = true
    render(<ThemeProvider>x</ThemeProvider>)
    expect(isDark()).toBe(false)
    setSystemDark(true)
    expect(isDark()).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('respects a saved Dark on a light device', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(<ThemeProvider>x</ThemeProvider>)
    expect(isDark()).toBe(true)
  })
})

describe('Settings → Theme', () => {
  function renderSettings() {
    return render(
      <I18nProvider locale="en">
        <SettingsClient viewerRole="parent" sharedDevice={null} />
      </I18nProvider>
    )
  }

  it('shows Auto selected when nothing is saved, and opening Settings saves nothing', async () => {
    systemDark = true
    renderSettings()
    const auto = await screen.findByRole('button', { name: 'Auto' })
    expect(auto.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('shows a saved choice, and saves and applies a new one when picked', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    renderSettings()
    expect((await screen.findByRole('button', { name: 'Dark' })).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(isDark()).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(isDark()).toBe(true)
  })
})
