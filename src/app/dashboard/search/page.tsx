'use client'

import * as React from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { SearchField } from '@/components/ui/search-field'
import { cn } from '@/lib/utils'

export default function SearchPage() {
  const [query, setQuery] = React.useState('')

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-large-title font-display">Search</h1>
        <p className="text-subhead text-label-secondary mt-0.5">
          Find chores, events, lists, and people
        </p>
      </div>

      {/* Search input */}
      <div className="relative">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search across chores, events, lists, and people"
          className="w-full"
        />
      </div>

      {/* Results placeholder */}
      {query === '' ? (
        <div className={cn(
          'card-apple p-8 text-center',
          'flex flex-col items-center'
        )}>
          <div className="w-16 h-16 rounded-full bg-[var(--surface-fill)] flex items-center justify-center mb-4">
            <Search className="w-7 h-7 text-label-tertiary" />
          </div>
          <h3 className="text-title-3 text-label-primary mb-1">
            Search everything
          </h3>
          <p className="text-subhead text-label-secondary max-w-xs">
            Search across chores, events, lists, and people
          </p>

          {/* Quick filters */}
          <div className="flex flex-wrap gap-2 mt-6 justify-center">
            {['Chores', 'Events', 'Lists', 'Family'].map((filter) => (
              <button
                key={filter}
                type="button"
                className="btn-ghost text-footnote py-1.5"
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={cn(
          'card-apple p-8 text-center'
        )}>
          <Search className="w-8 h-8 text-label-tertiary mx-auto mb-3" />
          <p className="text-subhead text-label-secondary">
            No results for &ldquo;{query}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}