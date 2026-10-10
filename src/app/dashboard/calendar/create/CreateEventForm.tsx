'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calendar as CalendarIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'
import { calendarFormMessages, type CalendarFormMessage, type CalendarFormError } from '@/i18n/calendar-forms'
import { EventDuration } from '@/components/calendar/EventDuration'
import { eventFormRange, toDateOnlyLocal } from '@/lib/dates'

export default function CreateEventForm({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const { t } = useTranslation()
  const message = (key: CalendarFormMessage, params?: Record<string, string | number>) => t(key, params, calendarFormMessages)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [duration, setDuration] = useState('')
  const [location, setLocation] = useState('')
  const submitHint = !title.trim() && !startDate ? message('requiredBoth') : !title.trim() ? message('requiredTitle') : !startDate ? message('requiredStart') : null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CalendarFormError | null>(null)
  const router = useRouter()
  useEffect(() => { onBusyChange?.(loading) }, [loading, onBusyChange])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Form values are local wall-clock time; send real ISO instants (with offset)
      // An end time without an end date is on the start day (src/lib/dates.ts).
      const range = eventFormRange({ startDate, startTime, endDate, endTime }, undefined, duration === '' ? undefined : Number(duration))
      const startDateTime = range?.start
      const endDateTime = range?.end

      if (!startDateTime || !endDateTime) {
        setError({ key: 'invalidTime' })
        setLoading(false)
        return
      }

      if (new Date(endDateTime) < new Date(startDateTime)) {
        setError({ key: 'endBeforeStart' })
        setLoading(false)
        return
      }

      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          start_time: startDateTime,
          end_time: endDateTime,
          location: location || null,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ? { raw: data.error } : { key: 'createFailed' })
        return
      }

      router.push('/dashboard/calendar')
      router.refresh()
    } catch (err) {
      setError({ key: 'unexpected' })
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={inSheet ? "" : "max-w-xl mx-auto pb-20"}>
      {!inSheet && <>
      {/* Back nav */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/calendar" className="btn-plain text-base py-2">
          <ArrowLeft className="w-5 h-5" />
          <span>{message('calendar')}</span>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-large-title font-display">{message('newEvent')}</h1>
        <p className="text-subhead text-label-secondary mt-1">{message('createDescription')}</p>
      </div>

      </>}
      <form onSubmit={handleSubmit} className={inSheet ? "space-y-5" : "mt-6 space-y-5 px-4"}>

        {error && (
          <div className="card-apple p-4 border border-[var(--danger)]">
            <p role="alert" className="text-body text-[var(--danger-text)]">{'key' in error ? message(error.key) : error.raw}</p>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="label-apple" htmlFor="title">{message('title')}</label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-apple"
            placeholder={message('titlePlaceholder')}
          />
        </div>

        {/* Description */}
        <div>
          <label className="label-apple" htmlFor="description">{message('description')}</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-apple min-h-[80px] resize-none"
            placeholder={message('descriptionPlaceholder')}
            rows={3}
          />
        </div>

        {/* Start */}
        <div>
          <label className="label-apple" htmlFor="startDate">{message('start')}</label>
          <div className="grid grid-cols-2 gap-3">
            <input
              id="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input-apple"
              min={toDateOnlyLocal(new Date())}
            />
            <input
              id="startTime"
              aria-label={message('startTime')}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="input-apple"
            />
          </div>
        </div>

        <EventDuration value={duration} onChange={next => {
          if (next === '' && duration !== '') {
            const range = eventFormRange({ startDate, startTime, endDate, endTime }, undefined, Number(duration))
            if (range) {
              const end = new Date(range.end)
              setEndDate(`${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`)
              setEndTime(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`)
            }
          }
          setDuration(next)
        }} end={duration === '' ? undefined : eventFormRange({ startDate, startTime, endDate, endTime }, undefined, Number(duration))?.end} />

        {/* End */}
        <div hidden={duration !== ''}>
          <label className="label-apple" htmlFor="endDate">{message('end')}</label>
          <div className="grid grid-cols-2 gap-3">
            <input
              id="endDate"
              disabled={duration !== ''}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input-apple"
              min={startDate || toDateOnlyLocal(new Date())}
            />
            <input
              id="endTime"
              disabled={duration !== ''}
              aria-label={message('endTime')}
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="input-apple"
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="label-apple" htmlFor="location">{message('location')}</label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="input-apple"
            placeholder={message('createLocationPlaceholder')}
          />
        </div>

        {/* Submit */}
        <div className={inSheet ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-3 pb-1" : "pt-2"}>
          <button
            type="submit"
            disabled={loading || submitHint !== null}
            aria-describedby={submitHint ? 'create-event-hint' : undefined}
            className="btn-filled w-full"
          >
            {loading ? message('creating') : message('create')}
          </button>
          {submitHint && (
            <p id="create-event-hint" className="text-footnote text-label-secondary mt-2 text-center">
              {submitHint}
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
