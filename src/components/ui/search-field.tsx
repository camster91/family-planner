'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * SearchField — iOS-style rounded search input (rounded-full, soft fill).
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  clearLabel = 'Clear',
  ariaLabel,
  className,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  clearLabel?: string
  ariaLabel?: string
  className?: string
  onSubmit?: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-label-tertiary pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
        placeholder={placeholder}
        className="no-native-clear w-full h-11 pl-9 pr-14 rounded-full bg-surface-fill text-subhead text-label-primary placeholder:text-label-tertiary focus:outline-none focus:bg-surface-fill-secondary transition-colors"
      />
      {value && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
          aria-label={clearLabel || 'Clear'}
        >
          {/* Keep the small visual circle inside a 44px touch target. */}
          <span
            className="w-5 h-5 rounded-full bg-label-tertiary flex items-center justify-center"
            aria-hidden="true"
          >
            <X className="w-3 h-3 text-white" />
          </span>
        </button>
      )}
    </div>
  )
}
