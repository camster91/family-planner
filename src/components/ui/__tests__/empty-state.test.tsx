/**
 * @jest-environment jsdom
 */
// EmptyState with a Warm Paper illustration (docs/product/BRAND.md): the art
// replaces the icon glyph, is decorative (empty alt, hidden from assistive
// tech, lazy, with a reserved size) and the heading still carries the meaning.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { CheckSquare } from 'lucide-react'
import { EmptyState } from '../empty-state'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'

function art(container: HTMLElement) {
  return container.querySelector('img[data-brand-illustration]') as HTMLImageElement | null
}

describe('EmptyState illustration', () => {
  it('shows the illustration instead of the icon glyph', () => {
    const { container } = render(
      <EmptyState icon={CheckSquare} glyphColor="chore" illustration={ILLUSTRATIONS.choresClear} title="All clear!" />
    )
    const img = art(container)
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('/brand/illustrations/chores-clear.webp')
    expect(container.querySelector('.empty-state-icon')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('is decorative: empty alt, aria-hidden, not exposed as an image', () => {
    const { container } = render(<EmptyState illustration={ILLUSTRATIONS.calendarEmpty} title="No events" />)
    const img = art(container)!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'No events' })).toBeTruthy()
  })

  it('lazy-loads with explicit width and height to avoid layout shift', () => {
    const { container } = render(<EmptyState illustration={ILLUSTRATIONS.groceriesClear} title="Clear" />)
    const img = art(container)!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    expect(img.getAttribute('width')).toBe('450')
    expect(img.getAttribute('height')).toBe('480')
    expect(img.className).toContain('empty-state-illustration')
  })

  it('accepts a bare src string', () => {
    const { container } = render(<EmptyState illustration="/brand/illustrations/rewards.webp" title="No rewards yet" />)
    const img = art(container)!
    expect(img.getAttribute('src')).toBe('/brand/illustrations/rewards.webp')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('width')).toBeTruthy()
    expect(img.getAttribute('height')).toBeTruthy()
  })

  it('falls back to the icon glyph without an illustration', () => {
    const { container } = render(<EmptyState icon={CheckSquare} glyphColor="lists" title="No items yet" />)
    expect(art(container)).toBeNull()
    const glyph = container.querySelector('.empty-state-icon')
    expect(glyph).not.toBeNull()
    expect(glyph!.className).toContain('bg-tint-lists')
    expect(glyph!.querySelector('svg')).not.toBeNull()
  })

  it('keeps the heading level, description and action', () => {
    render(
      <EmptyState
        illustration={ILLUSTRATIONS.rewards}
        headingLevel="h3"
        title="No rewards yet"
        description="Ask a parent to create rewards."
        action={<button type="button">Add</button>}
      />
    )
    expect(screen.getByRole('heading', { level: 3, name: 'No rewards yet' })).toBeTruthy()
    expect(screen.getByText('Ask a parent to create rewards.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })
})
