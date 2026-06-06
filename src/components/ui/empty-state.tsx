import * as React from 'react'
import { cn } from '@/lib/utils'
import { LucideIcon, Inbox } from 'lucide-react'

/**
 * EmptyState — iOS-style empty surface.
 * Illustration glyph + headline + subhead + optional primary CTA.
 */
export function EmptyState({
  icon: Icon = Inbox,
  glyphColor = 'gray',
  title,
  description,
  action,
  className,
  headingLevel = 'h2',
}: {
  icon?: LucideIcon
  glyphColor?: 'chore' | 'calendar' | 'lists' | 'budget' | 'messages' | 'family' | 'rewards' | 'projects' | 'meals' | 'gray'
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

  return (
    <div className={cn('empty-state animate-spring-up', className)}>
      <div className={cn('empty-state-icon', bgClass)}>
        <Icon className="w-9 h-9 text-white" />
      </div>
      <Heading className="text-title-3 text-label-primary mb-1">{title}</Heading>
      {description && (
        <p className="text-subhead text-label-secondary max-w-sm mb-4">{description}</p>
      )}
      {action}
    </div>
  )
}
