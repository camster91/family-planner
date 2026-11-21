'use client'

import { useId } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { calendarFormMessages, type CalendarFormMessage } from '@/i18n/calendar-forms'

/**
 * "All day" for the event create and edit forms: a switch that sits with the
 * date. On, the forms hide the time and duration fields and keep the date
 * (src/lib/all-day.ts). The word On/Off says the state, so colour is never
 * the only cue, and the whole control is at least 44px tall.
 */
export function EventAllDaySwitch({ on, onChange, disabled = false }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const message = (key: CalendarFormMessage) => t(key, undefined, calendarFormMessages)
  const labelId = useId()
  const hintId = useId()
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3" data-testid="event-all-day">
      <div className="min-w-0">
        <p id={labelId} className="text-body font-medium text-label-primary">{message('allDay')}</p>
        <p id={hintId} className="text-footnote text-label-secondary">{message('allDayHint')}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className="group inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 rounded-full px-1 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60"
      >
        <span className="w-7 text-right text-[14px] font-medium text-label-secondary" aria-hidden="true">
          {on ? message('switchOn') : message('switchOff')}
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
  )
}
