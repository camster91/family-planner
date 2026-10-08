/**
 * @jest-environment jsdom
 */
// Settings → Language really changes the app language (it used to save a value
// nothing read, and offered languages with no translations), and the app info
// shows the real server build from GET /api/version instead of a made-up
// "Version 1.0.0 • Phase 1 MVP".
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsClient from '../SettingsClient'
import { THEME_STORAGE_KEY } from '@/lib/theme'
import { I18nProvider, LOCALE_STORAGE_KEY, useTranslation } from '@/i18n'

// SettingsClient refreshes the server layout after a profile save.
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}))

function mockApi(version: { ok: boolean; body?: unknown } | 'throw' = { ok: false }) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/version') {
      if (version === 'throw') throw new Error('offline')
      return { ok: version.ok, status: version.ok ? 200 : 500, json: async () => version.body ?? {} } as Response
    }
    if (url === '/api/users') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: { name: 'Pat', email: 'pat@example.test', role: 'parent', age: null } }),
      } as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response
  }) as unknown as typeof fetch
}

// Shows a translated string so the test can see the app language switch.
function Probe() {
  const { t } = useTranslation()
  return <p data-testid="probe">{t('wishlist.title')}</p>
}

function renderSettings() {
  return render(
    <I18nProvider locale="en" persistLocale>
      <Probe />
      <SettingsClient viewerRole="parent" sharedDevice={null} />
    </I18nProvider>
  )
}

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia)
})

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.lang = 'en'
})

describe('Settings language', () => {
  it('offers only languages the app has translations for', async () => {
    mockApi()
    renderSettings()
    const select = await screen.findByLabelText('Preferred language')
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.value)).toEqual(['en', 'es'])
  })

  it('switches the app to Spanish, saves it and updates <html lang>', async () => {
    mockApi()
    renderSettings()
    expect(screen.getByTestId('probe').textContent).toBe('Wishlist')
    await userEvent.selectOptions(await screen.findByLabelText('Preferred language'), 'es')
    expect(screen.getByTestId('probe').textContent).toBe('Lista de deseos')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })

  it('keeps profile edits and device preferences independent while switching languages and themes', async () => {
    mockApi()
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    renderSettings()
    const name = await screen.findByDisplayValue('Pat')
    await userEvent.clear(name)
    await userEvent.type(name, 'Casey')
    await userEvent.selectOptions(screen.getByLabelText('Preferred language'), 'es')
    expect(screen.getByRole('group', { name: 'Tema' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Oscuro' }).getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect((name as HTMLInputElement).value).toBe('Casey')
    await userEvent.click(screen.getByRole('button', { name: 'Claro' }))
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect((screen.getByLabelText('Idioma preferido') as HTMLSelectElement).value).toBe('es')
    expect((name as HTMLInputElement).value).toBe('Casey')
    await userEvent.selectOptions(screen.getByLabelText('Idioma preferido'), 'en')
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect((name as HTMLInputElement).value).toBe('Casey')
  })

  it('starts from the saved language after mount', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    mockApi()
    renderSettings()
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Lista de deseos'))
    expect(((await screen.findByLabelText('Idioma preferido')) as HTMLSelectElement).value).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })

  it('ignores an unsupported saved language (from the old picker)', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr')
    mockApi()
    renderSettings()
    await screen.findByLabelText('Preferred language')
    expect(screen.getByTestId('probe').textContent).toBe('Wishlist')
    expect((screen.getByLabelText('Preferred language') as HTMLSelectElement).value).toBe('en')
  })

  it('stays in English when storage is blocked, and a choice still applies for the visit', async () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    function Switch() {
      const { setLocale } = useTranslation()
      return <button onClick={() => setLocale('es')}>Spanish</button>
    }
    try {
      render(
        <I18nProvider locale="en" persistLocale>
          <Probe />
          <Switch />
        </I18nProvider>
      )
      expect(screen.getByTestId('probe').textContent).toBe('Wishlist')
      await userEvent.click(screen.getByRole('button', { name: 'Spanish' }))
      expect(screen.getByTestId('probe').textContent).toBe('Lista de deseos')
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })
})

describe('Settings app version', () => {
  it('shows the server build from /api/version', async () => {
    mockApi({ ok: true, body: { version: '0.7.2', commit: '0123456789abcdef0123456789abcdef01234567', builtAt: 'unknown' } })
    renderSettings()
    expect(await screen.findByText('Version 0.7.2 (0123456)')).toBeTruthy()
    expect(screen.queryByText(/Phase 1 MVP/)).toBeNull()
  })

  it('leaves out an unknown commit', async () => {
    mockApi({ ok: true, body: { version: '0.7.2', commit: 'unknown', builtAt: 'unknown' } })
    renderSettings()
    expect(await screen.findByText('Version 0.7.2')).toBeTruthy()
  })

  it.each([
    ['an error response', { ok: false }],
    ['a network failure', 'throw'],
  ] as const)('shows no version line on %s', async (_label, version) => {
    mockApi(version as any)
    renderSettings()
    await screen.findByLabelText('Preferred language')
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/version'))
    expect(screen.queryByText(/^Version/)).toBeNull()
  })
})
