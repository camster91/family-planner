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
  className,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  onSubmit?: () => void
}) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-label-tertiary pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-9 rounded-full bg-surface-fill text-subhead text-label-primary placeholder:text-label-tertiary focus:outline-none focus:bg-surface-fill-secondary transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-label-tertiary flex items-center justify-center"
          aria-label="Clear"
        >
          <X className="w-3 h-3 text-white" />
        </button>
      )}
    </div>
  )
}
