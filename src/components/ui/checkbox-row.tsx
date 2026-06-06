'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Check, Circle } from 'lucide-react'

/**
 * CheckboxRow — large tappable checkbox + label + secondary text.
 * iOS Reminders style: full-row tap, square check on the right.
 */
export function CheckboxRow({
  checked,
  onChange,
  title,
  subtitle,
  meta,                          // right-side secondary text (e.g. "Today")
  glyph,                          // optional left glyph
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  glyph?: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 min-h-[52px] text-left',
        'active:bg-[var(--surface-fill-secondary)]',
        'transition-colors duration-200',
        className
      )}
    >
      {glyph}
      <div className="flex-1 min-w-0">
        <div className={cn(
          'text-body truncate',
          checked ? 'text-label-tertiary line-through' : 'text-label-primary'
        )}>
          {title}
        </div>
        {subtitle && (
          <div className="text-footnote text-label-secondary truncate">{subtitle}</div>
        )}
      </div>
      {meta && (
        <div className="text-footnote text-label-tertiary shrink-0">{meta}</div>
      )}
      <div className={cn(
        'w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all duration-200',
        checked
          ? 'bg-success border-success animate-check-pop'
          : 'border-label-tertiary'
      )}>
        {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      </div>
    </button>
  )
}
