import * as React from 'react'
import { cn } from '@/lib/utils'
import { LucideIcon, Inbox } from 'lucide-react'
import { BrandIllustration } from '@/components/ui/brand-illustration'
import { BrandMotion } from '@/components/ui/brand-motion'
import type { BrandIllustrationSource, BrandMotionSource } from '@/lib/brand-illustrations'

/**
 * EmptyState — a calm empty surface.
 * Glyph (or a Warm Paper illustration) + headline + subhead + optional CTA.
 *
 * `illustration` replaces the icon glyph with a decorative spot illustration
 * (ILLUSTRATIONS in src/lib/brand-illustrations.ts). A bare src string works
 * too, but then the box size is unknown until load; prefer the registry entry.
 * `motion` (MOTION in the same file) shows a short loop instead, falling back
 * to its still illustration (see BrandMotion).
 */
export function EmptyState({
  icon: Icon = Inbox,
  glyphColor = 'gray',
  illustration,
  motion,
  title,
  description,
  action,
  className,
  headingLevel = 'h2',
}: {
  icon?: LucideIcon
  glyphColor?: 'chore' | 'calendar' | 'lists' | 'budget' | 'messages' | 'family' | 'rewards' | 'projects' | 'meals' | 'gray'
  /** Decorative illustration shown instead of the icon glyph. */
  illustration?: BrandIllustrationSource | string
  /** Decorative looping animation; wins over `illustration`. */
  motion?: BrandMotionSource
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  /** Heading level for the title — defaults to h2 to fit a typical page (H1 page title → H2 empty state). */
  headingLevel?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
}) {
  const bgClass = {
    chore: 'bg-chore', calendar: 'bg-tint-calendar', lists: 'bg-tint-lists',
    budget: 'bg-tint-budget', messages: 'bg-tint-messages', family: 'bg-tint-family',
    rewards: 'bg-tint-rewards', projects: 'bg-tint-projects', meals: 'bg-tint-meals',
    gray: 'bg-surface-fill',
  }[glyphColor]

  const Heading = headingLevel
  const art =
    typeof illustration === 'string' ? { src: illustration, width: 480, height: 400 } : illustration

  return (
    <div className={cn('empty-state animate-spring-up', className)}>
      {motion ? (
        <BrandMotion motion={motion} className="empty-state-illustration rounded-[var(--radius-lg)]" />
      ) : art ? (
        <BrandIllustration source={art} className="empty-state-illustration" />
      ) : (
        <div className={cn('empty-state-icon', bgClass)}>
          <Icon className="w-9 h-9 text-white" aria-hidden="true" />
        </div>
      )}
      <Heading className="text-title-3 text-label-primary mb-1">{title}</Heading>
      {description && (
        <p className="text-subhead text-label-secondary max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  )
}
