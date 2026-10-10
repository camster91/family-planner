/** @jest-environment jsdom */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import config from '../../../capacitor.config'

const root = path.resolve(__dirname, '../../..')
const html = readFileSync(path.join(root, 'public/native-offline.html'), 'utf8')
const parse = () => new DOMParser().parseFromString(html, 'text/html')

test('recovery is self contained without scripts, external assets, forms or embedded household data', () => {
  const document = parse()
  expect(document.querySelector('script, iframe, form, input, img, link, audio, video')).toBeNull()
  expect(document.querySelectorAll('[src], [srcset]')).toHaveLength(0)
  expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(|url\(/i)
  expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'")
  expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer')
})
test('recovery has only explicit canonical HTTPS entry links and explains sign-in/pairing', () => {
  const document = parse()
  const links = Array.from(document.querySelectorAll('a'))
  expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Open my app', 'https://family.ashbi.ca/'],
    ['Open shared tablet', 'https://family.ashbi.ca/device/today'],
  ])
  expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Reconnect')
  expect(document.querySelector('h1')?.textContent).toBe("Let's get connected.")
  expect(document.body.textContent).toContain("This screen doesn't save changes.")
  expect(document.body.textContent).toContain('tablet pairing')
})
test('native source config chooses bundled recovery without weakening HTTPS', () => {
  expect(config.server?.errorPath).toBe('native-offline.html')
  expect(config.server?.url).toBe('https://family.ashbi.ca')
  expect(config.server?.cleartext).not.toBe(true)
})
