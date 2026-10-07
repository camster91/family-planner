import fs from 'fs'
import path from 'path'
import { PRODUCT_BRAND } from '@/lib/brand'
import { metadata, viewport } from '../layout'

jest.mock('next/font/local', () => ({ __esModule: true, default: () => ({ variable: 'local-font' }) }))
jest.mock('../globals.css', () => ({}))
jest.mock('@/components/providers/posthog-provider', () => ({}))
jest.mock('@/components/providers/theme-provider', () => ({}))
jest.mock('@/components/ui/toast', () => ({}))
jest.mock('@/i18n', () => ({}))
jest.mock('@/components/providers/csrf-fetch-patch', () => ({}))
jest.mock('@/components/providers/service-worker-registration', () => ({}))
jest.mock('@/components/ui/site-offline-banner', () => ({}))

it('uses the display brand in metadata without changing the production origin or advertising legacy OG artwork', () => {
  expect(metadata.title).toEqual({ default: `${PRODUCT_BRAND.name} — Household organizer`, template: `%s — ${PRODUCT_BRAND.name}` })
  expect(metadata.description).toBe(PRODUCT_BRAND.description)
  expect(String(metadata.metadataBase)).toBe('https://family.ashbi.ca/')
  expect(metadata.openGraph).toMatchObject({ siteName: PRODUCT_BRAND.name, description: PRODUCT_BRAND.description })
  expect(metadata.twitter).toMatchObject({ title: `${PRODUCT_BRAND.name} — Household organizer`, description: PRODUCT_BRAND.description })
  expect(JSON.stringify(metadata)).not.toMatch(/Free family|Kids earn XP|\/og-image.jpg/)
  expect(viewport.themeColor).toContainEqual({ media: '(prefers-color-scheme: dark)', color: '#11211E' })
})

it('keeps install routes and icon URLs while updating the PWA display identity', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../public/manifest.json'), 'utf8'))
  expect(manifest.name).toBe(PRODUCT_BRAND.name)
  expect(manifest.short_name).toBe(PRODUCT_BRAND.name)
  expect(manifest.description).toBe(PRODUCT_BRAND.description)
  expect(manifest.start_url).toBe('/')
  expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(['/icon-192.png', '/icon-512.png'])
})
