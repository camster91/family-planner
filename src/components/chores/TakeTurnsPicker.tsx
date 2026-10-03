'use client'

/**
 * "Take turns" (O-38) for the chore create and edit forms: a switch, and when
 * it is on, an ordered member picker. Tap people in the order they take
 * turns; each shows its number; tap again to take them out. At least two.
 *
 * Only shown for repeating chores (the forms hide it for "Once").
 */
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { ROTATION_MAX, ROTATION_MIN } from '@/lib/chore-rotation'

export type TakeTurnsMember = { id: string; name: string }

export function TakeTurnsPicker({
  members,
  on,
  onToggle,
  order,
  onOrderChange,
}: {
  members: TakeTurnsMember[]
  on: boolean
  onToggle: (on: boolean) => void
  order: string[]
  onOrderChange: (order: string[]) => void
}) {
  const id = useId()
  const labelId = `${id}-label`
  const descId = `${id}-desc`
  const names = new Map(members.map((m) => [m.id, m.name]))
  const tooFew = on && order.length < ROTATION_MIN

  const tap = (memberId: string) => {
    if (order.includes(memberId)) onOrderChange(order.filter((x) => x !== memberId))
    else if (order.length < ROTATION_MAX) onOrderChange([...order, memberId])
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={labelId} className="label-apple mb-0">
            Take turns
          </p>
          <p id={descId} className="text-footnote text-label-secondary">
            Each time it repeats, the next person does it.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={descId}
          onClick={() => onToggle(!on)}
          className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
        >
          {/* The word says the state; colour is not the only cue. */}
          <span className="w-7 text-right text-[14px] font-medium text-label-secondary" aria-hidden="true">
            {on ? 'On' : 'Off'}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors motion-reduce:transition-none',
              on ? 'bg-accent-fill' : 'bg-[var(--label-tertiary)]'
            )}
          >
            <span
              className={cn(
                'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
                on ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </span>
        </button>
      </div>

      {on && (
        <div className="mt-3">
          <p id={`${id}-pick`} className="text-footnote text-label-secondary mb-2">
            Tap people in the order they take turns. Tap again to take someone out.
          </p>
          <div role="group" aria-labelledby={`${id}-pick`} className="grid grid-cols-2 gap-2">
            {members.map((m) => {
              const place = order.indexOf(m.id)
              const picked = place >= 0
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => tap(m.id)}
                  aria-pressed={picked}
                  aria-label={picked ? `${m.name}, turn ${place + 1}` : m.name}
                  className={cn(
                    'flex min-h-[44px] items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-all duration-200 motion-reduce:transition-none',
                    picked
                      ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                      : 'border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-primary'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-footnote font-semibold',
                      picked ? 'bg-accent-fill text-white' : 'border border-[var(--surface-separator)] text-label-tertiary'
                    )}
                  >
                    {picked ? place + 1 : ''}
                  </span>
                  <span className="min-w-0 break-words text-body">{m.name}</span>
                </button>
              )
            })}
          </div>
          {order.length > 0 && (
            <p className="text-footnote text-label-secondary mt-2" aria-live="polite">
              Order: {order.map((x) => names.get(x) ?? 'Someone').join(' → ')}
              {order.length >= ROTATION_MIN ? ` → ${names.get(order[0]) ?? 'Someone'}` : ''}
            </p>
          )}
          {tooFew && (
            <p className="text-footnote text-[var(--danger-text)] mt-1">Pick at least {ROTATION_MIN} people.</p>
          )}
        </div>
      )}
    </div>
  )
}
