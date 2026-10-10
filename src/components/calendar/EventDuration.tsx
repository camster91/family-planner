'use client'

import { useState } from 'react'
import { useTranslation } from '@/i18n'
import { calendarFormMessages, type CalendarFormMessage } from '@/i18n/calendar-forms'

/** Duration is optional: existing event instants stay untouched until selected. */
export function EventDuration({ value, onChange, end }: { value: string; onChange: (value: string) => void; end?: string }) {
  const { t, locale } = useTranslation()
  const message = (key: CalendarFormMessage, params?: Record<string, string | number>) => t(key, params, calendarFormMessages)
  const [custom, setCustom] = useState(false)
  return <div>
    <label className="label-apple" htmlFor="eventDuration">{message('duration')}</label>
    <select id="eventDuration" className="input-apple min-h-[44px]" value={custom && value !== '' ? 'custom' : value} onChange={e => {
      const next = e.target.value
      setCustom(next === 'custom')
      onChange(next === 'custom' ? (value || '60') : next)
    }}>
      <option value="">{message('customEnd')}</option>
      {[15, 30, 45, 60, 90, 120].map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? message('minutes', { count: minutes }) : minutes === 60 ? message('hour') : message('hours', { count: minutes / 60 })}</option>)}
      <option value="custom">{message('customDuration')}</option>
    </select>
    {custom && value !== '' && <div className="mt-3">
      <label className="label-apple" htmlFor="durationMinutes">{message('durationMinutes')}</label>
      <input id="durationMinutes" className="input-apple min-h-[44px]" type="number" min="1" max="525600" step="1" required value={value === '0' ? '' : value} onChange={e => onChange(e.target.value || '0')} />
    </div>}
    {value !== '' && end && <p className="text-footnote text-label-secondary mt-2" aria-live="polite">{message('endsAt', { time: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(end)) })}</p>}
  </div>
}
