/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, useTranslation } from '@/i18n'
import { isPseudolocaleEnabled, pseudolocalizeTemplate } from '../pseudo'

function Probe() {
  const { t, locale } = useTranslation()
  return <>
    <p data-testid="greeting">{t('dashboard.welcomeBack', { name: '李 & Casey {save} <script>' })}</p>
    <p data-testid="missing">{t('qa.nonexistent', { name: 'Casey' })}</p>
    <p data-testid="locale">{locale}</p>
  </>
}

beforeEach(() => window.localStorage.clear())

describe('pseudolocale QA templates', () => {
  it('accents copy and expands letters about 40 percent with visible delimiters', () => {
    const result = pseudolocalizeTemplate('abcdefghijklmnopqrstuvwxyz')
    expect(result.startsWith('⟦')).toBe(true)
    expect(result.endsWith('⟧')).toBe(true)
    expect(result).not.toMatch(/[a-z]/i)
    expect(result.slice(1, -1)).toHaveLength(36)
  })
  it('preserves placeholders, whitespace, numbers and punctuation', () => {
    const result = pseudolocalizeTemplate('Hello {name}!\n{count} / 24 {missing_key}')
    expect(result).toContain('{name}!\n{count} / 24 {missing_key}')
    expect(pseudolocalizeTemplate('')).toBe('')
  })
  it('requires both exact QA flags; neither development nor production turns it on by default', () => {
    for (const NODE_ENV of ['development', 'test', 'production']) {
      expect(isPseudolocaleEnabled({ NODE_ENV })).toBe(false)
      expect(isPseudolocaleEnabled({ NODE_ENV, I18N_PSEUDO_ENABLED: '1' })).toBe(false)
      expect(isPseudolocaleEnabled({ NODE_ENV, DESIGN_GALLERY_ENABLED: '1' })).toBe(false)
      expect(isPseudolocaleEnabled({ NODE_ENV, I18N_PSEUDO_ENABLED: 'true', DESIGN_GALLERY_ENABLED: '1' })).toBe(false)
      expect(isPseudolocaleEnabled({ NODE_ENV, I18N_PSEUDO_ENABLED: '1', DESIGN_GALLERY_ENABLED: '1' })).toBe(true)
    }
  })
  it('is disabled for the ordinary provider and preserves the public locale catalogue', () => {
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByTestId('greeting').textContent).toBe('Welcome back, 李 & Casey {save} <script>!')
    expect(SUPPORTED_LOCALES).toEqual(['en', 'es'])
  })
  it('transforms only templates, keeping inserted household data and missing keys exactly intact', () => {
    const name = '李 & Casey {save} <script>'
    render(<I18nProvider pseudolocalize><Probe /></I18nProvider>)
    expect(screen.getByTestId('greeting').textContent).toBe(
      pseudolocalizeTemplate('Welcome back, {name}!').replace('{name}', name)
    )
    expect(screen.getByTestId('greeting').querySelector('script')).toBeNull()
    expect(screen.getByTestId('missing').textContent).toBe('qa.nonexistent')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull()
  })
  it('retains a previously stored real language and does not store a pseudo language', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    render(<I18nProvider persistLocale pseudolocalize><Probe /></I18nProvider>)
    expect((await screen.findByTestId('locale')).textContent).toBe('es')
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(screen.getByTestId('greeting').textContent).toContain('李 & Casey {save} <script>')
  })
})
