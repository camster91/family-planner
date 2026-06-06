import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * LargeHeader — Apple-style "Good morning, Cam" header.
 * Used at the top of the Today page and most primary surfaces.
 */
export function LargeHeader({
  greeting,
  title,
  subtitle,
  trailing,
  className,
}: {
  greeting?: string
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex items-end justify-between gap-4 px-1 pt-2 pb-4', className)}>
      <div className="min-w-0">
        {greeting && (
          <p className="text-subhead text-label-secondary mb-0.5">{greeting}</p>
        )}
        <h1 className="text-large-title text-label-primary truncate">{title}</h1>
        {subtitle && (
          <p className="text-subhead text-label-secondary mt-1">{subtitle}</p>
        )}
      </div>
      {trailing}
    </header>
  )
}
