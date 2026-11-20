'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { shortNames, type PersonFilterValue, type PersonOption } from '@/lib/person-display'
import { PersonAvatar } from './person-chip'

/**
 * "Everyone · Mia · Casey": show only the items for one person. A group of
 * pressed/unpressed buttons (one is always pressed), each at least 44px, that
 * wraps instead of scrolling sideways. All words come from the caller so each
 * screen keeps its own English and Spanish copy. Renders nothing for fewer
 * than two people: there is nothing to choose between.
 */
export function PersonFilter({
  people,
  value,
  onChange,
  label,
  everyoneLabel,
  className,
}: {
  people: ReadonlyArray<PersonOption>
  value: PersonFilterValue
  onChange: (next: PersonFilterValue) => void
  /** Group name for assistive tech, e.g. "Show items for". */
  label: string
  everyoneLabel: string
  className?: string
}) {
  const names = React.useMemo(() => shortNames(people), [people])
  if (people.length < 2) return null
  const button = (selected: boolean) =>
    cn(
      'inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-full border px-3 py-1.5 text-subhead font-semibold',
      'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
      selected
        ? 'border-[var(--label-primary)] bg-[var(--surface-elevated)] text-label-primary shadow-sm'
        : 'border-[var(--surface-separator)] text-label-secondary hover:text-label-primary',
    )
  return (
    <div role="group" aria-label={label} data-testid="person-filter" className={cn('flex max-w-full flex-wrap gap-2', className)}>
      <button type="button" aria-pressed={value === 'all'} onClick={() => onChange('all')} className={button(value === 'all')}>
        {everyoneLabel}
      </button>
      {people.map((person) => {
        const name = names.get(person.key) ?? person.name
        return (
          <button
            key={person.key}
            type="button"
            aria-pressed={value === person.key}
            onClick={() => onChange(person.key)}
            className={button(value === person.key)}
          >
            <PersonAvatar name={name} color={person.color} size="sm" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
          </button>
        )
      })}
    </div>
  )
}
