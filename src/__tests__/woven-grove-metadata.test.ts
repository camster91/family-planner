import fs from 'fs'
import path from 'path'
const root = path.join(__dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
it('updates browser/PWA theme metadata and public recovery display without changing technical identity', () => {
  const layout = read('src/app/layout.tsx')
  expect(layout).toContain("media: '(prefers-color-scheme: light)', color: '#F7F4EC'")
  expect(layout).toContain("media: '(prefers-color-scheme: dark)', color: '#11211E'")
  const manifest = JSON.parse(read('public/manifest.json'))
  expect(manifest).toMatchObject({ name: 'Herewoven', short_name: 'Herewoven', start_url: '/', background_color: '#F7F4EC', theme_color: '#245B50' })
  expect(manifest.icons).toEqual([
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ])
  const offline = read('public/offline.html')
  expect(offline).toContain("You're offline — Herewoven")
  expect(offline).not.toContain('Family Planner')
  expect(offline).toContain('--surface-grouped: #F7F4EC')
  expect(offline).toContain('--accent-fill: #245B50')
  expect(offline).toContain('familyPlanner_theme_v2')
  expect(read('public/sw.js')).toContain("const CACHE_VERSION = 'v2'")
  expect(read('public/sw.js')).toContain("const CACHE_PREFIX = 'fp-offline-'")
  expect(read('public/index.html')).toContain('Loading Herewoven...')
  expect(read('public/index.html')).toContain("window.location.href = 'https://family.ashbi.ca'")
})
it('keeps pressed plain actions and dark success text readable rather than fading foregrounds', () => {
  const css = read('src/app/globals.css')
  expect(css).toMatch(/\.btn-plain:active\s*\{[^}]*background:\s*var\(--accent-tint\)/)
  expect(css).not.toContain('.btn-plain:active { opacity: 0.6; }')
  expect(css).toContain('.text-green-600 { color: var(--success-text) !important; }')
  expect(css).toMatch(/\.font-display\s*\{[^}]*font-weight:\s*600/)
})
