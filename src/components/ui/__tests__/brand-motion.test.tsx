/**
 * @jest-environment jsdom
 */
// BrandMotion (docs/product/BRAND.md): a muted inline loop in light mode, the
// still illustration with reduced motion, data saver, dark mode and on the
// server. Always decorative.
import * as React from 'react'
import { act, render } from '@testing-library/react'
import { TextEncoder } from 'util'
import { BrandMotion } from '../brand-motion'
import { MOTION } from '@/lib/brand-illustrations'

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia
}

class FakeIO {
  static instances: FakeIO[] = []
  observed: Element[] = []
  constructor(public cb: IntersectionObserverCallback) {
    FakeIO.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  document.documentElement.className = ''
  mockReducedMotion(false)
  FakeIO.instances = []
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO
  window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = jest.fn()
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true })
})

describe('BrandMotion', () => {
  it('plays a muted, looping, decorative video with WebM then MP4 and a poster', () => {
    const { container } = render(<BrandMotion motion={MOTION.tea} className="w-40" />)
    const video = container.querySelector('video')!
    expect(video).not.toBeNull()
    expect(video.getAttribute('aria-hidden')).toBe('true')
    expect(video.getAttribute('poster')).toBe('/brand/motion/tea-poster.webp')
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.hasAttribute('controls')).toBe(false)
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.hasAttribute('playsinline')).toBe(true)
    expect(video.getAttribute('width')).toBe('360')
    expect(video.getAttribute('height')).toBe('360')
    const sources = Array.from(video.querySelectorAll('source')).map((s) => [s.getAttribute('src'), s.getAttribute('type')])
    expect(sources).toEqual([
      ['/brand/motion/tea.webm', 'video/webm'],
      ['/brand/motion/tea.mp4', 'video/mp4'],
    ])
    expect(container.querySelector('img')).toBeNull()
  })

  it('plays only while in view and pauses off screen', () => {
    const { container } = render(<BrandMotion motion={MOTION.moon} />)
    const video = container.querySelector('video')!
    const io = FakeIO.instances[0]
    expect(io.observed).toContain(video)
    expect(video.play).not.toHaveBeenCalled()
    act(() => io.cb([{ isIntersecting: true, target: video } as unknown as IntersectionObserverEntry], io as never))
    expect(video.play).toHaveBeenCalled()
    act(() => io.cb([{ isIntersecting: false, target: video } as unknown as IntersectionObserverEntry], io as never))
    expect(video.pause).toHaveBeenCalled()
  })

  it('shows the transparent still with reduced motion', () => {
    mockReducedMotion(true)
    const { container } = render(<BrandMotion motion={MOTION.celebrate} />)
    expect(container.querySelector('video')).toBeNull()
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/brand/illustrations/celebrate.webp')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
  })

  it("shows the still with the app's reduce-motion setting, in dark mode and with data saver", () => {
    document.documentElement.className = 'reduce-motion'
    expect(render(<BrandMotion motion={MOTION.tea} />).container.querySelector('video')).toBeNull()
    document.documentElement.className = 'dark'
    expect(render(<BrandMotion motion={MOTION.tea} />).container.querySelector('video')).toBeNull()
    document.documentElement.className = ''
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true })
    expect(render(<BrandMotion motion={MOTION.tea} />).container.querySelector('video')).toBeNull()
  })

  it('switches to the still when the theme turns dark', async () => {
    const { container } = render(<BrandMotion motion={MOTION.tea} />)
    expect(container.querySelector('video')).not.toBeNull()
    await act(async () => {
      document.documentElement.classList.add('dark')
      await Promise.resolve()
    })
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('renders the still on the server (hydration-safe)', () => {
    // jsdom lacks TextEncoder, which react-dom/server's browser build needs at load.
    if (typeof globalThis.TextEncoder === 'undefined') {
      ;(globalThis as { TextEncoder?: unknown }).TextEncoder = TextEncoder
    }
    const { renderToString } = require('react-dom/server') as typeof import('react-dom/server')
    const html = renderToString(<BrandMotion motion={MOTION.hero} priority />)
    expect(html).not.toContain('<video')
    expect(html).toContain('/brand/illustrations/hero-kitchen-1600.webp')
    expect(html).toContain('hero-kitchen-800.webp 800w')
  })
})
