import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Glyph — Apple's colorful rounded-square module icon.
 * Use <Glyph color="chore" />. Icon as children.
 */
type GlyphColor =
  | 'chore' | 'calendar' | 'lists' | 'budget'
  | 'messages' | 'family' | 'rewards' | 'projects' | 'meals'
  | 'gray'

export function Glyph({
  color = 'gray',
  size = 'md',
  className,
  children,
}: {
  color?: GlyphColor
  size?: 'sm' | 'md' | 'lg'
  className?: string
  children: React.ReactNode
}) {
  const sizeClass = {
    sm: 'w-7 h-7 rounded-[8px]',
    md: 'w-9 h-9 rounded-[10px]',
    lg: 'w-14 h-14 rounded-[14px]',
  }[size]

  const colorClass = {
    chore: 'bg-chore',
    calendar: 'bg-tint-calendar',
    lists: 'bg-tint-lists',
    budget: 'bg-tint-budget',
    messages: 'bg-tint-messages',
    family: 'bg-tint-family',
    rewards: 'bg-tint-rewards',
    projects: 'bg-tint-projects',
    meals: 'bg-tint-meals',
    gray: 'bg-surface-fill',
  }[color]

  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0 text-white',
        sizeClass,
        colorClass,
        className
      )}
    >
      {children}
    </div>
  )
}
