'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Check, Circle } from 'lucide-react'

/**
 * CheckboxRow — large tappable checkbox + label + secondary text.
 * iOS Reminders style: full-row tap, square check on the right.
 *
 * With `toggleArea="control"` only the round check (a 44px target) toggles;
 * the title and subtitle are plain text, so a row that also has other actions
 * (edit, reassign...) is not ticked off by a tap on its name.
 */
export function CheckboxRow({
  checked,
  onChange,
  title,
  subtitle,
  meta,                          // right-side secondary text (e.g. "Today")
  glyph,                          // optional left glyph
  wrap = false,                   // wrap long text instead of truncating
  disabled = false,
  toggleArea = 'row',
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  glyph?: React.ReactNode
  wrap?: boolean
  /** Shown but not toggleable (e.g. a chore a parent already checked). */
  disabled?: boolean
  /** What a tap toggles: the whole row (default) or only the check control. */
  toggleArea?: 'row' | 'control'
  className?: string
}) {
  const id = React.useId()
  const titleId = `${id}-title`
  const subtitleId = `${id}-subtitle`
  const toggle = () => {
    if (!disabled) onChange(!checked)
  }
  const rowClass = cn(
    'w-full flex items-center gap-3 px-4 py-3 min-h-[52px] text-left',
    toggleArea === 'row' && 'active:bg-[var(--surface-fill-secondary)]',
    'transition-colors duration-200',
    className
  )

  const text = (
    <>
      {glyph}
      <div className="flex-1 min-w-0">
        <div id={toggleArea === 'control' ? titleId : undefined} className={cn(
          'text-body',
          wrap ? 'break-words' : 'truncate',
          checked ? 'text-label-tertiary line-through' : 'text-label-primary'
        )}>
          {title}
        </div>
        {subtitle && (
          <div id={toggleArea === 'control' ? subtitleId : undefined} className={cn('text-footnote text-label-secondary', wrap ? 'break-words' : 'truncate')}>{subtitle}</div>
        )}
      </div>
      {meta && (
        <div className="text-footnote text-label-tertiary shrink-0">{meta}</div>
      )}
    </>
  )

  const circle = (
    <div className={cn(
      'w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all duration-200',
      checked
        ? 'bg-success border-success animate-check-pop'
        : 'border-label-tertiary'
    )}>
      {checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
    </div>
  )

  if (toggleArea === 'control') {
    return (
      <div className={rowClass}>
        {text}
        {/* 44px target around the 24px circle; the negative margin keeps the
            circle where the full-row variant draws it. Named by the title. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-disabled={disabled || undefined}
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          onClick={toggle}
          className={cn(
            '-mx-2.5 w-11 h-11 shrink-0 flex items-center justify-center rounded-full',
            'active:bg-[var(--surface-fill-secondary)] transition-colors duration-200',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]'
          )}
        >
          {circle}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      onClick={toggle}
      className={rowClass}
    >
      {text}
      {circle}
    </button>
  )
}
