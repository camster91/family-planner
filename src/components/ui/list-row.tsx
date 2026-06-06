import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ChevronRight, LucideIcon } from 'lucide-react'

/**
 * ListRow — iOS Settings-style row, grouped inset.
 * Optional leading icon (Apple glyph), title, subtitle, trailing chevron/badge.
 */
type GlyphColor =
  | 'chore' | 'calendar' | 'lists' | 'budget'
  | 'messages' | 'family' | 'rewards' | 'projects' | 'meals' | 'gray'

export function ListRow({
  icon: Icon,
  glyphColor = 'gray',
  title,
  subtitle,
  trailing,
  showChevron = true,
  href,
  onClick,
  className,
  last,
}: {
  icon?: LucideIcon
  glyphColor?: GlyphColor
  title: React.ReactNode
  subtitle?: React.ReactNode
  trailing?: React.ReactNode
  showChevron?: boolean
  href?: string
  onClick?: () => void
  className?: string
  last?: boolean
}) {
  const bgClass = {
    chore: 'bg-chore', calendar: 'bg-tint-calendar', lists: 'bg-tint-lists',
    budget: 'bg-tint-budget', messages: 'bg-tint-messages', family: 'bg-tint-family',
    rewards: 'bg-tint-rewards', projects: 'bg-tint-projects', meals: 'bg-tint-meals',
    gray: 'bg-surface-fill',
  }[glyphColor]

  const inner = (
    <div
      className={cn(
        'row-apple',
        !last && 'border-b border-[var(--surface-separator)]',
        className
      )}
    >
      {Icon && (
        <div className={cn('glyph', bgClass)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-body text-label-primary truncate">{title}</div>
        {subtitle && (
          <div className="text-footnote text-label-secondary truncate">{subtitle}</div>
        )}
      </div>
      {trailing}
      {showChevron && (
        <ChevronRight className="w-4 h-4 text-label-tertiary shrink-0" />
      )}
    </div>
  )

  if (href) {
    return <Link href={href} className="block active:bg-[var(--surface-fill-secondary)]">{inner}</Link>
  }
  if (onClick) {
    return <button type="button" onClick={onClick} className="block w-full text-left">{inner}</button>
  }
  return inner
}

/**
 * InsetList — wrapper that gives a card-like grouped list look.
 */
export function InsetList({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('list-inset', className)}>{children}</div>
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="section-header">{children}</div>
}
