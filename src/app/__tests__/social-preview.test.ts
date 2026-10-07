import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { metadata } from '../layout'

jest.mock('next/font/local', () => ({ __esModule: true, default: () => ({ variable: 'local-font' }) }))
jest.mock('../globals.css', () => ({}))
jest.mock('@/components/providers/posthog-provider', () => ({}))
jest.mock('@/components/providers/theme-provider', () => ({}))
jest.mock('@/components/ui/toast', () => ({}))
jest.mock('@/i18n', () => ({}))
jest.mock('@/components/providers/csrf-fetch-patch', () => ({}))
jest.mock('@/components/providers/service-worker-registration', () => ({}))
jest.mock('@/components/ui/site-offline-banner', () => ({}))

const root = path.join(__dirname, '../../..')
const imageUrl = '/brand/woven-grove/herewoven-social.png'
const alt = 'Herewoven — Everyday life, held together. A woven H above interwoven bands.'

it('advertises the same accurately described large image for Open Graph and Twitter', () => {
  expect(String(metadata.metadataBase)).toBe('https://family.ashbi.ca/')
  expect(metadata.openGraph).toMatchObject({
    images: [{ url: imageUrl, width: 1200, height: 630, type: 'image/png', alt }],
  })
  expect(metadata.twitter).toMatchObject({
    card: 'summary_large_image', images: [{ url: imageUrl, alt }],
  })
  expect(JSON.stringify(metadata)).not.toContain('/og-image.jpg')
})

it('ships a real 1200×630 PNG with recorded approved-source provenance', () => {
  const image = fs.readFileSync(path.join(root, 'public', imageUrl))
  expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(image.subarray(12, 16).toString()).toBe('IHDR')
  expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([1200, 630])
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'public/brand/woven-grove/social-preview-manifest.json'), 'utf8'))
  const adoption = JSON.parse(fs.readFileSync(path.join(root, 'public/brand/woven-grove/adoption-manifest.json'), 'utf8'))
  expect(provenance.background).toBe('#F7F4EC')
  expect(provenance.output.sha256).toBe(createHash('sha256').update(image).digest('hex'))
  expect(Object.keys(provenance.sources)).toEqual([
    'public/brand/woven-grove/logos/herewoven-horizontal.png',
    'public/brand/woven-grove/graphics/herewoven-woven-graphic.svg',
  ])
  for (const [file, hash] of Object.entries(provenance.sources)) {
    expect(hash).toBe(adoption.files[file])
    expect(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')).toBe(hash)
  }
})
