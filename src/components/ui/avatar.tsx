import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Avatar — Apple's circular monogram avatar.
 * Apple-style: pure white text on a tinted bg, perfect circle, optional ring.
 */
const AVATAR_COLORS = [
  'bg-chore', 'bg-tint-calendar', 'bg-tint-lists', 'bg-tint-budget',
  'bg-tint-messages', 'bg-tint-family', 'bg-tint-rewards', 'bg-tint-projects',
] as const

function pickColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizeClass = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
    xl: 'w-20 h-20 text-2xl',
  }[size]

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('rounded-full object-cover shrink-0', sizeClass, className)}
      />
    )
  }

  return (
    <div
      aria-label={name}
      className={cn(
        'rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none',
        sizeClass,
        pickColor(name),
        className
      )}
    >
      {initials(name)}
    </div>
  )
}
