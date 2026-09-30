'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Layout helpers for the design gallery (#156). Only the gallery imports this
 * file; nothing here is a product component.
 */

/** One gallery section: stable id, heading and `data-testid="gallery-section-<id>"`. */
export function GallerySection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      data-testid={`gallery-section-${id}`}
      className="scroll-mt-4 border-t border-[var(--surface-separator)] px-4 py-8 sm:px-6 lg:px-8"
    >
      <h2 id={`${id}-heading`} className="text-title-1 mb-6 break-words text-label-primary">
        {title}
      </h2>
      <div className="space-y-8">{children}</div>
    </section>
  )
}

/**
 * One component (or state) on show: its name, where the production source
 * lives and the rendered component. `data-testid="specimen-<slug>"`.
 */
export function Specimen({
  name,
  source,
  note,
  children,
  className,
}: {
  name: string
  source: string
  note?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return (
    <div data-testid={`specimen-${slug}`} className="min-w-0">
      <h3 className="text-headline break-words text-label-primary">{name}</h3>
      <p className="text-footnote mb-3 break-words text-label-secondary">
        <code>{source}</code>
      </p>
      {note && <p className="text-subhead mb-3 max-w-prose text-label-secondary">{note}</p>}
      <div className={cn('min-w-0', className)}>{children}</div>
    </div>
  )
}

/**
 * A fixed-height box that contains `position: fixed` descendants (a transform
 * makes it their containing block), so overlays such as the toast stack or the
 * calm display render inside the frame instead of over the whole page.
 */
export function ContainedFrame({
  label,
  height,
  testId,
  children,
}: {
  label: string
  height: number
  testId: string
  children: React.ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="relative w-full overflow-hidden rounded-[var(--radius-xl)] border border-[var(--surface-separator)] bg-[var(--surface-grouped)]"
      style={{ height, transform: 'translateZ(0)' }}
    >
      {children}
    </div>
  )
}

/** Responsive grid of specimens: one column on phones, two from `lg`. */
export function SpecimenGrid({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn('grid gap-8', wide ? 'xl:grid-cols-2' : 'lg:grid-cols-2')}>{children}</div>
}
