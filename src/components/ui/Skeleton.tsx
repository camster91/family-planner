'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton — shimmer loading placeholder.
 * Rounded rect with a shimmer sweep animation.
 */
export function Skeleton({
  className,
  width,
  height,
}: {
  className?: string
  width?: string | number
  height?: string | number
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-fill)] shimmer',
        className
      )}
      style={{ width, height }}
    />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('card-apple p-4 space-y-3', className)}>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  )
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', className)}>
      <Skeleton className="h-9 w-9 rounded-[var(--radius-md)]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}