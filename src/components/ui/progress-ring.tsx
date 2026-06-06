import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * ProgressRing — Apple Activity-style ring.
 * Stroke draws from 12 o'clock, springs to target percentage.
 */
export function ProgressRing({
  progress,                              // 0..1
  size = 56,
  strokeWidth = 6,
  color = 'var(--accent)',
  trackColor = 'var(--surface-fill)',
  className,
  children,
}: {
  progress: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  className?: string
  children?: React.ReactNode
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circumference * (1 - clamped)

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="progress-ring">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="progress-ring"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-label-primary font-semibold">
        {children}
      </div>
    </div>
  )
}
