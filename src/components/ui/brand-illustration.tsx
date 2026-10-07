import * as React from 'react'
import { cn } from '@/lib/utils'
import type { BrandIllustrationSource } from '@/lib/brand-illustrations'

/**
 * A Warm Paper spot illustration (docs/product/BRAND.md).
 *
 * Always decorative: empty alt and aria-hidden, because the heading or text
 * beside it already says what it shows. Lazy by default; pass `priority` only
 * for art above the fold. Width and height are the file's pixels so the box is
 * reserved before load; size it with CSS (`className`). Lazy art fades in
 * (opacity only, off with reduced motion, globals.css); `priority` art is
 * eager and shows at once so it never delays the first paint.
 */
export function BrandIllustration({
  source,
  className,
  priority = false,
  sizes,
  srcSet,
}: {
  source: BrandIllustrationSource
  className?: string
  priority?: boolean
  sizes?: string
  srcSet?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-compressed static art; a plain <img> keeps the explicit srcset and needs no optimiser
    <img
      src={source.src}
      srcSet={srcSet}
      sizes={sizes}
      width={source.width}
      height={source.height}
      alt=""
      aria-hidden="true"
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      data-brand-illustration=""
      className={cn(!priority && 'animate-paper-fade', 'select-none', className)}
    />
  )
}

/**
 * The approved Woven Grove transparent symbol. The Chalk backing preserves
 * its original colors in dark mode; no reverse, filters or redraws.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 1 KB static SVG; no optimiser needed
    <img
      src="/brand/woven-grove/logos/herewoven-symbol.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className={cn('brand-mark select-none', className)}
    />
  )
}
