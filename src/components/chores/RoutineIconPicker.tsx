'use client'

import * as React from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ROUTINE_NAME_MAX,
  ROUTINE_ORDER_MAX,
  ROUTINE_SUGGESTIONS,
  routineIconLabel,
  searchRoutineIcons,
} from '@/lib/routine-icons'
import { RoutineIcon } from './RoutineIcon'

export interface RoutineIconPickerProps {
  /** Selected icon key, or null for no picture. */
  value: string | null
  onChange: (key: string | null) => void
  /** Prefix for element ids (two pickers on one page stay distinct). */
  idPrefix?: string
}

/**
 * Picture picker for a chore (#272): a searchable grid of the built-in icons.
 * Every choice is a labelled button of at least 64×64 (>= 44 target), with the
 * name under the picture; the selected one is `aria-pressed` and outlined, and
 * its name is repeated in text above the grid (not colour alone).
 */
export function RoutineIconPicker({ value, onChange, idPrefix = 'chore-icon' }: RoutineIconPickerProps) {
  const [query, setQuery] = React.useState('')
  const results = searchRoutineIcons(query)
  const selectedLabel = routineIconLabel(value)
  const legendId = `${idPrefix}-legend`
  const searchId = `${idPrefix}-search`

  return (
    <fieldset aria-labelledby={legendId} data-testid="routine-icon-picker">
      <legend id={legendId} className="label-apple">
        Picture
      </legend>
      <p className="text-footnote text-label-secondary mb-2" aria-live="polite">
        {selectedLabel ? `Selected: ${selectedLabel}` : 'No picture selected. Young kids can follow a routine by its pictures.'}
      </p>
      <div className="relative mb-3">
        <label htmlFor={searchId} className="sr-only">
          Search pictures
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label-tertiary" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pictures, e.g. teeth"
          className="input-apple pl-9"
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2 max-h-[320px] overflow-y-auto p-0.5">
        {query.trim() === '' && (
          <PickerButton pressed={value === null} label="No picture" onClick={() => onChange(null)}>
            <span className="flex h-9 w-9 items-center justify-center text-title-3 text-label-tertiary" aria-hidden>
              –
            </span>
          </PickerButton>
        )}
        {results.map((icon) => (
          <PickerButton
            key={icon.key}
            pressed={value === icon.key}
            label={icon.label}
            onClick={() => onChange(value === icon.key ? null : icon.key)}
            iconKey={icon.key}
          >
            <RoutineIcon icon={icon.key} className="h-9 w-9" />
          </PickerButton>
        ))}
      </div>
      {results.length === 0 && (
        <p className="text-footnote text-label-secondary mt-2" role="status">
          No pictures match “{query.trim()}”.
        </p>
      )}
    </fieldset>
  )
}

function PickerButton({
  pressed,
  label,
  onClick,
  children,
  iconKey,
}: {
  pressed: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
  iconKey?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-icon-key={iconKey ?? 'none'}
      className={cn(
        'flex min-h-[76px] min-w-[64px] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border-2 px-1 py-2 text-center transition-colors duration-150',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        pressed
          ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
          : 'border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-primary'
      )}
    >
      {children}
      <span className="text-caption-1 leading-tight">{label}</span>
    </button>
  )
}

export interface RoutineFieldsProps {
  routine: string
  onRoutineChange: (value: string) => void
  /** Step number as typed ('' for none). */
  order: string
  onOrderChange: (value: string) => void
  idPrefix?: string
}

/** Routine name (with suggestions) and step number for a chore (#272). */
export function RoutineFields({ routine, onRoutineChange, order, onOrderChange, idPrefix = 'chore' }: RoutineFieldsProps) {
  const listId = `${idPrefix}-routine-suggestions`
  return (
    <div className="grid grid-cols-[1fr_7rem] gap-3">
      <div>
        <label className="label-apple" htmlFor={`${idPrefix}-routine`}>
          Routine
        </label>
        <input
          id={`${idPrefix}-routine`}
          type="text"
          list={listId}
          value={routine}
          maxLength={ROUTINE_NAME_MAX}
          onChange={(e) => onRoutineChange(e.target.value)}
          className="input-apple"
          placeholder="e.g. Morning"
          aria-describedby={`${idPrefix}-routine-help`}
        />
        <datalist id={listId}>
          {ROUTINE_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="label-apple" htmlFor={`${idPrefix}-routine-order`}>
          Step
        </label>
        <input
          id={`${idPrefix}-routine-order`}
          type="number"
          inputMode="numeric"
          min={1}
          max={ROUTINE_ORDER_MAX}
          value={order}
          onChange={(e) => onOrderChange(e.target.value)}
          className="input-apple"
          placeholder="1"
          disabled={routine.trim() === ''}
        />
      </div>
      <p id={`${idPrefix}-routine-help`} className="col-span-2 -mt-1 text-footnote text-label-tertiary">
        Chores in the same routine show on the kid home as picture cards, in step order.
      </p>
    </div>
  )
}

/** The request fields for a routine, from the form's text values. */
export function routineRequestFields(routine: string, order: string): { routine: string | null; routine_order: number | null } {
  const name = routine.trim()
  const step = Number.parseInt(order, 10)
  return {
    routine: name === '' ? null : name,
    routine_order: name !== '' && Number.isFinite(step) ? step : null,
  }
}
