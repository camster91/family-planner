import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrandMark } from '@/components/ui/brand-illustration'

const root = path.join(__dirname, '../..')
const digest = (file: string) => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')

it('renders the exact approved transparent symbol, with a Chalk backing for dark mode and no color effects', () => {
  const html = renderToStaticMarkup(React.createElement(BrandMark, { size: 48 }))
  expect(html).toContain('src="/brand/woven-grove/logos/herewoven-symbol.svg"')
  expect(html).toContain('brand-mark')
  expect(html).toContain('alt=""')
  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain('width="48"')
  expect(digest('public/brand/woven-grove/logos/herewoven-symbol.svg')).toBe('6c920161ae35cb038b2132aa28f709359102a41d347bbfd1c34c5d88cc0e6e00')
})

it('replaces every canonical browser icon with the approved paper tile without changing install paths', () => {
  expect(digest('public/favicon.svg')).toBe('8e9b7f45f4639890f75c89db60030d8faa413642c7321e9ab28a45c9ccde9b03')
  expect(digest('public/favicon.ico')).toBe('85ff09d1d348111952badfa761b63ec024df94774bf4ca2b6e74e0a414741055')
  expect(digest('public/brand/favicon-32.png')).toBe('1243cd4f1c5d7bad1f146c170c2632c88d9d1be12fa6f9fede8f8ee935a0b6ee')
  expect(digest('public/brand/favicon-48.png')).toBe('63d3bf8b4d4bd629da64e53b1ebe1a675976d1c7fe90662c0470ec403de215de')
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const) {
    const png = fs.readFileSync(path.join(root, 'public', file))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
    expect(digest(`public/${file}`)).toBe(JSON.parse(fs.readFileSync(path.join(root, 'public/brand/woven-grove/adoption-manifest.json'), 'utf8')).files[`public/${file}`])
  }
})
