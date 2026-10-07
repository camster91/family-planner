import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Home from '@/app/page'
import AuthLayout from '@/app/(auth)/layout'
import { I18nProvider } from '@/i18n'

it('uses the selected mark at the preferred 48px size in landing, auth and the app shell', () => {
  const landing = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(Home)))
  const auth = renderToStaticMarkup(React.createElement(AuthLayout, null, React.createElement('form')))
  for (const html of [landing, auth]) expect(html).toMatch(/src="\/brand\/woven-grove\/logos\/herewoven-symbol.svg"[^>]*width="48"[^>]*height="48"/)
  const nav = fs.readFileSync(path.join(__dirname, '../components/layout/DashboardNav.tsx'), 'utf8')
  expect(nav).toContain('<BrandMark size={48} className="h-12 w-12" />')
})

it('uses the approved woven graphic in the actual landing and shared auth frame without changing account routes', () => {
  const landing = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(Home)))
  const auth = renderToStaticMarkup(React.createElement(AuthLayout, null, React.createElement('form', { 'data-canonical-form': true })))
  for (const html of [landing, auth]) {
    expect(html).toContain('/brand/woven-grove/graphics/herewoven-woven-graphic.svg')
    expect(html).toContain('Herewoven')
    expect(html).not.toContain('hero-kitchen')
    expect(html).not.toContain('auth-entryway')
    expect(html).toContain('aria-hidden="true"')
  }
  expect(landing).toContain('href="/register"')
  expect(landing).toContain('href="/login"')
  expect(landing).toContain('Illustrative preview · fictional household')
  expect(auth).toContain('data-canonical-form="true"')
  expect(auth).toContain('href="/"')
  const file = fs.readFileSync(path.join(__dirname, '../../public/brand/woven-grove/graphics/herewoven-woven-graphic.svg'))
  expect(createHash('sha256').update(file).digest('hex')).toBe('a1577d50c5152a28063c1c5dcdfbd070db933dfdda0b1515dba2846e1eb79f6f')
  const setup = fs.readFileSync(path.join(__dirname, '../components/dashboard/GetStarted.tsx'), 'utf8')
  expect(setup).toContain('source={ILLUSTRATIONS.wovenGrove}')
  expect(setup).toContain("const STORAGE_PREFIX = 'fp:get-started-hidden:'")
})
