/**
 * @jest-environment jsdom
 */
// Design gallery gate (#156): 404 in production unless DESIGN_GALLERY_ENABLED=1.
import * as React from 'react'
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  usePathname: () => '/dev/design-system',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import DesignGalleryPage from '../page'
import { isDesignGalleryEnabled } from '../gate'
import { galleryHref, parseGalleryOptions } from '../options'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'

const env = process.env as Record<string, string | undefined>
const saved = { NODE_ENV: env.NODE_ENV, FLAG: env.DESIGN_GALLERY_ENABLED }

afterEach(() => {
  env.NODE_ENV = saved.NODE_ENV
  if (saved.FLAG === undefined) delete env.DESIGN_GALLERY_ENABLED
  else env.DESIGN_GALLERY_ENABLED = saved.FLAG
})

async function renderPage(search: Record<string, string> = {}) {
  const element = await DesignGalleryPage({ searchParams: Promise.resolve(search) })
  return render(
    <I18nProvider locale="en">
      <ToastProvider>{element}</ToastProvider>
    </I18nProvider>
  )
}

describe('isDesignGalleryEnabled', () => {
  it('is off in production without the flag', () => {
    expect(isDesignGalleryEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(isDesignGalleryEnabled({ NODE_ENV: 'production', DESIGN_GALLERY_ENABLED: '0' })).toBe(false)
    expect(isDesignGalleryEnabled({ NODE_ENV: 'production', DESIGN_GALLERY_ENABLED: 'true' })).toBe(false)
  })
  it('is on in production only with DESIGN_GALLERY_ENABLED=1', () => {
    expect(isDesignGalleryEnabled({ NODE_ENV: 'production', DESIGN_GALLERY_ENABLED: '1' })).toBe(true)
  })
  it('is on outside production builds', () => {
    expect(isDesignGalleryEnabled({ NODE_ENV: 'development' })).toBe(true)
    expect(isDesignGalleryEnabled({ NODE_ENV: 'test' })).toBe(true)
  })
})

describe('/dev/design-system page', () => {
  it('calls notFound() in production without the flag', async () => {
    env.NODE_ENV = 'production'
    delete env.DESIGN_GALLERY_ENABLED
    await expect(DesignGalleryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders in production with the flag', async () => {
    env.NODE_ENV = 'production'
    env.DESIGN_GALLERY_ENABLED = '1'
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Design gallery' })).toBeTruthy()
  })

  it('renders every section in development, with the theme from the URL', async () => {
    env.NODE_ENV = 'development'
    delete env.DESIGN_GALLERY_ENABLED
    const { container } = await renderPage({ theme: 'dark' })
    const gallery = screen.getByTestId('design-gallery')
    expect(gallery.className).toMatch(/\bdark\b/)
    expect(gallery.getAttribute('data-theme')).toBe('dark')
    expect(container.querySelectorAll('[data-testid^="gallery-section-"]')).toHaveLength(12)
    expect(screen.getByTestId('region-today')).toBeTruthy()
  })

  it('renders one section with ?section=', async () => {
    env.NODE_ENV = 'development'
    const { container } = await renderPage({ section: 'inventory' })
    const sections = container.querySelectorAll('[data-testid^="gallery-section-"]')
    expect(sections).toHaveLength(1)
    expect(sections[0].getAttribute('data-testid')).toBe('gallery-section-inventory')
  })
})

describe('gallery options', () => {
  it('parses and falls back to defaults', () => {
    expect(parseGalleryOptions({ theme: 'fridge-night', long: '1', data: 'empty', section: 'chores' })).toEqual({
      theme: 'fridge-night',
      long: true,
      empty: true,
      section: 'chores',
    })
    expect(parseGalleryOptions({ theme: 'neon', section: 'nope' })).toEqual({
      theme: 'light',
      long: false,
      empty: false,
      section: null,
    })
  })
  it('builds short URLs', () => {
    expect(galleryHref(parseGalleryOptions({}))).toBe('/dev/design-system')
    expect(galleryHref(parseGalleryOptions({ theme: 'dark', long: '1' }), 'states')).toBe(
      '/dev/design-system?theme=dark&long=1#states'
    )
  })
})
