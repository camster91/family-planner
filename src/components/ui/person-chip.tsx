import * as React from 'react'
import { cn } from '@/lib/utils'
import { MEMBER_COLOR_CSS } from '@/lib/member-colors'
import { firstName, personColor, personInitial } from '@/lib/person-display'

/**
 * The person's initial on their colour (src/lib/member-colors.ts). Always
 * decoration next to a printed name, so it is hidden from assistive tech and
 * colour never carries meaning on its own. An unknown colour draws a neutral
 * circle.
 */
export function PersonAvatar({
  name,
  color,
  size = 'sm',
  className,
}: {
  name: string
  color?: string | null
  size?: 'xs' | 'sm' | 'md'
  className?: string
}) {
  const key = personColor(color)
  return (
    <span
      aria-hidden="true"
      data-member-color={key ?? undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold leading-none',
        size === 'xs' && 'h-[1.125rem] w-[1.125rem] text-[10px]',
        size === 'sm' && 'h-6 w-6 text-[12px]',
        size === 'md' && 'h-8 w-8 text-[15px]',
        key ? 'text-white' : 'bg-[var(--surface-fill-secondary)] text-label-primary',
        className,
      )}
      style={key ? { backgroundColor: MEMBER_COLOR_CSS[key] } : undefined}
    >
      {personInitial(name)}
    </span>
  )
}

/**
 * Who an item is for: initial on the person's colour plus their first name
 * (or `label`, e.g. "For Casey"). Server-safe and dependency-free so it can
 * sit on the Today board without growing its first-load script.
 */
export function PersonChip({
  name,
  color,
  label,
  size = 'sm',
  className,
  testId = 'person-chip',
}: {
  /** Display name; the chip prints the first name and uses its initial. */
  name: string
  color?: string | null
  /** Visible text instead of the first name (must still name the person). */
  label?: string
  size?: 'sm' | 'md'
  className?: string
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-fill)] py-0.5 pl-0.5 pr-2.5 align-middle font-medium text-label-primary',
        size === 'sm' ? 'text-footnote' : 'text-[15px] md:text-[17px] 2xl:text-[18px]',
        className,
      )}
    >
      <PersonAvatar name={name} color={color} size={size === 'sm' ? 'xs' : 'sm'} />
      <span data-person-name className="min-w-0 [overflow-wrap:anywhere]">{label ?? firstName(name)}</span>
    </span>
  )
}

/** Several people, wrapping on narrow screens. Nothing for an empty list. */
export function PersonChips({
  people,
  label,
  size = 'sm',
  className,
}: {
  people: ReadonlyArray<{ name: string; color?: string | null; key?: string }> | null | undefined
  /** Words before the names for assistive tech, e.g. "For". */
  label?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  if (!people || people.length === 0) return null
  return (
    <span
      data-testid="person-chips"
      className={cn('inline-flex max-w-full flex-wrap items-center gap-1', className)}
    >
      {label && <span className="sr-only">{label} </span>}
      {people.map((person, index) => (
        <PersonChip key={person.key ?? `${index}:${person.name}`} name={person.name} color={person.color} size={size} />
      ))}
    </span>
  )
}
